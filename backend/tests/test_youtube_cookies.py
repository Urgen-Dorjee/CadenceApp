"""YouTube sign-in through a cookies.txt file: checked when chosen."""

import os

from fastapi.testclient import TestClient

from config import Preferences, settings
from main import app
from services.youtube_cookies import problem_with_cookies_file

HOST = {"host": f"127.0.0.1:{settings.backend_port}"}
AUTH = {**HOST, "x-cadence-token": "test-token"}
HEADER = "# Netscape HTTP Cookie File\n"


def _file(tmp_path, *lines):
    path = tmp_path / "cookies.txt"
    path.write_text(HEADER + "\n".join(lines) + "\n", encoding="utf-8")
    return str(path)


def test_a_signed_in_export_is_accepted(tmp_path):
    path = _file(tmp_path, "#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t1893456000\tLOGIN_INFO\tabc",
                 ".youtube.com\tTRUE\t/\tTRUE\t1893456000\tPREF\tf6=8")
    assert problem_with_cookies_file(path, now=1_700_000_000) is None


def test_files_without_a_current_youtube_sign_in_are_explained(tmp_path):
    assert "no YouTube cookies" in problem_with_cookies_file(_file(tmp_path, ".example.com\tTRUE\t/\tFALSE\t0\ta\tb"))
    not_signed_in = _file(tmp_path, ".youtube.com\tTRUE\t/\tTRUE\t1893456000\tPREF\tf6=8")
    assert "doesn't include a YouTube sign-in" in problem_with_cookies_file(not_signed_in)
    expired = _file(tmp_path, ".youtube.com\tTRUE\t/\tTRUE\t1600000000\tLOGIN_INFO\tabc")
    assert "expired" in problem_with_cookies_file(expired, now=1_700_000_000)
    assert "Choose" in problem_with_cookies_file(str(tmp_path / "missing.txt"))


def test_choosing_a_file_without_a_sign_in_is_refused_with_the_reason(tmp_path):
    bad = _file(tmp_path, ".youtube.com\tTRUE\t/\tTRUE\t1893456000\tPREF\tf6=8")
    body = {**Preferences(library_dir=str(tmp_path)).model_dump(), "cookies_from": "file", "cookies_file": bad}
    with TestClient(app, base_url=f"http://127.0.0.1:{settings.backend_port}") as client:
        r = client.put("/api/preferences", headers=AUTH, json=body)
        assert r.status_code == 422 and "doesn't include a YouTube sign-in" in r.json()["detail"]
        assert set(client.get("/api/youtube/sign-in", headers=AUTH).json()) == {"firefox"}
    if os.path.exists(settings.prefs_path):
        os.remove(settings.prefs_path)
