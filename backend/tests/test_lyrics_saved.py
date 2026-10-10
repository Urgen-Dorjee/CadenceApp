"""The player reads lyrics saved with a song: the .lrc file next to it first."""

from services import lyrics


def test_reads_the_lrc_file_next_to_the_song(tmp_path):
    song = tmp_path / "Song.mp3"
    song.write_bytes(b"not really audio")
    (tmp_path / "Song.lrc").write_text("[00:01.00] First line\n[00:05.50] Second line\n", encoding="utf-8")
    found = lyrics.read_saved(str(song), "mp3")
    assert found["synced"].startswith("[00:01.00] First line")
    assert found["plain"] == "First line\nSecond line"


def test_no_lyrics_saved(tmp_path):
    song = tmp_path / "Song.mp3"
    song.write_bytes(b"not really audio")
    assert lyrics.read_saved(str(song), "mp3") is None


def test_plain_lyrics_are_not_mistaken_for_synced():
    assert lyrics._looks_synced("[00:12.00] Line")
    assert not lyrics._looks_synced("Tujhe dekha to\nYeh jaana sanam")
