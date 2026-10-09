"""Song credits from a video's description: the singer, song, film or album and year.

Music uploads usually list them as lines such as "Singer(s):- Kumar Sanu", "🎤 Singers: Kumar Sanu,
Alka Yagnik" or "Movie: Baazigar". The channel that uploaded a video is often a fan or a label, not the
singer, so it is only used when it is the artist's own channel ("Kumar Sanu - Topic").
"""

import re
from typing import Any

# "Singer(s):- X", "🎤 Singers : X", "Playback Singer - X", "Vocals: X". The separator is needed, so a
# table header such as "# Song Singer(s) Lyrics" is not read as a credit.
_LINE_RE = re.compile(
    r"^[^\w(]*(?P<key>[A-Za-z][A-Za-z ()]*?)\s*(?::\s*-|:|–|—|-|=)\s*(?P<value>\S.*)$"
)
_KEYS = {
    "singer": "singers", "singers": "singers", "singer(s)": "singers", "singer (s)": "singers",
    "playback singer": "singers", "playback singers": "singers", "playback singer(s)": "singers",
    "vocals": "singers", "vocal": "singers", "vocalist": "singers", "vocalists": "singers",
    "vocalist(s)": "singers", "sung by": "singers", "voice": "singers",
    "song": "song", "song name": "song", "song title": "song", "track": "song", "title": "song",
    "movie": "album", "film": "album", "movie name": "album", "film name": "album", "album": "album",
    "year": "year", "release year": "year", "released": "year", "release date": "year",
}
# "... sung by Vinod Rathod." or "sung by #KumarSanu": only when there is no credits line.
# Names are capitalised words, so the rest of the sentence isn't taken.
_SUNG_BY_RE = re.compile(r"\b(?i:sung\s+by)\s+#?([A-Z][\w.']*(?:\s+[A-Z][\w.']*){0,3})")
_SPLIT_RE = re.compile(r"\s*(?:,|&|/|;|\band\b|\bwith\b|\bft\.?|\bfeat\.?)\s*", re.IGNORECASE)
_YEAR_RE = re.compile(r"\b((?:19|20)\d{2})\b")
_MAX_VALUE = 120


def _clean(value: str) -> str:
    value = re.sub(r"https?://\S+", "", value)
    value = re.sub(r"\s{2,}", " ", value)
    return value.strip(" \t-–—:|,.;\"'“”")


def _camel_split(name: str) -> str:
    """"KumarSanu" (from a hashtag) to "Kumar Sanu"."""
    return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", name)


def split_names(value: str) -> list[str]:
    names: list[str] = []
    for part in _SPLIT_RE.split(value):
        name = _camel_split(_clean(part.lstrip("#")))
        if name and len(name) <= 60 and not any(c.isdigit() for c in name) and name.lower() not in (n.lower() for n in names):
            names.append(name)
    return names


def parse_credits(description: str) -> dict[str, Any]:
    """{"singers": [...], "song": str, "album": str, "year": str} from a description, empty when not found."""
    found: dict[str, Any] = {"singers": [], "song": "", "album": "", "year": ""}
    for raw in (description or "").splitlines():
        m = _LINE_RE.match(raw.strip())
        if not m:
            continue
        field = _KEYS.get(re.sub(r"\s+", " ", m.group("key").strip().lower()))
        value = _clean(m.group("value"))
        if not field or not value or len(value) > _MAX_VALUE:
            continue
        if field == "singers":
            if not found["singers"]:
                found["singers"] = split_names(value)
        elif field == "year":
            year = _YEAR_RE.search(value)
            if year and not found["year"]:
                found["year"] = year.group(1)
        elif not found[field]:
            if field == "album":
                year = _YEAR_RE.search(value)
                if year and not found["year"]:
                    found["year"] = year.group(1)
                value = _clean(re.sub(r"[(\[]\s*(?:19|20)\d{2}\s*[)\]]", "", value))
            found[field] = value
    if not found["singers"]:
        m = _SUNG_BY_RE.search(description or "")
        if m:
            found["singers"] = split_names(m.group(1))[:1]
    return found


def artist_channel(uploader: str) -> str:
    """The singer, when the video comes from the artist's own channel ("Kumar Sanu - Topic",
    "ShreyaGhoshalVEVO"); "" for labels and fan channels, which aren't the singer."""
    name = (uploader or "").strip()
    if name.endswith(" - Topic"):
        return name[: -len(" - Topic")].strip()
    if name.endswith("VEVO") and len(name) > 4:
        return _camel_split(name[:-4]).strip()
    return ""


def singer_for(info: dict[str, Any]) -> str:
    """The best guess at a video's singer: YouTube's own song details, the description's credits,
    then the artist's own channel. "" when unknown, rather than the uploader's name."""
    artists = info.get("artists") or ([info["artist"]] if info.get("artist") else [])
    if artists:
        return ", ".join(artists)
    singers = parse_credits(info.get("description") or "")["singers"]
    if singers:
        return ", ".join(singers)
    return artist_channel(info.get("uploader") or info.get("channel") or "")
