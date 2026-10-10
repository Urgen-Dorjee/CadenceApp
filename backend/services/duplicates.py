"""Find songs of a split that are already in the library, so they needn't be saved twice.

A song matches when its title is the same once case, punctuation and upload noise
("Official Audio", "Lyrical", brackets...) are ignored. If both songs name a
singer they must share one, and if both lengths are known they must be close
(different uploads of a song are trimmed differently, so allow DURATION_TOLERANCE_S
or DURATION_TOLERANCE_RATIO of the length, whichever is more): a different song that
happens to share a title, or a short edit, isn't flagged.

Titles saved as "3.Every Breath You Take - The Police" (a number, and the singer
after a dash) also match "Every Breath You Take".
"""

import re
import unicodedata
from typing import Any

from services.library import same_file_key
from services.tracklist import clean_title

DURATION_TOLERANCE_S = 30.0
DURATION_TOLERANCE_RATIO = 0.2
_LEADING_NUMBER = re.compile(r"^\s*\d{1,3}\s*[.)]\s*|^\s*\d{1,3}\s+[-–—]\s+")
_DASH = re.compile(r"\s+[-–—]\s+")
_NON_WORD = re.compile(r"[^\w]+", re.UNICODE)
_ARTIST_SPLIT = re.compile(r"\s*(?:,|&|/|;|\bfeat\.?|\bft\.?|\band\b|\bx\b)\s*", re.IGNORECASE)


def normalize(text: str) -> str:
    """"Tujhe Dekha To (Official Audio)!" -> "tujhe dekha to"."""
    text = unicodedata.normalize("NFKC", clean_title(text or "")).casefold()
    return " ".join(_NON_WORD.sub(" ", text).split())


def singers(text: str) -> set[str]:
    return {normalize(s) for s in _ARTIST_SPLIT.split(text or "") if normalize(s)}


def readings(title: str, artist: str) -> list[tuple[str, str]]:
    """Ways to read a saved name as (title, singer): as it is, and for "Title - Singer" or
    "Singer - Title" (with any leading "3." dropped) each half as the title."""
    title = _LEADING_NUMBER.sub("", title or "")
    found = [(title, artist)]
    halves = _DASH.split(title, maxsplit=1)
    if len(halves) == 2:
        found += [(halves[0], artist or halves[1]), (halves[1], artist or halves[0])]
    return [(t, a) for t, a in found if normalize(t)]


def _close_in_length(a: float, b: float) -> bool:
    if not a or not b or a <= 0 or b <= 0:
        return True
    return abs(a - b) <= max(DURATION_TOLERANCE_S, DURATION_TOLERANCE_RATIO * min(a, b))


def _same_song(track: dict[str, Any], song: dict[str, Any]) -> bool:
    if not _close_in_length(track["end"] - track["start"], song.get("duration") or 0):
        return False
    for title, artist in readings(track["title"], track.get("artist", "")):
        for their_title, their_artist in readings(song["title"], song.get("artist") or song.get("album_artist", "")):
            if normalize(title) != normalize(their_title):
                continue
            ours, theirs = singers(artist), singers(their_artist)
            if not (ours and theirs and not ours & theirs):
                return True
    return False


def find(tracks: list[dict[str, Any]], songs: list[dict[str, Any]], exclude_paths: list[str] = ()) -> dict[str, list[dict[str, Any]]]:
    """{track id: [library songs it duplicates]} for tracks with at least one match, skipped
    or not (the review screen shows why a song was skipped).

    `exclude_paths` are files this split saved itself, which don't count.
    """
    excluded = {same_file_key(p) for p in exclude_paths}
    by_title: dict[str, list[dict[str, Any]]] = {}
    for song in songs:
        if same_file_key(song["path"]) not in excluded:
            for title, _ in readings(song["title"], ""):
                bucket = by_title.setdefault(normalize(title), [])
                if song not in bucket:
                    bucket.append(song)
    found: dict[str, list[dict[str, Any]]] = {}
    for track in tracks:
        candidates: list[dict[str, Any]] = []
        for title, _ in readings(track["title"], ""):
            candidates += [s for s in by_title.get(normalize(title), []) if s not in candidates]
        matches = [s for s in candidates if _same_song(track, s)]
        if matches:
            found[track["id"]] = [{"path": s["path"], "title": s["title"], "artist": s["artist"], "album": s["album"]} for s in matches]
    return found
