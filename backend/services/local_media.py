"""Use a file from the user's computer as a split source.

The original file is only ever read: songs are cut from it directly (no quality
lost to an extra encode), and it is never moved or deleted. Formats the app's
player can't play (most video containers, WMA, APE...) get a small playback copy
in the job's work folder.
"""

import hashlib
import json
import os
import subprocess
from typing import Any, Callable

from core.ffmpeg_utils import get_ffmpeg_path, get_ffprobe_path

AUDIO_EXTENSIONS = {".mp3", ".m4a", ".aac", ".flac", ".wav", ".ogg", ".opus", ".wma", ".aiff", ".aif", ".ape", ".m4b"}
VIDEO_EXTENSIONS = {".mp4", ".mkv", ".webm", ".mov", ".avi", ".m4v", ".wmv", ".flv", ".ts"}
SUPPORTED_EXTENSIONS = AUDIO_EXTENSIONS | VIDEO_EXTENSIONS
# Audio files the built-in player (Chromium) plays as they are.
PLAYABLE_EXTENSIONS = {".mp3", ".m4a", ".aac", ".flac", ".wav", ".ogg", ".opus"}
PREVIEW_NAME = "preview.webm"

_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


class LocalFileError(Exception):
    """The file can't be used. The message is shown to the user."""


def is_supported(path: str) -> bool:
    return os.path.splitext(path)[1].lower() in SUPPORTED_EXTENSIONS


def needs_preview(path: str) -> bool:
    return os.path.splitext(path)[1].lower() not in PLAYABLE_EXTENSIONS


def source_id(path: str) -> str:
    """Stable id for a local file, so a retried job reuses its work files."""
    return "local-" + hashlib.sha1(os.path.normcase(os.path.abspath(path)).encode("utf-8")).hexdigest()[:10]


def _tag(tags: dict[str, Any], *names: str) -> str:
    lowered = {k.lower(): v for k, v in (tags or {}).items()}
    for name in names:
        value = str(lowered.get(name, "")).strip()
        if value:
            return value
    return ""


def probe(path: str) -> dict[str, Any]:
    """Duration, tags, chapters and streams of a media file. Blocking."""
    proc = subprocess.run(
        [get_ffprobe_path(), "-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-show_chapters", path],
        capture_output=True, creationflags=_NO_WINDOW,
    )
    if proc.returncode != 0:
        raise LocalFileError("This file couldn't be read. It may be damaged or in a format Cadence doesn't support.")
    data = json.loads(proc.stdout or b"{}")
    streams = data.get("streams") or []
    if not any(s.get("codec_type") == "audio" for s in streams):
        raise LocalFileError("This file has no sound to split.")
    fmt = data.get("format") or {}
    tags = fmt.get("tags") or {}
    duration = float(fmt.get("duration") or 0)
    if duration <= 0:
        raise LocalFileError("Couldn't tell how long this file is.")
    chapters = [
        {
            "start_time": float(c.get("start_time") or 0),
            "end_time": float(c.get("end_time") or 0) or None,
            "title": _tag(c.get("tags") or {}, "title"),
        }
        for c in data.get("chapters") or []
    ]
    pictures = [s for s in streams if s.get("codec_type") == "video"]
    return {
        "duration": duration,
        "title": _tag(tags, "title"),
        "artist": _tag(tags, "album_artist", "artist", "performer"),
        "album": _tag(tags, "album"),
        "year": _tag(tags, "date", "year")[:4],
        "comment": _tag(tags, "comment", "description"),
        "chapters": chapters,
        # An attached picture (album cover) or a real video track to take a frame from.
        "has_cover": any((s.get("disposition") or {}).get("attached_pic") for s in pictures),
        "has_video": any(not (s.get("disposition") or {}).get("attached_pic") for s in pictures),
    }


def find_cue(path: str) -> str | None:
    """A .cue sheet next to the file with the same name ("Album.flac" + "Album.cue")."""
    base = os.path.splitext(path)[0]
    for candidate in (base + ".cue", path + ".cue"):
        if os.path.isfile(candidate):
            return candidate
    return None


def read_text(path: str) -> str:
    """Cue sheets come in UTF-8 or a legacy Windows code page."""
    with open(path, "rb") as f:
        raw = f.read()
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def extract_cover(path: str, out_dir: str, info: dict[str, Any]) -> str | None:
    """Save the embedded cover, or a frame from the video, as cover.jpg. Blocking."""
    if not info["has_cover"] and not info["has_video"]:
        return None
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "cover.jpg")
    seek = [] if info["has_cover"] else ["-ss", f"{min(info['duration'] * 0.1, 30):.1f}"]
    proc = subprocess.run(
        [get_ffmpeg_path(), "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *seek, "-i", path,
         "-map", "0:v:0", "-frames:v", "1", "-vf", "scale='min(1000,iw)':-2", out],
        capture_output=True, creationflags=_NO_WINDOW,
    )
    return out if proc.returncode == 0 and os.path.isfile(out) else None


def make_preview(
    path: str, out_dir: str, duration: float,
    on_progress: Callable[[float], None] | None = None, is_cancelled: Callable[[], bool] | None = None,
) -> str:
    """A small Opus copy the player can play. Only used for playback, never for cutting. Blocking."""
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, PREVIEW_NAME)
    tmp = out + ".part"
    cmd = [get_ffmpeg_path(), "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", path, "-map", "0:a:0", "-vn",
           "-ac", "2", "-c:a", "libopus", "-b:a", "96k", "-f", "webm", "-progress", "pipe:1", "-nostats", tmp]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=_NO_WINDOW)
    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            if is_cancelled and is_cancelled():
                proc.kill()
                raise InterruptedError()
            key, _, value = line.decode("ascii", "replace").strip().partition("=")
            if key == "out_time_us" and value.isdigit() and duration and on_progress:
                on_progress(min(1.0, int(value) / 1e6 / duration))
        proc.wait()
        if proc.returncode != 0:
            raise LocalFileError("Couldn't prepare this file for playback.")
        os.replace(tmp, out)
        return out
    finally:
        if proc.poll() is None:
            proc.kill()
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass
