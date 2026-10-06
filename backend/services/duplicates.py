"""Find songs of a split that are already in the library, so they needn't be saved twice.

A song matches when its title is the same once case, punctuation and upload noise
("Official Audio", "Lyrical", brackets...) are ignored. If both songs name a
singer they must share one, and if both lengths are known they must be within
DURATION_TOLERANCE_S: a different song that happens to share a title isn't flagged.
"""

import re
import unicodedata
from typing import Any

from services.library import same_file_key
from services.tracklist import clean_title

DURATION_TOLERANCE_S = 10.0
_NON_WORD = re.compile(r"[^\w]+", re.UNICODE)
_ARTIST_SPLIT = re.compile(r"\s*(?:,|&|/|;|\bfeat\.?|\bft\.?|\band\b|\bx\b)\s*", re.IGNORECASE)


def normalize(text: str) -> str:
    """"Tujhe Dekha To (Official Audio)!" -> "tujhe dekha to"."""
    text = unicodedata.normalize("NFKC", clean_title(text or "")).casefold()
    return " ".join(_NON_WORD.sub(" ", text).split())


def singers(text: str) -> set[str]:
    return {normalize(s) for s in _ARTIST_SPLIT.split(text or "") if normalize(s)}


def _same_song(track: dict[str, Any], song: dict[str, Any]) -> bool:
    if not normalize(track["title"]) or normalize(track["title"]) != normalize(song["title"]):
        return False
    ours, theirs = singers(track.get("artist", "")), singers(song.get("artist") or song.get("album_artist", ""))
    if ours and theirs and not ours & theirs:
        return False
    length = track["end"] - track["start"]
    return not (song.get("duration") and length > 0 and abs(song["duration"] - length) > DURATION_TOLERANCE_S)


def find(tracks: list[dict[str, Any]], songs: list[dict[str, Any]], exclude_paths: list[str] = ()) -> dict[str, list[dict[str, Any]]]:
    """{track id: [library songs it duplicates]} for included tracks with at least one match.

    `exclude_paths` are files this split saved itself, which don't count.
    """
    excluded = {same_file_key(p) for p in exclude_paths}
    by_title: dict[str, list[dict[str, Any]]] = {}
    for song in songs:
        if same_file_key(song["path"]) not in excluded:
            by_title.setdefault(normalize(song["title"]), []).append(song)
    found: dict[str, list[dict[str, Any]]] = {}
    for track in tracks:
        if not track.get("include", True):
            continue
        matches = [s for s in by_title.get(normalize(track["title"]), []) if _same_song(track, s)]
        if matches:
            found[track["id"]] = [{"path": s["path"], "title": s["title"], "artist": s["artist"], "album": s["album"]} for s in matches]
    return found
