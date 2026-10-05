"""Find song boundaries and collection details from YouTube metadata.

Everything here is pure (no network, no files) so it can be unit-tested with
plain strings. The order of trust is: chapters > description > comments.
"""

import re
import uuid
from typing import Any

CONFIDENCE = {
    "chapters": 0.95,
    "description": 0.9,
    "comment": 0.8,
    "playlist": 1.0,
    "single": 1.0,
}

_TS = r"(?<![\d:])(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?![\d:])"
_TS_RE = re.compile(_TS)
# Leading "1.", "01)", "#3", "Track 4 -" before a title
_TRACK_NO_RE = re.compile(r"^\s*(?:#|track\s*)?\d{1,3}\s*[.)\-:]\s+", re.IGNORECASE)
_EDGE_PUNCT = " \t-–—|:•·~>*[](){}\"'"

# Noise words that video titles attach to song names.
_NOISE_BRACKET_RE = re.compile(
    r"[\(\[](?:[^\)\]]*?\b(?:official|video|audio|lyric(?:al)?s?|full\s*song|hd|4k|1080p|720p|jukebox|visualizer|song)\b[^\)\]]*)[\)\]]",
    re.IGNORECASE,
)
_NOISE_SUFFIX_RE = re.compile(
    r"\s*[-|]\s*(?:official\s*(?:music\s*)?video|full\s*(?:video\s*)?song|lyrical(?:\s*video)?|audio\s*song|video\s*song)\s*$",
    re.IGNORECASE,
)


def new_track_id() -> str:
    return uuid.uuid4().hex[:8]


def parse_seconds(h: str | None, m: str, s: str) -> int:
    return int(h or 0) * 3600 + int(m) * 60 + int(s)


def format_ts(seconds: float) -> str:
    seconds = int(round(seconds))
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def clean_title(title: str) -> str:
    """Strip upload noise like "(Official Video)" and keep the song name."""
    t = _NOISE_BRACKET_RE.sub("", title)
    t = _NOISE_SUFFIX_RE.sub("", t)
    # Jukebox chapters often read "Song | Movie | Actors"; the first part is the song.
    if " | " in t:
        t = t.split(" | ")[0]
    t = re.sub(r"\s{2,}", " ", t)
    return t.strip(_EDGE_PUNCT) or title.strip()


def parse_timestamps(text: str, duration: float | None = None) -> list[tuple[float, str]]:
    """Parse a timestamped tracklist out of free text.

    Handles "00:00 Song", "Song - 3:45", "1. Song 1:02:03", "[04:12] Song" and
    ranges like "00:00 - 04:12 Song". Returns [] unless the timestamps look like
    a real tracklist: at least two entries, strictly increasing, inside the video.
    """
    entries: list[tuple[float, str]] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        matches = list(_TS_RE.finditer(line))
        if not matches or len(matches) > 2:
            continue
        start = parse_seconds(*matches[0].groups())
        title = _TS_RE.sub(" ", line)
        title = _TRACK_NO_RE.sub("", title.strip(_EDGE_PUNCT))
        title = re.sub(r"\s*[-–—|]\s*[-–—|]\s*", " - ", title)  # "a - - b" left by a removed range
        title = clean_title(title.strip(_EDGE_PUNCT))
        entries.append((float(start), title))

    if len(entries) < 2:
        return []
    starts = [s for s, _ in entries]
    if any(b <= a for a, b in zip(starts, starts[1:])):
        return []
    if duration and starts[-1] >= duration:
        return []
    # A tracklist starts near the beginning; scattered timestamps in prose do not.
    if duration and starts[0] > max(60.0, duration * 0.1):
        return []
    return entries


def _tracks_from_starts(
    entries: list[tuple[float, str]], duration: float, origin: str, source_id: str
) -> list[dict[str, Any]]:
    tracks = []
    for i, (start, title) in enumerate(entries):
        end = entries[i + 1][0] if i + 1 < len(entries) else duration
        tracks.append(
            make_track(
                title=title or f"Track {i + 1}",
                start=0.0 if i == 0 and start <= 15 else start,
                end=end,
                origin=origin,
                source_id=source_id,
            )
        )
    return tracks


def make_track(
    *,
    title: str,
    start: float,
    end: float,
    origin: str,
    source_id: str,
    confidence: float | None = None,
    artist: str = "",
) -> dict[str, Any]:
    return {
        "id": new_track_id(),
        "title": title,
        "artist": artist,
        "start": round(float(start), 3),
        "end": round(float(end), 3),
        "source_id": source_id,
        "origin": origin,
        "confidence": CONFIDENCE.get(origin, 0.5) if confidence is None else round(confidence, 2),
        "include": True,
    }


def tracks_from_chapters(chapters: list[dict[str, Any]] | None, duration: float, source_id: str) -> list[dict[str, Any]]:
    if not chapters or len(chapters) < 2:
        return []
    tracks = []
    for i, ch in enumerate(chapters):
        title = clean_title(str(ch.get("title") or "")) or f"Track {i + 1}"
        end = ch.get("end_time")
        if end is None:
            end = chapters[i + 1]["start_time"] if i + 1 < len(chapters) else duration
        tracks.append(
            make_track(title=title, start=float(ch.get("start_time") or 0), end=float(end), origin="chapters", source_id=source_id)
        )
    return tracks


SHORT_TRACK_SECONDS = 45.0


def flag_short_tracks(tracks: list[dict[str, Any]]) -> None:
    """Segments under 45 s are usually an intro or outro, not a song: ask the user."""
    for t in tracks:
        if t["origin"] not in ("playlist", "single", "manual") and t["end"] - t["start"] < SHORT_TRACK_SECONDS:
            t["confidence"] = min(t["confidence"], 0.5)


def tracks_from_metadata(info: dict[str, Any], source_id: str) -> list[dict[str, Any]]:
    """Best tracklist from chapters, description or top comments. [] if none found."""
    duration = float(info.get("duration") or 0)

    tracks = tracks_from_chapters(info.get("chapters"), duration, source_id)
    if tracks:
        return tracks

    entries = parse_timestamps(info.get("description") or "", duration)
    if entries:
        return _tracks_from_starts(entries, duration, "description", source_id)

    best: list[tuple[float, str]] = []
    for comment in info.get("comments") or []:
        found = parse_timestamps(comment.get("text") or "", duration)
        if len(found) > len(best):
            best = found
    if len(best) >= 3:
        return _tracks_from_starts(best, duration, "comment", source_id)
    return []


# --- Collection classification -------------------------------------------------

_GENERIC_WORDS = {
    "bollywood", "hindi", "punjabi", "tamil", "telugu", "nepali", "tibetan", "english", "indian",
    "romantic", "love", "sad", "party", "dance", "old", "new", "latest", "evergreen", "golden",
    "classic", "retro", "top", "best", "all", "time", "hit", "hits", "super", "superhit", "songs",
    "song", "the", "of", "and", "&", "90s", "80s", "70s", "2000s", "90's", "80's", "melody",
    "melodies", "unplugged", "lofi", "lo-fi", "mashup", "nonstop", "non-stop", "jukebox", "audio",
    "video", "full", "album", "collection", "special", "mix", "playlist", "devotional", "bhajan",
}

_ARTIST_PREFIX_RE = re.compile(
    r"\b(?:best\s+of|hits\s+of|songs\s+of|top\s+\d+\s+(?:songs\s+)?of|tribute\s+to|remembering)\s+(.+?)(?=\s*(?:[|\-–(\[]|songs\b|hits\b|jukebox\b|$))",
    re.IGNORECASE,
)
_ARTIST_SUFFIX_RE = re.compile(
    r"^(.+?)\s+(?:(?:top|best|all\s+time|romantic|sad|evergreen|superhit|super\s+hit|hit|greatest)\s+)*(?:super\s*hits?|hits|hit\s+songs|songs\s+collection|collection|special)\b",
    re.IGNORECASE,
)
_YEAR_RE = re.compile(r"[\(\[]\s*((?:19|20)\d{2})\s*[\)\]]")
_ALBUM_RE = re.compile(
    r"^(.+?)\s*(?:[-|:]\s*)?(?:(?:full|all|movie|film)\s+(?:movie\s+)?(?:songs|album)|(?:audio|video)?\s*jukebox|album|ost|soundtrack)\b",
    re.IGNORECASE,
)
_ALBUM_KEYWORD_RE = re.compile(
    r"\b(?:full\s+album|all\s+songs|movie\s+songs|film\s+songs|jukebox|ost|soundtrack)\b", re.IGNORECASE
)


def _strip_noise(text: str) -> str:
    text = re.sub(r"[\(\[][^\)\]]*[\)\]]", " ", text)
    text = re.sub(r"\s{2,}", " ", text)
    return text.strip(_EDGE_PUNCT)


def _is_generic(name: str) -> bool:
    words = [w for w in re.split(r"[\s,]+", name.lower()) if w]
    return not words or all(w in _GENERIC_WORDS or w.isdigit() for w in words)


def classify_collection(title: str, track_count: int, uploader: str = "") -> dict[str, Any]:
    """Guess whether a video is a singer collection, a movie album or a mixed collection.

    The guess is shown in the review screen, where the user can change it.
    """
    year_match = _YEAR_RE.search(title)
    year = year_match.group(1) if year_match else ""
    head = title.split("|")[0]

    if track_count <= 1:
        return {"type": "single", "name": clean_title(title), "artist": uploader, "album": "", "year": year, "confidence": 0.9}

    m = _ARTIST_PREFIX_RE.search(head) or _ARTIST_SUFFIX_RE.search(head)
    if m:
        candidate = _strip_noise(m.group(1))
        if candidate and not _is_generic(candidate):
            return {"type": "artist", "name": candidate, "artist": candidate, "album": "", "year": "", "confidence": 0.8}

    m = _ALBUM_RE.search(head)
    album_name = m.group(1) if m else None
    if album_name is None and _ALBUM_KEYWORD_RE.search(title):
        # "Movie (1995) | Full Album | Actors": the keyword sits after the first "|".
        album_name = head
    if album_name is not None:
        candidate = _strip_noise(_YEAR_RE.sub("", album_name))
        if candidate and not _is_generic(candidate):
            return {"type": "album", "name": candidate, "artist": "", "album": candidate, "year": year, "confidence": 0.75 if year else 0.6}

    name = _strip_noise(head) or title
    return {"type": "collection", "name": name, "artist": "", "album": name, "year": year, "confidence": 0.4}
