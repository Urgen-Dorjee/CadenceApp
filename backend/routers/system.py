import asyncio
import os
import shutil
import subprocess
import sys

from fastapi import APIRouter, HTTPException

from config import AUDIO_FORMATS, Preferences, load_preferences, save_preferences, settings
from core.db import ACTIVE_STATES, get_store
from core.websocket_manager import manager as ws
from services import pipeline
from core.ffmpeg_utils import is_ffmpeg_available

router = APIRouter()


@router.get("/health")
async def health():
    import yt_dlp

    return {
        "status": "ok",
        "ffmpeg_available": is_ffmpeg_available(),
        "yt_dlp_version": yt_dlp.version.__version__,
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
    if prefs.save_mode not in ("library", "ask"):
        raise HTTPException(status_code=422, detail="Save mode must be library or ask")
    if not os.path.isabs(prefs.library_dir):
        raise HTTPException(status_code=422, detail="Library folder must be a full path")
    save_preferences(prefs)
    return prefs


@router.post("/yt-dlp/update")
async def update_yt_dlp():
    """Upgrade yt-dlp in place. YouTube changes often break older versions.

    The new version is used after the app restarts.
    """
    cmd = [sys.executable, "-m", "pip", "install", "--upgrade", "--disable-pip-version-check", "yt-dlp"]
    proc = await asyncio.to_thread(
        subprocess.run, cmd, capture_output=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)
    )
    if proc.returncode != 0:
        raise HTTPException(status_code=500, detail="Could not update yt-dlp. Check your internet connection.")
    out = proc.stdout.decode("utf-8", errors="replace")
    return {"updated": "Successfully installed" in out, "restart_required": "Successfully installed" in out}


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
    """(job, source) for every downloaded source audio file still on disk."""
    found = []
    for job in get_store().list():
        for source in job["sources"]:
            if source.get("path") and os.path.isfile(source["path"]):
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
