"""Runs a job through its stages and keeps the database and UI in sync.

analyze: resolve -> download -> find tracklist -> snap cuts  => status "review"
export:  cut + encode + tag each approved song               => status "completed"
"""

import asyncio
import logging
import os
import shutil
import threading
import time
from typing import Any, Callable

from config import load_preferences, settings
from core.db import get_store
from core.websocket_manager import manager as ws
from services import (
    audio_analysis, audio_profile, cover, credits, exporter, identify, library, local_media, loudness, lyrics, name_cleanup,
    playlist,
    song_index,
    tracklist, youtube,
)

log = logging.getLogger(__name__)

class _Slots:
    """At most `limit()` holders at once; the limit is read each time, so a new setting
    applies to splits waiting to start."""

    def __init__(self, limit: Callable[[], int]):
        self._limit = limit
        self._busy = 0
        self._changed = asyncio.Condition()

    async def __aenter__(self) -> None:
        async with self._changed:
            await self._changed.wait_for(lambda: self._busy < max(1, self._limit()))
            self._busy += 1

    async def __aexit__(self, *exc: object) -> None:
        async with self._changed:
            self._busy -= 1
            self._changed.notify_all()

    async def limit_changed(self) -> None:
        async with self._changed:
            self._changed.notify_all()


_analyze_slots = _Slots(lambda: load_preferences().parallel_splits)
_export_slots = asyncio.Semaphore(1)
_cancel_flags: dict[str, threading.Event] = {}
_running: dict[str, asyncio.Task] = {}


def job_dir(job_id: str) -> str:
    return os.path.join(settings.work_dir, job_id)


async def _update(job_id: str, **fields: Any) -> dict[str, Any] | None:
    job = get_store().update(job_id, **fields)
    if job:
        await ws.send_job(job)
    return job


def _cancelled(job_id: str) -> bool:
    flag = _cancel_flags.get(job_id)
    return bool(flag and flag.is_set())


def _check_cancel(job_id: str) -> None:
    if _cancelled(job_id):
        raise youtube.Cancelled()


def _start(job_id: str, coro) -> None:
    _cancel_flags[job_id] = threading.Event()
    task = asyncio.create_task(coro)
    _running[job_id] = task
    task.add_done_callback(lambda _t: _running.pop(job_id, None))


def is_running(job_id: str) -> bool:
    return job_id in _running


async def analyze_limit_changed() -> None:
    """Let waiting splits start if "splits at a time" was raised."""
    try:
        await _analyze_slots.limit_changed()
    except RuntimeError:
        pass  # no split has waited yet (the condition isn't tied to this event loop)


def start_analysis(job_id: str) -> None:
    _start(job_id, _analyze(job_id))


def start_export(job_id: str, replace_previous: bool = False) -> None:
    _start(job_id, _export(job_id, replace_previous))


def cancel(job_id: str) -> bool:
    flag = _cancel_flags.get(job_id)
    if flag and job_id in _running:
        flag.set()
        return True
    return False


async def remove_downloads(job_id: str, sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Delete downloaded source audio but keep thumbnails and waveforms. Returns updated sources.

    The user's own files (local sources) are never touched.
    """
    updated = []
    for source in sources:
        if source.get("local"):
            updated.append(source)
            continue
        path = source.get("path")
        if path and os.path.isfile(path):
            await asyncio.to_thread(os.remove, path)
        updated.append({**source, "path": ""})
    return updated


async def delete_work_files(job_id: str) -> None:
    await asyncio.to_thread(shutil.rmtree, job_dir(job_id), True)


class _Progress:
    """Throttles progress pushes coming from yt-dlp's download thread."""

    def __init__(self, job_id: str, loop: asyncio.AbstractEventLoop, base: float, span: float, label: str):
        self.job_id, self.loop, self.base, self.span, self.label = job_id, loop, base, span, label
        self._last = (0.0, -1.0)

    def __call__(self, fraction: float) -> None:
        now, pct = time.monotonic(), self.base + self.span * fraction
        if pct - self._last[1] < 1 and now - self._last[0] < 0.5 and fraction < 1:
            return
        self._last = (now, pct)
        asyncio.run_coroutine_threadsafe(
            _update(self.job_id, progress=round(pct, 1), message=f"{self.label} {fraction * 100:.0f}%"), self.loop
        )


async def _analyze(job_id: str) -> None:
    store = get_store()
    job = store.get(job_id)
    if not job:
        return
    loop = asyncio.get_running_loop()
    out_dir = job_dir(job_id)
    try:
        async with _analyze_slots:
            if is_local(job["url"]):
                await _analyze_local(job_id, job["url"], out_dir, loop)
                return
            await _update(job_id, status="resolving", progress=2, message="Reading video details", error=None)
            info = await youtube.resolve(job["url"])
            _check_cancel(job_id)

            if info.get("_type") == "playlist":
                await _analyze_playlist(job_id, info, out_dir, loop)
            else:
                await _analyze_video(job_id, info, out_dir, loop)
    except youtube.Cancelled:
        await _update(job_id, status="cancelled", message="Cancelled", progress=0)
    except Exception as e:  # noqa: BLE001 - shown to the user, full trace in the log
        log.exception("Analysis failed for job %s", job_id)
        await _update(job_id, status="failed", error=friendly_error(e), message="")


def is_local(url: str) -> bool:
    """Jobs for a file on this computer store its full path where a link would be."""
    return os.path.isabs(url) and not url.lower().startswith(("http://", "https://"))


async def _analyze_local(job_id: str, path: str, out_dir: str, loop: asyncio.AbstractEventLoop) -> None:
    if not os.path.isfile(path):
        raise local_media.LocalFileError("The file is no longer there. It may have been moved, renamed or deleted.")
    await _update(job_id, status="analyzing", progress=2, message="Reading the file", error=None)
    info = await asyncio.to_thread(local_media.probe, path)
    duration = info["duration"]
    sid = local_media.source_id(path)
    title = os.path.splitext(os.path.basename(path))[0]
    await _update(job_id, title=title, progress=4)
    source = {
        "id": sid, "title": title, "url": "", "duration": duration, "path": path, "local": True, "preview_path": "",
        "thumbnail": await asyncio.to_thread(local_media.extract_cover, path, out_dir, info),
        "uploader": info["artist"], "description": info["comment"],
    }

    # Songs from a .cue sheet next to the file, else from chapters inside it.
    tracks: list[dict[str, Any]] = []
    hint = {"artist": info["artist"], "album": info["album"], "year": info["year"]}
    cue = local_media.find_cue(path)
    if cue:
        try:
            parsed = tracklist.parse_pasted(await asyncio.to_thread(local_media.read_text, cue), duration)
            tracks = tracklist.tracks_from_pasted(parsed, duration, sid, origin="cue")
            hint = {k: parsed[k] or hint[k] for k in hint}
        except (OSError, tracklist.TracklistError) as e:
            log.warning("Ignoring cue sheet %s: %s", cue, e)
    if not tracks:
        tracks = tracklist.tracks_from_chapters(info["chapters"], duration, sid)
    _check_cancel(job_id)

    base = 5.0
    if local_media.needs_preview(path):
        await _update(job_id, progress=base, message="Preparing audio for playback")
        try:
            source["preview_path"] = await asyncio.to_thread(
                local_media.make_preview, path, out_dir, duration,
                _Progress(job_id, loop, base, 30, "Preparing audio for playback"), lambda: _cancelled(job_id),
            )
        except InterruptedError as e:
            raise youtube.Cancelled() from e
        base = 35.0
    await _find_songs(job_id, loop, out_dir, source, tracks, title, info["artist"], base, hint)


async def _analyze_video(job_id: str, info: dict[str, Any], out_dir: str, loop: asyncio.AbstractEventLoop) -> None:
    url = info.get("webpage_url") or get_store().get(job_id)["url"]
    title = info.get("title") or "Untitled"
    await _update(job_id, title=title, progress=5, message="Looking for a tracklist")

    tracks = tracklist.tracks_from_metadata(info, info["id"])
    if not tracks:
        await _update(job_id, message="Checking comments for a tracklist")
        info["comments"] = await youtube.fetch_comments(url)
        tracks = tracklist.tracks_from_metadata(info, info["id"])
    _check_cancel(job_id)

    await _update(job_id, status="downloading", progress=8, message="Downloading audio")
    downloaded = await youtube.download_audio(
        url, out_dir, _Progress(job_id, loop, 8, 72, "Downloading audio"), lambda: _cancelled(job_id)
    )
    _check_cancel(job_id)
    audio_path = downloaded["_audio_path"]
    duration = float(downloaded.get("duration") or info.get("duration") or 0)
    source = {
        "id": info["id"], "title": title, "url": url, "duration": duration,
        "path": audio_path, "thumbnail": downloaded.get("_thumbnail_path"),
        "uploader": info.get("uploader") or info.get("channel") or "",
        "description": info.get("description") or "",
    }

    # The singer from the description's credits, never a fan channel's name.
    found = credits.parse_credits(source["description"])
    singer = credits.singer_for(info)
    year = found["year"]
    hint = {
        # A collection gets an album singer only when the credits name one.
        "artist": singer if len(found["singers"]) <= 1 else "",
        "year": year, "song": found["song"], "film": found["album"],
    }
    await _find_songs(job_id, loop, out_dir, source, tracks, title, singer, 80.0, hint)


async def _find_songs(
    job_id: str, loop: asyncio.AbstractEventLoop, out_dir: str, source: dict[str, Any], tracks: list[dict[str, Any]],
    title: str, uploader: str, base: float, hint: dict[str, str] | None = None,
) -> None:
    """Shared by videos and local files: read the waveform, find or refine the songs, name them, then review.

    `tracks` is the tracklist found so far ([] to listen for the songs). `base` is
    where progress stands. `hint` holds album details from tags or a cue sheet.
    """
    prefs = load_preferences()
    sid, audio_path, duration = source["id"], source["path"], source["duration"]
    await _update(job_id, status="analyzing", progress=base, message="Reading the waveform")
    try:
        profile = await asyncio.to_thread(
            audio_profile.build_profile, audio_path, duration,
            _Progress(job_id, loop, base, max(1.0, 92 - base), "Reading the waveform"), lambda: _cancelled(job_id),
        )
    except InterruptedError as e:
        raise youtube.Cancelled() from e
    audio_profile.save_peaks(out_dir, sid, profile)
    duration = duration or profile.duration
    source["duration"] = duration

    if not tracks:
        await _update(job_id, progress=93, message="No tracklist found. Listening for where songs change")
        tracks = audio_analysis.tracks_from_profile(profile, sid)
    else:
        await _update(job_id, progress=93, message="Fine-tuning cut points")
    if tracks:
        tracks[-1]["end"] = min(tracks[-1]["end"], duration) or duration
    await audio_analysis.refine_boundaries(tracks, audio_path, duration, prefs.snap_window_s)
    tracklist.flag_short_tracks(tracks)
    _check_cancel(job_id)

    key = identify.api_key(prefs.acoustid_key)
    if prefs.identify_songs and key and any(identify.needs_name(t) for t in tracks):
        async def progress(i: int, total: int) -> None:
            await _update(job_id, progress=96, message=f"Identifying songs {i + 1} of {total}")
        try:
            await identify.identify_tracks(tracks, {sid: source}, key, on_progress=progress)
        except identify.IdentifyError as e:
            log.warning("Song identification skipped: %s", e)

    collection = tracklist.classify_collection(title, len(tracks), uploader)
    if hint and hint.get("album") and len(tracks) > 1:
        collection.update(type="album", name=hint["album"], album=hint["album"], confidence=0.8)
    if hint and hint.get("artist") and not collection.get("artist"):
        collection["artist"] = hint["artist"]
    if hint and hint.get("year") and not collection.get("year"):
        collection["year"] = hint["year"]
    if collection["type"] == "single" and tracks:
        tracks[0]["title"] = (hint or {}).get("song") or tracklist.clean_title(title)
        if hint and hint.get("film") and not collection.get("album"):
            collection["album"] = hint["film"]

    if prefs.tidy_names and prefs.anthropic_api_key:
        await _update(job_id, progress=98, message="Tidying names with Claude")
        try:
            suggestion = await name_cleanup.suggest_names(
                prefs.anthropic_api_key, {"title": title, "sources": [source]}, tracks
            )
            tracks, collection = name_cleanup.apply_suggestions(tracks, collection, suggestion)
        except name_cleanup.NameCleanupError as e:
            log.warning("Name tidying skipped: %s", e)
    await _update(
        job_id, status="review", progress=100, sources=[source], tracks=tracks, collection=collection,
        thumbnail=source["thumbnail"], message=_review_message(tracks),
    )


async def _analyze_playlist(job_id: str, info: dict[str, Any], out_dir: str, loop: asyncio.AbstractEventLoop) -> None:
    entries = [e for e in (info.get("entries") or []) if e and e.get("id")]
    if not entries:
        raise RuntimeError("This playlist has no playable videos.")
    title = info.get("title") or "Playlist"
    await _update(job_id, title=title, status="downloading", progress=5, message=f"Downloading {len(entries)} videos")

    sources, tracks = [], []
    span = 90 / len(entries)
    for i, entry in enumerate(entries):
        _check_cancel(job_id)
        url = entry.get("url") or f"https://www.youtube.com/watch?v={entry['id']}"
        label = f"Downloading {i + 1} of {len(entries)}"
        try:
            downloaded = await youtube.download_audio(
                url, out_dir, _Progress(job_id, loop, 5 + span * i, span, label), lambda: _cancelled(job_id)
            )
        except youtube.Cancelled:
            raise
        except Exception as e:  # noqa: BLE001 - one private or removed video should not sink the playlist
            log.warning("Skipping playlist entry %s: %s", entry.get("id"), e)
            continue
        duration = float(downloaded.get("duration") or 0)
        sources.append({
            "id": downloaded["id"], "title": downloaded.get("title") or entry.get("title") or "",
            "url": url, "duration": duration, "path": downloaded["_audio_path"],
            "thumbnail": downloaded.get("_thumbnail_path"),
        })
        found = credits.parse_credits(downloaded.get("description") or "")
        tracks.append(tracklist.make_track(
            title=found["song"] or tracklist.clean_title(downloaded.get("title") or entry.get("title") or f"Track {i + 1}"),
            start=0, end=duration, origin="playlist", source_id=downloaded["id"], artist=credits.singer_for(downloaded),
        ))

    if not tracks:
        raise RuntimeError("None of the videos in this playlist could be downloaded.")
    collection = tracklist.classify_collection(
        title, len(tracks), credits.artist_channel(info.get("uploader") or info.get("channel") or ""),
    )
    await _update(
        job_id, status="review", progress=100, sources=sources, tracks=tracks, collection=collection,
        thumbnail=sources[0]["thumbnail"], message=_review_message(tracks),
    )


def _review_message(tracks: list[dict[str, Any]]) -> str:
    flagged = sum(1 for t in tracks if t["confidence"] < 0.7)
    found = f"{len(tracks)} song{'s' if len(tracks) != 1 else ''} found"
    return f"{found}, {flagged} need a check" if flagged else f"{found}, ready to export"


def _trash(paths: list[str]) -> list[str]:
    """Move files to the Recycle Bin. Returns the ones that were moved. Blocking."""
    from send2trash import send2trash

    moved = []
    for path in paths:
        try:
            send2trash(path)
            moved.append(path)
        except OSError as e:  # in use or already gone: leave it, saving still succeeded
            log.warning("Couldn't move %s to the Recycle Bin: %s", path, e)
    return moved


async def _export(job_id: str, replace_previous: bool = False) -> None:
    store = get_store()
    job = store.get(job_id)
    if not job:
        return
    # Songs saved last time that may be overwritten (only when the user chose to replace them).
    previous = [o["path"] for o in job.get("outputs") or []] if replace_previous else []
    if replace_previous and job.get("playlist"):
        previous.append(job["playlist"])
    replaceable = frozenset(library.same_file_key(p) for p in previous)
    try:
        async with _export_slots:
            prefs = load_preferences()
            sources = {s["id"]: s for s in job["sources"]}
            chosen = [t for t in job["tracks"] if t.get("include", True)]
            collection = job["collection"]
            root = job.get("destination") or prefs.library_dir
            outputs: list[dict[str, Any]] = []
            entries: list[dict[str, Any]] = []  # for the playlist
            with_lyrics = 0
            lyrics_offline = False
            await _update(job_id, status="exporting", progress=0, message="Saving songs", error=None, outputs=[])

            # Pass 1 (only when needed): trim silent edges and measure loudness. The
            # album's ReplayGain needs every song measured before any is tagged.
            spans = [(t["start"], t["end"]) for t in chosen]
            measured: list[dict[str, Any] | None] = [None] * len(chosen)
            preparing = prefs.trim_silence or prefs.loudness != "off"
            for n, track in enumerate(chosen if preparing else [], start=1):
                _check_cancel(job_id)
                src = sources[track["source_id"]]["path"]
                await _update(
                    job_id, progress=round(30 * (n - 1) / len(chosen), 1),
                    message=f"Preparing {n} of {len(chosen)}: {track['title']}",
                )
                if prefs.trim_silence:
                    spans[n - 1] = await asyncio.to_thread(loudness.trim_bounds, src, *spans[n - 1])
                if prefs.loudness != "off":
                    measured[n - 1] = await asyncio.to_thread(loudness.measure, src, *spans[n - 1])
            covers: dict[str, str | None] = {}

            async def cover_for(source: dict[str, Any]) -> str | None:
                """The split's own cover if the user chose one, else the video's thumbnail (square if wanted)."""
                if job.get("cover") and os.path.isfile(job["cover"]):
                    return job["cover"]
                if source["id"] not in covers:
                    thumb = source.get("thumbnail")
                    if thumb and os.path.isfile(thumb) and prefs.square_cover:
                        out = os.path.join(job_dir(job_id), f"cover-square-{source['id']}.jpg")
                        thumb = await asyncio.to_thread(cover.square, thumb, out)
                    covers[source["id"]] = thumb
                return covers[source["id"]]

            # "Original": each source's audio as it is, in its own file type. Volume changes and
            # audible fades need a re-encode, so "Adjust volume" falls back to ReplayGain tags.
            original = prefs.audio_format == "original"
            formats: dict[str, tuple[str, str | None]] = {}
            for s in job["sources"]:
                if s["id"] in {t["source_id"] for t in chosen}:
                    formats[s["id"]] = await asyncio.to_thread(exporter.original_format, s["path"]) if original else (prefs.audio_format, None)
            loudness_mode = "tags" if original and prefs.loudness == "normalize" else prefs.loudness

            album_lufs, album_peak = None, float("-inf")
            if loudness_mode == "tags":
                songs = [(end - start, m) for (start, end), m in zip(spans, measured) if m]
                album_lufs = loudness.album_loudness(songs)
                album_peak = max((m["sample_peak_db"] for _, m in songs), default=float("-inf"))
            saving_from = 30 if preparing else 0

            for n, track in enumerate(chosen, start=1):
                _check_cancel(job_id)
                source = sources[track["source_id"]]
                rel = library.relative_path(track, n, collection, prefs)
                fmt, muxer = formats[track["source_id"]]
                dest = library.unique_path(os.path.join(root, f"{rel}.{fmt}"), replaceable)
                if any(library.same_file_key(dest) == library.same_file_key(o["path"]) for o in outputs):
                    dest = library.unique_path(dest)  # two songs with the same name in this save
                await _update(
                    job_id, progress=round(saving_from + (100 - saving_from) * (n - 1) / len(chosen), 1),
                    message=f"Saving {n} of {len(chosen)}: {track['title']}",
                )
                m = measured[n - 1]
                gain = loudness.normalize_gain(m, prefs.loudness_target) if m and loudness_mode == "normalize" else 0.0
                replaygain = loudness.replaygain(m, album_lufs, album_peak) if m and loudness_mode == "tags" else None
                start, end = spans[n - 1]
                await exporter.cut_track(
                    source["path"], start, end, dest, fmt, prefs.audio_bitrate, prefs.edge_fade_ms,
                    gain_db=gain, fade_in_s=prefs.song_fade_in_s, fade_out_s=prefs.song_fade_out_s, copy_muxer=muxer,
                )
                album_artist = collection.get("artist") or ""
                await asyncio.to_thread(
                    exporter.write_tags, dest, fmt,
                    {
                        "title": track["title"],
                        "artist": track.get("artist") or album_artist,
                        "album_artist": album_artist,
                        "album": collection.get("album") or collection.get("name") or "",
                        "year": collection.get("year") or "",
                        "track": n, "total": len(chosen),
                    },
                    await cover_for(source),
                    replaygain,
                )
                if prefs.lyrics != "off" and not lyrics_offline:
                    try:
                        found = await asyncio.to_thread(
                            lyrics.fetch, track["title"], track.get("artist") or album_artist,
                            collection.get("album") or "", end - start,
                        )
                    except OSError as e:  # offline or LRCLIB down: save the rest without asking again
                        log.warning("Lyrics lookup failed: %s", e)
                        lyrics_offline, found = True, None
                    if found:
                        await asyncio.to_thread(lyrics.embed, dest, fmt, found["synced"] or found["plain"])
                        lrc = lyrics.lrc_path(dest)
                        mine = library.same_file_key(lrc) in replaceable or library.same_file_key(dest) in replaceable
                        if prefs.lyrics == "lrc" and found["synced"] and (mine or not os.path.exists(lrc)):
                            await asyncio.to_thread(lyrics.write_lrc, dest, found["synced"])
                        with_lyrics += 1
                outputs.append({"track_id": track["id"], "title": track["title"], "path": dest})
                entries.append({
                    "path": dest, "title": track["title"], "duration": end - start,
                    "artist": track.get("artist") or album_artist,
                })

            folder = os.path.commonpath([os.path.dirname(o["path"]) for o in outputs]) if outputs else root
            await asyncio.to_thread(song_index.get_index().add_paths, [o["path"] for o in outputs])
            playlist_file = ""
            if prefs.write_playlist and len(outputs) > 1:
                target = library.unique_path(playlist.playlist_path(folder, collection), replaceable)
                playlist_file = await asyncio.to_thread(playlist.write, target, entries)
            # Old songs this save didn't overwrite (renamed or left out) go to the Recycle Bin.
            kept = {library.same_file_key(o["path"]) for o in outputs} | {library.same_file_key(playlist_file)}
            stale = [p for p in previous if library.same_file_key(p) not in kept and os.path.isfile(p)]
            # A replaced song's .lrc goes with it (only ones Cadence wrote: next to its own songs).
            stale += [lyrics.lrc_path(p) for p in stale if p.lower().endswith(tuple(f".{f}" for f in ("mp3", "m4a", "flac", "opus")))
                      and os.path.isfile(lyrics.lrc_path(p)) and library.same_file_key(lyrics.lrc_path(p)) not in kept]
            if stale:
                trashed = await asyncio.to_thread(_trash, stale)
                await asyncio.to_thread(song_index.get_index().remove_paths, trashed)
            sources_after = job["sources"]
            if not prefs.keep_downloads:
                sources_after = await remove_downloads(job_id, job["sources"])
            # Remember the videos, so playlists and channels can show what was saved before.
            store.remember_saved_videos([(src["id"], src.get("title", "")) for src in job["sources"] if not src.get("local")])
            await _update(
                job_id, status="completed", progress=100, outputs=outputs, sources=sources_after, playlist=playlist_file,
                message=f"Saved {len(outputs)} song{'s' if len(outputs) != 1 else ''} to {folder}"
                + (f" (lyrics for {with_lyrics})" if prefs.lyrics != "off" and not lyrics_offline else "")
                + (" (lyrics skipped: couldn't reach LRCLIB)" if lyrics_offline else ""),
            )
    except youtube.Cancelled:
        await _update(job_id, status="review", progress=0, message="Export cancelled. Songs already saved were kept.")
    except Exception as e:  # noqa: BLE001
        log.exception("Export failed for job %s", job_id)
        await _update(job_id, status="review", error=friendly_error(e), message="Export failed")


def friendly_error(e: Exception) -> str:
    text = str(e).replace("ERROR: ", "").strip()
    lowered = text.lower()
    if "private video" in lowered:
        return "This video is private."
    if "video unavailable" in lowered or "not available" in lowered:
        return "This video is unavailable. It may have been removed or blocked in your region."
    if "could not copy" in lowered and "cookie" in lowered or "failed to decrypt" in lowered:
        return ("Couldn't read the browser's YouTube sign-in. Close the browser and try again, or use Firefox "
                "or a cookies.txt file (Settings → YouTube).")
    if "sign in to confirm your age" in lowered or "age-restricted" in lowered:
        return "This video is age-restricted. Sign in to YouTube in your browser, then choose it in Settings → YouTube."
    if "sign in to confirm" in lowered:
        return ("YouTube asked to confirm you are not a bot. Try again later, update yt-dlp, or use your browser's "
                "YouTube sign-in (Settings → YouTube).")
    if "unsupported url" in lowered:
        return "That link isn't a YouTube video or playlist."
    if "ffmpeg not found" in lowered:
        return text
    return text[:400] or e.__class__.__name__
