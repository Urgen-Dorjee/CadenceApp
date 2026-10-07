"""Where things live on Windows, macOS and Linux."""

import os
import sys
from pathlib import Path

# resources/ in a dev checkout (packaged builds get exact tool paths from Electron).
RESOURCES_DIR = Path(__file__).parent.parent.parent / "resources"


def exe(name: str) -> str:
    """Executable file name: "ffmpeg" -> "ffmpeg.exe" on Windows."""
    return f"{name}.exe" if os.name == "nt" else name


def bundled_tool(folder: str, name: str) -> Path:
    """resources/<folder>/<name>[.exe] in a dev checkout."""
    return RESOURCES_DIR / folder / exe(name)


def default_data_dir(app_name: str) -> str:
    """Per-user app data folder, the same one Electron uses for the app:
    %APPDATA%\\Cadence, ~/Library/Application Support/Cadence or ~/.config/Cadence."""
    if os.name == "nt":
        return os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), app_name)
    if sys.platform == "darwin":
        return os.path.join(os.path.expanduser("~"), "Library", "Application Support", app_name)
    return os.path.join(os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config"), app_name)
