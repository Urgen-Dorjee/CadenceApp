"""Keeping users' data safe: database upgrades run once with a copy kept first, daily
backups, and a diagnostics report that leaves out personal details."""

import os
import sqlite3

from fastapi.testclient import TestClient

from config import Preferences, save_preferences, settings
from core import backup
from core.db import JobStore
from main import app
from services import diagnostics

HOST = {"host": f"127.0.0.1:{settings.backend_port}"}
AUTH = {**HOST, "x-cadence-token": "test-token"}


def _old_database(path):
    """A database as the first releases made it: the jobs table without later columns."""
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE jobs (id TEXT PRIMARY KEY, url TEXT, title TEXT, status TEXT, progress REAL, message TEXT, error TEXT,"
        " sources TEXT, tracks TEXT, collection TEXT, outputs TEXT, created_at REAL, updated_at REAL)"
    )
    conn.execute("INSERT INTO jobs VALUES ('j1', 'https://youtu.be/x', 'Old', 'completed', 100, '', NULL, '[]', '[]', '{}', '[]', 1, 1)")
    conn.commit()
    conn.close()


def test_an_old_database_is_upgraded_once_with_a_copy_kept_first(tmp_path):
    db = tmp_path / "cadence.db"
    _old_database(db)
    store = JobStore(str(db))
    assert store.schema_version == len(store._migrations())
    assert store.get("j1")["kind"] == "music"                      # the added column, with its default
    copies = backup.list_backups(str(tmp_path))
    assert len(copies) == 1 and "before-layout" in copies[0]["name"]
    copy = sqlite3.connect(tmp_path / "backups" / copies[0]["name"])
    assert copy.execute("SELECT title FROM jobs").fetchone()[0] == "Old"   # the copy is the old database
    copy.close()
    store._conn.close()
    JobStore(str(db))._conn.close()                                # opening again changes nothing
    assert len(backup.list_backups(str(tmp_path))) == 1


def test_a_new_database_needs_no_copy(tmp_path):
    store = JobStore(str(tmp_path / "cadence.db"))
    assert store.schema_version == len(store._migrations())
    assert backup.list_backups(str(tmp_path)) == []
    store._conn.close()


def test_daily_backups_happen_once_a_day_and_only_a_week_is_kept(tmp_path):
    db = tmp_path / "cadence.db"
    JobStore(str(db))._conn.close()
    prefs = tmp_path / "preferences.json"
    prefs.write_text("{}")
    assert backup.daily_backup(str(db), str(prefs), str(tmp_path))
    assert backup.daily_backup(str(db), str(prefs), str(tmp_path)) is None     # already done today
    folder = tmp_path / "backups"
    for day in range(1, 12):
        (folder / f"cadence-2020-01-{day:02d}_000000-daily.db").write_bytes(b"x")
        (folder / f"preferences-2020-01-{day:02d}_000000-daily.json").write_text("{}")
    backup.prune(str(folder))
    names = sorted(os.listdir(folder))
    assert len([n for n in names if n.endswith(".db")]) == backup.BACKUPS_KEPT
    assert "preferences-2020-01-01_000000-daily.json" not in names           # went with its database copy


def test_diagnostics_leave_out_the_home_folder_secrets_and_keys(tmp_path):
    home = os.path.expanduser("~")
    song = os.path.join(home, "Music", "x.mp3")
    text = diagnostics.anonymize(f"saved to {song} via http://127.0.0.1:5000/a?token=abc123&x=1")
    assert home not in text and "~" in text and "abc123" not in text
    save_preferences(Preferences(library_dir=str(tmp_path), acoustid_key="SECRETKEY", proxy="http://user:pass@proxy:8080"))
    try:
        with TestClient(app, base_url=f"http://127.0.0.1:{settings.backend_port}") as client:
            report = client.get("/api/diagnostics", headers=AUTH).json()["text"]
    finally:
        os.remove(settings.prefs_path)
    assert "## Tools" in report and "database layout:" in report
    assert "SECRETKEY" not in report and "user:pass" not in report
    assert "acoustid_key: set" in report and "proxy: set" in report


def test_backups_can_be_listed_and_made_from_settings():
    with TestClient(app, base_url=f"http://127.0.0.1:{settings.backend_port}") as client:
        made = client.post("/api/backups", headers=AUTH).json()["name"]
        listed = client.get("/api/backups", headers=AUTH).json()
    assert made.endswith("-manual.db") and made in [b["name"] for b in listed["backups"]]
