"""Turn a track plus collection details into a safe path inside the library."""

import os
import re
from typing import Any

from config import Preferences

_ILLEGAL_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}
_MAX_COMPONENT = 120


def sanitize_component(name: str, fallback: str = "Untitled") -> str:
    """Make one path component valid on Windows (and everywhere else)."""
    name = _ILLEGAL_RE.sub(" ", name)
    name = re.sub(r"\s{2,}", " ", name).strip().rstrip(". ")
    if not name:
        name = fallback
    if name.split(".")[0].upper() in _RESERVED:
        name = f"_{name}"
    return name[:_MAX_COMPONENT].rstrip(". ")


def template_for(collection_type: str, prefs: Preferences) -> str:
    return {
        "artist": prefs.artist_template,
        "album": prefs.album_template,
        "collection": prefs.collection_template,
        "single": prefs.single_template,
    }.get(collection_type, prefs.collection_template)


def relative_path(track: dict[str, Any], number: int, collection: dict[str, Any], prefs: Preferences) -> str:
    """Path relative to the library root, without extension."""
    artist = track.get("artist") or collection.get("artist") or "Unknown Artist"
    album = collection.get("album") or collection.get("name") or "Unknown Album"
    year = collection.get("year") or ""
    values: dict[str, Any] = {
        "artist": artist,
        "album": album,
        "collection": collection.get("name") or album,
        "year": year,
        "year_suffix": f" ({year})" if year else "",
        "title": track.get("title") or f"Track {number}",
    }
    # Slashes inside a value must not create folders; only the template's own slashes do.
    values = {k: re.sub(r"[\\/]+", " ", str(v)) for k, v in values.items()}
    values["track"] = number
    template = template_for(collection.get("type", "collection"), prefs)
    try:
        rendered = template.format(**values)
    except (KeyError, IndexError, ValueError):
        rendered = template_for(collection.get("type", "collection"), Preferences()).format(**values)
    parts = [sanitize_component(p) for p in re.split(r"[\\/]+", rendered) if p.strip()]
    return os.path.join(*parts) if parts else sanitize_component(values["title"])


def unique_path(path: str) -> str:
    """Never overwrite: "Song.mp3" -> "Song (2).mp3" if the first exists."""
    if not os.path.exists(path):
        return path
    base, ext = os.path.splitext(path)
    n = 2
    while os.path.exists(f"{base} ({n}){ext}"):
        n += 1
    return f"{base} ({n}){ext}"
