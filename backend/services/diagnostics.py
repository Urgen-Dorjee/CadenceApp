"""A plain-text report for bug reports: versions, tools, counts, settings without secrets, and
the end of the log. Personal details stay out: the home folder shows as "~", keys and the
proxy (which can hold a password) only as set or not, and the per-launch secret is removed.
"""

import os
import platform
import re
import shutil
import subprocess
import sys
from collections import Counter
from typing import Any

from config import load_preferences, settings
from core import backup
from core.db import get_store
from core.ffmpeg_utils import get_ffmpeg_path, get_ffprobe_path

LOG_LINES = 150
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
_TOKEN = re.compile(r"(token=|x-cadence-token[\"']?:\s*[\"']?)[^\s\"'&]+", re.IGNORECASE)
_SECRET_PREFS = ("acoustid_key", "anthropic_api_key", "proxy")


def anonymize(text: str) -> str:
    """Home folder -> "~" (in either slash style), and no per-launch secret."""
    home = os.path.expanduser("~")
    for form in {home, home.replace("\\", "/"), home.replace("/", "\\")}:
        if form and len(form) > 3:
            text = re.sub(re.escape(form), "~", text, flags=re.IGNORECASE)
    return _TOKEN.sub(r"\1[removed]", text)


def _tool_version(path: str | None, *args: str) -> str:
    if not path:
        return "missing"
    try:
        out = subprocess.run([path, *args], capture_output=True, text=True, timeout=10, creationflags=_NO_WINDOW)
        first = (out.stdout or out.stderr).strip().splitlines()
        return first[0][:120] if first else "found"
    except (OSError, subprocess.SubprocessError):
        return "won't start"


def _module_version(name: str) -> str:
    try:
        module = __import__(name)
    except ImportError:
        return "not installed"
    version = getattr(module, "__version__", None) or getattr(getattr(module, "version", None), "__version__", None)
    return str(version or "installed")


def _preferences() -> dict[str, Any]:
    prefs = load_preferences().model_dump()
    shown = {}
    for key, value in prefs.items():
        if key in _SECRET_PREFS:
            shown[key] = "set" if value else "not set"
        elif key == "cookies_file":
            shown[key] = "set" if value else ""
        else:
            shown[key] = value
    return shown


def _log_tail(lines: int = LOG_LINES) -> str:
    path = os.path.join(settings.data_dir, "logs", "main.log")
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return "".join(f.readlines()[-lines:])
    except OSError:
        return "(no log file)"


def report(app_version: str) -> str:
    """The whole report. Blocking (runs the tools to read their versions)."""
    from services import identify, song_index

    store = get_store()
    jobs = store.list()
    statuses = Counter(f"{j.get('kind') or 'music'} {j['status']}" for j in jobs)
    backups = backup.list_backups(settings.data_dir)
    deno = os.environ.get("DENO_PATH") or shutil.which("deno")
    try:
        songs = song_index.get_index().count()
    except Exception:  # noqa: BLE001 - a report shouldn't fail over one figure
        songs = "?"
    sections = [
        ("Cadence", [
            f"version {app_version}",
            f"installed: {bool(os.environ.get('CADENCE_PACKAGED')) or getattr(sys, 'frozen', False)}",
            f"system: {platform.platform()} ({platform.machine()})",
            f"python: {platform.python_version()}",
        ]),
        ("Tools", [
            f"yt-dlp: {_module_version('yt_dlp')}",
            f"curl_cffi (browser-like requests): {_module_version('curl_cffi')}",
            f"ffmpeg: {_tool_version(get_ffmpeg_path(), '-version')}",
            f"ffprobe: {_tool_version(get_ffprobe_path(), '-version')}",
            f"deno: {_tool_version(deno, '--version')}",
            f"fpcalc: {_tool_version(identify.find_fpcalc(), '-version')}",
        ]),
        ("Data", [
            f"folder: {settings.data_dir}",
            f"database layout: {store.schema_version}",
            f"database size: {os.path.getsize(settings.db_path) // 1024} KB" if os.path.isfile(settings.db_path) else "database: missing",
            f"jobs: {len(jobs)} ({', '.join(f'{n} {k}' for k, n in sorted(statuses.items())) or 'none'})",
            f"library songs: {songs}",
            f"videos: {len(store.list_videos())}",
            f"backups: {len(backups)}" + (f" (newest {backups[0]['name']})" if backups else ""),
        ]),
        ("Settings", [f"{k}: {v}" for k, v in _preferences().items()]),
    ]
    text = "\n\n".join(f"## {title}\n" + "\n".join(lines) for title, lines in sections)
    text += f"\n\n## Log (last {LOG_LINES} lines)\n" + _log_tail()
    return anonymize(text)
