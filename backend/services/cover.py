"""Cover art for saved songs: the user's own image, or the video thumbnail cropped square.

Album covers are square; YouTube thumbnails are 16:9. With "square covers" on
(the default), the centre of the thumbnail is used. A cover the user picks is
used as it is.
"""

import json
import os
import subprocess

from core.ffmpeg_utils import get_ffmpeg_path, get_ffprobe_path

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
CUSTOM_NAME = "cover-custom.jpg"
MAX_SIZE = 1400

_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


class CoverError(Exception):
    """The image can't be used. The message is shown to the user."""


def _ffmpeg(args: list[str]) -> bool:
    proc = subprocess.run([get_ffmpeg_path(), "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *args],
                          capture_output=True, creationflags=_NO_WINDOW)
    return proc.returncode == 0


def size(path: str) -> tuple[int, int] | None:
    """(width, height) of an image, or None if it can't be read. Blocking."""
    proc = subprocess.run(
        [get_ffprobe_path(), "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
         "-of", "json", path],
        capture_output=True, creationflags=_NO_WINDOW,
    )
    try:
        stream = json.loads(proc.stdout)["streams"][0]
        return int(stream["width"]), int(stream["height"])
    except (ValueError, KeyError, IndexError):
        return None


def import_image(src: str, out_dir: str, name: str = CUSTOM_NAME) -> str:
    """Copy the user's image into the job folder as a JPEG of at most 1400 px. Blocking."""
    if os.path.splitext(src)[1].lower() not in IMAGE_EXTENSIONS or not os.path.isfile(src):
        raise CoverError("Choose a JPG, PNG, WebP or BMP image.")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, name)
    tmp = out + ".part.jpg"
    scale = f"scale='min({MAX_SIZE},iw)':'min({MAX_SIZE},ih)':force_original_aspect_ratio=decrease"
    if not _ffmpeg(["-i", src, "-frames:v", "1", "-vf", scale, "-q:v", "2", tmp]):
        if os.path.exists(tmp):
            os.remove(tmp)
        raise CoverError("This image couldn't be read.")
    os.replace(tmp, out)
    return out


def square(src: str, out: str) -> str:
    """The centre square of `src` saved as `out`, or `src` itself if it is already (nearly) square. Blocking."""
    dims = size(src)
    if not dims or abs(dims[0] - dims[1]) <= 2:
        return src
    if os.path.isfile(out) and os.path.getmtime(out) >= os.path.getmtime(src):
        return out
    os.makedirs(os.path.dirname(out), exist_ok=True)
    tmp = out + ".part.jpg"
    if not _ffmpeg(["-i", src, "-frames:v", "1", "-vf", "crop='min(iw,ih)':'min(iw,ih)'", "-q:v", "2", tmp]):
        return src  # keep the original shape rather than saving songs without a cover
    os.replace(tmp, out)
    return out
