import asyncio
import json
from types import SimpleNamespace

import anthropic
import httpx2
import pytest

from services import name_cleanup
from services.tracklist import make_track


def _tracks():
    return [
        make_track(title="Track 1", start=0, end=245, origin="silence", source_id="s"),
        make_track(title="Song Two (Official Audio) | Some Channel", start=245, end=500, origin="chapters", source_id="s"),
    ]


JOB = {
    "title": "Film Name (1999) Jukebox | Some Channel",
    "sources": [{"uploader": "Some Channel", "description": "00:00 First Song - Singer A\n04:05 Song Two - Singer B"}],
}

SUGGESTION = {
    "collection": {"type": "album", "name": "Film Name", "artist": "", "album": "Film Name", "year": "1999"},
    "tracks": [
        {"index": 0, "title": "First Song", "artist": "Singer A"},
        {"index": 1, "title": "Song Two", "artist": "Singer B"},
    ],
}


class FakeMessages:
    def __init__(self, response=None, error=None):
        self.response, self.error, self.calls = response, error, []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return self.response


def _client(response=None, error=None):
    messages = FakeMessages(response, error)
    return SimpleNamespace(beta=SimpleNamespace(messages=messages)), messages


def _response(text, stop_reason="end_turn"):
    return SimpleNamespace(stop_reason=stop_reason, content=[SimpleNamespace(type="text", text=text)])


def test_request_sends_only_text_and_enables_fallback():
    client, messages = _client(_response(json.dumps(SUGGESTION)))
    result = asyncio.run(name_cleanup.suggest_names("key", JOB, _tracks(), client=client))
    assert result == SUGGESTION

    call = messages.calls[0]
    assert call["model"] == "claude-opus-5-5"
    assert call["fallbacks"] == "default" and call["betas"] == ["server-side-fallback-2026-07-01"]
    assert call["output_config"]["effort"] == "low"
    assert call["output_config"]["format"]["type"] == "json_schema"
    text = call["messages"][0]["content"]
    assert "Film Name (1999) Jukebox" in text and "Singer A" in text
    assert "0 | Track 1 |  | 4:05" in text


def test_apply_suggestions_changes_names_but_never_cuts():
    tracks, collection = name_cleanup.apply_suggestions(
        _tracks(), {"type": "collection", "name": "x", "artist": "", "album": "x", "year": ""}, SUGGESTION
    )
    assert [t["title"] for t in tracks] == ["First Song", "Song Two"]
    assert [t["artist"] for t in tracks] == ["Singer A", "Singer B"]
    assert [(t["start"], t["end"]) for t in tracks] == [(0, 245), (245, 500)]
    assert tracks[0]["match"] == {"source": "claude"}
    assert collection == {"type": "album", "name": "Film Name", "artist": "", "album": "Film Name", "year": "1999"}


def test_apply_suggestions_ignores_bad_values():
    original = _tracks()
    tracks, collection = name_cleanup.apply_suggestions(
        original,
        {"type": "artist", "name": "A", "artist": "A", "album": "", "year": "2001"},
        {"collection": {"type": "nonsense", "name": "", "artist": "", "album": "", "year": "around 2000"},
         "tracks": [{"index": 7, "title": "Out of range", "artist": ""}, {"index": 0, "title": "  ", "artist": ""}]},
    )
    assert [t["title"] for t in tracks] == [t["title"] for t in original]
    assert collection["type"] == "artist" and collection["year"] == "2001" and collection["name"] == "A"


def test_refusal_becomes_a_clear_message():
    client, _ = _client(_response("", stop_reason="refusal"))
    with pytest.raises(name_cleanup.NameCleanupError, match="declined"):
        asyncio.run(name_cleanup.suggest_names("key", JOB, _tracks(), client=client))


def test_bad_key_becomes_a_clear_message():
    request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    error = anthropic.AuthenticationError("invalid x-api-key", response=httpx2.Response(401, request=request), body=None)
    client, _ = _client(error=error)
    with pytest.raises(name_cleanup.NameCleanupError, match="rejected the API key"):
        asyncio.run(name_cleanup.suggest_names("key", JOB, _tracks(), client=client))


def test_missing_key():
    with pytest.raises(name_cleanup.NameCleanupError, match="Anthropic API key"):
        asyncio.run(name_cleanup.suggest_names("", JOB, _tracks()))
