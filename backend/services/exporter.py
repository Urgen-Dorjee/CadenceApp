"""Cut songs out of the source audio, encode them and write tags and cover art."""

import asyncio
import base64
import os
import subprocess
from typing import Any

from core.ffmpeg_utils import get_ffmpeg_path

_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def codec_args(fmt: str, bitrate: int) -> list[str]:
    if fmt == "flac":
        return ["-c:a", "flac", "-compression_level", "8"]
    if fmt == "m4a":
        return ["-c:a", "aac", "-b:a", f"{min(bitrate, 320)}k", "-movflags", "+faststart"]
    if fmt == "opus":
        return ["-c:a", "libopus", "-b:a", f"{min(bitrate, 256)}k"]
    return ["-c:a", "libmp3lame", "-b:a", f"{bitrate}k", "-id3v2_version", "3"]


def build_cut_command(
    src: str, start: float, end: float, dest: str, fmt: str, bitrate: int, fade_ms: int
) -> list[str]:
    """FFmpeg command for one song.

    `-ss` before `-i` seeks quickly, and because the audio is decoded and
    re-encoded the cut is still sample-accurate. A short fade at both edges
    removes the click a hard cut would leave.
    """
    duration = max(0.0, end - start)
    fade = min(fade_ms / 1000.0, duration / 4)
    filters = []
    if fade > 0:
        filters.append(f"afade=t=in:st=0:d={fade:.3f}")
        filters.append(f"afade=t=out:st={max(0.0, duration - fade):.3f}:d={fade:.3f}")
    cmd = [
        get_ffmpeg_path(), "-hide_banner", "-loglevel", "error", "-y",
        "-ss", f"{start:.3f}", "-i", src, "-t", f"{duration:.3f}",
        "-map", "0:a:0", "-vn", "-map_metadata", "-1",
    ]
    if filters:
        cmd += ["-af", ",".join(filters)]
    cmd += codec_args(fmt, bitrate)
    if fmt == "opus":
        cmd += ["-f", "ogg"]
    elif fmt == "m4a":
        cmd += ["-f", "mp4"]
    else:
        cmd += ["-f", fmt]
    cmd.append(dest)
    return cmd


async def cut_track(src: str, start: float, end: float, dest: str, fmt: str, bitrate: int, fade_ms: int) -> None:
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    cmd = build_cut_command(src, start, end, tmp, fmt, bitrate, fade_ms)
    proc = await asyncio.to_thread(subprocess.run, cmd, capture_output=True, creationflags=_NO_WINDOW)
    if proc.returncode != 0:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise RuntimeError(f"FFmpeg could not cut the song: {proc.stderr.decode('utf-8', errors='replace').strip()[-400:]}")
    os.replace(tmp, dest)


def write_tags(path: str, fmt: str, tags: dict[str, Any], cover_path: str | None) -> None:
    """Write title/artist/album/track/year and cover art with mutagen."""
    cover = None
    if cover_path and os.path.exists(cover_path):
        with open(cover_path, "rb") as f:
            cover = f.read()
    track_no = f"{tags['track']}/{tags['total']}"

    if fmt == "mp3":
        from mutagen.id3 import APIC, ID3, TALB, TDRC, TIT2, TPE1, TPE2, TRCK, ID3NoHeaderError

        try:
            id3 = ID3(path)
        except ID3NoHeaderError:
            id3 = ID3()
        id3.add(TIT2(encoding=3, text=tags["title"]))
        if tags.get("artist"):
            id3.add(TPE1(encoding=3, text=tags["artist"]))
        if tags.get("album_artist"):
            id3.add(TPE2(encoding=3, text=tags["album_artist"]))
        if tags.get("album"):
            id3.add(TALB(encoding=3, text=tags["album"]))
        if tags.get("year"):
            id3.add(TDRC(encoding=3, text=tags["year"]))
        id3.add(TRCK(encoding=3, text=track_no))
        if cover:
            id3.add(APIC(encoding=3, mime="image/jpeg", type=3, desc="Cover", data=cover))
        id3.save(path, v2_version=3)
        return

    if fmt == "m4a":
        from mutagen.mp4 import MP4, MP4Cover

        mp4 = MP4(path)
        mp4["\xa9nam"] = tags["title"]
        if tags.get("artist"):
            mp4["\xa9ART"] = tags["artist"]
        if tags.get("album_artist"):
            mp4["aART"] = tags["album_artist"]
        if tags.get("album"):
            mp4["\xa9alb"] = tags["album"]
        if tags.get("year"):
            mp4["\xa9day"] = tags["year"]
        mp4["trkn"] = [(tags["track"], tags["total"])]
        if cover:
            mp4["covr"] = [MP4Cover(cover, imageformat=MP4Cover.FORMAT_JPEG)]
        mp4.save()
        return

    from mutagen.flac import FLAC, Picture

    picture = None
    if cover:
        picture = Picture()
        picture.type = 3
        picture.mime = "image/jpeg"
        picture.data = cover

    if fmt == "flac":
        audio = FLAC(path)
    else:
        from mutagen.oggopus import OggOpus

        audio = OggOpus(path)
    audio["title"] = tags["title"]
    if tags.get("artist"):
        audio["artist"] = tags["artist"]
    if tags.get("album_artist"):
        audio["albumartist"] = tags["album_artist"]
    if tags.get("album"):
        audio["album"] = tags["album"]
    if tags.get("year"):
        audio["date"] = tags["year"]
    audio["tracknumber"] = str(tags["track"])
    audio["tracktotal"] = str(tags["total"])
    if picture is not None:
        if fmt == "flac":
            audio.add_picture(picture)
        else:
            audio["metadata_block_picture"] = [base64.b64encode(picture.write()).decode("ascii")]
    audio.save()
