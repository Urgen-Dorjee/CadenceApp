"""Copies of Cadence's database and settings, so a broken update or disk problem can't take a
user's history (splits, saved songs, video progress) with it.

A copy is made once a day at startup and before the database is upgraded to a new layout,
into <data folder>/backups. The newest BACKUPS_KEPT copies are kept.
To restore one: quit Cadence and copy it over cadence.db (and preferences.json).
"""

import datetime as dt
import glob
import logging
import os
import shutil
import sqlite3

BACKUPS_KEPT = 7
log = logging.getLogger(__name__)


def backups_dir(data_dir: str) -> str:
    return os.path.join(data_dir, "backups")


def copy_database(conn: sqlite3.Connection, dest: str) -> str:
    """A consistent copy of an open database (SQLite's backup API works while it's in use)."""
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    target = sqlite3.connect(dest)
    try:
        conn.backup(target)
    finally:
        target.close()
    return dest


def backup_now(db_path: str, prefs_path: str, data_dir: str, label: str = "daily") -> str:
    """Copy the database (and the settings file, if there is one) now. Returns the copy's path."""
    stamp = dt.datetime.now().strftime("%Y-%m-%d_%H%M%S")
    folder = backups_dir(data_dir)
    source = sqlite3.connect(db_path)
    try:
        dest = copy_database(source, os.path.join(folder, f"cadence-{stamp}-{label}.db"))
    finally:
        source.close()
    if os.path.isfile(prefs_path):
        shutil.copy2(prefs_path, os.path.join(folder, f"preferences-{stamp}-{label}.json"))
    prune(folder)
    return dest


def daily_backup(db_path: str, prefs_path: str, data_dir: str) -> str | None:
    """Back up once per day: does nothing if today's copy exists or there is nothing to copy."""
    if not os.path.isfile(db_path):
        return None
    today = dt.date.today().isoformat()
    if glob.glob(os.path.join(glob.escape(backups_dir(data_dir)), f"cadence-{today}_*.db")):
        return None
    return backup_now(db_path, prefs_path, data_dir)


def prune(folder: str, keep: int = BACKUPS_KEPT) -> None:
    """Keep the newest `keep` database copies, and the settings copies made with them."""
    copies = sorted(glob.glob(os.path.join(glob.escape(folder), "cadence-*.db")), reverse=True)
    for old in copies[keep:]:
        stamp_label = os.path.basename(old)[len("cadence-"):-len(".db")]
        for path in (old, os.path.join(folder, f"preferences-{stamp_label}.json")):
            try:
                os.remove(path)
            except FileNotFoundError:
                pass
            except OSError as e:
                log.warning("Couldn't remove old backup %s: %s", path, e)


def list_backups(data_dir: str) -> list[dict]:
    """The database copies, newest first: {"name", "size", "created"}."""
    found = []
    for path in sorted(glob.glob(os.path.join(glob.escape(backups_dir(data_dir)), "cadence-*.db")), reverse=True):
        found.append({"name": os.path.basename(path), "size": os.path.getsize(path), "created": os.path.getmtime(path)})
    return found
