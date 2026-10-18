"""YouTube sign-in for downloads: a cookies.txt file exported from a signed-in browser, or
Firefox's own cookies. (Google refuses sign-in inside app windows, so Cadence can't sign in itself.)

A cookies.txt file is checked when it's chosen, so a file without a YouTube sign-in, or with
an expired one, is reported then rather than as a failed download later.
"""

import os
import sys
import time

# YouTube sets LOGIN_INFO on youtube.com once a browser is signed in.
SIGN_IN_COOKIE = "LOGIN_INFO"


def problem_with_cookies_file(path: str, now: float | None = None) -> str | None:
    """None if the file holds a current YouTube sign-in, else what's wrong, in plain words."""
    if not os.path.isfile(path):
        return "Choose your cookies.txt file."
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            text = f.read(5_000_000)
    except OSError:
        return "Cadence couldn't read that file."
    now = time.time() if now is None else now
    youtube, sign_in_expiry = False, None
    for line in text.splitlines():
        if line.startswith("#HttpOnly_"):
            line = line[len("#HttpOnly_"):]
        elif not line.strip() or line.startswith("#"):
            continue
        fields = line.split("\t")
        if len(fields) != 7:
            continue
        domain, _, _, _, expiry, name, _ = fields
        if not domain.lstrip(".").lower().endswith("youtube.com"):
            continue
        youtube = True
        if name == SIGN_IN_COOKIE:
            sign_in_expiry = int(expiry) if expiry.isdigit() else 0
    if not youtube:
        return "That file has no YouTube cookies. Open youtube.com in your browser, then export the cookies from there."
    if sign_in_expiry is None:
        return "That file doesn't include a YouTube sign-in. Sign in on youtube.com in your browser first, then export again."
    if sign_in_expiry and sign_in_expiry < now:
        return "The YouTube sign-in in that file has expired. Export a fresh cookies.txt from your browser."
    return None


def firefox_profiles_dir() -> str:
    if sys.platform == "win32":
        return os.path.join(os.environ.get("APPDATA", ""), "Mozilla", "Firefox", "Profiles")
    if sys.platform == "darwin":
        return os.path.expanduser("~/Library/Application Support/Firefox/Profiles")
    return os.path.expanduser("~/.mozilla/firefox")


def firefox_installed() -> bool:
    """True when Firefox has a profile on this computer (so its YouTube sign-in can be read)."""
    folder = firefox_profiles_dir()
    try:
        return any(os.path.isdir(os.path.join(folder, d)) for d in os.listdir(folder))
    except OSError:
        return False
