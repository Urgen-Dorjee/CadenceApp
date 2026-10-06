import pytest
from fastapi.testclient import TestClient

from config import settings
from core.db import get_store
from main import app
from services.tracklist import TracklistError, parse_pasted, tracks_from_pasted

AUTH = {"host": f"127.0.0.1:{settings.backend_port}", "x-cadence-token": "test-token"}


def test_start_times():
    parsed = parse_pasted("0:00 Tujhe Dekha To\n5:03 Mere Khwabon Mein\n10:21 Ho Gaya Hai Tujhko", duration=900)
    assert parsed["format"] == "starts"
    assert [(e["start"], e["title"]) for e in parsed["entries"]] == [
        (0.0, "Tujhe Dekha To"), (303.0, "Mere Khwabon Mein"), (621.0, "Ho Gaya Hai Tujhko"),
    ]


def test_first_song_may_start_late_when_pasted():
    """Unlike descriptions, a pasted list is trusted even if the first song starts after a long intro."""
    parsed = parse_pasted("2:30 Song A\n6:00 Song B", duration=600)
    assert [e["start"] for e in parsed["entries"]] == [150.0, 360.0]


def test_song_lengths_are_added_up():
    text = "1. Song A 4:00\n2. Song B 3:30\n3. Song C 5:00"
    parsed = parse_pasted(text, duration=750)
    assert parsed["format"] == "lengths"
    assert [(e["start"], e["title"]) for e in parsed["entries"]] == [(0.0, "Song A"), (240.0, "Song B"), (450.0, "Song C")]


def test_lengths_detected_when_not_increasing():
    parsed = parse_pasted("Song A 5:00\nSong B 3:00\nSong C 4:00", duration=0)
    assert [e["start"] for e in parsed["entries"]] == [0.0, 300.0, 480.0]


def test_cue_sheet():
    cue = "\n".join([
        'REM DATE 1995',
        'PERFORMER "Lata Mangeshkar"',
        'TITLE "Dilwale Dulhania Le Jayenge"',
        'FILE "ddlj.wav" WAVE',
        '  TRACK 01 AUDIO',
        '    TITLE "Tujhe Dekha To"',
        '    PERFORMER "Lata Mangeshkar, Kumar Sanu"',
        '    INDEX 01 00:00:00',
        '  TRACK 02 AUDIO',
        '    TITLE "Mehndi Laga Ke Rakhna"',
        '    INDEX 00 05:01:00',
        '    INDEX 01 05:03:37',
    ])
    parsed = parse_pasted(cue, duration=700)
    assert parsed["format"] == "cue"
    assert (parsed["album"], parsed["artist"], parsed["year"]) == ("Dilwale Dulhania Le Jayenge", "Lata Mangeshkar", "1995")
    first, second = parsed["entries"]
    assert first == {"start": 0.0, "title": "Tujhe Dekha To", "artist": "Lata Mangeshkar, Kumar Sanu"}
    assert second["title"] == "Mehndi Laga Ke Rakhna"
    assert second["start"] == pytest.approx(303 + 37 / 75)  # frames are 1/75 s; INDEX 00 (pregap) is ignored


@pytest.mark.parametrize("text, message", [
    ("Just some words\nno times here", "No times found"),
    ("0:00 A\n12:00 B", "after the video ends"),
    ("1. A 0:00\n2. B 0:00", "can't be 0:00 long"),
    ('TRACK 01 AUDIO\nTITLE "A"', "no INDEX 01"),
])
def test_unusable_tracklists_explain_why(text, message):
    with pytest.raises(TracklistError, match=message):
        parse_pasted(text, duration=600)


def test_tracks_share_cuts_and_end_at_the_video_end():
    tracks = tracks_from_pasted(parse_pasted("0:05 A\n3:00 B\n6:00 C", 500), 500, "src")
    assert [(t["start"], t["end"]) for t in tracks] == [(0.0, 180.0), (180.0, 360.0), (360.0, 500.0)]
    assert all(t["origin"] == "pasted" for t in tracks)


@pytest.fixture
def client():
    with TestClient(app, base_url=f"http://127.0.0.1:{settings.backend_port}") as c:
        yield c


def test_endpoint_returns_tracks_without_saving(client):
    store = get_store()
    job = store.create("https://www.youtube.com/watch?v=t")
    store.update(job["id"], status="review", sources=[{"id": "s", "path": "", "duration": 600}], tracks=[])
    r = client.post(f"/api/jobs/{job['id']}/tracklist", json={"text": "0:00 A\n4:00 B"}, headers=AUTH)
    assert r.status_code == 200
    body = r.json()
    assert [t["title"] for t in body["tracks"]] == ["A", "B"]
    assert body["snapped"] is False  # no audio on disk, so times are used as given
    assert store.get(job["id"])["tracks"] == []


def test_endpoint_rejects_playlists_and_bad_text(client):
    store = get_store()
    job = store.create("https://www.youtube.com/playlist?list=x")
    store.update(job["id"], status="review", sources=[{"id": "a", "duration": 200}, {"id": "b", "duration": 200}])
    r = client.post(f"/api/jobs/{job['id']}/tracklist", json={"text": "0:00 A\n1:00 B"}, headers=AUTH)
    assert r.status_code == 422 and "playlist" in r.json()["detail"]

    single = store.create("https://www.youtube.com/watch?v=u")
    store.update(single["id"], status="review", sources=[{"id": "s", "duration": 600}])
    r = client.post(f"/api/jobs/{single['id']}/tracklist", json={"text": "hello"}, headers=AUTH)
    assert r.status_code == 422 and "No times found" in r.json()["detail"]


def test_short_pasted_segments_are_still_flagged():
    from services.tracklist import flag_short_tracks

    tracks = tracks_from_pasted(parse_pasted("0:00 Intro\n0:05 Song A\n4:00 Song B", 500), 500, "src")
    flag_short_tracks(tracks)
    assert tracks[0]["confidence"] == 0.5  # 5 s "Intro" is probably not a song
    assert tracks[1]["confidence"] == 0.95
