"""Tidy song and album names with Claude (optional, off by default).

Sends only text: the video title, channel, description and the current song
names and lengths. Never audio. Uses the user's own Anthropic API key from
Settings. Results are suggestions; the review screen applies them with Undo.
"""

import asyncio
import json
import urllib.error
import urllib.request
from typing import Any, Callable

API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"

MODEL = "claude-opus-5-5"
# Server-side refusal fallback: on a policy decline the API retries on Anthropic's
# recommended model inside the same call instead of returning the refusal.
FALLBACK_BETA = "server-side-fallback-2026-07-01"

SYSTEM_PROMPT = """You tidy metadata for a music library app. The user downloaded a YouTube video that \
contains several songs (a movie album jukebox, a singer's collection, or a mixed collection) and the app \
has already split it into songs. You get the video's title, channel, description and the current name and \
length of each song.

Return clean names for the collection and every song:
- Song titles: the song's name only. Remove channel names, "Full Song", "Lyrical", "Audio", "HD", video \
numbering, movie names and actor names. Keep the original language and transliteration (do not translate \
Hindi or other languages into English). Use natural title case.
- Song singers: the singer names for that song if the title or description states them, separated by ", ". \
Otherwise an empty string. Never guess singers from your own knowledge of the song.
- Collection type: "artist" for one singer's songs, "album" for one movie's or album's songs, "collection" \
for a mix, "single" if there is only one song.
- Collection name, artist, album and year: from the title and description. Year only if stated, as four \
digits, else an empty string.
- Keep exactly the same number of songs in the same order, using each song's index. If you can't tell what \
a song is called, return its current title unchanged."""

SCHEMA = {
    "type": "object",
    "properties": {
        "collection": {
            "type": "object",
            "properties": {
                "type": {"type": "string", "enum": ["artist", "album", "collection", "single"]},
                "name": {"type": "string"},
                "artist": {"type": "string"},
                "album": {"type": "string"},
                "year": {"type": "string"},
            },
            "required": ["type", "name", "artist", "album", "year"],
            "additionalProperties": False,
        },
        "tracks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "title": {"type": "string"},
                    "artist": {"type": "string"},
                },
                "required": ["index", "title", "artist"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["collection", "tracks"],
    "additionalProperties": False,
}


class NameCleanupError(Exception):
    """A problem to show the user (bad key, no credit, refusal, network)."""


def _clock(seconds: float) -> str:
    seconds = int(round(seconds))
    return f"{seconds // 60}:{seconds % 60:02d}"


def build_request_text(job: dict[str, Any], tracks: list[dict[str, Any]]) -> str:
    source = (job.get("sources") or [{}])[0]
    lines = [
        f"Video title: {job.get('title') or source.get('title') or ''}",
        f"Channel: {source.get('uploader') or ''}",
        "Description:",
        source.get("description") or "(none)",
        "",
        "Songs (index | current title | current singers | length):",
    ]
    for i, track in enumerate(tracks):
        lines.append(f"{i} | {track.get('title', '')} | {track.get('artist', '')} | {_clock(track['end'] - track['start'])}")
    return "\n".join(lines)


def apply_suggestions(
    tracks: list[dict[str, Any]], collection: dict[str, Any], suggestion: dict[str, Any]
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Merge Claude's names into copies of the tracks and collection. Cuts are never changed."""
    by_index = {t["index"]: t for t in suggestion.get("tracks", []) if isinstance(t.get("index"), int)}
    new_tracks = []
    for i, track in enumerate(tracks):
        updated = dict(track)
        s = by_index.get(i)
        if s:
            title = s.get("title", "").strip()
            if title and title != track.get("title"):
                updated["title"] = title[:300]
                updated["match"] = {"source": "claude"}
            if s.get("artist", "").strip():
                updated["artist"] = s["artist"].strip()[:300]
        new_tracks.append(updated)

    c = suggestion.get("collection") or {}
    new_collection = dict(collection)
    for key in ("type", "name", "artist", "album"):
        value = (c.get(key) or "").strip()
        if value:
            new_collection[key] = value[:300]
    year = (c.get("year") or "").strip()
    new_collection["year"] = year if len(year) == 4 and year.isdigit() else collection.get("year", "")
    if new_collection.get("type") not in ("artist", "album", "collection", "single"):
        new_collection["type"] = collection.get("type", "collection")
    return new_tracks, new_collection


class ApiError(Exception):
    def __init__(self, status: int, message: str = ""):
        super().__init__(message or f"HTTP {status}")
        self.status, self.message = status, message


def _post(body: dict[str, Any], headers: dict[str, str], timeout: float = 120.0) -> dict[str, Any]:
    """POST to the Messages API. Blocking. Raises ApiError (status 0 when the server can't be reached).

    A plain request rather than the anthropic library: that library is thousands of files,
    which made every install and update of Cadence slower for an optional feature.
    """
    request = urllib.request.Request(API_URL, data=json.dumps(body).encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as e:
        try:
            message = json.loads(e.read()).get("error", {}).get("message", "")
        except ValueError:
            message = ""
        raise ApiError(e.code, message) from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise ApiError(0, str(e)) from e


async def suggest_names(
    api_key: str, job: dict[str, Any], tracks: list[dict[str, Any]], post: Callable[..., dict[str, Any]] = _post
) -> dict[str, Any]:
    """Ask Claude for clean names. Returns the parsed suggestion dict."""
    if not api_key:
        raise NameCleanupError("Add your Anthropic API key in Settings to tidy names with Claude.")
    body = {
        "model": MODEL,
        "max_tokens": 16000,
        "fallbacks": "default",
        "system": SYSTEM_PROMPT,
        "output_config": {"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
        "messages": [{"role": "user", "content": build_request_text(job, tracks)}],
    }
    headers = {
        "x-api-key": api_key,
        "anthropic-version": API_VERSION,
        "anthropic-beta": FALLBACK_BETA,
        "content-type": "application/json",
    }
    try:
        response = await asyncio.to_thread(post, body, headers)
    except ApiError as e:
        message = e.message.lower()
        if e.status == 0:
            raise NameCleanupError("Couldn't reach Claude. Check your internet connection.") from e
        if e.status == 401:
            raise NameCleanupError("Anthropic rejected the API key. Check it in Settings.") from e
        if e.status == 403:
            raise NameCleanupError("This Anthropic API key isn't allowed to use Claude. Check your account.") from e
        if e.status in (429, 529):
            raise NameCleanupError("Claude is busy or your account hit its limit. Try again in a minute.") from e
        if e.status == 400:
            if "credit" in message or "billing" in message:
                raise NameCleanupError("Your Anthropic account is out of credit.") from e
            raise NameCleanupError(f"Claude couldn't process this request: {e.message or 'bad request'}") from e
        raise NameCleanupError(f"Claude returned an error ({e.status}). Try again later.") from e

    stop_reason = response.get("stop_reason")
    if stop_reason == "refusal":
        raise NameCleanupError("Claude declined to tidy these names. You can still edit them yourself.")
    if stop_reason == "max_tokens":
        raise NameCleanupError("The tracklist was too long for one request.")
    text = next((b.get("text", "") for b in response.get("content") or [] if b.get("type") == "text"), "")
    try:
        return json.loads(text)
    except ValueError as e:
        raise NameCleanupError("Claude's answer couldn't be read. Try again.") from e
