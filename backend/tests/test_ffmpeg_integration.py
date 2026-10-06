"""End-to-end audio checks against the real FFmpeg binary (skipped when it's missing)."""

import asyncio
import subprocess

import pytest

from core.ffmpeg_utils import get_ffprobe_path, is_ffmpeg_available, get_ffmpeg_path
from services import audio_analysis, audio_profile, exporter
from services.tracklist import make_track

pytestmark = pytest.mark.skipif(not is_ffmpeg_available(), reason="FFmpeg not installed")


def _make_fake_jukebox(path: str) -> None:
    """Three 'songs' (tones) of 100 s, 95 s and 110 s separated by 1.5 s of silence."""
    parts = [(440, 100), (660, 95), (550, 110)]
    inputs, filters = [], []
    for i, (freq, dur) in enumerate(parts):
        inputs += ["-f", "lavfi", "-i", f"sine=frequency={freq}:duration={dur}:sample_rate=44100"]
        inputs += ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:d=1.5"]
        filters.append(f"[{2 * i}:a][{2 * i + 1}:a]")
    graph = "".join(filters) + f"concat=n={2 * len(parts)}:v=0:a=1[out]"
    subprocess.run(
        [get_ffmpeg_path(), "-hide_banner", "-loglevel", "error", "-y", *inputs,
         "-filter_complex", graph, "-map", "[out]", "-ac", "1", "-c:a", "libopus", "-b:a", "96k", path],
        check=True,
    )


def _duration(path: str) -> float:
    out = subprocess.run(
        [get_ffprobe_path(), "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
        capture_output=True, check=True, text=True,
    )
    return float(out.stdout.strip())


@pytest.fixture(scope="module")
def jukebox(tmp_path_factory):
    path = str(tmp_path_factory.mktemp("audio") / "jukebox.opus")
    _make_fake_jukebox(path)
    return path


def test_profile_fallback_finds_both_gaps(jukebox, tmp_path):
    duration = _duration(jukebox)
    progress = []
    profile = audio_profile.build_profile(jukebox, duration, on_progress=progress.append)
    assert abs(profile.duration - duration) < 0.2
    assert progress and progress[-1] > 0.95
    audio_profile.save_peaks(str(tmp_path), "src", profile)
    assert (tmp_path / "peaks-src.json").exists()
    tracks = audio_analysis.tracks_from_profile(profile, "src")
    assert len(tracks) == 3
    # Gap centres are at 100.75 s and 197.25 s
    assert abs(tracks[1]["start"] - 100.75) < 0.5
    assert abs(tracks[2]["start"] - 197.25) < 0.5


def test_snapping_moves_a_rough_cut_into_the_gap(jukebox):
    duration = _duration(jukebox)
    # Chapter says the 2nd song starts at 102 s, but the real gap is 100.0-101.5 s.
    tracks = [
        make_track(title="A", start=0, end=102, origin="chapters", source_id="s"),
        make_track(title="B", start=102, end=duration, origin="chapters", source_id="s"),
    ]
    asyncio.run(audio_analysis.refine_boundaries(tracks, jukebox, duration, window=5.0))
    assert 100.0 <= tracks[1]["start"] <= 101.5
    assert tracks[0]["end"] == tracks[1]["start"]  # shared cut: no gap, no overlap


@pytest.mark.parametrize("fmt", ["mp3", "flac", "m4a", "opus"])
def test_cut_encode_and_tag(jukebox, tmp_path, fmt):
    dest = str(tmp_path / f"song.{fmt}")
    cover = tmp_path / "cover.jpg"
    subprocess.run(
        [get_ffmpeg_path(), "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
         "-i", "color=c=blue:s=64x64:d=1", "-frames:v", "1", str(cover)],
        check=True,
    )
    asyncio.run(exporter.cut_track(jukebox, 100.75, 197.25, dest, fmt, 192, 10))
    assert abs(_duration(dest) - 96.5) < 0.1

    exporter.write_tags(
        dest, fmt,
        {"title": "Test Song", "artist": "Singer", "album_artist": "Singer", "album": "Album",
         "year": "1995", "track": 2, "total": 3},
        str(cover),
    )
    import mutagen

    audio = mutagen.File(dest, easy=fmt in ("mp3", "m4a"))
    assert audio is not None
    title = audio.get("title") or audio.get("\xa9nam")
    assert title[0] == "Test Song"


def test_pasted_tracklist_snaps_to_the_real_gaps(jukebox):
    """Gaps are at 100.0-101.5 s and 196.5-198.0 s; the pasted times are about 3 s off."""
    from fastapi.testclient import TestClient

    from config import settings
    from core.db import get_store
    from main import app

    store = get_store()
    job = store.create("https://www.youtube.com/watch?v=j")
    store.update(job["id"], status="review", sources=[{"id": "s", "path": jukebox, "duration": _duration(jukebox)}])
    headers = {"host": f"127.0.0.1:{settings.backend_port}", "x-cadence-token": "test-token"}
    with TestClient(app, base_url=f"http://127.0.0.1:{settings.backend_port}") as client:
        r = client.post(f"/api/jobs/{job['id']}/tracklist", json={"text": "0:00 A\n1:44 B\n3:15 C"}, headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["snapped"] is True
    a, b, c = body["tracks"]
    assert 100.0 <= b["start"] <= 101.5 and a["end"] == b["start"]
    assert 196.5 <= c["start"] <= 198.0 and b["end"] == c["start"]


def test_drifting_timestamps_still_find_the_gaps(jukebox):
    """Timestamps 7-8 s late, beyond the ±5 s window: the wide search and drift tracking find both gaps."""
    duration = _duration(jukebox)
    tracks = [
        make_track(title="A", start=0, end=108, origin="chapters", source_id="s"),
        make_track(title="B", start=108, end=205, origin="chapters", source_id="s"),
        make_track(title="C", start=205, end=duration, origin="chapters", source_id="s"),
    ]
    asyncio.run(audio_analysis.refine_boundaries(tracks, jukebox, duration, window=5.0))
    assert 100.0 <= tracks[1]["start"] <= 101.5
    assert 196.5 <= tracks[2]["start"] <= 198.0
    assert all(t["confidence"] >= 0.9 for t in tracks)
