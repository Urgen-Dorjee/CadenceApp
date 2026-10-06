"""Cover art: square crops, the user's own image, and what ends up in saved songs (needs FFmpeg)."""

import asyncio
import os
import subprocess

import pytest
from fastapi.testclient import TestClient

from config import Preferences, save_preferences, settings
from core.db import get_store
from core.ffmpeg_utils import get_ffmpeg_path, is_ffmpeg_available
from main import app
from services import cover, pipeline
from services.tracklist import make_track

pytestmark = pytest.mark.skipif(not is_ffmpeg_available(), reason="FFmpeg not installed")
AUTH = {"host": f"127.0.0.1:{settings.backend_port}", "x-cadence-token": "test-token"}


def _image(path, w, h, color="red"):
    subprocess.run([get_ffmpeg_path(), "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
                    "-i", f"color=c={color}:s={w}x{h}:d=1", "-frames:v", "1", str(path)], check=True)
    return str(path)


def test_square_crops_wide_thumbnails_and_keeps_square_ones(tmp_path):
    wide = _image(tmp_path / "thumb.jpg", 1280, 720)
    out = cover.square(wide, str(tmp_path / "sq.jpg"))
    assert out.endswith("sq.jpg") and cover.size(out) == (720, 720)
    already = _image(tmp_path / "album.jpg", 600, 600)
    assert cover.square(already, str(tmp_path / "sq2.jpg")) == already


def test_import_image_converts_and_limits_size(tmp_path):
    png = _image(tmp_path / "big.png", 3000, 2000)
    out = cover.import_image(png, str(tmp_path / "job"))
    assert out.endswith(cover.CUSTOM_NAME)
    assert cover.size(out) == (1400, 933)
    with pytest.raises(cover.CoverError, match="JPG, PNG"):
        cover.import_image(str(tmp_path / "notes.txt"), str(tmp_path / "job"))


@pytest.fixture
def client():
    with TestClient(app, base_url=f"http://127.0.0.1:{settings.backend_port}") as c:
        yield c


def test_set_and_reset_cover(client, tmp_path):
    store = get_store()
    job = store.create("https://www.youtube.com/watch?v=cover")
    os.makedirs(pipeline.job_dir(job["id"]), exist_ok=True)
    thumb = _image(os.path.join(pipeline.job_dir(job["id"]), "vid.jpg"), 1280, 720)
    store.update(job["id"], status="review", thumbnail=thumb, sources=[{"id": "s", "thumbnail": thumb, "duration": 10}])
    mine = _image(tmp_path / "mine.png", 500, 500, "blue")

    r = client.post(f"/api/jobs/{job['id']}/cover", json={"path": mine}, headers=AUTH)
    assert r.status_code == 200, r.text
    assert r.json()["cover"].endswith(cover.CUSTOM_NAME) and r.json()["thumbnail"] == r.json()["cover"]
    assert client.get(f"/api/jobs/{job['id']}/thumbnail?token=test-token", headers={"host": AUTH["host"]}).status_code == 200

    r = client.delete(f"/api/jobs/{job['id']}/cover", headers=AUTH)
    assert r.json()["cover"] == "" and r.json()["thumbnail"] == thumb
    assert not os.path.exists(os.path.join(pipeline.job_dir(job["id"]), cover.CUSTOM_NAME))

    r = client.post(f"/api/jobs/{job['id']}/cover", json={"path": str(tmp_path / "missing.png")}, headers=AUTH)
    assert r.status_code == 422


@pytest.mark.parametrize("square_pref, custom, expected", [
    (True, False, (720, 720)),     # video thumbnail cropped square
    (False, False, (1280, 720)),   # kept wide
    (True, True, (500, 300)),      # the user's own cover is used as it is
])
def test_saved_songs_get_the_right_cover(tmp_path, square_pref, custom, expected):
    from mutagen.flac import FLAC

    save_preferences(Preferences(library_dir=str(tmp_path / "lib"), audio_format="flac", trim_silence=False,
                                 square_cover=square_pref, write_playlist=False))
    try:
        src = str(tmp_path / "a.flac")
        subprocess.run([get_ffmpeg_path(), "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
                        "-i", "sine=frequency=440:duration=4", "-c:a", "flac", src], check=True)
        store = get_store()
        job = store.create("https://www.youtube.com/watch?v=embed")
        thumb = _image(tmp_path / "thumb.jpg", 1280, 720)
        fields = {}
        if custom:
            fields["cover"] = cover.import_image(_image(tmp_path / "mine.png", 500, 300, "blue"), pipeline.job_dir(job["id"]))
        store.update(job["id"], status="review", sources=[{"id": "s", "path": src, "duration": 4, "thumbnail": thumb}],
                     tracks=[make_track(title="T", start=0, end=4, origin="chapters", source_id="s")],
                     collection={"type": "album", "name": "A", "album": "A"}, **fields)
        asyncio.run(pipeline._export(job["id"]))
        job = store.get(job["id"])
        assert job["status"] == "completed", job["error"]
        data = FLAC(job["outputs"][0]["path"]).pictures[0].data
        pic = tmp_path / "embedded.jpg"
        pic.write_bytes(data)
        assert cover.size(str(pic)) == expected
    finally:
        os.remove(settings.prefs_path)
