"""Find songs from the audio itself, and snap cuts to the quietest point.

Used when a video has no tracklist. Two signals, from one AudioProfile:

1. Silent gaps (strong): runs of quiet 50 ms frames between songs.
2. Music change (weaker): where the sound before a point differs most from
   the sound after it. Only used to split segments too long to be one song,
   which is what a crossfaded jukebox looks like.
"""

import asyncio
import subprocess
from typing import Any

import numpy as np

from core.ffmpeg_utils import get_ffmpeg_path
from services.audio_profile import BLOCK_S, FRAME_S, AudioProfile
from services.tracklist import make_track

ANALYSIS_RATE = 8000
MIN_TRACK_SECONDS = 90.0
# Longer than this and a segment almost certainly holds more than one song.
MAX_TRACK_SECONDS = 450.0
SILENCE_DB = -38.0
MIN_SILENCE_SECONDS = 0.4
NOVELTY_WINDOW_SECONDS = 12.0
MIN_NOVELTY_Z = 1.0     # enough to split a segment that's too long to be one song
STRONG_NOVELTY_Z = 4.0  # enough to cut anywhere

_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


# --- Silent gaps -----------------------------------------------------------------

def silences_from_rms(rms: np.ndarray, threshold_db: float = SILENCE_DB,
                      min_length: float = MIN_SILENCE_SECONDS) -> list[tuple[float, float]]:
    """(start, end) of every run of frames quieter than `threshold_db` dBFS."""
    if len(rms) == 0:
        return []
    quiet = 20 * np.log10(np.maximum(rms, 1e-9)) < threshold_db
    padded = np.concatenate([[False], quiet, [False]])
    changes = np.flatnonzero(padded[1:] != padded[:-1])
    runs = changes.reshape(-1, 2)
    min_frames = int(round(min_length / FRAME_S))
    return [(round(a * FRAME_S, 3), round(b * FRAME_S, 3)) for a, b in runs if b - a >= min_frames]


def boundaries_from_silences(
    silences: list[tuple[float, float]], duration: float, min_track: float = MIN_TRACK_SECONDS
) -> list[tuple[float, float]]:
    """Choose cut points from silent gaps. Returns (time, confidence), sorted by time.

    Longer gaps win. A gap is skipped if accepting it would create a song shorter
    than `min_track`, which filters out quiet bridges inside one song.
    """
    candidates = sorted(silences, key=lambda s: s[1] - s[0], reverse=True)
    accepted: list[tuple[float, float]] = []
    for start, end in candidates:
        mid = (start + end) / 2
        if mid < min_track or duration - mid < min_track:
            continue
        if any(abs(mid - t) < min_track for t, _ in accepted):
            continue
        gap = end - start
        accepted.append((mid, min(0.85, 0.45 + gap / 5)))
    return sorted(accepted)


# --- Music change ----------------------------------------------------------------

def novelty_curve(features: np.ndarray, window_s: float = NOVELTY_WINDOW_SECONDS) -> np.ndarray:
    """For each 0.5 s block: how different the next `window_s` sounds from the last.

    Features are standardised per dimension, then the distance between the mean
    of the window before and the window after is taken (prefix sums keep it O(n)).
    Returned as a robust z-score so thresholds don't depend on the recording.
    """
    n = len(features)
    w = max(1, int(round(window_s / BLOCK_S)))
    curve = np.zeros(n)
    if n < 2 * w + 1:
        return curve
    std = features.std(axis=0)
    z = (features - features.mean(axis=0)) / np.where(std > 1e-9, std, 1)
    csum = np.vstack([np.zeros(z.shape[1]), np.cumsum(z, axis=0)])
    i = np.arange(w, n - w + 1)
    before = (csum[i] - csum[i - w]) / w
    after = (csum[i + w] - csum[i]) / w
    curve[i] = np.linalg.norm(after - before, axis=1)
    # Light smoothing, then a robust z-score (median / MAD).
    curve = np.convolve(curve, np.ones(3) / 3, mode="same")
    valid = curve[w:n - w]
    med = np.median(valid)
    mad = np.median(np.abs(valid - med)) * 1.4826 or 1.0
    out = (curve - med) / mad
    out[:w] = out[n - w:] = 0
    return out


def add_strong_changes(
    cuts: list[tuple[float, float]], novelty: np.ndarray, duration: float,
    min_z: float = STRONG_NOVELTY_Z, min_track: float = MIN_TRACK_SECONDS,
) -> list[tuple[float, float]]:
    """Add cuts at very clear music changes, strongest first, keeping songs ≥ `min_track`.

    This is what finds songs in a crossfaded jukebox, where there are no gaps.
    """
    result = list(cuts)
    for idx in np.argsort(novelty)[::-1]:
        z = float(novelty[idx])
        if z < min_z:
            break
        t = (idx + 0.5) * BLOCK_S
        if t < min_track or duration - t < min_track:
            continue
        if any(abs(t - c) < min_track for c, _ in result):
            continue
        result.append((round(t, 3), round(min(0.65, 0.45 + 0.04 * z), 2)))
    return sorted(result)


def split_long_segments(
    cuts: list[tuple[float, float]], novelty: np.ndarray, duration: float,
    max_track: float = MAX_TRACK_SECONDS, min_track: float = MIN_TRACK_SECONDS,
) -> list[tuple[float, float]]:
    """Split any segment longer than `max_track` at its strongest music change.

    Repeats until every segment is short enough or has no clear change left.
    Cuts found this way get a low confidence, so the review screen flags them.
    """
    result = sorted(cuts)
    changed = True
    while changed:
        changed = False
        edges = [0.0] + [t for t, _ in result] + [duration]
        for a, b in zip(edges, edges[1:]):
            if b - a <= max_track:
                continue
            lo, hi = int((a + min_track) / BLOCK_S), int((b - min_track) / BLOCK_S)
            hi = min(hi, len(novelty) - 1)
            if hi <= lo:
                continue
            idx = lo + int(np.argmax(novelty[lo:hi + 1]))
            z = float(novelty[idx])
            if z < MIN_NOVELTY_Z:
                continue
            t = round((idx + 0.5) * BLOCK_S, 3)
            result.append((t, round(min(0.65, 0.45 + 0.05 * z), 2)))
            result.sort()
            changed = True
            break
    return result


def tracks_from_profile(profile: AudioProfile, source_id: str) -> list[dict[str, Any]]:
    """Songs found from the audio alone: silent gaps first, then music changes."""
    duration = profile.duration
    cuts = boundaries_from_silences(silences_from_rms(profile.rms), duration)
    novelty = novelty_curve(profile.features)
    cuts = add_strong_changes(cuts, novelty, duration)
    cuts = split_long_segments(cuts, novelty, duration)
    if not cuts:
        return [make_track(title="Track 1", start=0, end=duration, origin="silence", source_id=source_id, confidence=0.3)]
    tracks = []
    edges = [(0.0, 1.0)] + cuts + [(duration, 1.0)]
    for i in range(len(edges) - 1):
        start, start_conf = edges[i]
        end, end_conf = edges[i + 1]
        tracks.append(
            make_track(
                title=f"Track {i + 1}", start=start, end=end, origin="silence",
                source_id=source_id, confidence=min(start_conf, end_conf),
            )
        )
    return tracks


# --- Snapping cuts to the gap between songs -------------------------------------
#
# Timestamps from chapters and descriptions are whole seconds and often a few
# seconds off, so each cut is moved to where one song really ends and the next
# begins. Two cases:
#
# 1. A gap: a stretch of near-silence at least GAP_MIN_S long. Short dips
#    between notes or drum hits (30-80 ms) are not gaps, so they can't trap the cut.
#    The cut goes in the deepest part of the gap.
# 2. No gap (crossfade): the cut goes to the lowest point of the smoothed
#    loudness, which is the middle of the crossfade.
#
# Nearby candidates are preferred, so a cut never jumps to a pause inside a song
# when a real gap is closer to the timestamp.

SNAP_HOP_S = 0.01          # loudness measured every 10 ms...
SNAP_FRAME_S = 0.03        # ...over 30 ms
GAP_BELOW_DB = 30.0        # a gap is this much quieter than the music around it
GAP_FLOOR_DB = -50.0       # anything below this is silence, however quiet the music
GAP_MIN_S = 0.15
DEEPEST_WITHIN_DB = 3.0    # cut in the part of the gap within 3 dB of its quietest point
SILENCE_FLOOR_DB = -70.0   # below this everything counts as equally silent
CROSSFADE_SMOOTH_S = 0.4


def _loudness_db(samples: np.ndarray, rate: int) -> tuple[np.ndarray, np.ndarray]:
    """(times, level in dBFS) every SNAP_HOP_S, measured over SNAP_FRAME_S."""
    frame = max(1, int(rate * SNAP_FRAME_S))
    hop = max(1, int(rate * SNAP_HOP_S))
    if len(samples) < frame:
        return np.zeros(0), np.zeros(0)
    n = 1 + (len(samples) - frame) // hop
    squares = np.concatenate([[0.0], np.cumsum(np.square(samples.astype(np.float64)))])
    starts = hop * np.arange(n)
    power = (squares[starts + frame] - squares[starts]) / frame
    times = (starts + frame / 2) / rate
    return times, 10 * np.log10(np.maximum(power, 1e-12))


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """(start, end) index pairs of every run of True values, end exclusive."""
    padded = np.concatenate([[False], mask, [False]])
    changes = np.flatnonzero(padded[1:] != padded[:-1])
    return [(int(a), int(b)) for a, b in changes.reshape(-1, 2)]


def _deepest_middle(level: np.ndarray, a: int, b: int) -> int:
    """Index in the middle of the quietest part of level[a:b].

    Digital silence at the end of a fade and the hiss of a gap are both inaudible,
    so levels below SILENCE_FLOOR_DB count as equal and the cut lands mid-silence.
    """
    gap = np.maximum(level[a:b], SILENCE_FLOOR_DB)
    deep = _runs(gap <= float(gap.min()) + DEEPEST_WITHIN_DB)
    lo, hi = max(deep, key=lambda r: r[1] - r[0])
    return a + (lo + hi - 1) // 2


def find_cut_offset(samples: np.ndarray, rate: int, center: float) -> float:
    """Offset (seconds into `samples`) where one song ends and the next begins.

    `center` is the rough cut. Returns it unchanged if the window is too short to judge.
    """
    times, level = _loudness_db(samples, rate)
    if len(times) < 3:
        return center
    span = max(center, times[-1] - center, 1e-6)
    music = float(np.percentile(level, 90))
    threshold = max(min(music - GAP_BELOW_DB, -20.0), GAP_FLOOR_DB)
    hop_s = times[1] - times[0]

    gaps = [(a, b) for a, b in _runs(level < threshold) if (b - a) * hop_s >= GAP_MIN_S]
    if gaps:
        def score(run: tuple[int, int]) -> float:
            a, b = run
            length = min((b - a) * hop_s, 1.0)          # up to 1 s, longer gaps are more convincing
            depth = min(threshold - float(level[a:b].min()), 30.0) / 30.0
            middle = times[(a + b - 1) // 2]
            return length + 0.5 * depth - 1.2 * abs(middle - center) / span
        a, b = max(gaps, key=score)
        return float(times[_deepest_middle(level, a, b)])

    # No gap: songs crossfade. Cut at the lowest point of the smoothed loudness.
    k = max(1, int(round(CROSSFADE_SMOOTH_S / hop_s)))
    power = np.convolve(10 ** (level / 10), np.ones(k) / k, mode="same")
    smooth = 10 * np.log10(np.maximum(power, 1e-12))
    smooth[: k // 2] = smooth[len(smooth) - k // 2:] = np.inf  # edges only see half a window
    penalty = 1.5 * np.abs(times - center) / span   # dB: a clearly deeper dip may sit further away
    return float(times[int(np.argmin(smooth + penalty))])


def _run(cmd: list[str], **kwargs: Any) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, creationflags=_NO_WINDOW, **kwargs)


def _decode_window(path: str, start: float, length: float) -> np.ndarray:
    cmd = [
        get_ffmpeg_path(), "-hide_banner", "-loglevel", "error",
        "-ss", f"{start:.3f}", "-t", f"{length:.3f}", "-i", path,
        "-ac", "1", "-ar", str(ANALYSIS_RATE), "-f", "s16le", "-",
    ]
    proc = _run(cmd)
    return np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0


async def snap_to_gap(path: str, t: float, window: float, duration: float) -> float:
    """Move cut `t` to the real boundary between songs within ±window seconds."""
    if window <= 0 or t <= 0 or t >= duration:
        return t
    start = max(0.0, t - window)
    length = min(duration, t + window) - start
    samples = await asyncio.to_thread(_decode_window, path, start, length)
    if samples.size == 0:
        return t
    return round(start + find_cut_offset(samples, ANALYSIS_RATE, t - start), 3)


async def refine_boundaries(tracks: list[dict[str, Any]], path: str, duration: float, window: float) -> None:
    """Snap every shared boundary between consecutive tracks, in place.

    Consecutive tracks share one cut point, so there is never a gap or an
    overlap between songs.
    """
    for prev, nxt in zip(tracks, tracks[1:]):
        if abs(prev["end"] - nxt["start"]) > 0.5:
            continue  # not contiguous (user removed a section); leave both edges alone
        cut = await snap_to_gap(path, nxt["start"], window, duration)
        prev["end"] = nxt["start"] = cut
