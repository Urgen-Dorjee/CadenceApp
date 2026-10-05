import os
import subprocess

import pytest
from fastapi.testclient import TestClient

from config import Preferences, save_preferences, settings
from core.ffmpeg_utils import get_ffmpeg_path, is_ffmpeg_available
from main import app
from services import exporter
from services.song_index import SongIndex, get_index, song_id

pytestmark = pytest.mark.skipif(not is_ffmpeg_available(), reason="FFmpeg not installed")
AUTH = {"host": f"127.0.0.1:{settings.backend_port}", "x-cadence-token": "test-token"}


def _song(path, title, artist, album, track, fmt="mp3", cover=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    subprocess.run(
        [get_ffmpeg_path(), "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=3",
         *exporter.codec_args(fmt, 128), "-f", {"m4a": "mp4", "opus": "ogg"}.get(fmt, fmt), path],
        check=True,
    )
    exporter.write_tags(path, fmt, {"title": title, "artist": artist, "album_artist": artist, "album": album,
                                    "year": "1998", "track": track, "total": 9}, cover)


@pytest.fixture
def cover(tmp_path):
    path = tmp_path / "cover.jpg"
    subprocess.run([get_ffmpeg_path(), "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
                    "-i", "color=c=red:s=32x32:d=1", "-frames:v", "1", str(path)], check=True)
    return str(path)


def test_scan_reads_tags_and_tracks_changes(tmp_path, cover):
    lib = tmp_path / "lib"
    a = str(lib / "Artists" / "Singer A" / "a.mp3")
    b = str(lib / "Albums" / "Film B" / "02 - b.flac")
    _song(a, "Morning Song", "Singer A", "Best of A", 1, cover=cover)
    _song(b, "Evening Song", "Singer B", "Film B", 2, fmt="flac")
    index = SongIndex(str(tmp_path / "idx.db"))

    result = index.scan([str(lib)])
    assert result == {"added": 2, "updated": 0, "removed": 0, "total": 2}
    songs = {s["title"]: s for s in index.list()}
    assert songs["Morning Song"]["artist"] == "Singer A"
    assert songs["Morning Song"]["has_cover"] == 1
    assert songs["Evening Song"]["track"] == 2 and songs["Evening Song"]["format"] == "flac"
    assert songs["Evening Song"]["year"] == "1998"
    assert songs["Morning Song"]["duration"] > 2.5

    # Nothing changed: nothing re-read
    assert index.scan([str(lib)])["updated"] == 0
    # Deleted file disappears
    os.remove(b)
    assert index.scan([str(lib)])["removed"] == 1
    assert [s["title"] for s in index.list()] == ["Morning Song"]


def test_search_matches_every_word_across_fields(tmp_path):
    lib = tmp_path / "lib"
    _song(str(lib / "1.mp3"), "Rain Dance", "Singer A", "Monsoon", 1)
    _song(str(lib / "2.mp3"), "Sunny Day", "Singer B", "Monsoon", 2)
    index = SongIndex(str(tmp_path / "idx.db"))
    index.scan([str(lib)])
    assert [s["title"] for s in index.list("monsoon")] == ["Rain Dance", "Sunny Day"]
    assert [s["title"] for s in index.list("monsoon singer b")] == ["Sunny Day"]
    assert [s["title"] for s in index.list("title")] == []
    assert [s["title"] for s in index.list(sort="title")] == ["Rain Dance", "Sunny Day"]


def test_api_lists_streams_and_serves_covers(tmp_path, cover):
    lib = tmp_path / "apilib"
    path = str(lib / "song.m4a")
    _song(path, "Api Song", "Api Singer", "Api Album", 1, fmt="m4a", cover=cover)
    save_preferences(Preferences(library_dir=str(lib)))

    with TestClient(app, base_url=f"http://127.0.0.1:{settings.backend_port}") as c:
        assert c.post("/api/library/scan", headers=AUTH).status_code == 200
        songs = c.get("/api/library/songs?q=api", headers=AUTH).json()
        assert [s["title"] for s in songs] == ["Api Song"]
        sid = songs[0]["id"]
        audio = c.get(f"/api/library/songs/{sid}/audio", headers={**AUTH, "Range": "bytes=0-99"})
        assert audio.status_code == 206
        img = c.get(f"/api/library/songs/{sid}/cover", headers=AUTH)
        assert img.status_code == 200 and img.headers["content-type"].startswith("image/")
        # Only indexed files can be served
        assert c.get(f"/api/library/songs/{song_id('C:/Windows/win.ini')}/audio", headers=AUTH).status_code == 404


def test_saved_songs_are_indexed_immediately(tmp_path):
    path = str(tmp_path / "out" / "x.mp3")
    _song(path, "Fresh Song", "Someone", "New", 1)
    assert get_index().add_paths([path, str(tmp_path / "missing.mp3")]) == 1
    assert get_index().get(song_id(path))["title"] == "Fresh Song"
