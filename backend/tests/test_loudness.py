import asyncio
import math
import subprocess

import pytest

from config import Preferences, save_preferences, settings
from core.db import get_store
from core.ffmpeg_utils import get_ffmpeg_path, get_ffprobe_path, is_ffmpeg_available
from services import exporter, loudness, pipeline
from services.tracklist import make_track

SUMMARY = """[Parsed_ebur128_0 @ 0x1] Summary:

  Integrated loudness:
    I:         -16.4 LUFS
    Threshold: -26.6 LUFS

  Loudness range:
    LRA:         6.3 LU

  Sample peak:
    Peak:       -0.9 dBFS

  True peak:
    Peak:        0.4 dBFS
"""


def test_parse_ebur128():
    m = loudness.parse_ebur128("noise\n" + SUMMARY)
    assert m == {"lufs": -16.4, "sample_peak_db": -0.9, "true_peak_db": 0.4}


def test_parse_ebur128_silence():
    text = SUMMARY.replace("-16.4 LUFS", "-70.0 LUFS").replace("-0.9 dBFS", "-inf dBFS").replace("0.4 dBFS", "-inf dBFS")
    m = loudness.parse_ebur128(text)
    assert m["lufs"] is None and m["true_peak_db"] == -math.inf


def test_normalize_gain_reaches_target_unless_peaks_would_clip():
    assert loudness.normalize_gain({"lufs": -20.0, "true_peak_db": -12.0}, -14.0) == 6.0
    # +6 dB would push the true peak to +1 dBTP, so the gain stops at -1 dBTP.
    assert loudness.normalize_gain({"lufs": -20.0, "true_peak_db": -5.0}, -14.0) == 4.0
    assert loudness.normalize_gain({"lufs": -8.0, "true_peak_db": -0.1}, -14.0) == -6.0
    assert loudness.normalize_gain({"lufs": None, "true_peak_db": -math.inf}, -14.0) == 0.0
    # Never more than +20 dB, however quiet the song.
    assert loudness.normalize_gain({"lufs": -50.0, "true_peak_db": -40.0}, -14.0) == 20.0


def test_album_loudness_is_energy_weighted():
    songs = [(100, {"lufs": -10.0}), (100, {"lufs": -20.0}), (50, {"lufs": None})]
    assert loudness.album_loudness(songs) == pytest.approx(10 * math.log10((10 ** -1 + 10 ** -2) / 2))
    assert loudness.album_loudness([(10, {"lufs": None})]) is None


def test_replaygain_values():
    rg = loudness.replaygain({"lufs": -12.0, "sample_peak_db": -6.0206}, -14.0, -0.0)
    assert rg["track_gain"] == -6.0 and rg["album_gain"] == -4.0
    assert rg["track_peak"] == pytest.approx(0.5, abs=1e-4) and rg["album_peak"] == pytest.approx(1.0)
    assert loudness.opus_r128_gain(-12.0) == str(-11 * 256)


def test_cut_command_applies_gain_and_song_fades():
    cmd = exporter.build_cut_command("in.webm", 10, 70, "out.mp3", "mp3", 320, 10, gain_db=-3.5, fade_in_s=2, fade_out_s=3)
    af = cmd[cmd.index("-af") + 1]
    assert af == "volume=-3.50dB,afade=t=in:st=0:d=2.000,afade=t=out:st=57.000:d=3.000"
    plain = exporter.build_cut_command("in.webm", 10, 70, "out.mp3", "mp3", 320, 10)
    assert "volume" not in plain[plain.index("-af") + 1]


# --- With the real FFmpeg -------------------------------------------------------------

needs_ffmpeg = pytest.mark.skipif(not is_ffmpeg_available(), reason="FFmpeg not installed")


def _duration(path: str) -> float:
    out = subprocess.run([get_ffprobe_path(), "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                         capture_output=True, text=True, check=True)
    return float(out.stdout)


@pytest.fixture(scope="module")
def quiet_album(tmp_path_factory):
    """Two tones at different levels, each with 1.5 s of silence after it.

    Song 1: 0-60 s (peak -6 dBFS), gap 60-61.5. Song 2: 61.5-121.5 s (peak -18 dBFS), gap 121.5-123.
    """
    path = str(tmp_path_factory.mktemp("loud") / "album.flac")
    graph = (
        "[0:a]volume=12dB[a];[2:a]volume=0dB[b];"
        "[a][1:a][b][3:a]concat=n=4:v=0:a=1[out]"
    )
    subprocess.run(
        [get_ffmpeg_path(), "-hide_banner", "-loglevel", "error", "-y",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=60:sample_rate=44100",
         "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:d=1.5",
         "-f", "lavfi", "-i", "sine=frequency=660:duration=60:sample_rate=44100",
         "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:d=1.5",
         "-filter_complex", graph, "-map", "[out]", "-c:a", "flac", path],
        check=True,
    )
    return path


@needs_ffmpeg
def test_trim_bounds_keeps_a_short_pad(quiet_album):
    start, end = loudness.trim_bounds(quiet_album, 60.75, 123.0)
    assert start == pytest.approx(61.5 - loudness.TRIM_PAD_S, abs=0.03)
    assert end == pytest.approx(121.5 + loudness.TRIM_PAD_S, abs=0.03)


@needs_ffmpeg
def test_normalized_song_measures_at_target(quiet_album, tmp_path):
    m = loudness.measure(quiet_album, 61.5, 121.5)
    gain = loudness.normalize_gain(m, -14.0)
    dest = str(tmp_path / "song.flac")
    asyncio.run(exporter.cut_track(quiet_album, 61.5, 121.5, dest, "flac", 0, 10, gain_db=gain))
    assert loudness.measure(dest, 0, 60)["lufs"] == pytest.approx(-14.0, abs=0.3)


@needs_ffmpeg
@pytest.mark.parametrize("fmt", ["mp3", "m4a", "flac", "opus"])
def test_replaygain_tags_are_written(quiet_album, tmp_path, fmt):
    import mutagen

    dest = str(tmp_path / f"song.{fmt}")
    asyncio.run(exporter.cut_track(quiet_album, 0, 60, dest, fmt, 192, 10))
    rg = loudness.replaygain(loudness.measure(quiet_album, 0, 60), -20.0, -12.0)
    exporter.write_tags(dest, fmt, {"title": "T", "track": 1, "total": 2}, None, rg)
    audio = mutagen.File(dest)
    keys = {k.lower() for k in audio.keys()}
    flat = " ".join(keys)
    assert "replaygain_track_gain" in flat and "replaygain_album_gain" in flat
    if fmt == "opus":
        assert "r128_track_gain" in keys


@needs_ffmpeg
def test_export_trims_and_tags(quiet_album, tmp_path):
    save_preferences(Preferences(library_dir=str(tmp_path / "lib"), trim_silence=True, loudness="tags", audio_format="flac"))
    try:
        store = get_store()
        job = store.create("https://www.youtube.com/watch?v=loud")
        tracks = [
            make_track(title="Loud", start=0, end=60.75, origin="chapters", source_id="s"),
            make_track(title="Quiet", start=60.75, end=123.0, origin="chapters", source_id="s"),
        ]
        store.update(job["id"], status="review", sources=[{"id": "s", "path": quiet_album, "duration": 123.0}],
                     tracks=tracks, collection={"type": "album", "name": "A", "album": "A"})
        asyncio.run(pipeline._export(job["id"]))
        job = store.get(job["id"])
        assert job["status"] == "completed", job["error"]
        loud, quiet = (o["path"] for o in job["outputs"])
        # Song 1 had no leading silence; its 0.75 s tail is trimmed to the 0.15 s pad.
        assert _duration(loud) == pytest.approx(60 + loudness.TRIM_PAD_S, abs=0.05)
        assert _duration(quiet) == pytest.approx(60 + 2 * loudness.TRIM_PAD_S, abs=0.05)
        import mutagen

        gains = [float(mutagen.File(p)["replaygain_track_gain"][0].split()[0]) for p in (loud, quiet)]
        assert gains[1] - gains[0] == pytest.approx(12.0, abs=0.3)   # quiet song is 12 dB quieter
        album = {mutagen.File(p)["replaygain_album_gain"][0] for p in (loud, quiet)}
        assert len(album) == 1                                        # one album gain for both
    finally:
        import os

        os.remove(settings.prefs_path)
