"""An .m3u8 playlist next to the songs of each saved album or collection, so other
players (and phones the folder is copied to) keep the songs in order."""

import os
from typing import Any

from services import library


def playlist_path(folder: str, collection: dict[str, Any]) -> str:
    name = collection.get("album") or collection.get("name") or "Playlist"
    return os.path.join(folder, f"{library.sanitize_component(name, 'Playlist')}.m3u8")


def render(entries: list[dict[str, Any]], playlist_dir: str) -> str:
    """Extended M3U: one #EXTINF line (seconds, "Artist - Title") and a relative path per song."""
    lines = ["#EXTM3U"]
    for e in entries:
        label = f"{e['artist']} - {e['title']}" if e.get("artist") else e["title"]
        lines.append(f"#EXTINF:{max(0, round(e['duration']))},{label}")
        lines.append(os.path.relpath(e["path"], playlist_dir))
    return "\n".join(lines) + "\n"


def write(path: str, entries: list[dict[str, Any]]) -> str:
    """Write the playlist atomically (UTF-8, as .m3u8 requires). Returns its path."""
    tmp = path + ".part"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(render(entries, os.path.dirname(path)))
    os.replace(tmp, path)
    return path
