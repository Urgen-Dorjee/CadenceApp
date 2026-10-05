"""yt-dlp wrapper: read metadata without downloading, then download best audio."""

import asyncio
import glob
import os
from typing import Any, Callable

import yt_dlp
from yt_dlp.utils import DownloadCancelled

from core.ffmpeg_utils import get_ffmpeg_path
from core.js_runtime import js_runtimes


class Cancelled(Exception):
    pass


def _base_opts() -> dict[str, Any]:
    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "js_runtimes": js_runtimes(),
    }
    try:
        opts["ffmpeg_location"] = os.path.dirname(get_ffmpeg_path())
    except FileNotFoundError:
        pass
    return opts


def _extract(url: str, extra: dict[str, Any]) -> dict[str, Any]:
    with yt_dlp.YoutubeDL({**_base_opts(), **extra}) as ydl:
        info = ydl.extract_info(url, download=False)
        return ydl.sanitize_info(info)


async def resolve(url: str) -> dict[str, Any]:
    """Metadata for a video or playlist. Playlist entries are listed but not expanded."""
    return await asyncio.to_thread(_extract, url, {"skip_download": True, "extract_flat": "in_playlist"})


async def fetch_comments(url: str, limit: int = 40) -> list[dict[str, Any]]:
    """Top comments, where people often post the tracklist with timestamps."""
    opts = {
        "skip_download": True,
        "getcomments": True,
        "noplaylist": True,
        "extractor_args": {"youtube": {"max_comments": [str(limit), str(limit), "0", "0"], "comment_sort": ["top"]}},
    }
    try:
        info = await asyncio.to_thread(_extract, url, opts)
    except yt_dlp.utils.DownloadError:
        return []
    return info.get("comments") or []


def find_thumbnail(out_dir: str, video_id: str) -> str | None:
    for ext in ("jpg", "jpeg", "png", "webp"):
        matches = glob.glob(os.path.join(glob.escape(out_dir), f"{glob.escape(video_id)}.{ext}"))
        if matches:
            return matches[0]
    return None


async def download_audio(
    url: str,
    out_dir: str,
    on_progress: Callable[[float], None],
    is_cancelled: Callable[[], bool],
) -> dict[str, Any]:
    """Download the best audio stream (no re-encoding) plus the thumbnail as JPEG.

    Files are named by video id, so a retried job reuses what is already on disk
    and two jobs never pick up each other's files.
    """
    os.makedirs(out_dir, exist_ok=True)

    def hook(d: dict[str, Any]) -> None:
        if is_cancelled():
            raise DownloadCancelled("Cancelled")
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            if total:
                on_progress(min(1.0, d.get("downloaded_bytes", 0) / total))
        elif d.get("status") == "finished":
            on_progress(1.0)

    opts = {
        **_base_opts(),
        "format": "bestaudio/best",
        "outtmpl": os.path.join(out_dir, "%(id)s.%(ext)s"),
        "noplaylist": True,
        "writethumbnail": True,
        "postprocessors": [{"key": "FFmpegThumbnailsConvertor", "format": "jpg", "when": "before_dl"}],
        "progress_hooks": [hook],
        "retries": 5,
        "fragment_retries": 5,
    }

    def run() -> dict[str, Any]:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
            return ydl.sanitize_info(info)

    try:
        info = await asyncio.to_thread(run)
    except DownloadCancelled as e:
        raise Cancelled() from e

    downloads = info.get("requested_downloads") or []
    path = downloads[0].get("filepath") if downloads else None
    if not path or not os.path.exists(path):
        candidates = [
            p for p in glob.glob(os.path.join(glob.escape(out_dir), f"{glob.escape(info['id'])}.*"))
            if not p.endswith((".jpg", ".jpeg", ".png", ".webp", ".part", ".ytdl"))
        ]
        if not candidates:
            raise RuntimeError("Download finished but the audio file was not found.")
        path = candidates[0]
    info["_audio_path"] = path
    info["_thumbnail_path"] = find_thumbnail(out_dir, info["id"])
    return info
