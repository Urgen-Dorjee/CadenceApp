"""Locate a JavaScript runtime for yt-dlp (YouTube player challenges need one)."""

import os
import shutil
from pathlib import Path

from core.platform_paths import bundled_tool


def find_deno() -> str | None:
    # 1. Set by Electron (bundled copy in packaged builds)
    env_path = os.environ.get("DENO_PATH")
    if env_path and Path(env_path).is_file():
        return env_path
    # 2. Dev checkout: resources/deno/deno(.exe)
    bundled = bundled_tool("deno", "deno")
    if bundled.is_file():
        return str(bundled)
    # 3. Installed system-wide
    return shutil.which("deno")


def js_runtimes() -> dict[str, dict[str, str]]:
    """yt-dlp `js_runtimes` option: Deno if we have it, plus Node from PATH as a fallback."""
    runtimes: dict[str, dict[str, str]] = {}
    deno = find_deno()
    if deno:
        runtimes["deno"] = {"path": deno}
    node = shutil.which("node")
    if node:
        runtimes["node"] = {"path": node}  # yt-dlp ignores it if older than v22
    return runtimes or {"deno": {}}
