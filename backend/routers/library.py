import asyncio
import os

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from fastapi.responses import FileResponse, Response

from config import load_preferences
from core.db import get_store
from services import song_index, tag_edit

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
