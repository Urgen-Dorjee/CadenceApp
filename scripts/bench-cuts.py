"""Measure how well Cadence finds songs by listening, on real songs whose boundaries are known.

Point it at a folder of songs where every file is exactly one song (a music library, or
the songs Cadence saved). Nothing is uploaded or changed.

Test 1: each song on its own, as a one-song video. Every piece beyond one is a wrong cut.
Test 2: songs joined into jukeboxes (2 s gaps, brief dips, crossfades). Cuts are scored
        against the real boundaries.

Usage (from backend/): venv/Scripts/python.exe ../scripts/bench-cuts.py <folder> [songs per jukebox]
Decoded audio is cached in %TEMP%; delete cadence-bench-*.pkl after changing the folder.
"""

import hashlib
import os
import pickle
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.getcwd())
from core.ffmpeg_utils import get_ffmpeg_path  # noqa: E402
from services import audio_analysis  # noqa: E402
from services.audio_profile import RATE, profile_from_samples  # noqa: E402

AUDIO = (".mp3", ".m4a", ".flac", ".opus", ".ogg", ".wav")
TOLERANCE_S = 5.0


def decode(path: str) -> np.ndarray:
    cmd = [get_ffmpeg_path(), "-nostdin", "-hide_banner", "-loglevel", "error", "-i", path,
           "-vn", "-ac", "1", "-ar", str(RATE), "-f", "s16le", "-"]
    out = subprocess.run(cmd, capture_output=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout
    return np.frombuffer(out, dtype=np.int16).astype(np.float32) / 32768.0


def load(folder: str) -> dict[str, np.ndarray]:
    files = sorted(os.path.join(d, f) for d, _, fs in os.walk(folder) for f in fs if f.lower().endswith(AUDIO))
    key = hashlib.sha1("\n".join(files).encode()).hexdigest()[:10]
    cache = os.path.join(os.environ.get("TEMP", "."), f"cadence-bench-{key}.pkl")
    if os.path.exists(cache):
        with open(cache, "rb") as f:
            return pickle.load(f)
    songs = {}
    for path in files:
        samples = decode(path)
        if len(samples) > 60 * RATE:
            songs[path] = samples
    with open(cache, "wb") as f:
        pickle.dump(songs, f)
    return songs


def join(parts: list[np.ndarray], how: str) -> tuple[np.ndarray, list[float]]:
    out, bounds = parts[0].copy(), []
    for x in parts[1:]:
        if how == "crossfade 4 s":
            k = 4 * RATE
            ramp = np.linspace(0, 1, k, dtype=np.float32)
            bounds.append((len(out) - k / 2) / RATE)
            out = np.concatenate([out[:-k], out[-k:] * (1 - ramp) + x[:k] * ramp, x[k:]])
        else:
            gap = 2.0 if how == "gap 2 s" else 0.3
            bounds.append(len(out) / RATE + gap / 2)
            out = np.concatenate([out, np.zeros(int(gap * RATE), np.float32), x])
    return out, bounds


def main() -> None:
    songs = load(sys.argv[1])
    per_box = int(sys.argv[2]) if len(sys.argv) > 2 else 20
    names = sorted(songs, key=lambda p: -len(songs[p]))
    print(f"{len(names)} songs\n")

    chopped = []
    for path in names:
        tracks = audio_analysis.tracks_from_profile(profile_from_samples(songs[path]), "x")
        if len(tracks) > 1:
            chopped.append((len(songs[path]) / RATE / 60, [round(t["start"] / 60, 2) for t in tracks[1:]], os.path.basename(path)))
    print(f"TEST 1  one-song videos: {len(names) - len(chopped)} of {len(names)} kept whole")
    for minutes, cuts, name in chopped:
        print(f"   {minutes:4.1f} min, cut at {cuts} min  {name[:60]}".encode("ascii", "replace").decode())

    rng = np.random.default_rng(3)
    rest = names[per_box:]
    rng.shuffle(rest)
    boxes = [b for b in (names[:per_box], rest[:per_box], rest[per_box:2 * per_box]) if len(b) >= 3]
    totals = {"right": 0, "boundaries": 0, "inside": 0, "unflagged": 0}
    print(f"\nTEST 2  jukeboxes (a cut is right within {TOLERANCE_S:.0f} s of a real boundary)")
    for n, box in enumerate(boxes, 1):
        lengths = [len(songs[p]) / RATE / 60 for p in box]
        print(f" jukebox {n}: {len(box)} songs of {min(lengths):.1f}-{max(lengths):.1f} min")
        for how in ("gap 2 s", "dip 0.3 s", "crossfade 4 s"):
            audio, truth = join([songs[p] for p in box], how)
            tracks = audio_analysis.tracks_from_profile(profile_from_samples(audio), "x")
            cuts = [(t["start"], t["confidence"]) for t in tracks[1:]]
            right = [c for c, _ in cuts if min(abs(c - b) for b in truth) <= TOLERANCE_S]
            inside = [(c, conf) for c, conf in cuts if c not in right]
            unflagged = sum(1 for _, conf in inside if conf >= 0.7)
            found = sum(1 for b in truth if any(abs(c - b) <= TOLERANCE_S for c, _ in cuts))
            totals["right"] += found
            totals["boundaries"] += len(truth)
            totals["inside"] += len(inside)
            totals["unflagged"] += unflagged
            print(f"   {how:14} found {found:2}/{len(truth)} boundaries, {len(inside):2} cuts inside songs ({unflagged} not flagged)")
    print(f"\nSUMMARY  whole: {len(names) - len(chopped)}/{len(names)} | boundaries found: {totals['right']}/{totals['boundaries']}"
          f" | cuts inside songs: {totals['inside']} ({totals['unflagged']} not flagged)")


if __name__ == "__main__":
    main()
