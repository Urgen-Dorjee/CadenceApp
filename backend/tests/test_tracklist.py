from services.tracklist import (
    classify_collection,
    clean_title,
    flag_short_tracks,
    make_track,
    format_ts,
    parse_timestamps,
    tracks_from_chapters,
    tracks_from_metadata,
)


def test_parses_common_description_tracklist():
    text = "\n".join([
        "Enjoy the full jukebox!",
        "00:00 Tujhe Dekha To",
        "05:03 Mere Khwabon Mein",
        "10:21 - Ho Gaya Hai Tujhko",
        "1:02:03 Zara Sa Jhoom Loon Main",
        "Subscribe for more",
    ])
    entries = parse_timestamps(text, duration=4000)
    assert entries == [
        (0.0, "Tujhe Dekha To"),
        (303.0, "Mere Khwabon Mein"),
        (621.0, "Ho Gaya Hai Tujhko"),
        (3723.0, "Zara Sa Jhoom Loon Main"),
    ]


def test_parses_numbered_title_first_and_ranges():
    text = "1. Pehla Nasha - 0:00\n2) Chura Ke Dil Mera 4:50\n[09:41 - 14:00] Kuch Kuch Hota Hai"
    entries = parse_timestamps(text, duration=900)
    assert [e[1] for e in entries] == ["Pehla Nasha", "Chura Ke Dil Mera", "Kuch Kuch Hota Hai"]
    assert [e[0] for e in entries] == [0, 290, 581]


def test_rejects_non_tracklist_timestamps():
    assert parse_timestamps("Watch at 3:20 for the best part", 600) == []
    # not increasing
    assert parse_timestamps("05:00 A\n01:00 B", 600) == []
    # beyond the end of the video
    assert parse_timestamps("00:00 A\n12:00 B", 600) == []
    # first timestamp far from the start: prose, not a tracklist
    assert parse_timestamps("40:00 A\n45:00 B", 3600) == []


def test_clean_title_strips_upload_noise():
    assert clean_title("Pehla Nasha (Official Video) | Jo Jeeta Wohi Sikandar") == "Pehla Nasha"
    assert clean_title("Tum Hi Ho - Full Song") == "Tum Hi Ho"
    assert clean_title("Chaiyya Chaiyya [Lyrical]") == "Chaiyya Chaiyya"


def test_chapters_take_priority():
    info = {
        "duration": 600,
        "chapters": [
            {"start_time": 0, "end_time": 300, "title": "Song A"},
            {"start_time": 300, "end_time": 600, "title": "Song B"},
        ],
        "description": "00:00 Wrong\n02:00 Also wrong",
    }
    tracks = tracks_from_metadata(info, "vid")
    assert [t["title"] for t in tracks] == ["Song A", "Song B"]
    assert tracks[0]["origin"] == "chapters"
    assert tracks[1]["start"] == 300 and tracks[1]["end"] == 600


def test_single_chapter_is_not_a_tracklist():
    assert tracks_from_chapters([{"start_time": 0, "end_time": 10, "title": "x"}], 10, "v") == []


def test_falls_back_to_comment_with_most_timestamps():
    info = {
        "duration": 900,
        "description": "Great songs",
        "comments": [
            {"text": "0:00 A\n3:00 B"},
            {"text": "0:00 One\n3:00 Two\n6:00 Three\n9:30 Four"},
        ],
    }
    tracks = tracks_from_metadata(info, "vid")
    assert [t["title"] for t in tracks] == ["One", "Two", "Three", "Four"]
    assert tracks[-1]["end"] == 900
    assert all(t["origin"] == "comment" for t in tracks)


def test_classify_singer_collections():
    c = classify_collection("Udit Narayan Superhit Songs | 90s Hits | Audio Jukebox", 20)
    assert c["type"] == "artist" and c["artist"] == "Udit Narayan"
    c = classify_collection("Best of Kumar Sanu | Romantic Songs", 15)
    assert c["type"] == "artist" and c["artist"] == "Kumar Sanu"
    c = classify_collection("Arijit Singh Top Hits Collection 2024", 12)
    assert c["type"] == "artist" and c["artist"] == "Arijit Singh"


def test_classify_movie_albums():
    c = classify_collection("Dilwale Dulhania Le Jayenge (1995) | Full Album | Shah Rukh Khan", 7)
    assert c["type"] == "album" and c["album"] == "Dilwale Dulhania Le Jayenge" and c["year"] == "1995"
    c = classify_collection("Kuch Kuch Hota Hai Audio Jukebox", 8)
    assert c["type"] == "album" and c["album"] == "Kuch Kuch Hota Hai"


def test_generic_titles_become_collections():
    c = classify_collection("90s Bollywood Romantic Hits | Nonstop Jukebox", 30)
    assert c["type"] == "collection"
    assert classify_collection("Some Song", 1)["type"] == "single"


def test_short_segments_are_flagged_for_review():
    tracks = [
        make_track(title="Intro", start=0, end=12, origin="chapters", source_id="s"),
        make_track(title="Song", start=12, end=300, origin="chapters", source_id="s"),
        make_track(title="Short single", start=0, end=30, origin="playlist", source_id="p"),
    ]
    flag_short_tracks(tracks)
    assert [t["confidence"] for t in tracks] == [0.5, 0.95, 1.0]


def test_format_ts():
    assert format_ts(65) == "1:05"
    assert format_ts(3723) == "1:02:03"
