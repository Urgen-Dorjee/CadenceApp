"""Saving options: per-split folder, removing downloads, clearing downloads, DB migration."""

import asyncio
import os
import sqlite3
import subprocess

import pytest
from fastapi.testclient import TestClient

from config import Preferences, save_preferences, settings
from core.db import JobStore, get_store
from core.ffmpeg_utils import get_ffmpeg_path, is_ffmpeg_available
from main import app
from services import pipeline
from services.tracklist import make_track

AUTH = {"host": f"127.0.0.1:{settings.backend_port}", "x-cadence-token": "test-token"}


def _job_with_audio(tmp_path, seconds=12):
    store = get_store()
    job = store.create("https://youtu.be/save-test")
    work = pipeline.job_dir(job["id"])
    os.makedirs(work, exist_ok=True)
    src = os.path.join(work, "src.opus")
    subprocess.run(
        [get_ffmpeg_path(), "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
         "-i", f"sine=frequency=440:duration={seconds}", "-c:a", "libopus", src],
        check=True,
    )
    tracks = [
        make_track(title="First", start=0, end=6, origin="chapters", source_id="s"),
        make_track(title="Second", start=6, end=seconds, origin="chapters", source_id="s"),
    ]
    store.update(
        job["id"], status="review", tracks=tracks,
        collection={"type": "album", "name": "Test Album", "album": "Test Album", "artist": "", "year": "2001"},
        sources=[{"id": "s", "title": "t", "url": "", "duration": seconds, "path": src, "thumbnail": None}],
    )
    return job["id"], src


@pytest.mark.skipif(not is_ffmpeg_available(), reason="FFmpeg not installed")
def test_export_to_chosen_folder_and_remove_downloads(tmp_path):
    save_preferences(Preferences(library_dir=str(tmp_path / "library"), keep_downloads=False))
    job_id, src = _job_with_audio(tmp_path)
    chosen = tmp_path / "chosen"
    get_store().update(job_id, destination=str(chosen))

    asyncio.run(pipeline._export(job_id))

    job = get_store().get(job_id)
    assert job["status"] == "completed", job["error"]
    assert all(o["path"].startswith(str(chosen)) for o in job["outputs"])
    assert os.path.isfile(os.path.join(chosen, "Albums", "Test Album (2001)", "01 - First.mp3"))
    assert not (tmp_path / "library").exists()
    # Downloaded audio removed, but the job keeps its sources list
    assert not os.path.exists(src)
    assert job["sources"][0]["path"] == ""


def test_relative_destination_is_rejected():
    job = get_store().create("https://youtu.be/rel")
    get_store().update(job["id"], status="review", sources=[{"id": "s", "path": "x", "duration": 10}])
    body = {
        "tracks": [{"id": "t", "title": "A", "start": 0, "end": 5, "source_id": "s"}],
        "collection": {"type": "single"},
        "destination": "relative\\folder",
    }
    with TestClient(app, base_url=f"http://127.0.0.1:{settings.backend_port}") as c:
        assert c.put(f"/api/jobs/{job['id']}", json=body, headers=AUTH).status_code == 422


@pytest.mark.skipif(not is_ffmpeg_available(), reason="FFmpeg not installed")
def test_storage_report_and_clear_downloads(tmp_path):
    save_preferences(Preferences(library_dir=str(tmp_path / "lib")))
    done_id, done_src = _job_with_audio(tmp_path)
    review_id, review_src = _job_with_audio(tmp_path)
    get_store().update(done_id, status="completed")

    with TestClient(app, base_url=f"http://127.0.0.1:{settings.backend_port}") as c:
        info = c.get("/api/storage", headers=AUTH).json()
        assert info["free_bytes"] > 0
        assert info["downloads_count"] >= 2
        assert info["library_exists"] is False

        result = c.post("/api/storage/clear-downloads", headers=AUTH).json()
        assert result["jobs_cleared"] >= 1 and result["freed_bytes"] > 0

    assert not os.path.exists(done_src)
    assert os.path.exists(review_src)  # still being reviewed: kept
    assert get_store().get(done_id)["sources"][0]["path"] == ""


def test_old_database_gets_new_columns(tmp_path):
    path = str(tmp_path / "old.db")
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE jobs (id TEXT PRIMARY KEY, url TEXT NOT NULL, status TEXT NOT NULL, progress REAL NOT NULL DEFAULT 0, "
        "message TEXT NOT NULL DEFAULT '', error TEXT, title TEXT NOT NULL DEFAULT '', thumbnail TEXT, "
        "collection TEXT NOT NULL DEFAULT '{}', sources TEXT NOT NULL DEFAULT '[]', tracks TEXT NOT NULL DEFAULT '[]', "
        "outputs TEXT NOT NULL DEFAULT '[]', created_at REAL NOT NULL, updated_at REAL NOT NULL)"
    )
    conn.execute("INSERT INTO jobs (id, url, status, created_at, updated_at) VALUES ('old', 'u', 'completed', 1, 1)")
    conn.commit()
    conn.close()

    store = JobStore(path)
    assert store.get("old")["destination"] == ""
