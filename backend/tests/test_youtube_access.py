import os

import pytest
from fastapi.testclient import TestClient

from config import Preferences, save_preferences, settings
from main import app
from services import pipeline, youtube

AUTH = {"host": f"127.0.0.1:{settings.backend_port}", "x-cadence-token": "test-token"}


@pytest.fixture(autouse=True)
def clean():
    yield
    if os.path.exists(settings.prefs_path):
        os.remove(settings.prefs_path)


def test_no_sign_in_or_proxy_by_default():
    opts = youtube._base_opts()
    assert "cookiesfrombrowser" not in opts and "cookiefile" not in opts and "proxy" not in opts


def test_browser_cookies_file_and_proxy(tmp_path):
    save_preferences(Preferences(cookies_from="firefox", proxy=" socks5://127.0.0.1:1080 "))
    opts = youtube._base_opts()
    assert opts["cookiesfrombrowser"] == ("firefox",) and opts["proxy"] == "socks5://127.0.0.1:1080"
    jar = tmp_path / "cookies.txt"
    jar.write_text("# Netscape HTTP Cookie File\n")
    save_preferences(Preferences(cookies_from="file", cookies_file=str(jar)))
    opts = youtube._base_opts()
    assert opts["cookiefile"] == str(jar) and "cookiesfrombrowser" not in opts


@pytest.fixture
def client():
    with TestClient(app, base_url=f"http://127.0.0.1:{settings.backend_port}") as c:
        yield c


@pytest.mark.parametrize("patch, ok", [
    ({"cookies_from": "firefox"}, True),
    ({"cookies_from": "safari"}, False),
    ({"cookies_from": "file", "cookies_file": r"C:\nope\cookies.txt"}, False),
    ({"proxy": "http://proxy.local:8080"}, True),
    ({"proxy": "proxy.local:8080"}, False),
])
def test_settings_validation(client, tmp_path, patch, ok):
    body = {**Preferences(library_dir=str(tmp_path)).model_dump(), **patch}
    r = client.put("/api/preferences", json=body, headers=AUTH)
    assert (r.status_code == 200) is ok, r.text


@pytest.mark.parametrize("message, expected", [
    ("ERROR: [youtube] x: Sign in to confirm your age. This video may be inappropriate", "age-restricted"),
    ("ERROR: [youtube] x: Sign in to confirm you're not a bot", "not a bot"),
    ("Could not copy Chrome cookie database. See https://github.com/yt-dlp/...", "Close the browser"),
    ("Failed to decrypt with DPAPI", "Close the browser"),
])
def test_friendly_sign_in_errors(message, expected):
    assert expected in pipeline.friendly_error(Exception(message))
