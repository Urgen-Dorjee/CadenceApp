"""Album details from MusicBrainz: search releases by name, then take their title, singer,
year, song names and cover art (from the Cover Art Archive).

No key is needed. MusicBrainz asks for a descriptive User-Agent and at most one request
per second; both are kept here. Only the typed album and singer names are sent.
"""

import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from services import cover

API = "https://musicbrainz.org/ws/2"
COVER_ART = "https://coverartarchive.org/release"
USER_AGENT = "Cadence/2.1 ( https://github.com/Urgen-Dorjee/CadenceApp )"
COVER_PREFIX = "cover-musicbrainz-"  # + release id, so an earlier album's cover can be restored

_lock = threading.Lock()
_last_request = 0.0


class MusicBrainzError(Exception):
    """Shown to the user."""


def _get(url: str, timeout: float = 20.0) -> bytes:
    """GET with the MusicBrainz User-Agent, at most one request per second. Blocking."""
    global _last_request
    with _lock:
        wait = 1.0 - (time.monotonic() - _last_request)
        if wait > 0:
            time.sleep(wait)
        _last_request = time.monotonic()
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise
        if e.code in (429, 503):
            raise MusicBrainzError("MusicBrainz is busy. Try again in a moment.") from e
        raise MusicBrainzError(f"MusicBrainz returned an error (HTTP {e.code}).") from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise MusicBrainzError("Couldn't reach MusicBrainz. Check your internet connection.") from e


def _quote(text: str) -> str:
    """A Lucene phrase: quotes and backslashes escaped."""
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


def build_query(album: str, artist: str = "") -> str:
    parts = [f"release:{_quote(album.strip())}"]
    if artist.strip():
        parts.append(f"artist:{_quote(artist.strip())}")
    return " AND ".join(parts)


def credit_name(credits: list[dict[str, Any]] | None) -> str:
    """"Lata Mangeshkar & Kishore Kumar" from a MusicBrainz artist-credit list."""
    return "".join(f"{c.get('name') or (c.get('artist') or {}).get('name', '')}{c.get('joinphrase', '')}" for c in credits or []).strip()


def parse_search(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Releases from a search response, best first."""
    results = []
    for r in data.get("releases") or []:
        group = r.get("release-group") or {}
        results.append({
            "id": r["id"],
            "title": r.get("title", ""),
            "artist": credit_name(r.get("artist-credit")),
            "year": (r.get("date") or "")[:4],
            "country": r.get("country") or "",
            "track_count": int(r.get("track-count") or sum(m.get("track-count", 0) for m in r.get("media") or [])),
            "type": group.get("primary-type") or "",
            "score": int(r.get("score") or 0),
            "cover_url": f"{COVER_ART}/{r['id']}/front-250",
        })
    return results


def search_releases(album: str, artist: str = "", limit: int = 10) -> list[dict[str, Any]]:
    """Releases matching an album (and optional singer) name. Blocking."""
    if not album.strip():
        raise MusicBrainzError("Type the album or movie name first.")
    query = urllib.parse.urlencode({"query": build_query(album, artist), "fmt": "json", "limit": limit})
    return parse_search(json.loads(_get(f"{API}/release?{query}")))


def parse_release(data: dict[str, Any]) -> dict[str, Any]:
    """{album, artist, year, tracks: [{title, artist}]} from a release lookup."""
    album_artist = credit_name(data.get("artist-credit"))
    tracks = []
    for medium in data.get("media") or []:
        for t in medium.get("tracks") or []:
            recording = t.get("recording") or {}
            artist = credit_name(t.get("artist-credit") or recording.get("artist-credit"))
            tracks.append({
                "title": t.get("title") or recording.get("title") or "",
                # Leave the singer empty when it's just the album's singer, so the album singer fills it.
                "artist": "" if artist == album_artist else artist,
            })
    return {
        "id": data.get("id", ""),
        "album": data.get("title", ""),
        "artist": album_artist,
        "year": (data.get("date") or "")[:4],
        "tracks": tracks,
    }


def release_details(mbid: str) -> dict[str, Any]:
    """Album name, singer, year and song list of one release. Blocking."""
    query = urllib.parse.urlencode({"inc": "recordings artist-credits", "fmt": "json"})
    try:
        return parse_release(json.loads(_get(f"{API}/release/{urllib.parse.quote(mbid)}?{query}")))
    except urllib.error.HTTPError as e:
        raise MusicBrainzError("That album is no longer on MusicBrainz.") from e


def download_cover(mbid: str, out_dir: str) -> str | None:
    """The release's front cover saved in `out_dir` (at most 1400 px), or None if it has none. Blocking."""
    try:
        data = _get(f"{COVER_ART}/{urllib.parse.quote(mbid)}/front-1200", timeout=60)
    except urllib.error.HTTPError:
        return None  # no cover art for this release
    os.makedirs(out_dir, exist_ok=True)
    raw = os.path.join(out_dir, "cover-musicbrainz-download.jpg")
    with open(raw, "wb") as f:
        f.write(data)
    try:
        path = cover.import_image(raw, out_dir, f"{COVER_PREFIX}{mbid}.jpg")
    except cover.CoverError:
        return None
    finally:
        os.remove(raw)
    return path
