import pytest
"""yt-dlp updates live in the data folder and are only used while newer than the bundled one."""

import os
import sys

from core import ytdlp_updates


def _fake_install(folder, version):
    os.makedirs(os.path.join(folder, "yt_dlp"))
    os.makedirs(os.path.join(folder, f"yt_dlp-{version}.dist-info"))


def test_version_key_orders_releases():
    key = ytdlp_updates.version_key
    assert key("2025.10.22") < key("2025.10.22.1") < key("2025.11.1") < key("2026.1.2")


def test_installed_version(tmp_path):
    folder = str(tmp_path / "packages")
    assert ytdlp_updates.installed_version(folder) is None
    _fake_install(folder, "2099.1.1")
    assert ytdlp_updates.installed_version(folder) == "2099.1.1"


def test_newer_update_goes_first_on_the_import_path(tmp_path, monkeypatch):
    monkeypatch.setattr(ytdlp_updates, "bundled_version", lambda: "2025.1.1")
    monkeypatch.setattr(sys, "path", list(sys.path))
    folder = ytdlp_updates.packages_dir(str(tmp_path))
    _fake_install(folder, "2099.1.1")
    assert ytdlp_updates.activate(str(tmp_path)) == "2099.1.1"
    assert sys.path[0] == folder


def test_update_older_than_the_bundled_one_is_removed(tmp_path, monkeypatch):
    # A newer Cadence brought a newer yt-dlp than the one updated earlier.
    monkeypatch.setattr(ytdlp_updates, "bundled_version", lambda: "2099.1.1")
    monkeypatch.setattr(sys, "path", list(sys.path))
    folder = ytdlp_updates.packages_dir(str(tmp_path))
    _fake_install(folder, "2025.1.1")
    assert ytdlp_updates.activate(str(tmp_path)) is None
    assert folder not in sys.path
    assert not os.path.exists(folder)


def test_no_update_installed(tmp_path):
    assert ytdlp_updates.activate(str(tmp_path)) is None


def _wheel(files):
    import io
    import zipfile
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, text in files.items():
            z.writestr(name, text)
    return buf.getvalue()


def test_wheel_is_checked_and_unpacked(tmp_path):
    import hashlib
    data = _wheel({"yt_dlp/__init__.py": "", "yt_dlp-2099.1.1.dist-info/METADATA": "Name: yt-dlp"})
    ytdlp_updates.unpack_wheel(data, hashlib.sha256(data).hexdigest(), str(tmp_path))
    assert ytdlp_updates.installed_version(str(tmp_path)) == "2099.1.1"


def test_damaged_or_unsafe_wheels_are_refused(tmp_path):
    import hashlib
    good = _wheel({"yt_dlp/__init__.py": ""})
    with pytest.raises(RuntimeError, match="checksum"):
        ytdlp_updates.unpack_wheel(good, "0" * 64, str(tmp_path))
    evil = _wheel({"../outside.py": ""})
    with pytest.raises(RuntimeError, match="Unexpected file"):
        ytdlp_updates.unpack_wheel(evil, hashlib.sha256(evil).hexdigest(), str(tmp_path / "t"))
    assert not (tmp_path / "outside.py").exists()
