"""Lyrics from LRCLIB (network faked) and what ends up in saved songs (needs FFmpeg)."""

import asyncio
import os
import subprocess

import mutagen
import pytest

from config import Preferences, save_preferences, settings
from core.db import get_store
from core.ffmpeg_utils import get_ffmpeg_path, is_ffmpeg_available
from services import exporter, lyrics, pipeline
from services.tracklist import make_track

SYNCED = "[00:01.00] Tujhe dekha to\n[00:03.50] ye jaana sanam"
RECORD = {"trackName": "Tujhe Dekha To", "duration": 300, "instrumental": False, "syncedLyrics": SYNCED, "plainLyrics": ""}


def fake_lrclib(get=None, search=()):
    calls = []

    def _get_json(path, params):
        calls.append((path, params))
        return get if path == "get" else list(search)

    return _get_json, calls


def test_exact_match(monkeypatch):
    fake, calls = fake_lrclib(get=RECORD)
    monkeypatch.setattr(lyrics, "_get_json", fake)
    found = lyrics.fetch("Tujhe Dekha To", "Lata Mangeshkar", "DDLJ", 300.4)
    assert found == {"synced": SYNCED, "plain": "Tujhe dekha to\nye jaana sanam"}
    assert calls[0] == ("get", {"track_name": "Tujhe Dekha To", "artist_name": "Lata Mangeshkar", "album_name": "DDLJ", "duration": 300})


def test_search_only_accepts_about_the_same_length(monkeypatch):
    other = {**RECORD, "duration": 200}
    fake, calls = fake_lrclib(get=None, search=[other, {**RECORD, "duration": 302}])
    monkeypatch.setattr(lyrics, "_get_json", fake)
    assert lyrics.fetch("Tujhe Dekha To", "", "", 300)["synced"] == SYNCED
    assert [c[0] for c in calls] == ["search"]  # no singer: straight to search
    fake, _ = fake_lrclib(get=None, search=[other])
    monkeypatch.setattr(lyrics, "_get_json", fake)
    assert lyrics.fetch("Tujhe Dekha To", "Lata", "", 300) is None


def test_instrumental_or_empty_is_none(monkeypatch):
    fake, _ = fake_lrclib(get={**RECORD, "instrumental": True})
    monkeypatch.setattr(lyrics, "_get_json", fake)
    assert lyrics.fetch("Theme", "Band", "", 300) is None


needs_ffmpeg = pytest.mark.skipif(not is_ffmpeg_available(), reason="FFmpeg not installed")


@needs_ffmpeg
@pytest.mark.parametrize("fmt", ["mp3", "m4a", "flac", "opus"])
def test_embed(tmp_path, fmt):
    src = str(tmp_path / "s.flac")
    subprocess.run([get_ffmpeg_path(), "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
                    "-i", "sine=duration=2", "-c:a", "flac", src], check=True)
    dest = str(tmp_path / f"song.{fmt}")
    asyncio.run(exporter.cut_track(src, 0, 2, dest, fmt, 128, 10))
    exporter.write_tags(dest, fmt, {"title": "T", "track": 1, "total": 1}, None)
    lyrics.embed(dest, fmt, SYNCED)
    tags = mutagen.File(dest).tags
    text = {"mp3": lambda: tags.getall("USLT")[0].text, "m4a": lambda: tags["\xa9lyr"][0]}.get(fmt, lambda: tags["lyrics"][0])()
    assert text == SYNCED


@needs_ffmpeg
def test_export_adds_lyrics_and_lrc_files(tmp_path, monkeypatch):
    save_preferences(Preferences(library_dir=str(tmp_path / "lib"), audio_format="mp3", trim_silence=False,
                                 lyrics="lrc", write_playlist=False))
    src = str(tmp_path / "src.flac")
    subprocess.run([get_ffmpeg_path(), "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
                    "-i", "sine=duration=6", "-c:a", "flac", src], check=True)
    store = get_store()

    def run(found_for):
        fake, calls = fake_lrclib()
        monkeypatch.setattr(lyrics, "_get_json", lambda path, params: (
            {**RECORD, "duration": params.get("duration", 3)} if path == "get" and params["track_name"] in found_for else None
        ) if path == "get" else [])
        job = store.create("https://www.youtube.com/watch?v=lyr")
        store.update(job["id"], status="review", sources=[{"id": "s", "path": src, "duration": 6}],
                     tracks=[make_track(title="Has Lyrics", artist="Singer", start=0, end=3, origin="chapters", source_id="s"),
                             make_track(title="No Lyrics", artist="Singer", start=3, end=6, origin="chapters", source_id="s")],
                     collection={"type": "album", "name": "A", "album": "A"})
        asyncio.run(pipeline._export(job["id"]))
        return store.get(job["id"])

    try:
        job = run({"Has Lyrics"})
        assert job["status"] == "completed", job["error"]
        assert job["message"].endswith("(lyrics for 1)")
        has, no = (o["path"] for o in job["outputs"])
        assert open(lyrics.lrc_path(has), encoding="utf-8").read().startswith("[00:01.00]")
        assert not os.path.exists(lyrics.lrc_path(no))

        # Offline: songs are still saved, LRCLIB is only tried once, and the message says so.
        attempts = []

        def offline(path, params):
            attempts.append(path)
            raise OSError("no network")

        job2 = store.create("https://www.youtube.com/watch?v=lyr2")
        store.update(job2["id"], status="review", sources=[{"id": "s", "path": src, "duration": 6}],
                     tracks=[make_track(title="A", start=0, end=3, origin="chapters", source_id="s"),
                             make_track(title="B", start=3, end=6, origin="chapters", source_id="s")],
                     collection={"type": "album", "name": "B", "album": "B"})
        monkeypatch.setattr(lyrics, "_get_json", offline)
        asyncio.run(pipeline._export(job2["id"]))
        job2 = store.get(job2["id"])
        assert job2["status"] == "completed" and len(job2["outputs"]) == 2
        assert "couldn't reach LRCLIB" in job2["message"] and len(attempts) == 1
    finally:
        os.remove(settings.prefs_path)
