import os

from config import Preferences
from services.library import relative_path, sanitize_component, unique_path


def test_sanitize_component_windows_rules():
    assert sanitize_component('AC/DC: "Live"?') == "AC DC Live"
    assert sanitize_component("CON") == "_CON"
    assert sanitize_component("name. . ") == "name"
    assert sanitize_component("   ") == "Untitled"
    assert len(sanitize_component("x" * 500)) == 120


def test_artist_layout():
    collection = {"type": "artist", "artist": "Udit Narayan", "name": "Udit Narayan"}
    path = relative_path({"title": "Pehla Nasha"}, 1, collection, Preferences())
    assert path == os.path.join("Artists", "Udit Narayan", "Udit Narayan - Pehla Nasha")


def test_album_layout_with_and_without_year():
    collection = {"type": "album", "album": "Dilwale Dulhania Le Jayenge", "year": "1995"}
    assert relative_path({"title": "Tujhe Dekha To"}, 3, collection, Preferences()) == os.path.join(
        "Albums", "Dilwale Dulhania Le Jayenge (1995)", "03 - Tujhe Dekha To"
    )
    collection["year"] = ""
    assert relative_path({"title": "Tujhe Dekha To"}, 3, collection, Preferences()) == os.path.join(
        "Albums", "Dilwale Dulhania Le Jayenge", "03 - Tujhe Dekha To"
    )


def test_bad_template_falls_back_to_default():
    prefs = Preferences(artist_template="{nonsense}/{title}")
    path = relative_path({"title": "Song"}, 1, {"type": "artist", "artist": "A"}, prefs)
    assert path == os.path.join("Artists", "A", "A - Song")


def test_title_with_slash_does_not_create_folders():
    path = relative_path({"title": "Love / Hate"}, 1, {"type": "single"}, Preferences())
    assert path == os.path.join("Singles", "Love Hate")


def test_unique_path(tmp_path):
    p = tmp_path / "song.mp3"
    assert unique_path(str(p)) == str(p)
    p.write_text("x")
    assert unique_path(str(p)) == str(tmp_path / "song (2).mp3")
