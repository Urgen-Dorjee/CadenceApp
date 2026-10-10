"""Lyrics for saved songs from LRCLIB (https://lrclib.net), a free, open lyrics database.

Optional (Settings), off by default. Only the song's title, singer, album and
length are sent. Synced lyrics (with timestamps) are preferred; plain lyrics are
used when that's all there is.
"""

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

API = "https://lrclib.net/api"
USER_AGENT = "Cadence (https://github.com/Urgen-Dorjee/CadenceApp)"
DURATION_TOLERANCE_S = 3.0  # LRCLIB matches on length; jukebox cuts are rarely exact
TIMEOUT_S = 10


def _get_json(path: str, params: dict[str, Any]) -> Any:
    """GET an LRCLIB endpoint. None for "not found"; raises OSError on network trouble. Blocking."""
    url = f"{API}/{path}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def _pick(record: dict[str, Any] | None) -> dict[str, str] | None:
    if not record or record.get("instrumental"):
        return None
    synced, plain = (record.get("syncedLyrics") or "").strip(), (record.get("plainLyrics") or "").strip()
    if not synced and not plain:
        return None
    return {"synced": synced, "plain": plain or _strip_times(synced)}


def _strip_times(synced: str) -> str:
    """Plain text from synced lyrics: "[01:02.30] Line" -> "Line"."""
    lines = []
    for line in synced.splitlines():
        text = line
        while text.startswith("[") and "]" in text:
            text = text[text.index("]") + 1:]
        lines.append(text.strip())
    return "\n".join(lines).strip()


def fetch(title: str, artist: str, album: str, duration: float) -> dict[str, str] | None:
    """{"synced", "plain"} lyrics for a song, or None if LRCLIB has none. Blocking."""
    if not title.strip():
        return None
    exact = {"track_name": title, "artist_name": artist, "album_name": album, "duration": round(duration)}
    found = _pick(_get_json("get", exact)) if artist else None
    if found:
        return found
    # No exact match (or no singer known): search, and only accept a result of about the same length.
    query = {"track_name": title, **({"artist_name": artist} if artist else {})}
    for record in _get_json("search", query) or []:
        if abs(float(record.get("duration") or 0) - duration) <= DURATION_TOLERANCE_S:
            picked = _pick(record)
            if picked:
                return picked
    return None


def lrc_path(song_path: str) -> str:
    return os.path.splitext(song_path)[0] + ".lrc"


def write_lrc(song_path: str, synced: str) -> str:
    """Save synced lyrics next to the song ("Song.mp3" -> "Song.lrc"). Blocking."""
    path = lrc_path(song_path)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(synced.rstrip() + "\n")
    return path


def embed(path: str, fmt: str, text: str) -> None:
    """Store lyrics in the song's own tags so phones and most players show them. Blocking."""
    if fmt == "mp3":
        from mutagen.id3 import ID3, USLT

        id3 = ID3(path)
        id3.delall("USLT")
        id3.add(USLT(encoding=3, lang="und", desc="", text=text))
        id3.save(path, v2_version=3)
    elif fmt == "m4a":
        from mutagen.mp4 import MP4

        mp4 = MP4(path)
        mp4["\xa9lyr"] = [text]
        mp4.save()
    else:
        import mutagen

        audio = mutagen.File(path)
        audio["lyrics"] = [text]
        audio.save()


def _looks_synced(text: str) -> bool:
    return any(line.lstrip().startswith("[") and ":" in line[:12] for line in text.splitlines()[:20])


def read_saved(path: str, fmt: str) -> dict[str, str] | None:
    """Lyrics already saved with a song: the .lrc file next to it, else the song's own tags. Blocking."""
    lrc = lrc_path(path)
    if os.path.isfile(lrc):
        with open(lrc, encoding="utf-8", errors="replace") as f:
            synced = f.read().strip()
        if synced:
            return {"synced": synced, "plain": _strip_times(synced)}
    text = ""
    try:
        if fmt == "mp3":
            from mutagen.id3 import ID3

            frames = ID3(path).getall("USLT")
            text = frames[0].text if frames else ""
        elif fmt == "m4a":
            from mutagen.mp4 import MP4

            text = (MP4(path).tags or {}).get("\xa9lyr", [""])[0]
        else:
            import mutagen

            audio = mutagen.File(path)
            if audio is not None and audio.tags is not None:
                text = (audio.tags.get("lyrics") or audio.tags.get("LYRICS") or [""])[0]
    except Exception:  # noqa: BLE001 - unreadable tags just mean no lyrics
        text = ""
    text = (text or "").strip()
    if not text:
        return None
    return {"synced": text, "plain": _strip_times(text)} if _looks_synced(text) else {"synced": "", "plain": text}
