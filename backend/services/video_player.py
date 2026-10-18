"""What the built-in video player needs from a downloaded video: its chapters, its subtitle
tracks (the .srt files saved next to it and those inside it) as WebVTT, and a stable key.

The video itself is streamed by the library router; the player is Chromium's <video>.
"""

import glob
import hashlib
import json
import os
import re
import subprocess
from typing import Any

from core.ffmpeg_utils import get_ffmpeg_path, get_ffprobe_path

_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

# ffprobe gives three-letter language codes; the interface names two-letter ones.
_LANG_2 = {
    "eng": "en", "hin": "hi", "spa": "es", "fra": "fr", "fre": "fr", "deu": "de", "ger": "de", "ita": "it",
    "por": "pt", "rus": "ru", "jpn": "ja", "kor": "ko", "zho": "zh", "chi": "zh", "ara": "ar", "ben": "bn",
    "urd": "ur", "tam": "ta", "tel": "te", "mar": "mr", "guj": "gu", "kan": "kn", "mal": "ml", "pan": "pa",
    "nep": "ne", "tur": "tr", "nld": "nl", "dut": "nl", "pol": "pl", "swe": "sv", "ukr": "uk", "vie": "vi",
    "tha": "th", "ind": "id", "fas": "fa", "per": "fa", "heb": "he", "ell": "el", "gre": "el", "bod": "bo", "tib": "bo",
}
# Subtitle formats FFmpeg can turn into WebVTT (pictures such as DVD subtitles can't be).
_TEXT_SUBTITLES = {"mov_text", "subrip", "srt", "webvtt", "ass", "ssa", "text"}
_SRT_TIME = re.compile(r"(\d{1,2}:\d{2}:\d{2}),(\d{3})")


def key_of(path: str) -> str:
    """A short, stable name for a video file, used in URLs instead of its path."""
    return hashlib.sha1(os.path.normcase(os.path.abspath(path)).encode("utf-8")).hexdigest()[:16]


def srt_to_vtt(srt: str) -> str:
    """WebVTT from SubRip: a header, and "00:00:01,200" times written "00:00:01.200"."""
    text = srt.lstrip("﻿").replace("\r\n", "\n").replace("\r", "\n")
    return "WEBVTT\n\n" + _SRT_TIME.sub(r"\1.\2", text).strip() + "\n"


def _sidecar_subtitles(path: str) -> list[dict[str, Any]]:
    """"Talk.en.srt" -> English; "Talk.srt" -> no language."""
    base = os.path.splitext(path)[0]
    found = []
    for file in sorted(glob.glob(glob.escape(base) + ".*srt")):
        middle = file[len(base):-len(".srt")].lstrip(".")
        if middle and not re.fullmatch(r"[A-Za-z]{2,3}(-[\w-]+)?", middle):
            continue  # another video whose name starts the same way
        found.append({"id": f"file-{middle or 'und'}", "lang": middle.split("-")[0].lower() if middle else "", "source": "file", "file": file})
    return found


def probe(path: str) -> dict[str, Any]:
    """{"duration", "chapters": [{start, end, title}], "subtitles": [{id, lang, source}]}. Blocking.

    Subtitles saved next to the video come first; a language inside the video is listed only
    when there is no file for it.
    """
    cmd = [get_ffprobe_path(), "-v", "error", "-print_format", "json", "-show_chapters", "-show_streams", "-show_format", path]
    out = subprocess.run(cmd, capture_output=True, creationflags=_NO_WINDOW, timeout=60)
    data = json.loads(out.stdout or b"{}")
    chapters = [
        {"start": float(c.get("start_time") or 0), "end": float(c.get("end_time") or 0), "title": (c.get("tags") or {}).get("title", "")}
        for c in data.get("chapters") or []
    ]
    subtitles = [{k: v for k, v in s.items() if k != "file"} for s in _sidecar_subtitles(path)]
    have = {s["lang"] for s in subtitles}
    for stream in data.get("streams") or []:
        if stream.get("codec_type") != "subtitle" or stream.get("codec_name") not in _TEXT_SUBTITLES:
            continue
        code = ((stream.get("tags") or {}).get("language") or "").lower()
        lang = _LANG_2.get(code, "" if code == "und" else code)
        if lang in have:
            continue
        have.add(lang)
        subtitles.append({"id": f"stream-{stream['index']}", "lang": lang, "source": "video"})
    return {"duration": float((data.get("format") or {}).get("duration") or 0), "chapters": chapters, "subtitles": subtitles}


def subtitle_vtt(path: str, track_id: str) -> str | None:
    """One subtitle track as WebVTT, or None if the video has no such track. Blocking."""
    if track_id.startswith("file-"):
        for track in _sidecar_subtitles(path):
            if track["id"] == track_id:
                with open(track["file"], encoding="utf-8", errors="replace") as f:
                    return srt_to_vtt(f.read())
        return None
    m = re.fullmatch(r"stream-(\d{1,3})", track_id)
    if not m:
        return None
    cmd = [get_ffmpeg_path(), "-v", "error", "-nostdin", "-i", path, "-map", f"0:{m.group(1)}", "-f", "webvtt", "-"]
    out = subprocess.run(cmd, capture_output=True, creationflags=_NO_WINDOW, timeout=120)
    if out.returncode != 0 or not out.stdout.startswith(b"WEBVTT"):
        return None
    return out.stdout.decode("utf-8", errors="replace")
