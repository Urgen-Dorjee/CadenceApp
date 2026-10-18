"""Whole-video downloads: picture, sound, subtitles and chapters of a YouTube video or course.

The details read for the "Video ready" screen are kept for a while so the download shows
the right title at once. The download itself reads the video again: YouTube ties its stream
links to the session that read them, and refuses (HTTP 403) a download that reuses them.
Videos in a playlist are downloaded one after another with a short pause between them,
which keeps YouTube from asking to confirm you're not a bot.
"""

import asyncio
import glob
import os
import re
import shutil
import time
from typing import Any, Callable

import yt_dlp
from yt_dlp.postprocessor.common import PostProcessor
from yt_dlp.utils import DownloadCancelled

from config import settings
from services import youtube

QUALITIES = ("best", "2160", "1440", "1080", "720", "480", "audio")
CONTAINERS = ("mp4", "mkv")
SUBTITLE_MODES = ("embed", "srt", "both")
LAYOUTS = ("channel", "flat")
QUALITY_LABELS = {
    "best": "Best available", "2160": "2160p (4K)", "1440": "1440p", "1080": "1080p",
    "720": "720p", "480": "480p", "audio": "Sound only (M4A)",
}
INFO_KEEP_S = 30 * 60  # details shown on "Video ready" are kept this long (for the title)
THUMB_EXTS = (".jpg", ".jpeg", ".png", ".webp")


class Paused(Exception):
    """The user paused the download. Partial files are kept so it can resume."""


def thumbs_dir() -> str:
    return os.path.join(settings.data_dir, "video-thumbs")


def thumb_path(video_id: str) -> str:
    return os.path.join(thumbs_dir(), f"{video_id}.jpg")


# --- Details for the "Video ready" screen -----------------------------------------

_details: dict[str, tuple[float, dict[str, Any]]] = {}


def remember(info: dict[str, Any]) -> None:
    now = time.monotonic()
    for key in [k for k, (at, _) in _details.items() if now - at > INFO_KEEP_S]:
        del _details[key]
    _details[info["id"]] = (now, info)


def remembered(video_id: str | None) -> dict[str, Any] | None:
    if not video_id or video_id not in _details:
        return None
    at, info = _details[video_id]
    return info if time.monotonic() - at <= INFO_KEEP_S else None


def _size(fmt: dict[str, Any], duration: float) -> float:
    if fmt.get("filesize") or fmt.get("filesize_approx"):
        return float(fmt.get("filesize") or fmt.get("filesize_approx"))
    return float(fmt.get("tbr") or 0) * 125 * duration  # kbit/s -> bytes


def _would_download(info: dict[str, Any], quality: str, container: str) -> list[dict[str, Any]]:
    """The formats a download with these choices would fetch, picked by yt-dlp itself with the
    download's own settings, so the sizes shown are the sizes saved."""
    opts = build_options({"quality": quality, "container": container}, ".", "flat", False)
    copy = {**info, "formats": [dict(f) for f in info.get("formats") or []]}
    with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "format_sort": opts.get("format_sort") or []}) as ydl:
        ydl.sort_formats(copy)
        picked = ydl._select_formats(copy["formats"], ydl.build_format_selector(opts["format"]))
    if not picked:
        return []
    return picked[0].get("requested_formats") or [picked[0]]


def quality_choices(info: dict[str, Any]) -> list[dict[str, Any]]:
    """The qualities a video has, each with the size of what would download: `sizes` per file
    type (MP4 prefers H.264, MKV takes the best), and `size` for MP4."""
    duration = float(info.get("duration") or 0)
    formats = info.get("formats") or []
    video = [f for f in formats if f.get("vcodec") not in (None, "none") and f.get("height")]
    has_audio = any(f.get("acodec") not in (None, "none") for f in formats)

    def choice(q: str, label: str) -> dict[str, Any] | None:
        sizes, height = {}, 0
        for container in CONTAINERS:
            picked = _would_download(info, q, container)
            if not picked:
                return None
            sizes[container] = round(sum(_size(f, duration) for f in picked))
            height = height or max((int(f.get("height") or 0) for f in picked), default=0)
            if q == "audio":
                sizes = dict.fromkeys(CONTAINERS, sizes[container])
                break
        return {"id": q, "label": label.format(height=height), "size": sizes["mp4"], "sizes": sizes}

    choices = []
    if video:
        # "Best" first, so a video that only has low qualities (240p, 360p) still offers its picture.
        choices.append(choice("best", "Best available ({height}p)"))
    for q in ("2160", "1440", "1080", "720", "480"):
        height = int(q)
        # A 1080p choice also covers 1088 or 1050-high encodes; never round a 720p up to 1080p.
        if any(height * 0.9 <= f["height"] <= height * 1.1 for f in video):
            choices.append(choice(q, QUALITY_LABELS[q]))
    if has_audio:
        choices.append(choice("audio", QUALITY_LABELS["audio"]))
    return [c for c in choices if c]


def subtitle_choices(info: dict[str, Any], wanted: list[str]) -> list[dict[str, Any]]:
    """Subtitles worth offering: every language the uploader added, plus YouTube's automatic
    captions in the video's own language and in the user's languages."""
    choices: dict[str, dict[str, Any]] = {}
    for code, tracks in (info.get("subtitles") or {}).items():
        if code == "live_chat":
            continue
        lang = code.split("-")[0]
        choices.setdefault(lang, {"lang": lang, "name": (tracks[0].get("name") if tracks else "") or code, "auto": False})
    auto = info.get("automatic_captions") or {}
    original = next((c[:-5] for c in auto if c.endswith("-orig")), "")
    for lang in dict.fromkeys([original, *wanted]):
        if lang and lang in auto and lang not in choices:
            tracks = auto[lang]
            name = (tracks[0].get("name") if tracks else "") or lang
            choices[lang] = {"lang": lang, "name": re.sub(r"\s*\(.*\)$", "", name), "auto": True}
    return sorted(choices.values(), key=lambda c: (c["auto"], c["name"].casefold()))


def describe(info: dict[str, Any], wanted_subs: list[str], saved: bool) -> dict[str, Any]:
    """What the "Video ready" screen shows for one video."""
    duration = float(info.get("duration") or 0)
    return {
        "kind": "video",
        "id": info["id"],
        "title": info.get("title") or "",
        "channel": info.get("channel") or info.get("uploader") or "",
        "duration": duration,
        "thumbnail": info.get("thumbnail") or "",
        "chapters": [{"start": float(c.get("start_time") or 0), "title": c.get("title") or ""} for c in info.get("chapters") or []],
        "qualities": quality_choices(info),
        "subtitles": subtitle_choices(info, wanted_subs),
        "saved": saved,
    }


def _full_details(url: str) -> dict[str, Any]:
    with yt_dlp.YoutubeDL({**youtube._base_opts(), "skip_download": True, "noplaylist": True}) as ydl:
        return ydl.sanitize_info(ydl.extract_info(url, download=False))


async def details(url: str, wanted_subs: list[str], saved_ids: set[str]) -> dict[str, Any]:
    """Details of a video, or a summary of a playlist or channel, for the "Video ready" screen."""
    kind = youtube.link_kind(url)
    if kind == "video":
        info = await asyncio.to_thread(_full_details, url)
        remember(info)
        return describe(info, wanted_subs, info["id"] in saved_ids)
    listed = await youtube.list_videos(url)
    entries = listed["entries"]
    return {
        "kind": "playlist",
        "title": listed["title"],
        "count": len(entries),
        "saved_count": sum(1 for e in entries if e["id"] in saved_ids),
        "duration": sum(e["duration"] for e in entries),
        "entries": [{"id": e["id"], "title": e["title"], "duration": e["duration"]} for e in entries[:200]],
    }


# --- Download options ---------------------------------------------------------------

def output_template(layout: str, playlist: bool) -> str:
    """Where a video goes under the video folder. A course or playlist gets its own folder
    with numbered files, so its videos stay in order."""
    name = "%(title)s.%(ext)s"
    if playlist:
        name = "%(playlist_title,playlist|Playlist)s/%(playlist_index)02d - %(title)s.%(ext)s"
    if layout == "channel":
        return "%(channel,uploader|Unknown channel)s/" + name
    return name


def subtitle_patterns(langs: list[str]) -> list[str]:
    """yt-dlp language patterns: "en" with any suffix ("en-GB", "en-orig"). Only one track per
    language is left to match by then (see one_track_per_language)."""
    return [rf"^{re.escape(lang)}(-[\w-]+)?$" for lang in langs if re.fullmatch(r"[A-Za-z]{2,3}", lang)]


def one_track_per_language(manual: dict[str, Any], auto: dict[str, Any], langs: list[str]) -> tuple[dict, dict]:
    """(manual, automatic) subtitles with one track left per wanted language.

    The uploader's own track wins ("en" itself, else a regional one like "en-GB"); YouTube's
    automatic captions are used only without one ("en", else the original "en-orig"). Machine
    translations ("en-de") and the other variants are dropped, so a video never gets three
    English tracks.
    """
    manual, auto = dict(manual), dict(auto)
    for lang in langs:
        def matching(tracks: dict[str, Any]) -> list[str]:
            return [c for c in tracks if c == lang or c.startswith(lang + "-")]

        mine, machine = matching(manual), matching(auto)
        if mine:
            keep, source = (lang if lang in mine else mine[0]), manual
        elif machine:
            keep = next((c for c in (lang, lang + "-orig") if c in machine), machine[0])
            source = auto
        else:
            continue
        for tracks, codes in ((manual, mine), (auto, machine)):
            for code in codes:
                if not (tracks is source and code == keep):
                    tracks.pop(code)
    return manual, auto


class _OneTrackPerLanguage(PostProcessor):
    """Trims the subtitles yt-dlp chose for a video to one per language (see one_track_per_language)."""

    def __init__(self, langs: list[str]):
        super().__init__()
        self.langs = langs

    def run(self, info: dict[str, Any]) -> tuple[list[str], dict[str, Any]]:
        manual = info.get("subtitles") or {}
        requested = info.get("requested_subtitles")
        if requested:
            # yt-dlp has already chosen by now: trim its choice the same way.
            mine = {c: t for c, t in requested.items() if c in manual}
            machine = {c: t for c, t in requested.items() if c not in manual}
            kept_mine, kept_machine = one_track_per_language(mine, machine, self.langs)
            info["requested_subtitles"] = {**kept_mine, **kept_machine}
        return [], info


def build_options(options: dict[str, Any], folder: str, layout: str, playlist: bool) -> dict[str, Any]:
    """yt-dlp options for one download. `options` holds this download's choices (see VideoOptions)."""
    quality, container = options["quality"], options["container"]
    opts: dict[str, Any] = {
        "paths": {"home": folder},
        "outtmpl": output_template(layout, playlist),
        "windowsfilenames": True,
        "trim_file_name": 120,
        "retries": 10,
        "fragment_retries": 10,
        "concurrent_fragment_downloads": 4,
        "noplaylist": not playlist,
        "ignoreerrors": "only_download" if playlist else False,  # one removed video doesn't stop a course
        "writethumbnail": True,  # kept for the library's cards; embedded only when asked
        "writedescription": bool(options.get("description")),
        "allow_playlist_files": False,  # the playlist's own cover and description aren't videos
    }
    postprocessors: list[dict[str, Any]] = [{"key": "FFmpegThumbnailsConvertor", "format": "jpg", "when": "before_dl"}]
    if quality == "audio":
        opts["format"] = "ba[ext=m4a]/ba/b"
        postprocessors.append({"key": "FFmpegExtractAudio", "preferredcodec": "m4a"})
    else:
        height = "" if quality == "best" else f":{quality}"
        opts["format"] = "bv*+ba/b"
        opts["merge_output_format"] = container
        # Highest picture up to the chosen height first; among equals, H.264 and AAC, which
        # play on every phone, TV and computer (MKV takes whatever is best).
        opts["format_sort"] = [f"res{height}", "vcodec:h264", "acodec:aac"] if container == "mp4" else [f"res{height}"]
        langs = subtitle_patterns(options.get("subtitles") or [])
        if langs:
            mode = options.get("subtitle_mode", "embed")
            opts.update(writesubtitles=True, writeautomaticsub=bool(options.get("auto_subtitles")),
                        subtitleslangs=langs, subtitlesformat="srt/vtt/best")
            postprocessors.append({"key": "FFmpegSubtitlesConvertor", "format": "srt", "when": "before_dl"})
            if mode in ("embed", "both"):
                postprocessors.append({"key": "FFmpegEmbedSubtitle", "already_have_subtitle": mode == "both"})
    # Chapters also go into sound-only M4A files: a lecture keeps its parts in any player.
    postprocessors.append({"key": "FFmpegMetadata", "add_chapters": bool(options.get("chapters")), "add_metadata": True})
    if options.get("thumbnail"):
        postprocessors.append({"key": "EmbedThumbnail", "already_have_thumbnail": True})
    opts["postprocessors"] = postprocessors
    return opts


# --- Downloading ------------------------------------------------------------------

def _format_eta(seconds: float | None) -> str:
    if not seconds:
        return ""
    seconds = int(seconds)
    if seconds < 60:
        return f"{seconds} s left"
    if seconds < 3600:
        return f"about {seconds // 60} min {seconds % 60:02d} s left" if seconds < 600 else f"about {round(seconds / 60)} min left"
    return f"about {seconds // 3600} h {seconds % 3600 // 60} min left"


def _mb(n: float) -> str:
    return f"{n / 1024 ** 3:.1f} GB" if n >= 1024 ** 3 else f"{n / 1024 ** 2:.0f} MB"


class _Tracker:
    """Turns yt-dlp's per-file progress into one figure and a sentence for the whole download."""

    def __init__(self, on_progress: Callable[[float, str], None], count: int,
                 on_started: Callable[[str, str], None] = lambda video_id, base: None):
        self.on_progress, self.count, self.on_started = on_progress, max(1, count), on_started
        self.index, self.part, self.parts = 0, 0, 1
        self.part_files: set[str] = set()
        # Each started video's file name without its extension: "Folder/Title".
        self.bases: set[str] = set()
        self.last_id = ""

    def hook(self, d: dict[str, Any]) -> None:
        info = d.get("info_dict") or {}
        if info.get("id") != self.last_id:
            self.last_id = info.get("id", "")
            self.index = int(info.get("playlist_index") or self.index + 1)
            # yt-dlp hands over each part's own details, not the list of parts. A part of a
            # picture-plus-sound download is named "Title.f<format>.ext"; the other part is the sound.
            filename = d.get("filename") or ""
            separate = bool(filename) and _base_name(filename, str(info.get("format_id") or "")) != _base_name(filename, "")
            self.part, self.parts = 0, 2 if separate else 1
            if filename:
                base = _base_name(filename, str(info.get("format_id") or ""))
                self.bases.add(base)
                self.on_started(self.last_id, base)
        for key in ("tmpfilename", "filename"):
            if d.get(key):
                self.part_files.add(d[key])
        if d.get("status") == "finished":
            self.part = min(self.parts, self.part + 1)
            return
        if d.get("status") != "downloading":
            return
        total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
        done = d.get("downloaded_bytes") or 0
        within = (self.part + (done / total if total else 0)) / self.parts
        overall = (self.index - 1 + within) / self.count
        bits = [f"{within * 100:.0f}%"]
        if total:
            # Picture and sound download one after the other; say which the sizes are for.
            what = ("picture ", "sound ")[min(self.part, 1)] if self.parts > 1 else ""
            bits.append(f"{what}{_mb(done)} of {_mb(total)}")
        if d.get("speed"):
            bits.append(f"{d['speed'] / 1024 ** 2:.1f} MB/s")
        if eta := _format_eta(d.get("eta")):
            bits.append(eta)
        prefix = f"Video {self.index} of {self.count} · " if self.count > 1 else ""
        self.on_progress(min(1.0, overall), prefix + " · ".join(bits))


def _base_name(filename: str, format_id: str) -> str:
    """"Folder/Title.f315.webm.part" -> "Folder/Title": the name the video and its extras share.
    A picture or sound downloaded separately carries a ".f<format>" tag that the merged file drops."""
    stem = os.path.splitext(filename[:-5] if filename.endswith(".part") else filename)[0]
    tag = f".f{format_id}"
    return stem[: -len(tag)] if format_id and stem.endswith(tag) else stem


def copy_thumbnail(base: str, video_id: str) -> str:
    """Copy the thumbnail written next to a video that is still downloading into Cadence's own
    folder, so the download shows its picture. The original stays for embedding."""
    for ext in THUMB_EXTS:
        if os.path.isfile(base + ext):
            os.makedirs(thumbs_dir(), exist_ok=True)
            shutil.copyfile(base + ext, thumb_path(video_id))
            return thumb_path(video_id)
    return ""


def remove_unfinished(bases: set[str], finished: set[str], since: float, root: str) -> None:
    """After a cancel: delete what this download wrote for videos that didn't finish (partial
    files, thumbnails, subtitles), and folders left empty. Older files are never touched."""
    done = {os.path.splitext(p)[0] for p in finished}
    for base in bases - done:
        for path in glob.glob(glob.escape(base) + ".*"):
            try:
                if os.path.isfile(path) and os.path.getmtime(path) >= since:
                    os.remove(path)
            except OSError:
                pass
        folder = os.path.dirname(base)
        while folder and os.path.normcase(os.path.abspath(folder)) != os.path.normcase(os.path.abspath(root)):
            try:
                os.rmdir(folder)  # only succeeds when empty
            except OSError:
                break
            folder = os.path.dirname(folder)


class _Problems:
    """yt-dlp's errors and warnings during a download, so it can say what went wrong instead
    of quietly saving fewer videos. Used as yt-dlp's logger."""

    def __init__(self) -> None:
        self.errors: list[str] = []
        self.missing_subtitles = 0

    def debug(self, msg: str) -> None:
        pass

    def info(self, msg: str) -> None:
        pass

    def warning(self, msg: str) -> None:
        if "Unable to download video subtitles" in msg:
            self.missing_subtitles += 1

    def error(self, msg: str) -> None:
        self.errors.append(msg)


class DownloadResult(dict):
    """{"saved": videos saved, "failed": error messages of videos that weren't,
    "missing_subtitles": subtitle downloads that failed (the videos were saved without them)}."""


def move_thumbnail(final_path: str, video_id: str) -> str:
    """Move the thumbnail written next to a video into Cadence's own folder (for the library)."""
    base = os.path.splitext(final_path)[0]
    for ext in THUMB_EXTS:
        if os.path.isfile(base + ext):
            os.makedirs(thumbs_dir(), exist_ok=True)
            shutil.move(base + ext, thumb_path(video_id))
            return thumb_path(video_id)
    return ""


def _subtitle_langs(info: dict[str, Any]) -> list[str]:
    return sorted({code.split("-")[0] for code in info.get("requested_subtitles") or {}})


async def download(
    url: str, options: dict[str, Any], folder: str, layout: str, *, playlist: bool, count: int,
    skip_ids: set[str], pause_s: float, rate_limit_mb: float,
    on_progress: Callable[[float, str], None], on_saved: Callable[[dict[str, Any]], None],
    stop: Callable[[], str], on_thumbnail: Callable[[str], None] = lambda path: None,
) -> DownloadResult:
    """Download a video or every video of a playlist. Returns what was saved and what failed
    (see DownloadResult). One video that fails, or subtitles YouTube won't give, never stop the
    rest; a single video that can't be downloaded at all raises its error.

    `stop()` returns "" to carry on, "pause" or "cancel". A pause keeps partial files so
    the download resumes; a cancel removes them. `on_saved` gets each finished video's
    record for the library. `on_thumbnail` gets each video's picture as its download starts.
    """
    os.makedirs(folder, exist_ok=True)
    started_at = time.time() - 2  # file times can be a little behind the clock

    def on_started(video_id: str, base: str) -> None:
        try:
            if thumb := copy_thumbnail(base, video_id):
                on_thumbnail(thumb)
        except OSError:
            pass  # the picture is a nicety; the download carries on

    tracker = _Tracker(on_progress, count, on_started)
    saved = 0
    finishing: dict[str, Any] = {}

    def progress_hook(d: dict[str, Any]) -> None:
        if stop():
            raise DownloadCancelled(stop())
        tracker.hook(d)

    def pp_hook(d: dict[str, Any]) -> None:
        nonlocal saved
        if stop():
            raise DownloadCancelled(stop())
        info = d.get("info_dict") or {}
        if d.get("status") == "started" and d.get("postprocessor") in ("Merger", "EmbedSubtitle", "Metadata", "EmbedThumbnail"):
            on_progress(min(1.0, tracker.index / tracker.count), "Finishing: putting picture, sound, subtitles and chapters together")
        if d.get("status") == "finished" and d.get("postprocessor") == "MoveFiles" and info.get("filepath"):
            path = info["filepath"]
            if path in finishing:
                return
            finishing[path] = True
            saved += 1
            on_saved({
                "path": path,
                "video_id": info.get("id", ""),
                "title": info.get("title") or os.path.splitext(os.path.basename(path))[0],
                "channel": info.get("channel") or info.get("uploader") or "",
                "playlist": (info.get("playlist_title") or info.get("playlist") or "") if playlist else "",
                "playlist_index": int(info.get("playlist_index") or 0) if playlist else 0,
                "duration": float(info.get("duration") or 0),
                "height": 0 if options["quality"] == "audio" else int(info.get("height") or 0),
                "ext": os.path.splitext(path)[1].lstrip(".").lower(),
                "size": os.path.getsize(path) if os.path.isfile(path) else 0,
                "subtitles": _subtitle_langs(info),
                "thumbnail": move_thumbnail(path, info.get("id", "")),
            })

    def skip_saved(info: dict[str, Any], *, incomplete: bool) -> str | None:
        return "already saved" if info.get("id") in skip_ids else None

    problems = _Problems()
    opts = {
        **youtube._base_opts(),
        **build_options(options, folder, layout, playlist),
        "progress_hooks": [progress_hook],
        "postprocessor_hooks": [pp_hook],
        # Carry on past a failure (and save a video whose subtitles fail); the problems are
        # collected and reported. Warnings must be on for subtitle failures to reach the logger.
        "ignoreerrors": True,
        "no_warnings": False,
        "logger": problems,
    }
    if playlist:
        opts["match_filter"] = skip_saved
        if pause_s > 0:
            opts.update(sleep_interval=pause_s, max_sleep_interval=pause_s * 2,
                        sleep_interval_subtitles=min(pause_s, 3))
    if rate_limit_mb > 0:
        opts["ratelimit"] = int(rate_limit_mb * 1024 * 1024)

    def run() -> None:
        with yt_dlp.YoutubeDL(opts) as ydl:
            if opts.get("writesubtitles"):
                ydl.add_post_processor(_OneTrackPerLanguage(options.get("subtitles") or []), when="pre_process")
            ydl.download([youtube._list_url(url) if playlist else url])

    try:
        await asyncio.to_thread(run)
    except DownloadCancelled as e:
        reason = stop()
        if reason != "pause":
            for part in tracker.part_files:
                for leftover in (part, part + ".part", part + ".ytdl"):
                    if os.path.isfile(leftover) and leftover not in finishing:
                        try:
                            os.remove(leftover)
                        except OSError:
                            pass
            remove_unfinished(tracker.bases, set(finishing), started_at, folder)
            raise youtube.Cancelled() from e
        raise Paused() from e
    if not playlist and not saved and problems.errors:
        raise yt_dlp.utils.DownloadError(problems.errors[-1])
    return DownloadResult(saved=saved, failed=problems.errors, missing_subtitles=problems.missing_subtitles)

