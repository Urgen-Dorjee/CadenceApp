"""Index of saved songs for the Library: read from each file's tags, kept in SQLite.

The index is rebuilt incrementally: a file is only re-read when its size or
modified time changes, and files that disappear are dropped. Only files in the
index can be streamed or have their cover served.
"""

import hashlib
import os
import sqlite3
import threading
import time
from typing import Any

AUDIO_EXTENSIONS = (".mp3", ".m4a", ".flac", ".opus", ".ogg")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS songs (
    id           TEXT PRIMARY KEY,
    path         TEXT NOT NULL UNIQUE,
    size         INTEGER NOT NULL,
    mtime        REAL NOT NULL,
    title        TEXT NOT NULL DEFAULT '',
    artist       TEXT NOT NULL DEFAULT '',
    album        TEXT NOT NULL DEFAULT '',
    album_artist TEXT NOT NULL DEFAULT '',
    year         TEXT NOT NULL DEFAULT '',
    track        INTEGER NOT NULL DEFAULT 0,
    duration     REAL NOT NULL DEFAULT 0,
    format       TEXT NOT NULL DEFAULT '',
    has_cover    INTEGER NOT NULL DEFAULT 0,
    added_at     REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS songs_artist ON songs(artist);
CREATE INDEX IF NOT EXISTS songs_album ON songs(album);
"""

SORTS = {
    "title": "title COLLATE NOCASE, artist COLLATE NOCASE",
    "artist": "COALESCE(NULLIF(artist, ''), album_artist) COLLATE NOCASE, album COLLATE NOCASE, track, title COLLATE NOCASE",
    "album": "album COLLATE NOCASE, track, title COLLATE NOCASE",
    "added": "added_at DESC, album COLLATE NOCASE, track",
}


def song_id(path: str) -> str:
    return hashlib.sha1(os.path.normcase(os.path.abspath(path)).encode("utf-8")).hexdigest()[:16]


def _first(tags: Any, *keys: str) -> str:
    for key in keys:
        try:
            value = tags.get(key) if tags is not None else None
        except (KeyError, ValueError):
            value = None
        if value:
            item = value[0] if isinstance(value, list) else value
            if isinstance(item, tuple):  # MP4 trkn: (number, total)
                item = item[0]
            text = str(item).strip()
            if text:
                return text
    return ""


def read_song(path: str) -> dict[str, Any]:
    """Tags, duration and cover presence for one audio file."""
    import mutagen

    info: dict[str, Any] = {
        "title": "", "artist": "", "album": "", "album_artist": "", "year": "",
        "track": 0, "duration": 0.0, "format": os.path.splitext(path)[1].lstrip(".").lower(), "has_cover": 0,
    }
    try:
        easy = mutagen.File(path, easy=True)
        full = mutagen.File(path)
    except Exception:  # noqa: BLE001 - unreadable file: index it by name only
        easy = full = None

    if easy is not None:
        info["duration"] = float(getattr(easy.info, "length", 0) or 0)
        info["title"] = _first(easy, "title")
        info["artist"] = _first(easy, "artist")
        info["album"] = _first(easy, "album")
        info["album_artist"] = _first(easy, "albumartist", "album artist")
        info["year"] = _first(easy, "date", "year")[:4]
        track = _first(easy, "tracknumber").split("/")[0]
        info["track"] = int(track) if track.isdigit() else 0
    if full is not None and full.tags is not None:
        keys = list(full.tags.keys())
        info["has_cover"] = int(
            any(str(k).startswith("APIC") for k in keys)
            or "covr" in keys
            or "metadata_block_picture" in [str(k).lower() for k in keys]
            or bool(getattr(full, "pictures", None))
        )
    if not info["title"]:
        info["title"] = os.path.splitext(os.path.basename(path))[0]
    return info


def read_cover(path: str) -> tuple[bytes, str] | None:
    """Embedded cover art as (bytes, mime type), or None."""
    import base64

    import mutagen
    from mutagen.flac import Picture

    try:
        audio = mutagen.File(path)
    except Exception:  # noqa: BLE001
        return None
    if audio is None:
        return None
    pictures = getattr(audio, "pictures", None)
    if pictures:
        return pictures[0].data, pictures[0].mime or "image/jpeg"
    tags = audio.tags
    if tags is None:
        return None
    for key in list(tags.keys()):
        if str(key).startswith("APIC"):
            frame = tags[key]
            return frame.data, frame.mime or "image/jpeg"
    if "covr" in tags and tags["covr"]:
        cover = tags["covr"][0]
        mime = "image/png" if getattr(cover, "imageformat", None) == 14 else "image/jpeg"
        return bytes(cover), mime
    blocks = tags.get("metadata_block_picture") if hasattr(tags, "get") else None
    if blocks:
        picture = Picture(base64.b64decode(blocks[0]))
        return picture.data, picture.mime or "image/jpeg"
    return None


class SongIndex:
    def __init__(self, db_path: str):
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.executescript(_SCHEMA)
        self._conn.commit()

    def _upsert(self, path: str, stat: os.stat_result) -> None:
        info = read_song(path)
        sid = song_id(path)
        with self._lock:
            existing = self._conn.execute("SELECT added_at FROM songs WHERE id = ?", (sid,)).fetchone()
            added = existing["added_at"] if existing else time.time()
            self._conn.execute(
                "INSERT OR REPLACE INTO songs (id, path, size, mtime, title, artist, album, album_artist, year, track, "
                "duration, format, has_cover, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (sid, os.path.abspath(path), stat.st_size, stat.st_mtime, info["title"], info["artist"], info["album"],
                 info["album_artist"], info["year"], info["track"], info["duration"], info["format"],
                 info["has_cover"], added),
            )
            self._conn.commit()

    def add_paths(self, paths: list[str]) -> int:
        """Index specific files (e.g. songs just saved). Returns how many were added or updated."""
        count = 0
        for path in paths:
            if path.lower().endswith(AUDIO_EXTENSIONS) and os.path.isfile(path):
                self._upsert(path, os.stat(path))
                count += 1
        return count

    def scan(self, roots: list[str], extra_paths: list[str] = ()) -> dict[str, int]:
        """Walk `roots` (plus `extra_paths`), re-reading only changed files and dropping missing ones."""
        with self._lock:
            known = {r["path"]: (r["size"], r["mtime"]) for r in self._conn.execute("SELECT path, size, mtime FROM songs")}
        seen: set[str] = set()
        added = updated = 0

        def consider(path: str) -> None:
            nonlocal added, updated
            path = os.path.abspath(path)
            if path in seen or not path.lower().endswith(AUDIO_EXTENSIONS) or path.endswith(".part"):
                return
            try:
                stat = os.stat(path)
            except OSError:
                return
            seen.add(path)
            before = known.get(path)
            if before == (stat.st_size, stat.st_mtime):
                return
            self._upsert(path, stat)
            if before is None:
                added += 1
            else:
                updated += 1

        for root in roots:
            if root and os.path.isdir(root):
                for dirpath, _dirs, files in os.walk(root):
                    for name in files:
                        consider(os.path.join(dirpath, name))
        for path in extra_paths:
            consider(path)

        missing = [p for p in known if p not in seen and not os.path.isfile(p)]
        with self._lock:
            self._conn.executemany("DELETE FROM songs WHERE path = ?", [(p,) for p in missing])
            self._conn.commit()
        return {"added": added, "updated": updated, "removed": len(missing), "total": self.count()}

    def count(self) -> int:
        with self._lock:
            return self._conn.execute("SELECT COUNT(*) FROM songs").fetchone()[0]

    def list(self, query: str = "", sort: str = "artist") -> list[dict[str, Any]]:
        order = SORTS.get(sort, SORTS["artist"])
        sql = "SELECT * FROM songs"
        params: list[Any] = []
        terms = [t for t in query.lower().split() if t]
        if terms:
            clauses = []
            for term in terms:
                clauses.append("(LOWER(title) LIKE ? OR LOWER(artist) LIKE ? OR LOWER(album) LIKE ? OR LOWER(album_artist) LIKE ?)")
                params += [f"%{term}%"] * 4
            sql += " WHERE " + " AND ".join(clauses)
        sql += f" ORDER BY {order}"
        with self._lock:
            return [dict(r) for r in self._conn.execute(sql, params).fetchall()]

    def get(self, sid: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute("SELECT * FROM songs WHERE id = ?", (sid,)).fetchone()
        return dict(row) if row else None


_index: SongIndex | None = None


def get_index() -> SongIndex:
    global _index
    if _index is None:
        from config import settings

        os.makedirs(settings.data_dir, exist_ok=True)
        _index = SongIndex(settings.db_path)
    return _index
