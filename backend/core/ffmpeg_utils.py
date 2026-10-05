import os
import shutil
from pathlib import Path

from config import settings


def get_ffmpeg_path() -> str:
    """Resolve FFmpeg binary path with fallback chain."""

    # 1. Environment variable (set by Electron)
    env_path = settings.ffmpeg_path
    if env_path and env_path != "ffmpeg" and Path(env_path).exists():
        return env_path

    # 2. Bundled location
    bundled = Path(__file__).parent.parent.parent / "resources" / "ffmpeg" / "ffmpeg.exe"
    if bundled.exists():
        return str(bundled)

    # 3. System PATH
    system_ffmpeg = shutil.which("ffmpeg")
    if system_ffmpeg:
        return system_ffmpeg

    raise FileNotFoundError(
        "FFmpeg not found. Run `npm run setup:ffmpeg`, or install FFmpeg and add it to your PATH."
    )


def get_ffprobe_path() -> str:
    ffmpeg = get_ffmpeg_path()
    directory, name = os.path.split(ffmpeg)
    candidate = os.path.join(directory, name.replace("ffmpeg", "ffprobe"))
    if os.path.exists(candidate):
        return candidate
    return shutil.which("ffprobe") or "ffprobe"


def is_ffmpeg_available() -> bool:
    try:
        get_ffmpeg_path()
        return True
    except FileNotFoundError:
        return False
