"""Saving a split again: replace last time's songs, or keep both (needs the real FFmpeg)."""

import asyncio
import os
import subprocess

import pytest

from config import Preferences, save_preferences, settings
from core.db import get_store
from core.ffmpeg_utils import get_ffmpeg_path, is_ffmpeg_available
from services import library, pipeline
from services.tracklist import make_track

pytestmark = pytest.mark.skipif(not is_ffmpeg_available(), reason="FFmpeg not installed")


@pytest.fixture(scope="module")
def source(tmp_path_factory):
    path = str(tmp_path_factory.mktemp("src") / "two.flac")
    subprocess.run(
        [get_ffmpeg_path(), "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
         "-i", "sine=frequency=440:duration=20:sample_rate=44100", "-c:a", "flac", path],
        check=True,
    )
    return path


@pytest.fixture
def library_dir(tmp_path, monkeypatch):
    save_preferences(Preferences(library_dir=str(tmp_path / "lib"), audio_format="flac", trim_silence=False))
    trashed: list[str] = []

    def fake_trash(paths):  # don't fill the real Recycle Bin from tests
        for p in paths:
            os.remove(p)
        trashed.extend(paths)
        return paths

    monkeypatch.setattr(pipeline, "_trash", fake_trash)
    yield str(tmp_path / "lib"), trashed
    os.remove(settings.prefs_path)


def _save(job_id: str, titles: list[str], replace: bool) -> list[str]:
    store = get_store()
    job = store.get(job_id)
    tracks = [dict(t, title=title) for t, title in zip(job["tracks"], titles)]
    store.update(job_id, tracks=tracks, status="review")
    asyncio.run(pipeline._export(job_id, replace_previous=replace))
    job = store.get(job_id)
    assert job["status"] == "completed", job["error"]
    return [o["path"] for o in job["outputs"]]


def _job(source: str) -> str:
    store = get_store()
    job = store.create("https://www.youtube.com/watch?v=again")
    store.update(
        job["id"], status="review", sources=[{"id": "s", "path": source, "duration": 20}],
        tracks=[make_track(title="A", start=0, end=10, origin="chapters", source_id="s"),
                make_track(title="B", start=10, end=20, origin="chapters", source_id="s")],
        collection={"type": "album", "name": "Album", "album": "Album"},
    )
    return job["id"]


def test_replace_overwrites_last_saves_songs_and_bins_the_rest(source, library_dir):
    lib, trashed = library_dir
    job_id = _job(source)
    first = _save(job_id, ["A", "B"], replace=False)
    # The user also has their own file named like the new third name: it must never be overwritten.
    own = os.path.join(os.path.dirname(first[0]), "02 - C.flac")
    with open(own, "wb") as f:
        f.write(b"mine")

    second = _save(job_id, ["A", "C"], replace=True)
    assert second[0] == first[0]                       # "A" replaced in place, no "(2)"
    assert second[1].endswith("02 - C (2).flac")       # the user's own "02 - C.flac" is kept
    assert open(own, "rb").read() == b"mine"
    assert trashed == [first[1]]                        # old "B" went to the Recycle Bin
    assert sorted(os.listdir(os.path.dirname(first[0]))) == ["01 - A.flac", "02 - C (2).flac", "02 - C.flac", "Album.m3u8"]


def test_keep_both_adds_copies(source, library_dir):
    _, trashed = library_dir
    job_id = _job(source)
    first = _save(job_id, ["A", "B"], replace=False)
    second = _save(job_id, ["A", "B"], replace=False)
    assert [os.path.basename(p) for p in second] == ["01 - A (2).flac", "02 - B (2).flac"]
    folder = os.path.dirname(first[0])
    assert {"Album.m3u8", "Album (2).m3u8"} <= set(os.listdir(folder))
    assert all(os.path.isfile(p) for p in first + second)
    assert trashed == []


def test_unique_path_only_overwrites_replaceable(tmp_path):
    existing = tmp_path / "Song.mp3"
    existing.write_bytes(b"x")
    assert library.unique_path(str(existing)).endswith("Song (2).mp3")
    key = library.same_file_key(str(existing).upper())
    assert library.unique_path(str(existing), frozenset({key})) == str(existing)


def test_playlist_lists_songs_in_order_with_relative_paths(source, library_dir):
    job_id = _job(source)
    paths = _save(job_id, ["First Song", "Second Song"], replace=False)
    job = get_store().get(job_id)
    assert os.path.basename(job["playlist"]) == "Album.m3u8"
    text = open(job["playlist"], encoding="utf-8").read()
    assert text.splitlines() == [
        "#EXTM3U",
        "#EXTINF:10,First Song",
        os.path.basename(paths[0]),
        "#EXTINF:10,Second Song",
        os.path.basename(paths[1]),
    ]
    # Saving again with "replace" rewrites the same playlist instead of adding "Album (2).m3u8".
    _save(job_id, ["First Song", "Renamed"], replace=True)
    assert sorted(f for f in os.listdir(os.path.dirname(paths[0])) if f.endswith(".m3u8")) == ["Album.m3u8"]
    assert "Renamed" in open(job["playlist"], encoding="utf-8").read()


def test_no_playlist_for_one_song_or_when_turned_off(source, library_dir):
    lib, _ = library_dir
    save_preferences(Preferences(library_dir=lib, audio_format="flac", trim_silence=False, write_playlist=False))
    job_id = _job(source)
    _save(job_id, ["A", "B"], replace=False)
    assert get_store().get(job_id)["playlist"] == ""
