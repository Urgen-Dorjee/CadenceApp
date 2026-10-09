"""yt-dlp wrapper: read metadata without downloading, then download best audio."""

import asyncio
import glob
import os
import re
import urllib.parse
from typing import Any, Callable

import yt_dlp
from yt_dlp.utils import DownloadCancelled

from core.ffmpeg_utils import get_ffmpeg_path
from core.js_runtime import js_runtimes


class Cancelled(Exception):
    pass


def _base_opts() -> dict[str, Any]:
    from config import load_preferences

    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "js_runtimes": js_runtimes(),
    }
    prefs = load_preferences()
    if prefs.cookies_from == "file" and prefs.cookies_file:
        opts["cookiefile"] = prefs.cookies_file
    elif prefs.cookies_from:
        opts["cookiesfrombrowser"] = (prefs.cookies_from,)
    if prefs.proxy.strip():
        opts["proxy"] = prefs.proxy.strip()
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


# Channel pages: youtube.com/@name, /channel/UC..., /c/name, /user/name (optionally with a tab).
_CHANNEL_RE = re.compile(r"^/(@[^/]+|channel/[^/]+|c/[^/]+|user/[^/]+)(/[^/]*)?/?$")
MAX_LISTED = 500


def video_id(url: str) -> str | None:
    """The video id of a watch, youtu.be, shorts or live link, else None."""
    parts = urllib.parse.urlparse(url.strip())
    host = parts.netloc.lower().split(":")[0]
    if host.endswith("youtu.be"):
        return parts.path.strip("/").split("/")[0] or None
    query = urllib.parse.parse_qs(parts.query)
    if query.get("v"):
        return query["v"][0]
    m = re.match(r"^/(?:shorts|live|embed)/([^/?]+)", parts.path)
    return m.group(1) if m else None


def link_kind(url: str) -> str:
    """"video", "playlist" (a list= link, even with a video in it) or "channel"."""
    parts = urllib.parse.urlparse(url.strip())
    if "list" in urllib.parse.parse_qs(parts.query):
        return "playlist"
    if _CHANNEL_RE.match(parts.path) and not video_id(url):
        return "channel"
    return "video"


def watch_url(vid: str) -> str:
    return f"https://www.youtube.com/watch?v={vid}"


def _videos_tab(url: str) -> str:
    """A channel link pointing at its Videos tab (the home tab mixes shelves and shorts)."""
    parts = urllib.parse.urlparse(url.strip())
    m = _CHANNEL_RE.match(parts.path)
    if not m:
        return url
    return urllib.parse.urlunparse(parts._replace(path=f"/{m.group(1)}/videos", query="", fragment=""))


def _list_url(url: str) -> str:
    """The playlist itself for a watch?v=...&list=... link."""
    parts = urllib.parse.urlparse(url.strip())
    playlist = urllib.parse.parse_qs(parts.query).get("list")
    if playlist and video_id(url):
        return f"https://www.youtube.com/playlist?list={playlist[0]}"
    return url


async def list_videos(url: str) -> dict[str, Any]:
    """The videos of a playlist or channel, without downloading: {title, kind, entries: [{id, title, duration}]}."""
    kind = link_kind(url)
    target = _videos_tab(url) if kind == "channel" else _list_url(url)
    info = await asyncio.to_thread(
        _extract, target, {"skip_download": True, "extract_flat": "in_playlist", "playlistend": MAX_LISTED},
    )
    entries = []
    for e in info.get("entries") or []:
        if not e or not e.get("id") or e.get("ie_key") not in (None, "Youtube"):
            continue  # skip nested playlists or channel shelves
        if (e.get("title") or "").strip() in ("[Private video]", "[Deleted video]"):
            continue
        entries.append({"id": e["id"], "title": e.get("title") or "", "duration": float(e.get("duration") or 0)})
    title = (info.get("channel") or info.get("uploader")) if kind == "channel" else info.get("title")
    return {"title": title or info.get("title") or "", "kind": kind, "entries": entries}


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
