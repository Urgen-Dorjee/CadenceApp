"""Turn a track plus collection details into a safe path inside the library."""

import os
import re
from typing import Any

from config import Preferences

_ILLEGAL_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}
_MAX_COMPONENT = 120
# Folder names come from video titles, which can be very long ("Chicago, Air Supply, Bee Gees, Phil
# Collins, Steel Heart, and more… A classic soft rock songs!!!"). Keep them short enough to read, and
# the whole path well under Windows' 260-character limit (room is left for " (2)" and a .lrc file).
MAX_FOLDER = 60
MAX_FILE = 100
MAX_PATH_LEN = 240
_TRAILING = " .,;:-–—…&+|"


def shorten(name: str, limit: int) -> str:
    """`name` cut to at most `limit` characters, at a word boundary when there is one nearby."""
    if len(name) <= limit:
        return name
    cut = name[:limit]
    space = cut.rfind(" ")
    if space >= limit * 0.6:
        cut = cut[:space]
    return cut.rstrip(_TRAILING) or name[:limit]


def sanitize_component(name: str, fallback: str = "Untitled", limit: int = _MAX_COMPONENT) -> str:
    """Make one path component valid on Windows (and everywhere else)."""
    name = _ILLEGAL_RE.sub(" ", name)
    name = re.sub(r"\s{2,}", " ", name).strip().rstrip(". ")
    if not name:
        name = fallback
    if name.split(".")[0].upper() in _RESERVED:
        name = f"_{name}"
    return shorten(name, limit).rstrip(". ")


def same_file_key(path: str) -> str:
    """Compare paths the way Windows does: absolute, case-insensitive, either slash."""
    return os.path.normcase(os.path.abspath(path))


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
    pieces = [p for p in re.split(r"[\\/]+", rendered) if p.strip()]
    parts = [sanitize_component(p, limit=MAX_FOLDER) for p in pieces[:-1]]
    parts += [sanitize_component(p, limit=MAX_FILE) for p in pieces[-1:]]
    return os.path.join(*parts) if parts else sanitize_component(values["title"], limit=MAX_FILE)


def fit_path(root: str, rel: str, ext: str) -> str:
    """`rel` with its file name shortened so root/rel.ext stays under MAX_PATH_LEN."""
    folder, name = os.path.split(rel)
    over = len(os.path.join(root, f"{rel}.{ext}")) - MAX_PATH_LEN
    if over <= 0:
        return rel
    name = shorten(name, max(30, len(name) - over))
    return os.path.join(folder, name) if folder else name


def unique_path(path: str, replaceable: set[str] | frozenset[str] = frozenset()) -> str:
    """Never overwrite: "Song.mp3" -> "Song (2).mp3" if the first exists.

    Files in `replaceable` (normalised with `same_file_key`) are songs this split
    saved last time, which the user chose to replace; those may be overwritten.
    """
    if not os.path.exists(path) or same_file_key(path) in replaceable:
        return path
    base, ext = os.path.splitext(path)
    n = 2
    while os.path.exists(f"{base} ({n}){ext}"):
        n += 1
    return f"{base} ({n}){ext}"
