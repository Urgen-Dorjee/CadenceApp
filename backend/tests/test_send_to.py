"""Copying saved songs to a folder or drive, or into Apple Music / iTunes (needs FFmpeg)."""

import asyncio
import os
import subprocess

import pytest
from fastapi.testclient import TestClient

from config import settings
from core.ffmpeg_utils import get_ffmpeg_path, is_ffmpeg_available
from main import app
from services import exporter, send_to, song_index
from services.song_index import read_cover, read_song

pytestmark = pytest.mark.skipif(not is_ffmpeg_available(), reason="FFmpeg not installed")
AUTH = {"host": f"127.0.0.1:{settings.backend_port}", "x-cadence-token": "test-token"}


def _song(tmp_path, fmt="flac"):
    src = str(tmp_path / "src.flac")
    subprocess.run([get_ffmpeg_path(), "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
                    "-i", "sine=frequency=440:duration=2", "-c:a", "flac", src], check=True)
    cover = str(tmp_path / "cover.jpg")
    subprocess.run([get_ffmpeg_path(), "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
                    "-i", "color=c=red:s=64x64:d=1", "-frames:v", "1", cover], check=True)
    path = str(tmp_path / "library" / f"Tujhe Dekha To.{fmt}")
    asyncio.run(exporter.cut_track(src, 0, 2, path, fmt, 192, 10))
    exporter.write_tags(path, fmt, {"title": "Tujhe Dekha To", "artist": "Lata Mangeshkar", "album_artist": "Jatin-Lalit",
                                    "album": "DDLJ", "year": "1995", "track": 1, "total": 7}, cover)
    return {**read_song(path), "path": path, "id": song_index.song_id(path)}


def test_target_names():
    song = {"path": "/x/a.mp3", "title": "Tujhe: Dekha", "artist": "Lata", "album_artist": "Jatin-Lalit", "album": "DDLJ", "track": 3}
    assert send_to.target_name(song, "folders", "mp3") == os.path.join("Jatin-Lalit", "DDLJ", "03 Tujhe Dekha.mp3")
    assert send_to.target_name(song, "flat", "mp3") == "Lata - Tujhe Dekha.mp3"
    assert send_to.target_name({"path": "/x/b.m4a", "title": "Song"}, "folders", "m4a") == os.path.join("Unknown Singer", "Singles", "Song.m4a")


def test_copy_keeps_the_original_and_skips_a_second_time(tmp_path):
    song = _song(tmp_path)
    out = str(tmp_path / "usb")
    assert send_to.copy_song(song, out, "folders", to_mp3=False) == "copied"
    copied = os.path.join(out, "Jatin-Lalit", "DDLJ", "01 Tujhe Dekha To.flac")
    assert os.path.getsize(copied) == os.path.getsize(song["path"])
    assert send_to.copy_song(song, out, "folders", to_mp3=False) == "skipped"
    assert os.path.isfile(song["path"])


def test_convert_to_mp3_keeps_tags_and_cover(tmp_path):
    song = _song(tmp_path)
    out = str(tmp_path / "car")
    assert send_to.copy_song(song, out, "flat", to_mp3=True) == "copied"
    mp3 = os.path.join(out, "Lata Mangeshkar - Tujhe Dekha To.mp3")
    tags = read_song(mp3)
    assert tags["format"] == "mp3" and tags["title"] == "Tujhe Dekha To" and tags["album"] == "DDLJ"
    assert read_cover(mp3) is not None


def test_music_app_folder_is_found(tmp_path, monkeypatch):
    monkeypatch.setattr(os.path, "expanduser", lambda p: str(tmp_path) if p == "~" else p)
    assert send_to.music_app_folder() is None
    folder = tmp_path / "Music" / "iTunes" / "iTunes Media" / "Automatically Add to iTunes"
    folder.mkdir(parents=True)
    assert send_to.music_app_folder() == (str(folder), "iTunes")


@pytest.fixture
def client():
    with TestClient(app, base_url=f"http://127.0.0.1:{settings.backend_port}") as c:
        yield c


def test_send_endpoint_checks_the_destination(client, tmp_path):
    r = client.post("/api/library/send", json={"ids": ["x"], "destination": str(tmp_path / "missing")}, headers=AUTH)
    assert r.status_code == 422
    r = client.post("/api/library/send", json={"ids": ["nope"], "destination": str(tmp_path)}, headers=AUTH)
    assert r.status_code == 404


def test_send_copies_in_the_background(client, tmp_path):
    song = _song(tmp_path, "mp3")
    song_index.get_index().add_paths([song["path"]])
    out = tmp_path / "usb"
    out.mkdir()
    with client.websocket_connect("/ws?token=test-token", headers={"host": AUTH["host"]}) as socket:
        r = client.post("/api/library/send", json={"ids": [song["id"]], "destination": str(out), "layout": "flat"}, headers=AUTH)
        assert r.status_code == 200, r.text
        while True:
            msg = socket.receive_json()
            if msg.get("type") == "send" and msg.get("finished"):
                break
    assert msg["copied"] == 1 and msg["failed"] == 0
    assert os.path.isfile(out / "Lata Mangeshkar - Tujhe Dekha To.mp3")
