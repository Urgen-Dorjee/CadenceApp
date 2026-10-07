"""Cut songs out of the source audio, encode them and write tags and cover art."""

import asyncio
import base64
import os
import subprocess
from typing import Any

from core.ffmpeg_utils import get_ffmpeg_path, get_ffprobe_path
from services import loudness

_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


# "Original" format: the source's own audio, copied without re-encoding, in the
# usual file type for that codec: (file extension, FFmpeg muxer).
ORIGINAL_CONTAINERS = {
    "opus": ("opus", "ogg"),
    "aac": ("m4a", "mp4"),
    "alac": ("m4a", "mp4"),
    "mp3": ("mp3", "mp3"),
    "flac": ("flac", "flac"),
    "vorbis": ("ogg", "ogg"),
}


def source_codec(src: str) -> str:
    """Codec of the first audio stream, e.g. "opus". Blocking."""
    proc = subprocess.run(
        [get_ffprobe_path(), "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name",
         "-of", "csv=p=0", src],
        capture_output=True, text=True, creationflags=_NO_WINDOW,
    )
    return proc.stdout.strip().lower()


def original_format(src: str) -> tuple[str, str | None]:
    """(extension, muxer) to save `src`'s audio as it is. Codecs no common file type can hold
    as they are (WMA, PCM, AC-3...) are saved as FLAC instead, which is lossless too: muxer None
    means "encode to FLAC". Blocking."""
    return ORIGINAL_CONTAINERS.get(source_codec(src), ("flac", None))


def build_copy_command(src: str, start: float, end: float, dest: str, muxer: str) -> list[str]:
    """Copy one song's audio packets without decoding. Cuts land on a packet edge (about 20-26 ms).

    The start goes after -i: with stream copy, seeking before -i can land well before the
    start in files without a seek index (keeping the previous song's end), and Ogg then
    gets negative timestamps that players can't play. Reading from the beginning and
    dropping packets is exact and still quick, because nothing is decoded.
    """
    return [
        get_ffmpeg_path(), "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-i", src, "-ss", f"{start:.3f}", "-t", f"{max(0.0, end - start):.3f}",
        "-map", "0:a:0", "-vn", "-map_metadata", "-1", "-c:a", "copy",
        "-avoid_negative_ts", "make_zero", "-f", muxer, dest,
    ]


def codec_args(fmt: str, bitrate: int) -> list[str]:
    if fmt == "flac":
        return ["-c:a", "flac", "-compression_level", "8"]
    if fmt == "m4a":
        return ["-c:a", "aac", "-b:a", f"{min(bitrate, 320)}k", "-movflags", "+faststart"]
    if fmt == "opus":
        return ["-c:a", "libopus", "-b:a", f"{min(bitrate, 256)}k"]
    return ["-c:a", "libmp3lame", "-b:a", f"{bitrate}k", "-id3v2_version", "3"]


def build_cut_command(
    src: str, start: float, end: float, dest: str, fmt: str, bitrate: int, fade_ms: int,
    gain_db: float = 0.0, fade_in_s: float = 0.0, fade_out_s: float = 0.0,
) -> list[str]:
    """FFmpeg command for one song.

    `-ss` before `-i` seeks quickly, and because the audio is decoded and
    re-encoded the cut is still sample-accurate. A short fade at both edges
    removes the click a hard cut would leave; `fade_in_s`/`fade_out_s` make
    longer, audible fades. `gain_db` is one fixed volume change for the song.
    """
    duration = max(0.0, end - start)
    fade_in = min(max(fade_ms / 1000.0, fade_in_s), duration / 4)
    fade_out = min(max(fade_ms / 1000.0, fade_out_s), duration / 4)
    filters = []
    if abs(gain_db) >= 0.01:
        filters.append(f"volume={gain_db:.2f}dB")
    if fade_in > 0:
        filters.append(f"afade=t=in:st=0:d={fade_in:.3f}")
    if fade_out > 0:
        filters.append(f"afade=t=out:st={max(0.0, duration - fade_out):.3f}:d={fade_out:.3f}")
    cmd = [
        get_ffmpeg_path(), "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
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


async def cut_track(
    src: str, start: float, end: float, dest: str, fmt: str, bitrate: int, fade_ms: int,
    gain_db: float = 0.0, fade_in_s: float = 0.0, fade_out_s: float = 0.0, copy_muxer: str | None = None,
) -> None:
    """Cut and encode one song; with `copy_muxer`, copy the audio as it is instead (no fades or gain)."""
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    if copy_muxer:
        cmd = build_copy_command(src, start, end, tmp, copy_muxer)
    else:
        cmd = build_cut_command(src, start, end, tmp, fmt, bitrate, fade_ms, gain_db, fade_in_s, fade_out_s)
    # A song never takes this long; if FFmpeg stalls, fail the save instead of hanging forever.
    limit = max(300.0, 2 * (end - start))
    try:
        proc = await asyncio.to_thread(
            subprocess.run, cmd, capture_output=True, stdin=subprocess.DEVNULL, creationflags=_NO_WINDOW, timeout=limit,
        )
    except subprocess.TimeoutExpired as e:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise RuntimeError(f"FFmpeg stopped responding while saving a song (gave up after {limit:.0f} s).") from e
    if proc.returncode != 0:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise RuntimeError(f"FFmpeg could not cut the song: {proc.stderr.decode('utf-8', errors='replace').strip()[-400:]}")
    os.replace(tmp, dest)


def _replaygain_text(rg: dict[str, Any]) -> dict[str, str]:
    """ReplayGain tag values as text, keyed by lower-case tag name."""
    text = {
        "replaygain_track_gain": f"{rg['track_gain']:+.2f} dB",
        "replaygain_track_peak": f"{rg['track_peak']:.6f}",
    }
    if "album_gain" in rg:
        text["replaygain_album_gain"] = f"{rg['album_gain']:+.2f} dB"
        text["replaygain_album_peak"] = f"{rg['album_peak']:.6f}"
    return text


def write_tags(
    path: str, fmt: str, tags: dict[str, Any], cover_path: str | None, replaygain: dict[str, Any] | None = None
) -> None:
    """Write title/artist/album/track/year, cover art and ReplayGain values with mutagen."""
    rg_text = _replaygain_text(replaygain) if replaygain else {}
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
        if rg_text:
            from mutagen.id3 import TXXX

            for key, value in rg_text.items():
                id3.add(TXXX(encoding=3, desc=key.upper(), text=value))
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
        for key, value in rg_text.items():
            mp4[f"----:com.apple.iTunes:{key}"] = [value.encode("utf-8")]
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
    elif fmt == "ogg":
        from mutagen.oggvorbis import OggVorbis

        audio = OggVorbis(path)
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
    for key, value in rg_text.items():
        audio[key] = value
    if fmt == "opus" and replaygain:
        # Opus players read R128 gains (relative to -23 LUFS) rather than ReplayGain.
        audio["R128_TRACK_GAIN"] = loudness.opus_r128_gain(replaygain["track_lufs"])
        if "album_lufs" in replaygain:
            audio["R128_ALBUM_GAIN"] = loudness.opus_r128_gain(replaygain["album_lufs"])
    if picture is not None:
        if fmt == "flac":
            audio.add_picture(picture)
        else:  # Ogg (Opus, Vorbis) stores the picture as a base64 FLAC picture block
            audio["metadata_block_picture"] = [base64.b64encode(picture.write()).decode("ascii")]
    audio.save()
