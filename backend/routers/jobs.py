import asyncio
import os
import re
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator

from core.db import ACTIVE_STATES, get_store
from core.websocket_manager import manager as ws
from config import load_preferences
from services import audio_profile, identify, name_cleanup, pipeline

router = APIRouter()

_YOUTUBE_RE = re.compile(r"^https?://(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)/", re.IGNORECASE)


class CreateJob(BaseModel):
    url: str

    @field_validator("url")
    @classmethod
    def youtube_only(cls, v: str) -> str:
        v = v.strip()
        if not _YOUTUBE_RE.match(v):
            raise ValueError("Paste a YouTube video or playlist link.")
        return v


class TrackIn(BaseModel):
    id: str
    title: str = Field(max_length=300)
    artist: str = Field(default="", max_length=300)
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    source_id: str
    origin: str = "manual"
    confidence: float = 1.0
    include: bool = True
    # Set when a name came from a lookup, e.g. {"source": "acoustid", "score": 0.93}
    match: dict | None = None


class CollectionIn(BaseModel):
    type: Literal["artist", "album", "collection", "single"]
    name: str = Field(default="", max_length=300)
    artist: str = Field(default="", max_length=300)
    album: str = Field(default="", max_length=300)
    year: str = Field(default="", max_length=8)
    confidence: float = 1.0


class ReviewIn(BaseModel):
    tracks: list[TrackIn]
    collection: CollectionIn
    # Folder for this split only. Empty means the library folder from Settings.
    destination: str = Field(default="", max_length=1000)

    @field_validator("destination")
    @classmethod
    def absolute_folder(cls, v: str) -> str:
        v = v.strip()
        if v and not os.path.isabs(v):
            raise ValueError("Choose a full folder path to save into.")
        return v


def _get_job(job_id: str) -> dict:
    job = get_store().get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def _validate_review(job: dict, body: ReviewIn) -> list[dict]:
    sources = {s["id"]: s for s in job["sources"]}
    tracks = []
    for t in body.tracks:
        source = sources.get(t.source_id)
        if not source:
            raise HTTPException(status_code=422, detail=f"Unknown source for \"{t.title}\"")
        if t.end <= t.start:
            raise HTTPException(status_code=422, detail=f"\"{t.title}\" ends before it starts")
        if source["duration"] and t.end > source["duration"] + 1:
            raise HTTPException(status_code=422, detail=f"\"{t.title}\" ends after the video does")
        tracks.append(t.model_dump())
    if not any(t["include"] for t in tracks):
        raise HTTPException(status_code=422, detail="Select at least one song to export")
    return tracks


@router.get("/jobs")
async def list_jobs():
    return get_store().list()


@router.post("/jobs", status_code=201)
async def create_job(body: CreateJob):
    job = get_store().create(body.url)
    await ws.send_job(job)
    pipeline.start_analysis(job["id"])
    return job


@router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    return _get_job(job_id)


@router.put("/jobs/{job_id}")
async def save_review(job_id: str, body: ReviewIn):
    job = _get_job(job_id)
    if job["status"] in ACTIVE_STATES:
        raise HTTPException(status_code=409, detail="Wait for the job to finish before editing")
    tracks = _validate_review(job, body)
    job = get_store().update(job_id, tracks=tracks, collection=body.collection.model_dump(), destination=body.destination)
    await ws.send_job(job)
    return job


@router.post("/jobs/{job_id}/export")
async def export_job(job_id: str, body: ReviewIn):
    job = _get_job(job_id)
    if job["status"] not in ("review", "completed"):
        raise HTTPException(status_code=409, detail="This job isn't ready to export yet")
    tracks = _validate_review(job, body)
    if any(not s.get("path") for s in job["sources"]):
        raise HTTPException(status_code=409, detail="The downloaded audio was removed after saving. Split the video again to save it again.")
    get_store().update(job_id, tracks=tracks, collection=body.collection.model_dump(), destination=body.destination)
    pipeline.start_export(job_id)
    return {"status": "started"}


@router.post("/jobs/{job_id}/identify")
async def identify_job(job_id: str, body: ReviewIn):
    """Name placeholder songs ("Track 3") by fingerprint. Returns the updated tracks; nothing is saved."""
    job = _get_job(job_id)
    tracks = _validate_review(job, body)
    prefs = load_preferences()
    sources = {s["id"]: s for s in job["sources"]}
    if any(not s.get("path") for s in job["sources"]):
        raise HTTPException(status_code=409, detail="The downloaded audio was removed, so songs can't be fingerprinted.")
    try:
        named = await identify.identify_tracks(tracks, sources, prefs.acoustid_key)
    except identify.IdentifyError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    return {"tracks": tracks, "named": named}


@router.post("/jobs/{job_id}/tidy-names")
async def tidy_names(job_id: str, body: ReviewIn):
    """Suggest clean song and album names with Claude. Returns suggestions; nothing is saved."""
    job = _get_job(job_id)
    tracks = _validate_review(job, body)
    collection = body.collection.model_dump()
    try:
        suggestion = await name_cleanup.suggest_names(load_preferences().anthropic_api_key, job, tracks)
    except name_cleanup.NameCleanupError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    new_tracks, new_collection = name_cleanup.apply_suggestions(tracks, collection, suggestion)
    changed = sum(1 for a, b in zip(tracks, new_tracks) if a["title"] != b["title"] or a["artist"] != b["artist"])
    return {"tracks": new_tracks, "collection": new_collection, "changed": changed}


@router.post("/jobs/{job_id}/retry")
async def retry_job(job_id: str):
    job = _get_job(job_id)
    if pipeline.is_running(job_id):
        raise HTTPException(status_code=409, detail="This job is already running")
    if job["status"] not in ("failed", "cancelled"):
        raise HTTPException(status_code=409, detail="Only failed or cancelled jobs can be retried")
    job = get_store().update(job_id, status="queued", error=None, progress=0, message="Waiting to start")
    await ws.send_job(job)
    pipeline.start_analysis(job_id)
    return job


@router.post("/jobs/{job_id}/cancel")
async def cancel_job(job_id: str):
    _get_job(job_id)
    if not pipeline.cancel(job_id):
        raise HTTPException(status_code=409, detail="Nothing is running for this job")
    return {"status": "cancelling"}


@router.delete("/jobs/{job_id}")
async def delete_job(job_id: str):
    """Removes the job and its downloaded source audio. Exported songs are kept."""
    _get_job(job_id)
    pipeline.cancel(job_id)
    await pipeline.delete_work_files(job_id)
    get_store().delete(job_id)
    await ws.send_job_deleted(job_id)
    return {"status": "deleted"}


def _serve_work_file(job_id: str, path: str | None) -> FileResponse:
    """Only files inside this job's work folder can be served."""
    if not path:
        raise HTTPException(status_code=404, detail="File not found")
    root = os.path.realpath(pipeline.job_dir(job_id))
    real = os.path.realpath(path)
    if os.path.commonpath([root, real]) != root or not os.path.isfile(real):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(real)


@router.get("/jobs/{job_id}/sources/{source_id}/audio")
async def source_audio(job_id: str, source_id: str):
    job = _get_job(job_id)
    source = next((s for s in job["sources"] if s["id"] == source_id), None)
    return _serve_work_file(job_id, source and source.get("path"))


@router.get("/jobs/{job_id}/sources/{source_id}/peaks")
async def source_peaks(
    job_id: str,
    source_id: str,
    start: float | None = Query(default=None, ge=0),
    end: float | None = Query(default=None, gt=0),
    points: int = Query(default=800, ge=10, le=4000),
):
    """Waveform peaks. Without start/end: the whole source (cached).

    With start/end: a high-resolution close-up of up to 60 s, used to fine-tune a cut.
    """
    job = _get_job(job_id)
    source = next((s for s in job["sources"] if s["id"] == source_id), None)
    if not source:
        raise HTTPException(status_code=404, detail="Audio not found")
    cached = audio_profile.peaks_file(pipeline.job_dir(job_id), source_id)
    has_audio = bool(source.get("path")) and os.path.isfile(source["path"])
    if start is None and end is None and os.path.isfile(cached):
        return FileResponse(cached, media_type="application/json")
    if not has_audio:
        raise HTTPException(status_code=404, detail="The downloaded audio was removed")

    if start is not None or end is not None:
        if start is None or end is None or end <= start or end - start > 60:
            raise HTTPException(status_code=422, detail="Close-ups need a start and end up to 60 s apart")
        return await asyncio.to_thread(audio_profile.window_peaks, source["path"], start, end, points)

    # Jobs analysed before waveforms existed, and playlist videos: build on first view.
    profile = await asyncio.to_thread(audio_profile.build_profile, source["path"], source.get("duration") or 0)
    audio_profile.save_peaks(pipeline.job_dir(job_id), source_id, profile)
    return FileResponse(cached, media_type="application/json")


@router.get("/jobs/{job_id}/thumbnail")
async def thumbnail(job_id: str):
    job = _get_job(job_id)
    return _serve_work_file(job_id, job.get("thumbnail"))
