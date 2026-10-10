import asyncio
import logging
import os
import re
import shutil

from fastapi import APIRouter, HTTPException

from config import AUDIO_FORMATS, Preferences, load_preferences, save_preferences, settings
from core.db import ACTIVE_STATES, get_store
from core.websocket_manager import manager as ws
from services import identify, pipeline
from core.ffmpeg_utils import is_ffmpeg_available
from core import ytdlp_updates

router = APIRouter()


@router.get("/health")
async def health():
    import yt_dlp

    return {
        "status": "ok",
        "ffmpeg_available": is_ffmpeg_available(),
        "yt_dlp_version": yt_dlp.version.__version__,
        # Cadence's own AcoustID key is in this build, so songs can be identified without one of your own.
        "identify_built_in": bool(identify.app_key()),
    }


@router.get("/preferences")
async def get_preferences():
    return load_preferences()


@router.put("/preferences")
async def update_preferences(prefs: Preferences):
    if prefs.audio_format not in AUDIO_FORMATS:
        raise HTTPException(status_code=422, detail=f"Format must be one of {', '.join(AUDIO_FORMATS)}")
    if not 64 <= prefs.audio_bitrate <= 320:
        raise HTTPException(status_code=422, detail="Bitrate must be between 64 and 320 kbps")
    if not 0 <= prefs.edge_fade_ms <= 200:
        raise HTTPException(status_code=422, detail="Edge fade must be between 0 and 200 ms")
    if not 0 <= prefs.snap_window_s <= 10:
        raise HTTPException(status_code=422, detail="Snap window must be between 0 and 10 seconds")
    if prefs.cookies_from not in ("", "firefox", "chrome", "edge", "brave", "file"):
        raise HTTPException(status_code=422, detail="Choose Firefox, Chrome, Edge, Brave or a cookies.txt file")
    if prefs.cookies_from == "file" and not os.path.isfile(prefs.cookies_file):
        raise HTTPException(status_code=422, detail="Choose your cookies.txt file")
    if prefs.proxy and not re.match(r"^(https?|socks5h?|socks4a?)://\S+$", prefs.proxy.strip()):
        raise HTTPException(status_code=422, detail="Proxy must look like http://host:port or socks5://host:port")
    if prefs.lyrics not in ("off", "embed", "lrc"):
        raise HTTPException(status_code=422, detail="Lyrics must be off, embed or lrc")
    if prefs.loudness not in ("off", "tags", "normalize"):
        raise HTTPException(status_code=422, detail="Loudness must be off, tags or normalize")
    if not -30 <= prefs.loudness_target <= -5:
        raise HTTPException(status_code=422, detail="Target loudness must be between -30 and -5 LUFS")
    if not (0 <= prefs.song_fade_in_s <= 10 and 0 <= prefs.song_fade_out_s <= 10):
        raise HTTPException(status_code=422, detail="Fades must be between 0 and 10 seconds")
    if not 1 <= prefs.parallel_splits <= 4:
        raise HTTPException(status_code=422, detail="Splits at a time must be between 1 and 4")
    if prefs.save_mode not in ("library", "ask"):
        raise HTTPException(status_code=422, detail="Save mode must be library or ask")
    if not os.path.isabs(prefs.library_dir):
        raise HTTPException(status_code=422, detail="Library folder must be a full path")
    save_preferences(prefs)
    await pipeline.analyze_limit_changed()
    return prefs


@router.post("/yt-dlp/update")
async def update_yt_dlp():
    """Install the newest yt-dlp if there is one. YouTube changes often break older versions.

    It goes into the data folder (never inside the app) and is used after the app restarts.
    """
    import yt_dlp

    try:
        latest = await asyncio.to_thread(ytdlp_updates.latest_version)
    except Exception:
        raise HTTPException(status_code=502, detail="Couldn't check for a new yt-dlp. Check your internet connection.")
    have = [yt_dlp.version.__version__, ytdlp_updates.installed_version(ytdlp_updates.packages_dir(settings.data_dir))]
    newest_here = max((v for v in have if v), key=ytdlp_updates.version_key)
    if ytdlp_updates.version_key(latest) <= ytdlp_updates.version_key(newest_here):
        restart = newest_here != yt_dlp.version.__version__
        return {"updated": restart, "restart_required": restart, "version": newest_here}
    try:
        await asyncio.to_thread(ytdlp_updates.install, settings.data_dir, latest)
    except Exception as e:
        logging.getLogger(__name__).warning("yt-dlp update failed: %s", e)
        raise HTTPException(status_code=500, detail="Could not update yt-dlp. Check your internet connection.")
    return {"updated": True, "restart_required": True, "version": latest}


def _existing_parent(path: str) -> str:
    """Closest folder that exists, so free space works before the library is created."""
    path = os.path.abspath(path)
    while not os.path.exists(path):
        parent = os.path.dirname(path)
        if parent == path:
            break
        path = parent
    return path


def _downloads() -> list[tuple[dict, dict]]:
    """(job, source) for every downloaded source audio file still on disk. The user's own files don't count."""
    found = []
    for job in get_store().list():
        for source in job["sources"]:
            if not source.get("local") and source.get("path") and os.path.isfile(source["path"]):
                found.append((job, source))
    return found


@router.get("/storage")
async def storage():
    prefs = load_preferences()

    def measure():
        usage = shutil.disk_usage(_existing_parent(prefs.library_dir))
        downloads = _downloads()
        return {
            "library_dir": prefs.library_dir,
            "library_exists": os.path.isdir(prefs.library_dir),
            "free_bytes": usage.free,
            "total_bytes": usage.total,
            "downloads_bytes": sum(os.path.getsize(s["path"]) for _, s in downloads),
            "downloads_count": len(downloads),
            "work_dir": settings.work_dir,
        }

    return await asyncio.to_thread(measure)


@router.post("/storage/clear-downloads")
async def clear_downloads():
    """Delete downloaded audio for finished splits. Saved songs, waveforms and thumbnails stay."""
    freed, cleared = 0, 0
    by_job: dict[str, dict] = {}
    for job, source in _downloads():
        if job["status"] in ACTIVE_STATES or job["status"] == "review":
            continue  # still needed for reviewing or saving
        by_job[job["id"]] = job
    for job_id, job in by_job.items():
        freed += sum(os.path.getsize(s["path"]) for s in job["sources"] if s.get("path") and os.path.isfile(s["path"]))
        sources = await pipeline.remove_downloads(job_id, job["sources"])
        updated = get_store().update(job_id, sources=sources)
        if updated:
            await ws.send_job(updated)
        cleared += 1
    return {"freed_bytes": freed, "jobs_cleared": cleared}
