"""Editing tags of saved songs from the Library (needs FFmpeg to make real files)."""

import asyncio
import subprocess

import mutagen
import pytest
from fastapi.testclient import TestClient

from config import settings
from core.ffmpeg_utils import get_ffmpeg_path, is_ffmpeg_available
from main import app
from services import exporter, song_index, tag_edit
from services.song_index import read_song

pytestmark = pytest.mark.skipif(not is_ffmpeg_available(), reason="FFmpeg not installed")
AUTH = {"host": f"127.0.0.1:{settings.backend_port}", "x-cadence-token": "test-token"}
RG = {"track_gain": -3.5, "track_peak": 0.9, "track_lufs": -14.5}


def _saved_song(tmp_path, fmt, name="song"):
    src = str(tmp_path / "src.flac")
    subprocess.run([get_ffmpeg_path(), "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
                    "-i", "sine=frequency=440:duration=3", "-c:a", "flac", src], check=True)
    cover = str(tmp_path / "cover.jpg")
    subprocess.run([get_ffmpeg_path(), "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
                    "-i", "color=c=red:s=64x64:d=1", "-frames:v", "1", cover], check=True)
    dest = str(tmp_path / f"{name}.{fmt}")
    asyncio.run(exporter.cut_track(src, 0, 3, dest, fmt, 192, 10))
    exporter.write_tags(dest, fmt, {"title": "Old", "artist": "Old Singer", "album_artist": "Old Singer",
                                    "album": "Old Album", "year": "1990", "track": 3, "total": 12}, cover, RG)
    return dest


@pytest.mark.parametrize("fmt", ["mp3", "m4a", "flac", "opus"])
def test_changes_only_the_given_tags(tmp_path, fmt):
    path = _saved_song(tmp_path, fmt)
    tag_edit.update_tags(path, {"title": "Tujhe Dekha To", "artist": "Lata Mangeshkar", "album": "DDLJ",
                                "year": "1995", "track": 5})
    info = read_song(path)
    assert (info["title"], info["artist"], info["album"], info["year"], info["track"]) == (
        "Tujhe Dekha To", "Lata Mangeshkar", "DDLJ", "1995", 5)
    assert info["album_artist"] == "Old Singer"          # untouched
    assert info["has_cover"] == 1                         # cover kept
    easy = mutagen.File(path, easy=True)
    assert str(easy["tracknumber"][0]) in ("5/12", "5")  # track count kept where the format stores it
    keys = " ".join(str(k).lower() for k in mutagen.File(path).keys())
    assert "replaygain_track_gain" in keys                # ReplayGain kept


def test_empty_value_removes_a_tag(tmp_path):
    path = _saved_song(tmp_path, "flac")
    tag_edit.update_tags(path, {"year": "", "album_artist": ""})
    info = read_song(path)
    assert info["year"] == "" and info["album_artist"] == ""


@pytest.fixture
def client():
    with TestClient(app, base_url=f"http://127.0.0.1:{settings.backend_port}") as c:
        yield c


def test_bulk_edit_endpoint(client, tmp_path):
    a, b = _saved_song(tmp_path, "mp3", "a"), _saved_song(tmp_path, "mp3", "b")
    index = song_index.get_index()
    index.add_paths([a, b])
    ids = [song_index.song_id(a), song_index.song_id(b)]

    r = client.put("/api/library/songs", json={"ids": ids, "changes": {"album": "New Album", "year": "2001"}}, headers=AUTH)
    assert r.status_code == 200, r.text
    assert [(s["album"], s["year"]) for s in r.json()] == [("New Album", "2001")] * 2
    assert read_song(b)["album"] == "New Album"

    r = client.put("/api/library/songs", json={"ids": ids, "changes": {"title": "Same"}}, headers=AUTH)
    assert r.status_code == 422 and "one song at a time" in r.json()["detail"]
    r = client.put("/api/library/songs", json={"ids": ids[:1], "changes": {"year": "95"}}, headers=AUTH)
    assert r.status_code == 422
    r = client.put("/api/library/songs", json={"ids": ids[:1], "changes": {}}, headers=AUTH)
    assert r.status_code == 422
    index.remove_paths([a, b])
