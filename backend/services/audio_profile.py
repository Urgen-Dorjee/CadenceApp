"""One streaming decode of a source that yields everything later stages need.

- 50 ms loudness frames (RMS and peak), for silence detection and the waveform
- 0.5 s spectral fingerprints (band energies + chroma), for spotting where the
  music changes when songs crossfade without a gap

A two-hour jukebox is decoded at 8 kHz mono in chunks, so memory stays small.
"""

import json
import os
import subprocess
from dataclasses import dataclass
from typing import Callable

import numpy as np

from core.ffmpeg_utils import get_ffmpeg_path

RATE = 8000
FRAME = 400            # 50 ms loudness frame
BLOCK = 4000           # 0.5 s spectral block = 10 loudness frames
FFT_SIZE = 4096
N_BANDS = 24
FRAME_S = FRAME / RATE
BLOCK_S = BLOCK / RATE
MAX_PEAKS = 16000

_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

_freqs = np.fft.rfftfreq(FFT_SIZE, 1 / RATE)
_band_edges = np.geomspace(60, RATE / 2 - 1, N_BANDS + 1)
_band_index = np.digitize(_freqs, _band_edges) - 1  # -1 / N_BANDS = out of range
_chroma_mask = (_freqs >= 100) & (_freqs <= 3000)
_chroma_index = np.zeros_like(_freqs, dtype=int)
_chroma_index[_chroma_mask] = np.round(12 * np.log2(_freqs[_chroma_mask] / 440.0)).astype(int) % 12
_window = np.hanning(BLOCK)


@dataclass
class AudioProfile:
    duration: float
    rms: np.ndarray       # per 50 ms frame, linear 0..1
    peak: np.ndarray      # per 50 ms frame, linear 0..1
    features: np.ndarray  # per 0.5 s block, shape (n_blocks, N_BANDS + 12)


def block_features(block: np.ndarray) -> np.ndarray:
    """Log band energies and a normalised chroma vector for one 0.5 s block."""
    spectrum = np.abs(np.fft.rfft(block * _window, n=FFT_SIZE)) ** 2
    valid = (_band_index >= 0) & (_band_index < N_BANDS)
    bands = np.bincount(_band_index[valid], weights=spectrum[valid], minlength=N_BANDS)
    chroma = np.bincount(_chroma_index[_chroma_mask], weights=spectrum[_chroma_mask], minlength=12)
    chroma = chroma / (chroma.sum() + 1e-9)
    return np.concatenate([np.log1p(bands * 1e3), chroma * 4])


def _process_unit(unit: np.ndarray, rms: list, peak: list, feats: list) -> None:
    frames = unit.reshape(-1, FRAME)
    rms.extend(np.sqrt(np.mean(frames * frames, axis=1)).tolist())
    peak.extend(np.max(np.abs(frames), axis=1).tolist())
    feats.append(block_features(unit))


def profile_from_samples(samples: np.ndarray) -> AudioProfile:
    """Profile from in-memory samples (8 kHz mono float32). Used by tests."""
    rms: list[float] = []
    peak: list[float] = []
    feats: list[np.ndarray] = []
    usable = len(samples) - len(samples) % BLOCK
    for i in range(0, usable, BLOCK):
        _process_unit(samples[i:i + BLOCK], rms, peak, feats)
    return _finish(len(samples) / RATE, rms, peak, feats)


def _finish(duration: float, rms: list, peak: list, feats: list) -> AudioProfile:
    features = np.array(feats) if feats else np.zeros((0, N_BANDS + 12))
    return AudioProfile(duration=duration, rms=np.array(rms), peak=np.array(peak), features=features)


def build_profile(path: str, duration: float, on_progress: Callable[[float], None] | None = None,
                  is_cancelled: Callable[[], bool] | None = None) -> AudioProfile:
    """Decode `path` once and build its profile. Blocking: run it in a thread."""
    cmd = [get_ffmpeg_path(), "-hide_banner", "-loglevel", "error", "-i", path,
           "-vn", "-ac", "1", "-ar", str(RATE), "-f", "s16le", "-"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=_NO_WINDOW)
    rms: list[float] = []
    peak: list[float] = []
    feats: list[np.ndarray] = []
    carry = np.zeros(0, dtype=np.float32)
    total = 0
    chunk_bytes = BLOCK * 2 * 40  # 20 s per read
    try:
        assert proc.stdout is not None
        while True:
            data = proc.stdout.read(chunk_bytes)
            if not data:
                break
            if is_cancelled and is_cancelled():
                raise InterruptedError()
            samples = np.frombuffer(data[: len(data) - len(data) % 2], dtype=np.int16).astype(np.float32) / 32768.0
            total += len(samples)
            buf = np.concatenate([carry, samples])
            usable = len(buf) - len(buf) % BLOCK
            for i in range(0, usable, BLOCK):
                _process_unit(buf[i:i + BLOCK], rms, peak, feats)
            carry = buf[usable:]
            if on_progress and duration:
                on_progress(min(1.0, total / RATE / duration))
    finally:
        proc.stdout and proc.stdout.close()
        proc.wait()
    # Trailing partial block: keep its loudness frames so the waveform reaches the end.
    tail = carry[: len(carry) - len(carry) % FRAME]
    if len(tail):
        frames = tail.reshape(-1, FRAME)
        rms.extend(np.sqrt(np.mean(frames * frames, axis=1)).tolist())
        peak.extend(np.max(np.abs(frames), axis=1).tolist())
    return _finish(total / RATE, rms, peak, feats)


# --- Waveform peaks --------------------------------------------------------------

def downsample_peaks(peak: np.ndarray, points: int) -> list[float]:
    """Max-pool 50 ms peaks to at most `points` values, normalised to 0..1."""
    if len(peak) == 0:
        return []
    points = max(1, min(points, len(peak)))
    edges = np.linspace(0, len(peak), points + 1).astype(int)
    pooled = np.maximum.reduceat(peak, edges[:-1])
    top = float(np.percentile(pooled, 99.5)) or float(pooled.max()) or 1.0
    return np.round(np.clip(pooled / top, 0, 1), 3).tolist()


def peaks_file(work_dir: str, source_id: str) -> str:
    return os.path.join(work_dir, f"peaks-{source_id}.json")


def save_peaks(work_dir: str, source_id: str, profile: AudioProfile) -> None:
    points = min(MAX_PEAKS, max(1, int(profile.duration * 8)))
    data = {"duration": profile.duration, "peaks": downsample_peaks(profile.peak, points)}
    tmp = peaks_file(work_dir, source_id) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f)
    os.replace(tmp, peaks_file(work_dir, source_id))


def window_peaks(path: str, start: float, end: float, points: int) -> dict:
    """High-resolution peaks for a short window, used by the cut close-up view."""
    start = max(0.0, start)
    length = max(0.1, end - start)
    cmd = [get_ffmpeg_path(), "-hide_banner", "-loglevel", "error", "-ss", f"{start:.3f}", "-t", f"{length:.3f}",
           "-i", path, "-vn", "-ac", "1", "-ar", str(RATE), "-f", "s16le", "-"]
    proc = subprocess.run(cmd, capture_output=True, creationflags=_NO_WINDOW)
    samples = np.abs(np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0)
    if samples.size == 0:
        return {"start": start, "end": start + length, "peaks": []}
    points = max(1, min(points, samples.size))
    edges = np.linspace(0, samples.size, points + 1).astype(int)
    pooled = np.maximum.reduceat(samples, edges[:-1])
    top = float(pooled.max()) or 1.0
    return {"start": start, "end": start + samples.size / RATE, "peaks": np.round(pooled / top, 3).tolist()}
