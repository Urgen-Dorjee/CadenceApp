"""Splitting files from the user's computer (needs the real FFmpeg)."""

import asyncio
import hashlib
import os
import subprocess

import pytest
from fastapi.testclient import TestClient

from config import settings
from core.db import get_store
from core.ffmpeg_utils import get_ffmpeg_path, is_ffmpeg_available
from main import app
from services import local_media, pipeline

pytestmark = pytest.mark.skipif(not is_ffmpeg_available(), reason="FFmpeg not installed")
AUTH = {"host": f"127.0.0.1:{settings.backend_port}", "x-cadence-token": "test-token"}

# Three "songs" (tones) of 100 s, 95 s and 110 s, each followed by 1.5 s of silence.
# Gaps: 100.0-101.5 and 196.5-198.0.
SONGS = [(440, 100), (660, 95), (550, 110)]


def _render(path: str, extra: list[str]) -> None:
    inputs, labels = [], []
    for i, (freq, dur) in enumerate(SONGS):
        inputs += ["-f", "lavfi", "-i", f"sine=frequency={freq}:duration={dur}:sample_rate=44100"]
        inputs += ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:d=1.5"]
        labels.append(f"[{2 * i}:a][{2 * i + 1}:a]")
    graph = "".join(labels) + f"concat=n={2 * len(SONGS)}:v=0:a=1[out]"
    subprocess.run(
        [get_ffmpeg_path(), "-hide_banner", "-loglevel", "error", "-y", *inputs, "-filter_complex", graph,
         "-map", "[out]", *extra, path],
        check=True,
    )


def _sha(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def _run_job(file_path: str) -> dict:
    job = get_store().create(file_path)
    asyncio.run(pipeline._analyze(job["id"]))
    return get_store().get(job["id"])


@pytest.fixture(scope="module")
def flac_with_cue(tmp_path_factory):
    folder = tmp_path_factory.mktemp("cue")
    path = str(folder / "My Album.flac")
    _render(path, ["-c:a", "flac", "-metadata", "artist=Tag Singer"])
    # Times 2-3 s off, like a real cue made from another release.
    (folder / "My Album.cue").write_text("\n".join([
        'PERFORMER "Lata Mangeshkar"', 'TITLE "Cue Album"', 'REM DATE 1995', 'FILE "My Album.flac" WAVE',
        '  TRACK 01 AUDIO', '    TITLE "First"', '    INDEX 01 00:00:00',
        '  TRACK 02 AUDIO', '    TITLE "Second"', '    INDEX 01 01:43:00',
        '  TRACK 03 AUDIO', '    TITLE "Third"', '    INDEX 01 03:19:00',
    ]), encoding="utf-8")
    return path


@pytest.fixture(scope="module")
def mkv_with_chapters(tmp_path_factory):
    folder = tmp_path_factory.mktemp("mkv")
    meta = folder / "chapters.txt"
    meta.write_text(
        ";FFMETADATA1\ntitle=Concert\n"
        "[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=102000\ntitle=Opening\n"
        "[CHAPTER]\nTIMEBASE=1/1000\nSTART=102000\nEND=199000\ntitle=Middle\n"
        "[CHAPTER]\nTIMEBASE=1/1000\nSTART=199000\nEND=308000\ntitle=Finale\n",
        encoding="utf-8",
    )
    path = str(folder / "Concert.mkv")
    _render(path, ["-c:a", "libopus", "-b:a", "96k"])
    with_chapters = str(folder / "Concert with chapters.mkv")
    subprocess.run(
        [get_ffmpeg_path(), "-hide_banner", "-loglevel", "error", "-y", "-i", path, "-i", str(meta),
         "-map_metadata", "1", "-map_chapters", "1", "-c", "copy", with_chapters],
        check=True,
    )
    return with_chapters


def test_flac_with_cue_sheet(flac_with_cue):
    before = _sha(flac_with_cue)
    job = _run_job(flac_with_cue)
    assert job["status"] == "review", job["error"]
    assert job["title"] == "My Album"
    source = job["sources"][0]
    assert source["local"] is True and source["path"] == flac_with_cue
    assert source["preview_path"] == ""  # FLAC plays as is
    tracks = job["tracks"]
    assert [t["title"] for t in tracks] == ["First", "Second", "Third"]
    assert all(t["origin"] == "cue" for t in tracks)
    assert 100.0 <= tracks[1]["start"] <= 101.5   # cue said 103 s
    assert 196.5 <= tracks[2]["start"] <= 198.0   # cue said 199 s
    assert job["collection"]["type"] == "album"
    assert job["collection"]["album"] == "Cue Album" and job["collection"]["year"] == "1995"
    assert _sha(flac_with_cue) == before


def test_mkv_chapters_and_playback_copy(mkv_with_chapters):
    before = _sha(mkv_with_chapters)
    job = _run_job(mkv_with_chapters)
    assert job["status"] == "review", job["error"]
    source = job["sources"][0]
    assert [t["title"] for t in job["tracks"]] == ["Opening", "Middle", "Finale"]
    assert 100.0 <= job["tracks"][1]["start"] <= 101.5
    assert source["preview_path"].endswith(local_media.PREVIEW_NAME) and os.path.isfile(source["preview_path"])
    with TestClient(app, base_url=f"http://127.0.0.1:{settings.backend_port}") as client:
        r = client.get(f"/api/jobs/{job['id']}/sources/{source['id']}/audio", headers=AUTH)
    assert r.status_code == 200 and len(r.content) > 1000
    assert _sha(mkv_with_chapters) == before


def test_removing_downloads_never_deletes_the_users_file(flac_with_cue):
    job = _run_job(flac_with_cue)
    sources = asyncio.run(pipeline.remove_downloads(job["id"], job["sources"]))
    assert sources[0]["path"] == flac_with_cue and os.path.isfile(flac_with_cue)
    asyncio.run(pipeline.delete_work_files(job["id"]))
    assert os.path.isfile(flac_with_cue)


def test_playable_local_file_is_served_directly(flac_with_cue):
    job = _run_job(flac_with_cue)
    with TestClient(app, base_url=f"http://127.0.0.1:{settings.backend_port}") as client:
        r = client.get(f"/api/jobs/{job['id']}/sources/{job['sources'][0]['id']}/audio", headers=AUTH)
    assert r.status_code == 200 and r.content[:4] == b"fLaC"


def test_moved_file_fails_with_a_clear_message(tmp_path):
    path = str(tmp_path / "gone.mp3")
    job = get_store().create(path)
    asyncio.run(pipeline._analyze(job["id"]))
    job = get_store().get(job["id"])
    assert job["status"] == "failed" and "no longer there" in job["error"]


@pytest.fixture
def client():
    with TestClient(app, base_url=f"http://127.0.0.1:{settings.backend_port}") as c:
        yield c


def test_create_job_validation(client, tmp_path, flac_with_cue):
    text_file = tmp_path / "notes.txt"
    text_file.write_text("hi")
    cases = [
        ({"path": str(tmp_path / "missing.mp3")}, "couldn't be found"),
        ({"path": str(text_file)}, "can't split .txt"),
        ({"path": "relative/song.mp3"}, "couldn't be found"),
        ({}, "YouTube link or choose a file"),
        ({"url": "https://youtu.be/x", "path": flac_with_cue}, "YouTube link or choose a file"),
    ]
    for body, message in cases:
        r = client.post("/api/jobs", json=body, headers=AUTH)
        assert r.status_code == 422, body
        assert message in str(r.json()["detail"]), r.json()
