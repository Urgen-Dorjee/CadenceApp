"""Playlists and channels: link recognition, listing with "saved" / "in list" marks, and splits at a time."""

import asyncio

import pytest
from fastapi.testclient import TestClient

from config import settings
from core.db import get_store
from main import app
from services import pipeline, youtube

AUTH = {"host": f"127.0.0.1:{settings.backend_port}", "x-cadence-token": "test-token"}


@pytest.mark.parametrize("url, kind, vid", [
    ("https://www.youtube.com/watch?v=abc123", "video", "abc123"),
    ("https://youtu.be/abc123?t=4", "video", "abc123"),
    ("https://www.youtube.com/shorts/xyz", "video", "xyz"),
    ("https://www.youtube.com/watch?v=abc&list=PLx", "playlist", "abc"),
    ("https://www.youtube.com/playlist?list=PLx", "playlist", None),
    ("https://www.youtube.com/@SaregamaMusic", "channel", None),
    ("https://www.youtube.com/@SaregamaMusic/featured", "channel", None),
    ("https://www.youtube.com/channel/UCabc", "channel", None),
])
def test_link_kind_and_video_id(url, kind, vid):
    assert youtube.link_kind(url) == kind
    assert youtube.video_id(url) == vid


def test_channel_links_list_the_videos_tab_and_playlists_the_list():
    assert youtube._videos_tab("https://www.youtube.com/@name/featured?x=1") == "https://www.youtube.com/@name/videos"
    assert youtube._list_url("https://www.youtube.com/watch?v=a&list=PLx") == "https://www.youtube.com/playlist?list=PLx"


@pytest.fixture
def client():
    with TestClient(app, base_url=f"http://127.0.0.1:{settings.backend_port}") as c:
        yield c


def test_expand_marks_saved_and_listed_videos(client, monkeypatch):
    async def fake_list(url):
        return {"title": "Jukeboxes", "kind": "playlist", "entries": [
            {"id": "saved1", "title": "Old", "duration": 3600.0},
            {"id": "listed1", "title": "In the list", "duration": 3000.0},
            {"id": "new1", "title": "New", "duration": 2400.0},
        ]}

    monkeypatch.setattr(youtube, "list_videos", fake_list)
    store = get_store()
    store.remember_saved_videos([("saved1", "Old")])
    job = store.create("https://www.youtube.com/watch?v=listed1")
    store.update(job["id"], status="review")

    r = client.post("/api/links/expand", json={"url": "https://www.youtube.com/playlist?list=PLx"}, headers=AUTH)
    assert r.status_code == 200, r.text
    states = {e["id"]: e["state"] for e in r.json()["entries"]}
    assert states == {"saved1": "saved", "listed1": "in_list", "new1": ""}
    assert r.json()["entries"][2]["url"] == "https://www.youtube.com/watch?v=new1"

    r = client.post("/api/links/expand", json={"url": "https://www.youtube.com/watch?v=abc"}, headers=AUTH)
    assert r.json()["kind"] == "video"
    assert client.post("/api/links/expand", json={"url": "https://example.com/x"}, headers=AUTH).status_code == 422


def test_slots_follow_the_current_limit():
    async def run():
        limit = {"n": 1}
        slots = pipeline._Slots(lambda: limit["n"])
        running, peak = 0, 0

        async def worker():
            nonlocal running, peak
            async with slots:
                running += 1
                peak = max(peak, running)
                await asyncio.sleep(0.05)
                running -= 1

        tasks = [asyncio.create_task(worker()) for _ in range(4)]
        await asyncio.sleep(0.01)
        assert running == 1  # one at a time
        limit["n"] = 3
        await slots.limit_changed()
        await asyncio.sleep(0.01)
        assert running == 3  # raising the limit starts waiting splits straight away
        await asyncio.gather(*tasks)
        return peak

    assert asyncio.run(run()) == 3
