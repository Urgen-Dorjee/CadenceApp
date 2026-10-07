"""Loudness measurement (EBU R128), ReplayGain values and silence trimming for saved songs.

Two ways to even out loudness, chosen in Settings:

- "tags": measure each song and the whole album and write ReplayGain tags.
  Players apply them; the audio itself is not changed.
- "normalize": set each song to a target loudness with one fixed gain, capped so
  the true peak stays at or below -1 dBTP. No compressor or limiter, so the
  music's dynamics are untouched.
"""

import math
import re
import subprocess
from typing import Any

import numpy as np

from core.ffmpeg_utils import get_ffmpeg_path

REPLAYGAIN_REFERENCE_LUFS = -18.0   # ReplayGain 2.0
OPUS_R128_REFERENCE_LUFS = -23.0    # Opus R128_*_GAIN tags (RFC 7845)
TRUE_PEAK_CEILING_DB = -1.0
MAX_BOOST_DB = 20.0
SILENT_LUFS = -70.0                 # ebur128 reports this for silence

TRIM_THRESHOLD_DB = -50.0           # quieter than this at a song's edge is trimmed...
TRIM_PAD_S = 0.15                   # ...keeping this much before the first and after the last sound
TRIM_MAX_S = 10.0                   # never trim more than this from either edge
TRIM_RATE = 8000

_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
_I_RE = re.compile(r"Integrated loudness:\s*I:\s*(-?[\d.]+|-inf)\s*LUFS", re.S)
_SAMPLE_PEAK_RE = re.compile(r"Sample peak:\s*Peak:\s*(-?[\d.]+|-inf)\s*dBFS", re.S)
_TRUE_PEAK_RE = re.compile(r"True peak:\s*Peak:\s*(-?[\d.]+|-inf)\s*dBFS", re.S)


def _db(text: str) -> float:
    return -math.inf if text == "-inf" else float(text)


def parse_ebur128(stderr: str) -> dict[str, float | None]:
    """{lufs, sample_peak_db, true_peak_db} from FFmpeg's ebur128 summary. lufs is None for silence."""
    summary = stderr[stderr.rfind("Summary:"):]
    i, sp, tp = _I_RE.search(summary), _SAMPLE_PEAK_RE.search(summary), _TRUE_PEAK_RE.search(summary)
    if not i:
        raise RuntimeError("Couldn't measure loudness.")
    lufs = _db(i.group(1))
    return {
        "lufs": None if lufs <= SILENT_LUFS else lufs,
        "sample_peak_db": _db(sp.group(1)) if sp else -math.inf,
        "true_peak_db": _db(tp.group(1)) if tp else -math.inf,
    }


def measure(src: str, start: float, end: float) -> dict[str, float | None]:
    """EBU R128 loudness and peaks of one song in the source. Blocking."""
    cmd = [
        get_ffmpeg_path(), "-nostdin", "-hide_banner", "-nostats", "-ss", f"{start:.3f}", "-t", f"{max(0.0, end - start):.3f}",
        "-i", src, "-map", "0:a:0", "-vn", "-af", "ebur128=peak=true+sample", "-f", "null", "-",
    ]
    proc = subprocess.run(cmd, capture_output=True, creationflags=_NO_WINDOW)
    return parse_ebur128(proc.stderr.decode("utf-8", errors="replace"))


def normalize_gain(measured: dict[str, float | None], target_lufs: float) -> float:
    """Fixed gain in dB that brings a song to `target_lufs` without its true peak passing -1 dBTP."""
    lufs = measured["lufs"]
    if lufs is None:
        return 0.0
    gain = target_lufs - lufs
    true_peak = measured["true_peak_db"]
    if true_peak is not None and math.isfinite(true_peak):
        gain = min(gain, TRUE_PEAK_CEILING_DB - true_peak)
    return round(max(-MAX_BOOST_DB, min(MAX_BOOST_DB, gain)), 2)


def album_loudness(songs: list[tuple[float, dict[str, float | None]]]) -> float | None:
    """Loudness of all songs together: the duration-weighted energy average of their loudness."""
    weighted = [(d, m["lufs"]) for d, m in songs if m["lufs"] is not None and d > 0]
    if not weighted:
        return None
    total = sum(d for d, _ in weighted)
    return 10 * math.log10(sum(d * 10 ** (lufs / 10) for d, lufs in weighted) / total)


def replaygain(measured: dict[str, float | None], album_lufs: float | None, album_peak_db: float,
               applied_gain_db: float = 0.0) -> dict[str, Any] | None:
    """ReplayGain 2.0 values for one song: gains in dB and peaks as linear sample values.

    `applied_gain_db` is any gain already applied to the audio, so tags stay correct.
    """
    if measured["lufs"] is None:
        return None
    lufs = measured["lufs"] + applied_gain_db
    peak = measured["sample_peak_db"] + applied_gain_db
    result = {
        "track_gain": round(REPLAYGAIN_REFERENCE_LUFS - lufs, 2),
        "track_peak": round(10 ** (peak / 20), 6) if math.isfinite(peak) else 0.0,
        "track_lufs": lufs,
    }
    if album_lufs is not None:
        result["album_gain"] = round(REPLAYGAIN_REFERENCE_LUFS - (album_lufs + applied_gain_db), 2)
        result["album_peak"] = round(10 ** ((album_peak_db + applied_gain_db) / 20), 6) if math.isfinite(album_peak_db) else 0.0
        result["album_lufs"] = album_lufs + applied_gain_db
    return result


def opus_r128_gain(lufs: float) -> str:
    """Opus R128_*_GAIN tag: Q7.8 fixed point, relative to -23 LUFS."""
    return str(int(round((OPUS_R128_REFERENCE_LUFS - lufs) * 256)))


# --- Trimming silence at song edges ---------------------------------------------

def _decode(src: str, start: float, length: float) -> np.ndarray:
    cmd = [get_ffmpeg_path(), "-nostdin", "-hide_banner", "-loglevel", "error", "-ss", f"{max(0.0, start):.3f}", "-t", f"{length:.3f}",
           "-i", src, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", str(TRIM_RATE), "-f", "s16le", "-"]
    proc = subprocess.run(cmd, capture_output=True, creationflags=_NO_WINDOW)
    return np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0


def _loud_frames(samples: np.ndarray, threshold_db: float) -> np.ndarray:
    """Indexes of 10 ms frames louder than `threshold_db`."""
    frame = TRIM_RATE // 100
    n = len(samples) // frame
    if n == 0:
        return np.zeros(0, dtype=int)
    frames = samples[: n * frame].reshape(n, frame)
    peak = np.max(np.abs(frames), axis=1)
    return np.flatnonzero(20 * np.log10(np.maximum(peak, 1e-9)) > threshold_db)


def trim_bounds(src: str, start: float, end: float, threshold_db: float = TRIM_THRESHOLD_DB) -> tuple[float, float]:
    """(start, end) with silence at both edges removed, keeping a short pad. Blocking.

    Only the first and last TRIM_MAX_S seconds are examined, so a quiet intro or
    fade-out longer than that is kept. A song that is silent throughout is left as is.
    """
    length = end - start
    edge = min(TRIM_MAX_S, length / 2)
    if edge <= 0.1:
        return start, end
    head = _loud_frames(_decode(src, start, edge), threshold_db)
    tail = _loud_frames(_decode(src, end - edge, edge), threshold_db)
    new_start = start + max(0.0, head[0] * 0.01 - TRIM_PAD_S) if len(head) else start
    new_end = (end - edge) + min(edge, (tail[-1] + 1) * 0.01 + TRIM_PAD_S) if len(tail) else end
    if not len(head) and not len(tail) or new_end - new_start < 1.0:
        return start, end
    return round(new_start, 3), round(new_end, 3)
