"""Name songs by their sound: Chromaprint fingerprint -> AcoustID / MusicBrainz lookup.

Opt-in (Settings), and needs a free AcoustID application key. Only the audio
fingerprint and duration are sent, never the audio itself.
"""

import asyncio
import json
import os
import re
import shutil
import subprocess
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable

from core.ffmpeg_utils import get_ffmpeg_path
from core.platform_paths import bundled_tool

LOOKUP_URL = "https://api.acoustid.org/v2/lookup"
MIN_SCORE = 0.7
FINGERPRINT_SECONDS = 120
_REQUEST_GAP = 0.35  # AcoustID allows 3 requests per second
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
_GENERIC_TITLE = re.compile(r"^(track|song|untitled( song)?)\s*\d*$", re.IGNORECASE)


class IdentifyError(Exception):
    """A problem the user can fix (missing key, missing fpcalc, rejected key)."""


def find_fpcalc() -> str | None:
    env_path = os.environ.get("FPCALC_PATH")
    if env_path and Path(env_path).is_file():
        return env_path
    bundled = bundled_tool("chromaprint", "fpcalc")
    if bundled.is_file():
        return str(bundled)
    return shutil.which("fpcalc")


def needs_name(track: dict[str, Any]) -> bool:
    """True for placeholder titles like "Track 3" that identification may replace."""
    return not track.get("title") or bool(_GENERIC_TITLE.match(track["title"].strip()))


def fingerprint(path: str, start: float, end: float) -> tuple[int, str]:
    """Chromaprint fingerprint of the first two minutes of one song. Blocking."""
    fpcalc = find_fpcalc()
    if not fpcalc:
        raise IdentifyError("The fingerprint tool (fpcalc) is missing. Run `npm run setup:chromaprint`.")
    length = max(1.0, min(FINGERPRINT_SECONDS, end - start))
    fd, wav = tempfile.mkstemp(suffix=".wav", prefix="cadence-fp-")
    os.close(fd)
    try:
        subprocess.run(
            [get_ffmpeg_path(), "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{start:.3f}", "-t", f"{length:.3f}",
             "-i", path, "-vn", "-ac", "2", "-ar", "44100", wav],
            check=True, capture_output=True, creationflags=_NO_WINDOW,
        )
        out = subprocess.run([fpcalc, "-json", wav], check=True, capture_output=True, creationflags=_NO_WINDOW)
        data = json.loads(out.stdout)
        return int(round(end - start)), data["fingerprint"]
    finally:
        try:
            os.remove(wav)
        except OSError:
            pass


def parse_lookup(data: dict[str, Any], min_score: float = MIN_SCORE) -> dict[str, Any] | None:
    """Best match from an AcoustID response: {title, artist, album, score} or None."""
    if data.get("status") != "ok":
        message = (data.get("error") or {}).get("message", "AcoustID lookup failed")
        if "invalid API key" in message or "key" in message.lower():
            raise IdentifyError("AcoustID rejected the API key. Check it in Settings.")
        raise IdentifyError(message)
    best = None
    for result in data.get("results") or []:
        score = float(result.get("score") or 0)
        if score < min_score:
            continue
        for recording in result.get("recordings") or []:
            title = (recording.get("title") or "").strip()
            if not title:
                continue
            artists = recording.get("artists") or []
            artist = "".join(f"{a.get('name', '')}{a.get('joinphrase', '')}" for a in artists).strip()
            groups = recording.get("releasegroups") or []
            # Prefer an album over a single or compilation for the album name.
            group = next((g for g in groups if g.get("type") == "Album" and not g.get("secondarytypes")), groups[0] if groups else None)
            candidate = {
                "title": title,
                "artist": artist,
                "album": (group or {}).get("title", ""),
                "score": round(score, 2),
            }
            if best is None or candidate["score"] > best["score"]:
                best = candidate
            break  # recordings in one result are the same song; the first is enough
    return best


def lookup(api_key: str, duration: int, fp: str) -> dict[str, Any] | None:
    """Ask AcoustID who this is. Blocking."""
    body = urllib.parse.urlencode({
        "client": api_key, "duration": duration, "fingerprint": fp,
        "meta": "recordings releasegroups compress", "format": "json",
    }).encode()
    request = urllib.request.Request(LOOKUP_URL, data=body, headers={"User-Agent": "Cadence/2.0"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            data = json.loads(response.read())
    except urllib.error.HTTPError as e:
        try:
            data = json.loads(e.read())
        except ValueError:
            raise IdentifyError(f"AcoustID returned HTTP {e.code}") from e
    except urllib.error.URLError as e:
        raise IdentifyError("Couldn't reach AcoustID. Check your internet connection.") from e
    return parse_lookup(data)


async def identify_tracks(
    tracks: list[dict[str, Any]],
    sources: dict[str, dict[str, Any]],
    api_key: str,
    only_unnamed: bool = True,
    on_progress: Callable[[int, int], Any] | None = None,
) -> int:
    """Fill in title/artist for tracks AcoustID recognises, in place. Returns how many were named."""
    if not api_key:
        raise IdentifyError("Add your AcoustID API key in Settings to identify songs.")
    targets = [t for t in tracks if t.get("include", True) and (not only_unnamed or needs_name(t))]
    named = 0
    for i, track in enumerate(targets):
        source = sources.get(track["source_id"]) or {}
        if not source.get("path") or not os.path.isfile(source["path"]):
            continue
        if on_progress:
            await on_progress(i, len(targets))
        duration, fp = await asyncio.to_thread(fingerprint, source["path"], track["start"], track["end"])
        match = await asyncio.to_thread(lookup, api_key, duration, fp)
        if match:
            track["title"] = match["title"]
            if match["artist"]:
                track["artist"] = match["artist"]
            track["match"] = {"source": "acoustid", "score": match["score"], "album": match["album"]}
            named += 1
        await asyncio.sleep(_REQUEST_GAP)
    return named
