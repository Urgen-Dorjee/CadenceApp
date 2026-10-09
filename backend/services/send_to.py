"""Copy saved songs to a folder or drive (USB stick, SD card, a phone's sync folder) or into
Apple Music / iTunes, optionally converting them to MP3 for players that need it.

The songs in the library are never changed or moved.
"""

import glob
import os
import shutil
import subprocess
import sys
from typing import Any

from core.ffmpeg_utils import get_ffmpeg_path
from services.library import sanitize_component

_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

# Apple Music and iTunes play these as they are; anything else is converted to MP3 for them.
MUSIC_APP_FORMATS = {"mp3", "m4a"}


class SendError(Exception):
    """Shown to the user."""


def target_name(song: dict[str, Any], layout: str, ext: str) -> str:
    """Where a song goes inside the destination: "Singer/Album/01 Title.mp3" (folders) or
    "Singer - Title.mp3" (all in one folder)."""
    title = sanitize_component(song.get("title") or os.path.splitext(os.path.basename(song["path"]))[0])
    artist = song.get("artist") or song.get("album_artist") or ""
    if layout == "flat":
        name = f"{sanitize_component(artist)} - {title}" if artist else title
        return f"{name}.{ext}"
    folder_artist = sanitize_component(song.get("album_artist") or artist, "Unknown Singer")
    album = sanitize_component(song.get("album") or "", "Singles")
    number = f"{int(song['track']):02d} " if song.get("track") else ""
    return os.path.join(folder_artist, album, f"{number}{title}.{ext}")


def build_mp3_command(src: str, dest: str, bitrate: int) -> list[str]:
    """Convert to MP3, keeping the tags and the cover picture."""
    return [
        get_ffmpeg_path(), "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", src,
        "-map", "0:a:0", "-map", "0:v:0?", "-c:v", "mjpeg", "-disposition:v", "attached_pic",
        "-map_metadata", "0", "-c:a", "libmp3lame", "-b:a", f"{bitrate}k", "-id3v2_version", "3",
        "-f", "mp3", dest,
    ]


def copy_song(song: dict[str, Any], dest_root: str, layout: str, to_mp3: bool, bitrate: int = 320) -> str:
    """Copy (or convert) one song. Returns "copied", or "skipped" when the same file is already there. Blocking."""
    src = song["path"]
    if not os.path.isfile(src):
        raise SendError("The song file is missing.")
    convert = to_mp3 and song.get("format") != "mp3"
    ext = "mp3" if convert else os.path.splitext(src)[1].lstrip(".").lower()
    dest = os.path.join(dest_root, target_name(song, layout, ext))
    if os.path.isfile(dest) and (convert or os.path.getsize(dest) == os.path.getsize(src)):
        return "skipped"
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    try:
        if convert:
            proc = subprocess.run(
                build_mp3_command(src, tmp, bitrate), capture_output=True, stdin=subprocess.DEVNULL,
                creationflags=_NO_WINDOW, timeout=max(300.0, 2 * float(song.get("duration") or 0)),
            )
            if proc.returncode != 0:
                raise SendError("Couldn't convert it to MP3.")
        else:
            shutil.copyfile(src, tmp)
        os.replace(tmp, dest)
    except OSError as e:
        raise SendError(f"Couldn't write to the destination ({e.strerror or e}).") from e
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    return "copied"


def music_app_folder() -> tuple[str, str] | None:
    """(folder, app name) of the Apple Music / iTunes "Automatically Add" folder, if installed.
    Files copied there are imported by the app, which moves them into its own library."""
    music = os.path.join(os.path.expanduser("~"), "Music")
    patterns = [
        os.path.join(music, "Music", "Media.localized", "Automatically Add to Music.localized"),
        os.path.join(music, "iTunes", "iTunes Media", "Automatically Add to iTunes*"),
        os.path.join(music, "*", "*", "Automatically Add to *"),
        os.path.join(music, "*", "*", "*", "Automatically Add to *"),
    ]
    for pattern in patterns:
        for folder in sorted(glob.glob(pattern)):
            if os.path.isdir(folder):
                name = os.path.basename(folder).replace(".localized", "").removeprefix("Automatically Add to ").strip()
                return folder, name or ("Music" if sys.platform == "darwin" else "iTunes")
    return None
