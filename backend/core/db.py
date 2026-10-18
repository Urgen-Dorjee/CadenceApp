"""SQLite-backed job store. Jobs survive app restarts so long splits can resume."""

import json
import os
import sqlite3
import threading
import time
import uuid
from typing import Any, Sequence

from config import settings

# Job lifecycle (music):
#   queued -> resolving -> downloading -> analyzing -> review -> exporting -> completed
# Video downloads: queued -> resolving -> downloading -> completed, and can be paused.
# Any running state can move to failed or cancelled.
RUNNING_STATES = ("queued", "resolving", "downloading", "analyzing")
ACTIVE_STATES = RUNNING_STATES + ("exporting",)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id          TEXT PRIMARY KEY,
    url         TEXT NOT NULL,
    status      TEXT NOT NULL,
    progress    REAL NOT NULL DEFAULT 0,
    message     TEXT NOT NULL DEFAULT '',
    error       TEXT,
    title       TEXT NOT NULL DEFAULT '',
    thumbnail   TEXT,
    collection  TEXT NOT NULL DEFAULT '{}',
    sources     TEXT NOT NULL DEFAULT '[]',
    tracks      TEXT NOT NULL DEFAULT '[]',
    outputs     TEXT NOT NULL DEFAULT '[]',
    created_at  REAL NOT NULL,
    updated_at  REAL NOT NULL
);

-- YouTube videos whose songs were saved, kept after the split is removed from the list,
-- so a playlist or channel can show which videos were done before.
CREATE TABLE IF NOT EXISTS saved_videos (
    video_id  TEXT PRIMARY KEY,
    title     TEXT NOT NULL DEFAULT '',
    saved_at  REAL NOT NULL
);

-- Whole videos Cadence downloaded (the Videos tab of the library).
CREATE TABLE IF NOT EXISTS videos (
    path            TEXT PRIMARY KEY,
    video_id        TEXT NOT NULL DEFAULT '',
    title           TEXT NOT NULL DEFAULT '',
    channel         TEXT NOT NULL DEFAULT '',
    playlist        TEXT NOT NULL DEFAULT '',
    playlist_index  INTEGER NOT NULL DEFAULT 0,
    duration        REAL NOT NULL DEFAULT 0,
    height          INTEGER NOT NULL DEFAULT 0,
    ext             TEXT NOT NULL DEFAULT '',
    size            INTEGER NOT NULL DEFAULT 0,
    subtitles       TEXT NOT NULL DEFAULT '[]',
    thumbnail       TEXT NOT NULL DEFAULT '',
    saved_at        REAL NOT NULL
);

-- Where each downloaded video was left off in the built-in player. Kept apart from
-- the videos table, so downloading a video again doesn't forget it.
CREATE TABLE IF NOT EXISTS video_progress (
    path        TEXT PRIMARY KEY,
    position    REAL NOT NULL DEFAULT 0,
    duration    REAL NOT NULL DEFAULT 0,
    updated_at  REAL NOT NULL
);
"""

_JSON_FIELDS = ("collection", "sources", "tracks", "outputs", "options")

# Columns added after the first release, with their definitions.
_ADDED_COLUMNS = {
    # Folder chosen for this split only; empty means the library folder.
    "destination": "TEXT NOT NULL DEFAULT ''",
    # The .m3u8 playlist written by the last save, so saving again can replace it.
    "playlist": "TEXT NOT NULL DEFAULT ''",
    # Cover image the user chose for this split (in its work folder); empty means the video's.
    "cover": "TEXT NOT NULL DEFAULT ''",
    # "music" (split into songs) or "video" (the whole video).
    "kind": "TEXT NOT NULL DEFAULT 'music'",
    # A video download's choices: quality, file type, subtitles, chapters...
    "options": "TEXT NOT NULL DEFAULT '{}'",
}


class JobStore:
    def __init__(self, path: str):
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.executescript(_SCHEMA)
        self._migrate()
        self._conn.commit()

    def _migrate(self) -> None:
        """Add columns introduced after the first release to existing databases."""
        existing = {row["name"] for row in self._conn.execute("PRAGMA table_info(jobs)")}
        for column, ddl in _ADDED_COLUMNS.items():
            if column not in existing:
                self._conn.execute(f"ALTER TABLE jobs ADD COLUMN {column} {ddl}")

    def _row_to_job(self, row: sqlite3.Row) -> dict[str, Any]:
        job = dict(row)
        for field in _JSON_FIELDS:
            job[field] = json.loads(job[field])
        return job

    def create(self, url: str, kind: str = "music", options: dict[str, Any] | None = None) -> dict[str, Any]:
        now = time.time()
        job_id = uuid.uuid4().hex[:12]
        with self._lock:
            self._conn.execute(
                "INSERT INTO jobs (id, url, status, message, kind, options, created_at, updated_at) "
                "VALUES (?, ?, 'queued', 'Waiting to start', ?, ?, ?, ?)",
                (job_id, url, kind, json.dumps(options or {}), now, now),
            )
            self._conn.commit()
        return self.get(job_id)  # type: ignore[return-value]

    def get(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return self._row_to_job(row) if row else None

    def list(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute("SELECT * FROM jobs ORDER BY created_at DESC").fetchall()
        return [self._row_to_job(r) for r in rows]

    def update(self, job_id: str, **fields: Any) -> dict[str, Any] | None:
        if not fields:
            return self.get(job_id)
        fields["updated_at"] = time.time()
        cols, values = [], []
        for key, value in fields.items():
            cols.append(f"{key} = ?")
            values.append(json.dumps(value) if key in _JSON_FIELDS else value)
        values.append(job_id)
        with self._lock:
            self._conn.execute(f"UPDATE jobs SET {', '.join(cols)} WHERE id = ?", values)
            self._conn.commit()
        return self.get(job_id)

    def remember_saved_videos(self, videos: Sequence[tuple[str, str]]) -> None:
        """Record (video id, title) pairs whose songs were saved."""
        if not videos:
            return
        now = time.time()
        with self._lock:
            self._conn.executemany(
                "INSERT INTO saved_videos (video_id, title, saved_at) VALUES (?, ?, ?) "
                "ON CONFLICT(video_id) DO UPDATE SET title = excluded.title, saved_at = excluded.saved_at",
                [(vid, title, now) for vid, title in videos],
            )
            self._conn.commit()

    def saved_video_ids(self) -> set[str]:
        with self._lock:
            return {row["video_id"] for row in self._conn.execute("SELECT video_id FROM saved_videos")}

    def add_video(self, video: dict[str, Any]) -> None:
        """Record a downloaded video (replacing any record of the same file)."""
        row = {**video, "subtitles": json.dumps(video.get("subtitles") or []), "saved_at": time.time()}
        cols = ("path", "video_id", "title", "channel", "playlist", "playlist_index", "duration", "height", "ext", "size",
                "subtitles", "thumbnail", "saved_at")
        with self._lock:
            self._conn.execute(
                f"INSERT OR REPLACE INTO videos ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                [row.get(c, "" if c in ("video_id", "title", "channel", "playlist", "ext", "thumbnail") else 0) for c in cols],
            )
            self._conn.commit()

    def list_videos(self) -> "list[dict[str, Any]]":
        """Every downloaded video, newest first, with where it was left off in the player
        (`position`, 0 if never played)."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT v.*, COALESCE(p.position, 0) AS position FROM videos v "
                "LEFT JOIN video_progress p ON p.path = v.path ORDER BY v.saved_at DESC"
            ).fetchall()
        return [{**dict(r), "subtitles": json.loads(r["subtitles"])} for r in rows]

    def set_video_progress(self, path: str, position: float, duration: float) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO video_progress (path, position, duration, updated_at) VALUES (?, ?, ?, ?)",
                (path, max(0.0, position), max(0.0, duration), time.time()),
            )
            self._conn.commit()

    def remove_video(self, path: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute("SELECT * FROM videos WHERE path = ?", (path,)).fetchone()
            self._conn.execute("DELETE FROM videos WHERE path = ?", (path,))
            self._conn.commit()
        return dict(row) if row else None

    def downloaded_video_ids(self) -> set[str]:
        """Videos downloaded whole whose file is still there."""
        return {v["video_id"] for v in self.list_videos() if v["video_id"] and os.path.isfile(v["path"])}

    def delete(self, job_id: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
            self._conn.commit()

    def recover_interrupted(self) -> None:
        """Called on startup: jobs that were mid-flight when the app closed."""
        with self._lock:
            self._conn.execute(
                "UPDATE jobs SET status = 'failed', error = 'Interrupted when the app closed. Retry to resume.', "
                f"message = '' WHERE status IN ({','.join('?' * len(RUNNING_STATES))})",
                RUNNING_STATES,
            )
            self._conn.execute(
                "UPDATE jobs SET status = 'review', message = 'Export was interrupted. Export again to finish.' "
                "WHERE status = 'exporting'"
            )
            self._conn.commit()


_store: JobStore | None = None


def get_store() -> JobStore:
    global _store
    if _store is None:
        os.makedirs(settings.data_dir, exist_ok=True)
        _store = JobStore(settings.db_path)
    return _store
