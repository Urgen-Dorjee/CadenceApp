"""The "Original" format: songs copied from the download without re-encoding (needs FFmpeg)."""

import asyncio
import os
import subprocess

import mutagen
import numpy as np
import pytest

from config import Preferences, save_preferences, settings
from core.db import get_store
from core.ffmpeg_utils import get_ffmpeg_path, is_ffmpeg_available
from services import exporter, pipeline
from services.tracklist import make_track

pytestmark = pytest.mark.skipif(not is_ffmpeg_available(), reason="FFmpeg not installed")
RATE = 48000


def _ff(*args):
    subprocess.run([get_ffmpeg_path(), "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def _decode(path, start=0.0, length=None):
    args = ["-ss", f"{start:.3f}"] + (["-t", f"{length:.3f}"] if length else []) + ["-i", path]
    proc = subprocess.run([get_ffmpeg_path(), "-hide_banner", "-loglevel", "error", *args,
                           "-ac", "1", "-ar", str(RATE), "-f", "f32le", "-"], capture_output=True, check=True)
    return np.frombuffer(proc.stdout, dtype=np.float32)


@pytest.fixture(scope="module")
def webm(tmp_path_factory):
    """Like a YouTube download: Opus in WebM. A chirp, so every moment sounds different."""
    path = str(tmp_path_factory.mktemp("orig") / "video.webm")
    _ff("-f", "lavfi", "-i", "aevalsrc=0.5*sin(2*PI*(200*t+40*t*t)):s=48000:d=12", "-c:a", "libopus", "-b:a", "128k", path)
    return path


def test_original_format_picks_the_matching_file_type(webm, tmp_path):
    assert exporter.original_format(webm) == ("opus", "ogg")
    wav = str(tmp_path / "a.wav")
    _ff("-f", "lavfi", "-i", "sine=duration=1", wav)
    assert exporter.original_format(wav) == ("flac", None)  # PCM can't be copied into a common type: lossless FLAC


def test_copied_song_is_not_reencoded_and_lands_within_a_packet(webm, tmp_path):
    dest = str(tmp_path / "song.opus")
    asyncio.run(exporter.cut_track(webm, 4.0, 9.0, dest, "opus", 0, 10, copy_muxer="ogg"))
    assert exporter.source_codec(dest) == "opus"
    full, cut = _decode(webm), _decode(dest)
    assert abs(len(cut) / RATE - 5.0) < 0.05
    # Where in the source does the copied song start? Align its first 100 ms against 3.8-4.2 s.
    probe_len = RATE // 10
    seg = cut[RATE // 50: RATE // 50 + probe_len]  # skip the decoder's first 20 ms
    lo = int(3.8 * RATE)
    scores = [float(np.dot(full[k:k + probe_len], seg)) for k in range(lo, int(4.2 * RATE))]
    start = (lo + int(np.argmax(scores))) / RATE - 0.02
    assert abs(start - 4.0) <= 0.03


def test_export_in_original_format(webm, tmp_path):
    save_preferences(Preferences(library_dir=str(tmp_path / "lib"), audio_format="original", loudness="normalize",
                                 trim_silence=False, write_playlist=False))
    try:
        store = get_store()
        job = store.create("https://www.youtube.com/watch?v=orig")
        store.update(job["id"], status="review", sources=[{"id": "s", "path": webm, "duration": 12}],
                     tracks=[make_track(title="One", start=0, end=6, origin="chapters", source_id="s"),
                             make_track(title="Two", start=6, end=12, origin="chapters", source_id="s")],
                     collection={"type": "album", "name": "A", "album": "A"})
        asyncio.run(pipeline._export(job["id"]))
        job = store.get(job["id"])
        assert job["status"] == "completed", job["error"]
        paths = [o["path"] for o in job["outputs"]]
        assert all(p.endswith(".opus") for p in paths)
        tags = mutagen.File(paths[0])
        assert tags["title"] == ["One"]
        # "Adjust volume" can't change copied audio, so ReplayGain tags are written instead.
        assert "replaygain_track_gain" in {k.lower() for k in tags.keys()}
    finally:
        os.remove(settings.prefs_path)
