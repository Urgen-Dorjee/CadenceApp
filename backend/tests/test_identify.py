import asyncio
import os
import subprocess

import pytest

from core.ffmpeg_utils import get_ffmpeg_path, is_ffmpeg_available
from services import identify
from services.tracklist import make_track


def _response(*results, status="ok"):
    return {"status": status, "results": list(results)}


def _result(score, title, artists, groups=()):
    return {
        "score": score,
        "recordings": [{
            "title": title,
            "artists": [{"name": n, "joinphrase": j} for n, j in artists],
            "releasegroups": list(groups),
        }],
    }


def test_parse_lookup_picks_the_best_scoring_match():
    data = _response(
        _result(0.75, "Weaker Match", [("Someone", "")]),
        _result(0.94, "Song Title", [("Singer A", " & "), ("Singer B", "")],
                [{"title": "Hits Compilation", "type": "Album", "secondarytypes": ["Compilation"]},
                 {"title": "Film Soundtrack", "type": "Album"}]),
    )
    assert identify.parse_lookup(data) == {
        "title": "Song Title", "artist": "Singer A & Singer B", "album": "Film Soundtrack", "score": 0.94,
    }


def test_parse_lookup_ignores_low_scores_and_empty_results():
    assert identify.parse_lookup(_response(_result(0.4, "Maybe", [("X", "")]))) is None
    assert identify.parse_lookup(_response({"score": 0.99, "id": "no-recordings"})) is None
    assert identify.parse_lookup(_response()) is None


def test_parse_lookup_reports_a_bad_key():
    with pytest.raises(identify.IdentifyError, match="API key"):
        identify.parse_lookup({"status": "error", "error": {"code": 4, "message": "invalid API key"}})


def test_needs_name_only_for_placeholders():
    assert identify.needs_name({"title": "Track 3"})
    assert identify.needs_name({"title": "Untitled song"})
    assert identify.needs_name({"title": ""})
    assert not identify.needs_name({"title": "Tum Hi Ho"})
    assert not identify.needs_name({"title": "Track Of My Heart"})


@pytest.mark.skipif(not (is_ffmpeg_available() and identify.find_fpcalc()), reason="FFmpeg or fpcalc missing")
def test_fingerprint_a_segment(tmp_path):
    src = str(tmp_path / "src.opus")
    subprocess.run([get_ffmpeg_path(), "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
                    "-i", "sine=frequency=440:duration=40", "-c:a", "libopus", src], check=True)
    duration, fp = identify.fingerprint(src, 10, 35)
    assert duration == 25
    assert isinstance(fp, str) and len(fp) > 20
    assert not any(f.startswith("cadence-fp-") for f in os.listdir(os.path.dirname(src)))


def test_identify_tracks_names_only_placeholders(monkeypatch, tmp_path):
    src = tmp_path / "a.opus"
    src.write_bytes(b"x")
    tracks = [
        make_track(title="Track 1", start=0, end=200, origin="silence", source_id="s"),
        make_track(title="Already Named", start=200, end=400, origin="chapters", source_id="s"),
        make_track(title="Track 3", start=400, end=600, origin="silence", source_id="s"),
    ]
    calls = []
    monkeypatch.setattr(identify, "fingerprint", lambda path, start, end: (int(end - start), f"fp{int(start)}"))
    monkeypatch.setattr(identify, "_REQUEST_GAP", 0)

    def fake_lookup(key, duration, fp):
        calls.append(fp)
        return {"title": "Found Song", "artist": "Found Singer", "album": "Found Album", "score": 0.9} if fp == "fp0" else None

    monkeypatch.setattr(identify, "lookup", fake_lookup)
    named = asyncio.run(identify.identify_tracks(tracks, {"s": {"path": str(src)}}, "key"))

    assert named == 1
    assert calls == ["fp0", "fp400"]  # the named song was not looked up
    assert tracks[0]["title"] == "Found Song" and tracks[0]["artist"] == "Found Singer"
    assert tracks[0]["match"] == {"source": "acoustid", "score": 0.9, "album": "Found Album"}
    assert tracks[2]["title"] == "Track 3"


def test_identify_requires_a_key():
    with pytest.raises(identify.IdentifyError, match="AcoustID API key"):
        asyncio.run(identify.identify_tracks([], {}, ""))
