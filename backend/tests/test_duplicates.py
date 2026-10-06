from services.duplicates import find, normalize, singers
from services.tracklist import make_track


def song(title, artist="", duration=240.0, path=None, album="Album"):
    return {"title": title, "artist": artist, "album_artist": "", "album": album, "duration": duration,
            "path": path or f"C:\Music\{title}.mp3"}


def track(title, artist="", start=0.0, end=240.0, include=True):
    t = make_track(title=title, artist=artist, start=start, end=end, origin="chapters", source_id="s")
    t["include"] = include
    return t


def test_normalize_ignores_case_punctuation_and_upload_noise():
    assert normalize("Tujhe Dekha To (Official Audio)!") == "tujhe dekha to"
    assert normalize("TUJHE  dekha-to") == "tujhe dekha to"
    assert singers("Lata Mangeshkar, Kumar Sanu & Udit ft. Alka") == {"lata mangeshkar", "kumar sanu", "udit", "alka"}


def test_finds_the_same_song():
    t = track("Tujhe Dekha To", "Lata Mangeshkar, Kumar Sanu")
    found = find([t], [song("Tujhe Dekha To (Lyrical)", "Kumar Sanu", 245)])
    assert list(found) == [t["id"]]
    assert found[t["id"]][0]["title"] == "Tujhe Dekha To (Lyrical)"


def test_different_singer_or_length_is_not_a_duplicate():
    t = track("Pehla Nasha", "Udit Narayan", end=290)
    assert find([t], [song("Pehla Nasha", "Arijit Singh", 290)]) == {}   # a cover by someone else
    assert find([t], [song("Pehla Nasha", "Udit Narayan", 180)]) == {}   # a short version
    assert find([t], [song("Pehla Nasha", "", 290)]) != {}               # library song has no singer: title + length match


def test_skipped_tracks_and_the_splits_own_files_are_ignored():
    t1, t2 = track("Song A"), track("Song B", include=False)
    lib = [song("Song A", path="C:\Music\A.mp3"), song("Song B")]
    assert find([t1, t2], lib, exclude_paths=["c:/music/a.mp3"]) == {}
