"""SQLite-backed job store. Jobs survive app restarts so long splits can resume."""

import json
import sqlite3
import threading
import time
import uuid
from typing import Any

from config import settings

# Job lifecycle:
#   queued -> resolving -> downloading -> analyzing -> review -> exporting -> completed
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
"""

_JSON_FIELDS = ("collection", "sources", "tracks", "outputs")

# Columns added after the first release, with their definitions.
_ADDED_COLUMNS = {
    # Folder chosen for this split only; empty means the library folder.
    "destination": "TEXT NOT NULL DEFAULT ''",
    # The .m3u8 playlist written by the last save, so saving again can replace it.
    "playlist": "TEXT NOT NULL DEFAULT ''",
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

    def create(self, url: str) -> dict[str, Any]:
        now = time.time()
        job_id = uuid.uuid4().hex[:12]
        with self._lock:
            self._conn.execute(
                "INSERT INTO jobs (id, url, status, message, created_at, updated_at) VALUES (?, ?, 'queued', 'Waiting to start', ?, ?)",
                (job_id, url, now, now),
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
        import os

        os.makedirs(settings.data_dir, exist_ok=True)
        _store = JobStore(settings.db_path)
    return _store
