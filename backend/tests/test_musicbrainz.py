"""MusicBrainz album details: query building and response parsing (no network)."""

import pytest

from services import musicbrainz as mb


def test_query_quotes_names_and_adds_the_singer():
    assert mb.build_query("Dilwale Dulhania Le Jayenge") == 'release:"Dilwale Dulhania Le Jayenge"'
    assert mb.build_query(' Say "Hi" ', "Udit Narayan") == 'release:"Say \\"Hi\\"" AND artist:"Udit Narayan"'


def test_credit_name_joins_artists():
    credits = [{"name": "Lata Mangeshkar", "joinphrase": " & "}, {"artist": {"name": "Kumar Sanu"}}]
    assert mb.credit_name(credits) == "Lata Mangeshkar & Kumar Sanu"
    assert mb.credit_name(None) == ""


def test_parse_search():
    data = {"releases": [{
        "id": "0b6b4ba2-6a4b-4d55-8b1d-3e2c3b6f0001", "score": 100, "title": "DDLJ", "date": "1995-10-20",
        "country": "IN", "track-count": 7, "release-group": {"primary-type": "Album"},
        "artist-credit": [{"name": "Jatin-Lalit"}],
    }]}
    [r] = mb.parse_search(data)
    assert r["year"] == "1995" and r["track_count"] == 7 and r["artist"] == "Jatin-Lalit" and r["type"] == "Album"
    assert r["cover_url"].endswith("/0b6b4ba2-6a4b-4d55-8b1d-3e2c3b6f0001/front-250")


def test_parse_release_leaves_album_singer_out_of_songs():
    data = {
        "id": "x", "title": "Album", "date": "1995", "artist-credit": [{"name": "Udit Narayan"}],
        "media": [
            {"tracks": [
                {"title": "One", "artist-credit": [{"name": "Udit Narayan"}]},
                {"title": "Two", "artist-credit": [{"name": "Lata Mangeshkar", "joinphrase": " & "}, {"name": "Udit Narayan"}]},
            ]},
            {"tracks": [{"recording": {"title": "Three"}}]},
        ],
    }
    details = mb.parse_release(data)
    assert details["album"] == "Album" and details["artist"] == "Udit Narayan" and details["year"] == "1995"
    assert details["tracks"] == [
        {"title": "One", "artist": ""},
        {"title": "Two", "artist": "Lata Mangeshkar & Udit Narayan"},
        {"title": "Three", "artist": ""},
    ]


def test_empty_album_name_is_refused():
    with pytest.raises(mb.MusicBrainzError):
        mb.search_releases("  ")
