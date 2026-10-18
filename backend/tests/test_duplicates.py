import os

import pytest

from services.duplicates import find, normalize, readings, singers
from services.tracklist import make_track


def song(title, artist="", duration=240.0, path=None, album="Album"):
    return {"title": title, "artist": artist, "album_artist": "", "album": album, "duration": duration,
            "path": path or os.path.abspath(os.path.join("Music", f"{title}.mp3"))}


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
    assert find([t], [song("Pehla Nasha", "Udit Narayan", 180)]) == {}   # a short edit
    assert find([t], [song("Pehla Nasha", "Udit Narayan", 230)]) == {}   # a minute shorter
    assert find([t], [song("Pehla Nasha", "", 290)]) != {}               # library song has no singer: title + length match


def test_other_uploads_of_a_song_trimmed_differently_still_match():
    # Real case: the same songs in two compilations, 16-32 s apart.
    assert find([track("Green Green Grass of Home", end=255)], [song("Green Green Grass of Home", duration=223)]) != {}
    assert find([track("Let It Be", end=245)], [song("Let It Be", duration=229)]) != {}
    assert find([track("Wonderful Tonight", end=197)], [song("Wonderful Tonight", "Eric Clapton", 217)]) != {}


def test_numbered_titles_with_the_singer_after_a_dash_match():
    t = track("Every Breath You Take", end=230)
    assert find([t], [song("3.Every Breath You Take - The Police", duration=225)]) != {}
    assert find([t], [song("03 - Every Breath You Take", duration=225)]) != {}
    assert find([t], [song("The Police - Every Breath You Take", duration=225)]) != {}
    assert find([track("Every Breath You Take", "Sting")], [song("Every Breath You Take - The Police")]) == {}


def test_readings_keep_titles_that_start_with_a_number():
    assert readings("99 Red Balloons", "") == [("99 Red Balloons", "")]
    assert readings("1999", "") == [("1999", "")]
    assert readings("12.The Lady in Red - Chris De Burgh", "")[0] == ("The Lady in Red - Chris De Burgh", "")


def test_skipped_tracks_are_reported_and_the_splits_own_files_are_ignored():
    t1, t2 = track("Song A"), track("Song B", include=False)
    own = os.path.abspath(os.path.join("Music", "A.mp3"))
    lib = [song("Song A", path=own), song("Song B")]
    assert list(find([t1, t2], lib, exclude_paths=[own])) == [t2["id"]]


@pytest.mark.skipif(os.name != "nt", reason="only Windows paths ignore case and slash direction")
def test_own_files_match_regardless_of_case_on_windows():
    lib = [song("Song A", path=r"C:\Music\A.mp3")]
    assert find([track("Song A")], lib, exclude_paths=["c:/music/a.mp3"]) == {}


def test_placeholder_names_are_never_duplicates():
    t = track("Track 3", end=337)
    assert find([t], [song("Track 3", "Romantic Love Songs", 330)]) == {}


def test_a_part_of_a_video_saved_before_matches_whatever_it_is_called_now(tmp_path):
    from services.duplicates import find_same_part

    saved_file = tmp_path / "01 - Pehla Nasha.mp3"
    saved_file.write_bytes(b"x")
    saved = [{"path": str(saved_file), "video_id": "vid", "start": 100.0, "end": 400.0, "title": "Pehla Nasha"},
             {"path": str(tmp_path / "gone.mp3"), "video_id": "vid", "start": 400.0, "end": 700.0, "title": "Gone"}]
    renamed = dict(make_track(title="Track 2", start=103, end=398, origin="silence", source_id="vid"), id="t2")
    other_part = dict(make_track(title="Track 3", start=400, end=700, origin="silence", source_id="vid"), id="t3")
    other_video = dict(make_track(title="Track 2", start=103, end=398, origin="silence", source_id="else"), id="t4")
    found = find_same_part([renamed, other_part, other_video], saved, [{"path": str(saved_file), "title": "Pehla Nasha (Remastered)", "artist": "Udit", "album": ""}])
    assert list(found) == ["t2"]                      # the deleted file and the other video don't count
    assert found["t2"][0]["title"] == "Pehla Nasha (Remastered)"
