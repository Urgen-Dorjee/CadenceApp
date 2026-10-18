import asyncio
import os
import re
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator, model_validator

from core.db import ACTIVE_STATES, get_store
from core.websocket_manager import manager as ws
from config import load_preferences
from services import (
    audio_analysis, audio_profile, cover, duplicates, identify, local_media, musicbrainz, name_cleanup, pipeline, song_index,
    tracklist, video, youtube,
)

router = APIRouter()

_YOUTUBE_RE = re.compile(r"^https?://(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)/", re.IGNORECASE)


class VideoOptions(BaseModel):
    """Choices for one whole-video download (starting values come from Settings)."""

    quality: str = "1080"
    container: str = "mp4"
    subtitles: list[str] = Field(default_factory=list, max_length=10)
    auto_subtitles: bool = True
    subtitle_mode: str = "embed"
    chapters: bool = True
    thumbnail: bool = True
    description: bool = False

    @model_validator(mode="after")
    def known_choices(self) -> "VideoOptions":
        if self.quality not in video.QUALITIES:
            raise ValueError("Choose a video quality from the list.")
        if self.container not in video.CONTAINERS:
            raise ValueError("The video file type must be MP4 or MKV.")
        if self.subtitle_mode not in video.SUBTITLE_MODES:
            raise ValueError("Subtitles go inside the video, in files, or both.")
        if any(not re.fullmatch(r"[A-Za-z]{2,3}", lang) for lang in self.subtitles):
            raise ValueError("Subtitle languages are two- or three-letter codes, like en or hi.")
        return self


class CreateJob(BaseModel):
    """A YouTube link, or the full path of an audio or video file on this computer.

    kind "music" splits it into songs; "video" downloads the whole video (links only).
    """

    url: str = ""
    path: str = Field(default="", max_length=1000)
    kind: Literal["music", "video"] = "music"
    video: VideoOptions | None = None

    @field_validator("url")
    @classmethod
    def youtube_only(cls, v: str) -> str:
        v = v.strip()
        if v and not _YOUTUBE_RE.match(v):
            raise ValueError("Paste a YouTube video or playlist link.")
        return v

    @field_validator("path")
    @classmethod
    def usable_file(cls, v: str) -> str:
        v = v.strip()
        if not v:
            return v
        if not os.path.isabs(v) or not os.path.isfile(v):
            raise ValueError("That file couldn't be found.")
        if not local_media.is_supported(v):
            ext = os.path.splitext(v)[1] or "this kind of file"
            raise ValueError(f"Cadence can't split {ext} files. Use an audio or video file such as MP3, FLAC, M4A or MP4.")
        return os.path.abspath(v)

    @model_validator(mode="after")
    def one_source(self) -> "CreateJob":
        if bool(self.url) == bool(self.path):
            raise ValueError("Paste a YouTube link or choose a file.")
        if self.kind == "video" and not self.url:
            raise ValueError("Paste a YouTube link to download a video.")
        return self


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
    # Saving again: overwrite the songs this split saved last time (old ones that are
    # no longer needed go to the Recycle Bin) instead of adding "(2)" copies.
    replace_previous: bool = False
    # Folder for this split only. Empty means the library folder from Settings.
    destination: str = Field(default="", max_length=1000)

    @field_validator("destination")
    @classmethod
    def absolute_folder(cls, v: str) -> str:
        v = v.strip()
        if v and not os.path.isabs(v):
            raise ValueError("Choose a full folder path to save into.")
        return v


class CoverIn(BaseModel):
    path: str = Field(min_length=1, max_length=1000)


class AlbumSearchIn(BaseModel):
    album: str = Field(min_length=1, max_length=300)
    artist: str = Field(default="", max_length=300)


class AlbumApplyIn(BaseModel):
    release_id: str = Field(pattern=r"^[0-9a-f-]{36}$")
    cover: bool = True


class LinkIn(BaseModel):
    url: str = Field(min_length=1, max_length=2000)

    @field_validator("url")
    @classmethod
    def youtube_only(cls, v: str) -> str:
        v = v.strip()
        if not _YOUTUBE_RE.match(v):
            raise ValueError("Paste a YouTube playlist or channel link.")
        return v


class TracklistIn(BaseModel):
    text: str = Field(min_length=1, max_length=100_000)


@router.post("/links/history")
async def link_history(body: LinkIn):
    """What was done with a video link before, so pasting it again can carry on instead of
    starting over: its splits still in the list, the songs saved from it (still on disk), and
    the copies of it downloaded whole."""
    vid = youtube.video_id(body.url) if youtube.link_kind(body.url) == "video" else None
    if not vid:
        return {"video_id": None, "jobs": [], "songs": [], "videos": []}
    store = get_store()
    jobs = []
    for job in await asyncio.to_thread(store.list):
        if youtube.video_id(job["url"] or "") == vid or any(s["id"] == vid for s in job["sources"] if not s.get("local")):
            jobs.append({
                "id": job["id"], "kind": job.get("kind") or "music", "status": job["status"],
                "saved": len(job.get("outputs") or []), "songs": len(job.get("tracks") or []),
            })
    songs = [
        {"path": r["path"], "title": r["title"], "saved_at": r["saved_at"]}
        for r in await asyncio.to_thread(store.saved_songs, [vid]) if os.path.isfile(r["path"])
    ]
    videos = [
        {"path": v["path"], "height": v["height"], "ext": v["ext"]}
        for v in await asyncio.to_thread(store.list_videos) if v["video_id"] == vid and os.path.isfile(v["path"])
    ]
    return {"video_id": vid, "jobs": jobs, "songs": songs, "videos": videos}


@router.post("/links/expand")
async def expand_link(body: LinkIn):
    """The videos of a playlist or channel link, each marked "saved" (its songs were saved before)
    or "in_list" (a split for it is already in the list). A plain video link gives kind "video"."""
    kind = youtube.link_kind(body.url)
    if kind == "video":
        return {"kind": "video", "title": "", "entries": []}
    try:
        listed = await youtube.list_videos(body.url)
    except Exception as e:  # noqa: BLE001 - yt-dlp errors are shown in plain words
        raise HTTPException(status_code=422, detail=pipeline.friendly_error(e)) from e
    store = get_store()
    saved = store.saved_video_ids()
    in_list = set()
    for job in store.list():
        if job["status"] in ("failed", "cancelled"):
            continue
        in_list.update(s["id"] for s in job["sources"] if not s.get("local"))
        if vid := youtube.video_id(job["url"]):
            in_list.add(vid)
    for entry in listed["entries"]:
        entry["url"] = youtube.watch_url(entry["id"])
        entry["state"] = "in_list" if entry["id"] in in_list else "saved" if entry["id"] in saved else ""
    return listed


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


def _video_defaults() -> VideoOptions:
    prefs = load_preferences()
    return VideoOptions(
        quality=prefs.video_quality, container=prefs.video_container, subtitles=prefs.video_subtitles,
        auto_subtitles=prefs.video_auto_subtitles, subtitle_mode=prefs.video_subtitle_mode,
        chapters=prefs.video_chapters, thumbnail=prefs.video_thumbnail, description=prefs.video_description,
    )


@router.post("/jobs", status_code=201)
async def create_job(body: CreateJob):
    if body.kind == "video":
        options = (body.video or _video_defaults()).model_dump()
        job = get_store().create(body.url, kind="video", options=options)
        await ws.send_job(job)
        pipeline.start_video(job["id"])
        return job
    job = get_store().create(body.url or body.path)
    await ws.send_job(job)
    pipeline.start_analysis(job["id"])
    return job


@router.post("/video/info")
async def video_info(body: LinkIn):
    """What a link holds, before downloading it whole: a video's qualities (with sizes),
    subtitles and chapters, or a playlist's videos. The details are kept for the download."""
    try:
        return await video.details(body.url, load_preferences().video_subtitles, get_store().downloaded_video_ids())
    except Exception as e:  # noqa: BLE001 - yt-dlp errors are shown in plain words
        raise HTTPException(status_code=422, detail=pipeline.friendly_error(e)) from e


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
    # Shown as saving straight away, even while it waits for another split to finish saving.
    job = get_store().update(
        job_id, tracks=tracks, collection=body.collection.model_dump(), destination=body.destination,
        status="exporting", progress=0, message="Waiting to save", error=None,
    )
    await ws.send_job(job)
    pipeline.start_export(job_id, replace_previous=body.replace_previous)
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
        named = await identify.identify_tracks(tracks, sources, identify.api_key(prefs.acoustid_key))
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


@router.post("/jobs/{job_id}/duplicates")
async def find_duplicates(job_id: str, body: ReviewIn):
    """Songs of this split that are already in the library: {track id: [matching songs]}."""
    job = _get_job(job_id)
    tracks = [t.model_dump() for t in body.tracks]
    songs = await asyncio.to_thread(song_index.get_index().list)
    own = [o["path"] for o in job.get("outputs") or []]
    found = await asyncio.to_thread(duplicates.find, tracks, songs, own)
    # Songs saved before from the same part of the same video, whatever they are called now.
    saved = await asyncio.to_thread(get_store().saved_songs, sorted({t["source_id"] for t in tracks}))
    for track_id, matches in (await asyncio.to_thread(duplicates.find_same_part, tracks, saved, songs, own)).items():
        known = {m["path"] for m in found.get(track_id, [])}
        found.setdefault(track_id, []).extend(m for m in matches if m["path"] not in known)
    return found


@router.post("/jobs/{job_id}/tracklist")
async def import_tracklist(job_id: str, body: TracklistIn):
    """Songs from a tracklist the user pasted or opened (.cue). Returns them; nothing is saved.

    Cuts are snapped to the real gap between songs, like a tracklist found on YouTube.
    """
    job = _get_job(job_id)
    if job["status"] in ACTIVE_STATES:
        raise HTTPException(status_code=409, detail="Wait for the job to finish before changing its songs")
    if len(job["sources"]) != 1:
        raise HTTPException(status_code=422, detail="A tracklist can only be used for a single video, not a playlist.")
    source = job["sources"][0]
    duration = float(source.get("duration") or 0)
    try:
        parsed = tracklist.parse_pasted(body.text, duration)
    except tracklist.TracklistError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    tracks = tracklist.tracks_from_pasted(parsed, duration, source["id"])
    snapped = bool(source.get("path")) and os.path.isfile(source["path"])
    if snapped:
        await audio_analysis.refine_boundaries(tracks, source["path"], duration, load_preferences().snap_window_s)
    tracklist.flag_short_tracks(tracks)
    collection: dict = {k: parsed[k] for k in ("artist", "album", "year") if parsed[k]}
    if parsed["album"]:
        collection["name"] = parsed["album"]
    return {"tracks": tracks, "collection": collection, "format": parsed["format"], "snapped": snapped}


@router.post("/jobs/{job_id}/cover")
async def set_cover(job_id: str, body: CoverIn):
    """Use the user's own image as the cover of every song in this split."""
    job = _get_job(job_id)
    if job["status"] in ACTIVE_STATES:
        raise HTTPException(status_code=409, detail="Wait for the job to finish before changing its cover")
    if not os.path.isabs(body.path):
        raise HTTPException(status_code=422, detail="Choose an image file.")
    job_dir = os.path.abspath(pipeline.job_dir(job_id))
    if os.path.dirname(os.path.abspath(body.path)) == job_dir and os.path.isfile(body.path):
        # A cover this job had before (Undo): use it again as it is.
        job = get_store().update(job_id, cover=body.path, thumbnail=body.path)
        await ws.send_job(job)
        return job
    try:
        path = await asyncio.to_thread(cover.import_image, body.path, job_dir)
    except cover.CoverError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    job = get_store().update(job_id, cover=path, thumbnail=path)
    await ws.send_job(job)
    return job


@router.post("/jobs/{job_id}/album-search")
async def album_search(job_id: str, body: AlbumSearchIn):
    """Albums on MusicBrainz matching the typed album and singer names."""
    _get_job(job_id)
    try:
        releases = await asyncio.to_thread(musicbrainz.search_releases, body.album, body.artist)
    except musicbrainz.MusicBrainzError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return {"releases": releases}


@router.post("/jobs/{job_id}/album-apply")
async def album_apply(job_id: str, body: AlbumApplyIn):
    """Details of the chosen album (name, singer, year, song names), and its cover art set on the job.
    The review screen decides what to use from the details; nothing else is saved."""
    job = _get_job(job_id)
    if job["status"] in ACTIVE_STATES:
        raise HTTPException(status_code=409, detail="Wait for the job to finish first")
    try:
        details = await asyncio.to_thread(musicbrainz.release_details, body.release_id)
    except musicbrainz.MusicBrainzError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    details["cover"] = False
    if body.cover:
        try:
            path = await asyncio.to_thread(musicbrainz.download_cover, body.release_id, pipeline.job_dir(job_id))
        except musicbrainz.MusicBrainzError:
            path = None  # the details are still useful without the cover
        if path:
            job = get_store().update(job_id, cover=path, thumbnail=path)
            await ws.send_job(job)
            details["cover"] = True
    details["job"] = job
    return details


@router.delete("/jobs/{job_id}/cover")
async def reset_cover(job_id: str):
    """Go back to the video's thumbnail."""
    job = _get_job(job_id)
    if job.get("cover") and os.path.isfile(job["cover"]):
        await asyncio.to_thread(os.remove, job["cover"])
    thumbnail = next((s.get("thumbnail") for s in job["sources"] if s.get("thumbnail")), None)
    job = get_store().update(job_id, cover="", thumbnail=thumbnail)
    await ws.send_job(job)
    return job


@router.post("/jobs/{job_id}/retry")
async def retry_job(job_id: str):
    """Try a failed or cancelled job again, or resume a paused video download."""
    job = _get_job(job_id)
    if pipeline.is_running(job_id):
        raise HTTPException(status_code=409, detail="This job is already running")
    if job["status"] not in ("failed", "cancelled", "paused"):
        raise HTTPException(status_code=409, detail="Only failed, cancelled or paused jobs can be started again")
    job = get_store().update(job_id, status="queued", error=None, message="Waiting to start")
    await ws.send_job(job)
    if job["kind"] == "video":
        pipeline.start_video(job_id)
    else:
        pipeline.start_analysis(job_id)
    return job


@router.post("/jobs/{job_id}/pause")
async def pause_job(job_id: str):
    job = _get_job(job_id)
    if job["kind"] != "video":
        raise HTTPException(status_code=409, detail="Only video downloads can be paused")
    if not pipeline.pause(job_id):
        raise HTTPException(status_code=409, detail="Nothing is downloading for this job")
    return {"status": "pausing"}


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
    if source and source.get("local"):
        # The user's own file: play the copy made for playback, or the file itself if it plays as is.
        if source.get("preview_path"):
            return _serve_work_file(job_id, source["preview_path"])
        if source.get("path") and os.path.isfile(source["path"]) and not local_media.needs_preview(source["path"]):
            return FileResponse(source["path"])
        raise HTTPException(status_code=404, detail="The file is no longer there.")
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
    if job["kind"] == "video":
        return _serve_video_thumbnail(job.get("thumbnail"))
    return _serve_work_file(job_id, job.get("thumbnail"))


def _serve_video_thumbnail(path: str | None) -> FileResponse:
    """Only thumbnails in Cadence's own video-thumbnail folder can be served."""
    root = os.path.realpath(video.thumbs_dir())
    real = os.path.realpath(path or "")
    if not path or os.path.commonpath([root, real]) != root or not os.path.isfile(real):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(real)
