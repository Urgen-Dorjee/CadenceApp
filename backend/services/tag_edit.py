"""Change the tags of songs that are already saved, from the Library.

Only the fields being changed are written; cover art, ReplayGain values and any
other tags are left as they are. mutagen's "easy" interface uses the same names
for MP3 (ID3), M4A (MP4 atoms) and FLAC/Opus (Vorbis comments).
"""

from typing import Any

EDITABLE = ("title", "artist", "album", "album_artist", "year", "track")
_EASY_KEY = {
    "title": "title", "artist": "artist", "album": "album",
    "album_artist": "albumartist", "year": "date", "track": "tracknumber",
}


class TagEditError(Exception):
    """The file couldn't be changed. The message is shown to the user."""


def update_tags(path: str, changes: dict[str, Any]) -> None:
    """Write `changes` (a subset of EDITABLE) to the file. An empty value removes that tag. Blocking."""
    import mutagen
    from mutagen.easyid3 import EasyID3

    try:
        audio = mutagen.File(path, easy=True)
    except Exception as e:  # noqa: BLE001
        raise TagEditError("This file couldn't be read.") from e
    if audio is None:
        raise TagEditError("Cadence can't edit the tags of this kind of file.")
    if audio.tags is None:
        audio.add_tags()
    for field, value in changes.items():
        key = _EASY_KEY[field]
        text = str(value).strip() if value is not None else ""
        if field == "track" and text:
            # Keep the album's track count: "3/12" stays "/12" after changing the number.
            total = str((audio.get(key) or [""])[0]).partition("/")[2]
            text = f"{text}/{total}" if total else text
        if text:
            audio[key] = [text]
        elif key in audio:
            del audio[key]
    try:
        if isinstance(audio.tags, EasyID3):
            audio.save(v2_version=3)  # what Cadence writes, and what Windows reads best
        else:
            audio.save()
    except PermissionError as e:
        raise TagEditError("The file is in use or read-only. Close any player using it and try again.") from e
    except Exception as e:  # noqa: BLE001
        raise TagEditError(f"Couldn't save the tags: {e}") from e
