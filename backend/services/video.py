"""Whole-video downloads: picture, sound, subtitles and chapters of a YouTube video or course.

The details read for the "Video ready" screen are kept for a while so the download shows
the right title at once. The download itself reads the video again: YouTube ties its stream
links to the session that read them, and refuses (HTTP 403) a download that reuses them.
Videos in a playlist are downloaded one after another with a short pause between them,
which keeps YouTube from asking to confirm you're not a bot.
"""

import asyncio
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


def quality_choices(formats: list[dict[str, Any]], duration: float) -> list[dict[str, Any]]:
    """The qualities a video has, each with an estimated file size (best picture + best sound)."""
    audio = [f for f in formats if f.get("vcodec") == "none" and f.get("acodec") not in (None, "none")]
    best_audio = max(audio, key=lambda f: (f.get("ext") == "m4a", f.get("abr") or 0), default=None)
    audio_bytes = _size(best_audio, duration) if best_audio else 0.0
    video = [f for f in formats if f.get("vcodec") not in (None, "none") and f.get("height")]
    choices = []
    if video:
        # "Best" first, so a video that only has low qualities (240p, 360p) still offers its picture.
        top = max(video, key=lambda f: (f["height"], str(f.get("vcodec", "")).startswith("avc1"), f.get("tbr") or 0))
        extra = audio_bytes if top.get("acodec") in (None, "none") else 0
        choices.append({"id": "best", "label": f"Best available ({top['height']}p)", "size": round(_size(top, duration) + extra)})
    for q in ("2160", "1440", "1080", "720", "480"):
        height = int(q)
        # A 1080p choice also covers 1088 or 1050-high encodes; never round a 720p up to 1080p.
        at = [f for f in video if height * 0.9 <= f["height"] <= height * 1.1]
        if not at:
            continue
        # The format the download would pick: H.264 when there is one at this height (plays everywhere).
        pick = max(at, key=lambda f: (str(f.get("vcodec", "")).startswith("avc1"), f.get("tbr") or 0))
        separate = pick.get("acodec") in (None, "none")
        choices.append({"id": q, "label": QUALITY_LABELS[q], "size": round(_size(pick, duration) + (audio_bytes if separate else 0))})
    if best_audio:
        choices.append({"id": "audio", "label": QUALITY_LABELS["audio"], "size": round(audio_bytes)})
    return choices


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
        "qualities": quality_choices(info.get("formats") or [], duration),
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
    postprocessors.append({"key": "FFmpegMetadata", "add_chapters": bool(options.get("chapters")) and quality != "audio",
                           "add_metadata": True})
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

    def __init__(self, on_progress: Callable[[float, str], None], count: int):
        self.on_progress, self.count = on_progress, max(1, count)
        self.index, self.part, self.parts = 0, 0, 1
        self.part_files: set[str] = set()
        self.last_id = ""

    def hook(self, d: dict[str, Any]) -> None:
        info = d.get("info_dict") or {}
        if info.get("id") != self.last_id:
            self.last_id = info.get("id", "")
            self.index = int(info.get("playlist_index") or self.index + 1)
            self.part, self.parts = 0, max(1, len(info.get("requested_formats") or []) or 1)
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
            bits.append(f"{_mb(done)} of {_mb(total)}")
        if d.get("speed"):
            bits.append(f"{d['speed'] / 1024 ** 2:.1f} MB/s")
        if eta := _format_eta(d.get("eta")):
            bits.append(eta)
        prefix = f"Video {self.index} of {self.count} · " if self.count > 1 else ""
        self.on_progress(min(1.0, overall), prefix + " · ".join(bits))


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
    stop: Callable[[], str],
) -> int:
    """Download a video or every video of a playlist. Returns how many videos were saved.

    `stop()` returns "" to carry on, "pause" or "cancel". A pause keeps partial files so
    the download resumes; a cancel removes them. `on_saved` gets each finished video's
    record for the library.
    """
    os.makedirs(folder, exist_ok=True)
    tracker = _Tracker(on_progress, count)
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

    opts = {
        **youtube._base_opts(),
        **build_options(options, folder, layout, playlist),
        "progress_hooks": [progress_hook],
        "postprocessor_hooks": [pp_hook],
    }
    if playlist:
        opts["match_filter"] = skip_saved
        if pause_s > 0:
            opts.update(sleep_interval=pause_s, max_sleep_interval=pause_s * 2)
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
            raise youtube.Cancelled() from e
        raise Paused() from e
    return saved

