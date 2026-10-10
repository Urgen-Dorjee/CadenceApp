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


# Jukeboxes often leave only a split second of silence between songs: too short for
# silences_from_rms, but much deeper than any pause inside a song.
DIP_BELOW_MEDIAN_DB = 37.0  # a dip is at least this much quieter than the typical level...
DIP_FLOOR_DB = -50.0        # ...and quieter than this
DIP_MERGE_S = 3.0
SONG_MIN_S = 150.0          # songs found this way should be 2.5 to 10 minutes long
SONG_MAX_S = 600.0


def short_dips(profile: AudioProfile, start: float, end: float, margin: float = 60.0) -> list[tuple[float, float]]:
    """(time, depth below the typical level in dB) of every brief near-silence inside (start, end)."""
    db = 20 * np.log10(np.maximum(profile.rms, 1e-9))
    if not len(db):
        return []
    threshold = min(DIP_FLOOR_DB, float(np.median(db)) - DIP_BELOW_MEDIAN_DB)
    quiet = np.concatenate([[False], db < threshold, [False]])
    runs = np.flatnonzero(quiet[1:] != quiet[:-1]).reshape(-1, 2)
    dips: list[tuple[float, float]] = []
    for a, b in runs:
        i = int(a + np.argmin(db[a:b]))
        t = round(i * FRAME_S, 3)
        if not (start + margin < t < end - margin):
            continue
        depth = float(np.median(db)) - max(float(db[i]), -100.0)
        if dips and t - dips[-1][0] < DIP_MERGE_S:
            if depth > dips[-1][1]:
                dips[-1] = (t, depth)
            continue
        dips.append((t, depth))
    return dips


def _choose(candidates: list[tuple[float, float]], start: float, end: float, count: int) -> list[tuple[float, float]]:
    """Exactly `count` of `candidates`, giving songs of believable, similar lengths (deeper dips win ties)."""
    typical = (end - start) / (count + 1)

    def cost(a: float, b: float) -> float:
        length = b - a
        outside = max(0.0, SONG_MIN_S - length) + max(0.0, length - SONG_MAX_S)
        return outside / 10 + ((length - typical) / typical) ** 2

    times = [t for t, _ in candidates]
    bonus = [-depth / 1000 for _, depth in candidates]
    m = len(times)
    inf = float("inf")
    # best[k][j]: lowest cost with k + 1 cuts chosen, the last at candidate j
    best = [[inf] * m for _ in range(count)]
    back = [[-1] * m for _ in range(count)]
    for j in range(m):
        best[0][j] = cost(start, times[j]) + bonus[j]
    for k in range(1, count):
        for j in range(k, m):
            for i in range(k - 1, j):
                c = best[k - 1][i] + cost(times[i], times[j]) + bonus[j]
                if c < best[k][j]:
                    best[k][j], back[k][j] = c, i
    j = min(range(m), key=lambda j: best[count - 1][j] + cost(times[j], end))
    chosen = []
    for k in range(count - 1, -1, -1):
        chosen.append(candidates[j])
        j = back[k][j]
    return chosen[::-1]


def cuts_in_range(profile: AudioProfile, start: float, end: float, count: int,
                  min_track: float = MIN_TRACK_SECONDS) -> list[tuple[float, float]]:
    """`count` cuts between `start` and `end`, for when the number of songs there is known.

    Brief silences between songs come first, choosing the ones that give songs of
    believable lengths; then longer silent gaps and, last, the clearest music changes
    (with a low confidence, so the review screen asks about them).
    Returns (time, confidence) sorted by time.
    """
    if count <= 0 or end - start < 2 * min_track:
        return []
    dips = short_dips(profile, start, end)
    if len(dips) >= count:
        chosen = _choose(dips, start, end, count)
        edges = [start] + [t for t, _ in chosen] + [end]
        cuts = []
        for i, (t, _) in enumerate(chosen):
            believable = all(SONG_MIN_S <= b - a <= SONG_MAX_S for a, b in ((edges[i], t), (t, edges[i + 2])))
            cuts.append((t, 0.75 if believable else 0.5))
        return cuts

    cuts = [(t, 0.7) for t, _ in dips]
    inside = [(a - start, b - start) for a, b in silences_from_rms(profile.rms) if a > start and b < end]
    for t, conf in sorted(boundaries_from_silences(inside, end - start, min_track), key=lambda c: c[1], reverse=True):
        if len(cuts) >= count:
            break
        if all(abs(t + start - c) >= min_track for c, _ in cuts):
            cuts.append((round(t + start, 3), min(conf, 0.6)))
    if len(cuts) < count:
        novelty = novelty_curve(profile.features)
        lo, hi = int((start + min_track) / BLOCK_S), min(int((end - min_track) / BLOCK_S), len(novelty) - 1)
        for idx in (lo + np.argsort(novelty[lo:hi + 1])[::-1] if hi > lo else []):
            if len(cuts) >= count:
                break
            t = round((int(idx) + 0.5) * BLOCK_S, 3)
            if all(abs(t - c) >= min_track for c, _ in cuts):
                cuts.append((t, 0.45))
    return sorted(cuts)


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
#
# Timestamps often drift: a tracklist made from an edited video can fall 10 s or
# more behind the audio by its end. Each cut that lands in a gap tells us the
# current drift, and the next cut is searched from its own timestamp to its
# timestamp plus that drift (preferring the latter), so both a drifting list and
# one that is only randomly off are covered.
# When there is still no gap in range, a wider search accepts only a clear gap;
# failing that, the crossfade cut is kept and flagged for review.

SNAP_HOP_S = 0.01          # loudness measured every 10 ms...
SNAP_FRAME_S = 0.03        # ...over 30 ms
GAP_BELOW_DB = 30.0        # a gap is this much quieter than the music around it
GAP_FLOOR_DB = -50.0       # anything below this is silence, however quiet the music
GAP_MIN_S = 0.15
DEEPEST_WITHIN_DB = 3.0    # cut in the part of the gap within 3 dB of its quietest point
SILENCE_FLOOR_DB = -70.0   # below this everything counts as equally silent
CROSSFADE_SMOOTH_S = 0.4
WIDE_SEARCH_S = 15.0       # second, wider search when no gap is within the normal window...
WIDE_GAP_MIN_S = 0.4       # ...which only accepts a clear gap
MAX_DRIFT_S = 30.0
UNSURE_CONFIDENCE = 0.6    # crossfade cut with no gap found: shown as "Check"


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
    """Offset (seconds into `samples`) where one song ends and the next begins."""
    return find_cut(samples, rate, center)[0]


def find_cut(
    samples: np.ndarray, rate: int, center: float, min_gap: float = GAP_MIN_S, allow_crossfade: bool = True
) -> tuple[float, bool]:
    """(offset in seconds, whether it is in a real gap) for the boundary nearest `center`.

    `center` is the rough cut. Without a gap, the crossfade point is returned, or
    `center` itself when `allow_crossfade` is False.
    """
    times, level = _loudness_db(samples, rate)
    if len(times) < 3:
        return center, False
    span = max(center, times[-1] - center, 1e-6)
    music = float(np.percentile(level, 90))
    threshold = max(min(music - GAP_BELOW_DB, -20.0), GAP_FLOOR_DB)
    hop_s = times[1] - times[0]

    gaps = [(a, b) for a, b in _runs(level < threshold) if (b - a) * hop_s >= min_gap]
    if gaps:
        def score(run: tuple[int, int]) -> float:
            a, b = run
            length = min((b - a) * hop_s, 1.0)          # up to 1 s, longer gaps are more convincing
            depth = min(threshold - float(level[a:b].min()), 30.0) / 30.0
            middle = times[(a + b - 1) // 2]
            return length + 0.5 * depth - 1.2 * abs(middle - center) / span
        a, b = max(gaps, key=score)
        return float(times[_deepest_middle(level, a, b)]), True
    if not allow_crossfade:
        return center, False

    # No gap: songs crossfade. Cut at the lowest point of the smoothed loudness.
    k = max(1, int(round(CROSSFADE_SMOOTH_S / hop_s)))
    power = np.convolve(10 ** (level / 10), np.ones(k) / k, mode="same")
    smooth = 10 * np.log10(np.maximum(power, 1e-12))
    smooth[: k // 2] = smooth[len(smooth) - k // 2:] = np.inf  # edges only see half a window
    penalty = 1.5 * np.abs(times - center) / span   # dB: a clearly deeper dip may sit further away
    return float(times[int(np.argmin(smooth + penalty))]), False


def _run(cmd: list[str], **kwargs: Any) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, creationflags=_NO_WINDOW, **kwargs)


def _decode_window(path: str, start: float, length: float) -> np.ndarray:
    cmd = [
        get_ffmpeg_path(), "-nostdin", "-hide_banner", "-loglevel", "error",
        "-ss", f"{start:.3f}", "-t", f"{length:.3f}", "-i", path,
        "-ac", "1", "-ar", str(ANALYSIS_RATE), "-f", "s16le", "-",
    ]
    proc = _run(cmd)
    return np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0


async def snap_to_gap(
    path: str, t: float, window: float, duration: float, min_gap: float = GAP_MIN_S,
    allow_crossfade: bool = True, also: float | None = None,
) -> tuple[float, bool]:
    """(cut, found a real gap) for the boundary between songs within ±window seconds of `t`.

    With `also`, the search reaches ±window around it too, still preferring points near `t`.
    """
    if window <= 0 or t <= 0 or t >= duration:
        return t, False
    lo, hi = (t, t) if also is None else (min(t, also), max(t, also))
    start = max(0.0, lo - window)
    length = min(duration, hi + window) - start
    samples = await asyncio.to_thread(_decode_window, path, start, length)
    if samples.size == 0:
        return t, False
    offset, found = find_cut(samples, ANALYSIS_RATE, t - start, min_gap, allow_crossfade)
    return round(start + offset, 3), found


async def refine_boundaries(tracks: list[dict[str, Any]], path: str, duration: float, window: float) -> None:
    """Snap every shared boundary between consecutive tracks, in place.

    Consecutive tracks share one cut point, so there is never a gap or an
    overlap between songs. Drift found at one cut is applied to the next.
    """
    if window <= 0:
        return
    drift = 0.0
    for prev, nxt in zip(tracks, tracks[1:]):
        if abs(prev["end"] - nxt["start"]) > 0.5:
            continue  # not contiguous (user removed a section); leave both edges alone
        stamp = nxt["start"]
        guess = min(max(stamp + drift, 0.0), duration)
        cut, found = await snap_to_gap(path, guess, window, duration, also=stamp)
        if not found:
            wide, found = await snap_to_gap(
                path, guess, max(window, WIDE_SEARCH_S), duration, min_gap=WIDE_GAP_MIN_S, allow_crossfade=False, also=stamp,
            )
            if found:
                cut = wide
        if found:
            drift = max(-MAX_DRIFT_S, min(MAX_DRIFT_S, cut - stamp))
        elif nxt.get("origin") != "manual":
            nxt["confidence"] = min(nxt.get("confidence", 1.0), UNSURE_CONFIDENCE)
        prev["end"] = nxt["start"] = cut
