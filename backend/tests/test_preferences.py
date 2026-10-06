import json

import pytest

from config import PREFS_VERSION, load_preferences, save_preferences, settings, Preferences


@pytest.fixture(autouse=True)
def clean_prefs():
    yield
    try:
        import os

        os.remove(settings.prefs_path)
    except OSError:
        pass


def _write(data: dict) -> None:
    with open(settings.prefs_path, "w", encoding="utf-8") as f:
        json.dump(data, f)


def test_old_default_snap_window_is_upgraded():
    _write({"snap_window_s": 2.0, "audio_format": "flac"})
    prefs = load_preferences()
    assert prefs.snap_window_s == 5.0
    assert prefs.audio_format == "flac"
    assert prefs.version == PREFS_VERSION


def test_custom_snap_window_is_kept():
    _write({"snap_window_s": 3.5})
    assert load_preferences().snap_window_s == 3.5


def test_snap_window_chosen_after_upgrade_is_kept():
    save_preferences(Preferences(snap_window_s=2.0))
    assert load_preferences().snap_window_s == 2.0
