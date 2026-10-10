import asyncio
import logging
import os
import uuid
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from fastapi.responses import FileResponse, Response

from config import load_preferences
from core.db import get_store
from core.websocket_manager import manager as ws
from services import lyrics, send_to, song_index, tag_edit

router = APIRouter()

_scan_lock = asyncio.Lock()


def _saved_paths() -> tuple[list[str], list[str]]:
    """Folders to scan (library + per-split folders) and individual saved files."""
    prefs = load_preferences()
    roots = [prefs.library_dir]
    files: list[str] = []
    for job in get_store().list():
        if job.get("destination"):
            roots.append(job["destination"])
        files += [o["path"] for o in job.get("outputs", [])]
    return list(dict.fromkeys(roots)), files


async def scan_library() -> dict[str, int]:
    async with _scan_lock:
        roots, files = _saved_paths()
        return await asyncio.to_thread(song_index.get_index().scan, roots, files)


@router.get("/library/songs")
async def list_songs(q: str = Query(default="", max_length=200), sort: str = Query(default="artist")):
    return await asyncio.to_thread(song_index.get_index().list, q, sort)


@router.post("/library/scan")
async def scan():
    return await scan_library()


def _song(song_id_: str) -> dict:
    song = song_index.get_index().get(song_id_)
    if not song or not os.path.isfile(song["path"]):
        raise HTTPException(status_code=404, detail="Song not found. It may have been moved or deleted.")
    return song


class TagChanges(BaseModel):
    """Only the fields that are set are changed. An empty string removes that tag."""

    title: str | None = Field(default=None, max_length=300)
    artist: str | None = Field(default=None, max_length=300)
    album: str | None = Field(default=None, max_length=300)
    album_artist: str | None = Field(default=None, max_length=300)
    year: str | None = Field(default=None, max_length=4)
    track: int | None = Field(default=None, ge=0, le=999)

    @field_validator("year")
    @classmethod
    def four_digits(cls, v: str | None) -> str | None:
        if v and not (v.isdigit() and len(v) == 4):
            raise ValueError("Year must be four digits, like 1995.")
        return v


class EditSongs(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=2000)
    changes: TagChanges


@router.put("/library/songs")
async def edit_songs(body: EditSongs):
    """Change tags of one or more saved songs. Returns the songs as now indexed."""
    changes = body.changes.model_dump(exclude_none=True)
    if not changes:
        raise HTTPException(status_code=422, detail="Nothing to change.")
    if len(body.ids) > 1 and ({"title", "track"} & changes.keys()):
        raise HTTPException(status_code=422, detail="Titles and track numbers can only be changed one song at a time.")
    if changes.get("title") == "":
        raise HTTPException(status_code=422, detail="A song needs a title.")
    songs = [_song(i) for i in body.ids]
    index = song_index.get_index()
    for song in songs:
        try:
            await asyncio.to_thread(tag_edit.update_tags, song["path"], changes)
        except tag_edit.TagEditError as e:
            raise HTTPException(status_code=422, detail=f"{song['title']}: {e}") from e
    await asyncio.to_thread(index.add_paths, [s["path"] for s in songs])
    return [index.get(s["id"]) for s in songs]


@router.get("/library/songs/{song_id_}/audio")
async def song_audio(song_id_: str):
    song = _song(song_id_)
    media = {"mp3": "audio/mpeg", "m4a": "audio/mp4", "flac": "audio/flac", "opus": "audio/ogg", "ogg": "audio/ogg"}
    return FileResponse(song["path"], media_type=media.get(song["format"], "application/octet-stream"))


@router.get("/library/songs/{song_id_}/cover")
async def song_cover(song_id_: str):
    song = _song(song_id_)
    cover = await asyncio.to_thread(song_index.read_cover, song["path"])
    if not cover:
        raise HTTPException(status_code=404, detail="No cover art")
    data, mime = cover
    return Response(content=data, media_type=mime, headers={"Cache-Control": "max-age=86400"})


# Lyrics looked up online while listening, kept for this session.
_lyrics_cache: dict[str, dict] = {}


@router.get("/library/songs/{song_id_}/lyrics")
async def song_lyrics(song_id_: str, online: bool = False):
    """Lyrics for the player: saved with the song (.lrc or tags), else, when `online`, from LRCLIB
    (sends only the title, singer, album and length). {"synced", "plain", "source"}; empty when none."""
    song = _song(song_id_)
    saved = await asyncio.to_thread(lyrics.read_saved, song["path"], song["format"])
    if saved:
        return {**saved, "source": "saved"}
    if not online:
        return {"synced": "", "plain": "", "source": ""}
    if song_id_ not in _lyrics_cache:
        try:
            found = await asyncio.to_thread(
                lyrics.fetch, song["title"], song["artist"] or song["album_artist"], song["album"], float(song["duration"] or 0),
            )
        except OSError as e:
            raise HTTPException(status_code=503, detail="Couldn't reach LRCLIB to look up the lyrics.") from e
        _lyrics_cache[song_id_] = {**found, "source": "lrclib"} if found else {"synced": "", "plain": "", "source": ""}
    return _lyrics_cache[song_id_]


_send_tasks: set[asyncio.Task] = set()


class SendSongs(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=20000)
    # "folder": a folder or drive the user chose; "music_app": Apple Music / iTunes.
    target: Literal["folder", "music_app"] = "folder"
    destination: str = Field(default="", max_length=1000)
    layout: Literal["folders", "flat"] = "folders"
    to_mp3: bool = False


@router.get("/library/music-app")
async def music_app():
    """The Apple Music / iTunes folder that imports songs copied into it, if the app is installed."""
    found = await asyncio.to_thread(send_to.music_app_folder)
    return {"folder": found[0], "name": found[1]} if found else {"folder": None, "name": None}


@router.post("/library/send")
async def send_songs(body: SendSongs):
    """Copy songs to a folder or drive, or into Apple Music / iTunes, in the background.
    Progress arrives as "send" messages on the WebSocket; returns the task id."""
    if body.target == "music_app":
        found = await asyncio.to_thread(send_to.music_app_folder)
        if not found:
            raise HTTPException(status_code=422, detail="Apple Music or iTunes isn't installed.")
        destination, layout, to_mp3, formats = found[0], "flat", False, send_to.MUSIC_APP_FORMATS
    else:
        destination, layout, to_mp3, formats = body.destination, body.layout, body.to_mp3, None
        if not os.path.isabs(destination) or not os.path.isdir(destination):
            raise HTTPException(status_code=422, detail="Choose a folder or drive to copy to.")
    index = song_index.get_index()
    songs = [s for s in (index.get(i) for i in body.ids) if s]
    if not songs:
        raise HTTPException(status_code=404, detail="Those songs aren't in the library any more.")
    task_id = uuid.uuid4().hex[:12]
    task = asyncio.create_task(_send(task_id, songs, destination, layout, to_mp3, formats))
    _send_tasks.add(task)  # keep a reference until it finishes
    task.add_done_callback(_send_tasks.discard)
    return {"task_id": task_id, "total": len(songs), "destination": destination}


async def _send(task_id: str, songs: list[dict], destination: str, layout: str, to_mp3: bool, formats: set[str] | None) -> None:
    counts = {"copied": 0, "skipped": 0, "failed": 0}
    errors: list[str] = []
    for i, song in enumerate(songs):
        await ws.send_event("send", {"task_id": task_id, "done": i, "total": len(songs), "current": song["title"], **counts})
        # Apple Music / iTunes only take MP3 and M4A: convert other formats for them.
        convert = to_mp3 or (formats is not None and song.get("format") not in formats)
        try:
            result = await asyncio.to_thread(send_to.copy_song, song, destination, layout, convert)
            counts[result] += 1
        except send_to.SendError as e:
            counts["failed"] += 1
            errors.append(f"{song['title']}: {e}")
        except Exception as e:  # noqa: BLE001 - keep going with the other songs
            logging.getLogger(__name__).exception("Copying %s failed", song["path"])
            counts["failed"] += 1
            errors.append(f"{song['title']}: {e}")
    await ws.send_event("send", {
        "task_id": task_id, "done": len(songs), "total": len(songs), "finished": True,
        "destination": destination, "errors": errors[:5], **counts,
    })
