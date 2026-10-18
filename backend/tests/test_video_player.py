"""The built-in video player's backend: chapters, subtitles, streaming and where a video was left off."""

import os
import subprocess

import pytest
from fastapi.testclient import TestClient

from config import settings
from core.db import get_store
from core.ffmpeg_utils import get_ffmpeg_path, is_ffmpeg_available
from main import app
from services import video_player

HOST = {"host": f"127.0.0.1:{settings.backend_port}"}
AUTH = {**HOST, "x-cadence-token": "test-token"}
SRT = "1\n00:00:00,500 --> 00:00:01,500\nHello there\n\n2\n00:00:02,000 --> 00:00:02,800\nSecond line\n"


@pytest.fixture
def client():
    with TestClient(app, base_url=f"http://127.0.0.1:{settings.backend_port}") as c:
        yield c


@pytest.fixture
def lecture(tmp_path):
    """A 3-second MP4 with two chapters, English subtitles inside it and Hindi ones next to it."""
    if not is_ffmpeg_available():
        pytest.skip("needs FFmpeg")
    (tmp_path / "en.srt").write_text(SRT, encoding="utf-8")
    (tmp_path / "chapters.txt").write_text(
        ";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1500\ntitle=Intro\n"
        "[CHAPTER]\nTIMEBASE=1/1000\nSTART=1500\nEND=3000\ntitle=Vectors\n", encoding="utf-8")
    video = tmp_path / "Lecture 1.mp4"
    subprocess.run([
        get_ffmpeg_path(), "-v", "error", "-y",
        "-f", "lavfi", "-i", "testsrc=size=160x120:rate=10:duration=3",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
        "-i", str(tmp_path / "en.srt"), "-i", str(tmp_path / "chapters.txt"),
        "-map", "0:v", "-map", "1:a", "-map", "2:s", "-map_metadata", "3", "-map_chapters", "3",
        "-c:v", "libx264", "-c:a", "aac", "-c:s", "mov_text", "-metadata:s:s:0", "language=eng", str(video),
    ], check=True, capture_output=True)
    (tmp_path / "Lecture 1.hi.srt").write_text(SRT.replace("Hello there", "Namaste"), encoding="utf-8")
    (tmp_path / "Lecture 10.mp4").write_bytes(b"")  # another video whose name starts the same way
    return str(video)


def test_srt_becomes_webvtt():
    vtt = video_player.srt_to_vtt("﻿" + SRT.replace("\n", "\r\n"))
    assert vtt.startswith("WEBVTT\n\n1\n00:00:00.500 --> 00:00:01.500\nHello there")


def test_chapters_and_subtitles_of_a_video(lecture):
    details = video_player.probe(lecture)
    assert [c["title"] for c in details["chapters"]] == ["Intro", "Vectors"]
    assert details["chapters"][1]["start"] == pytest.approx(1.5)
    assert 2.9 < details["duration"] < 3.2
    # The file next to the video first, then the language inside it.
    assert [(s["lang"], s["source"]) for s in details["subtitles"]] == [("hi", "file"), ("en", "video")]


def test_each_subtitle_track_reads_as_webvtt(lecture):
    tracks = {s["lang"]: s["id"] for s in video_player.probe(lecture)["subtitles"]}
    assert "Namaste" in video_player.subtitle_vtt(lecture, tracks["hi"])
    inside = video_player.subtitle_vtt(lecture, tracks["en"])
    assert inside.startswith("WEBVTT") and "Hello there" in inside
    assert video_player.subtitle_vtt(lecture, "stream-99") is None
    assert video_player.subtitle_vtt(lecture, "../etc") is None


def test_the_player_streams_a_library_video_and_remembers_where_it_stopped(client, lecture):
    get_store().add_video({"path": lecture, "video_id": "lllllllllll", "title": "Lecture 1", "duration": 3})
    listed = next(v for v in client.get("/api/library/videos", headers=AUTH).json() if v["path"] == lecture)
    key = listed["key"]
    assert listed["position"] == 0

    part = client.get(f"/api/library/videos/{key}/file", headers={**AUTH, "range": "bytes=0-99"})
    assert part.status_code == 206 and len(part.content) == 100
    details = client.get(f"/api/library/videos/{key}/details", headers=AUTH).json()
    assert [c["title"] for c in details["chapters"]] == ["Intro", "Vectors"]
    track = details["subtitles"][0]["id"]
    vtt = client.get(f"/api/library/videos/{key}/subtitles/{track}", headers=AUTH)
    assert vtt.status_code == 200 and vtt.headers["content-type"].startswith("text/vtt")

    assert client.put(f"/api/library/videos/{key}/progress", headers=AUTH, json={"position": 1.25, "duration": 3}).status_code == 200
    again = next(v for v in client.get("/api/library/videos", headers=AUTH).json() if v["path"] == lecture)
    assert again["position"] == 1.25
    # Downloading the same file again keeps the place.
    get_store().add_video({"path": lecture, "video_id": "lllllllllll", "title": "Lecture 1", "duration": 3})
    assert next(v for v in client.get("/api/library/videos", headers=AUTH).json() if v["path"] == lecture)["position"] == 1.25


def test_only_library_videos_can_be_played(client):
    assert client.get("/api/library/videos/0123456789abcdef/file", headers=AUTH).status_code == 404
    assert client.get("/api/library/videos/..%2F..%2Fsecret/file", headers=AUTH).status_code == 404
