"""yt-dlp updates installed into the data folder, never inside the app.

The app's own files must not change: on macOS that breaks its signature (the app is then
reported as "damaged"), and the Linux AppImage is read-only. Updates go to
<data dir>/packages and are put first on the import path at startup, but only while they
are newer than the yt-dlp that came with the app (a later Cadence version may bring a
newer one).
"""

import compileall
import hashlib
import io
import json
import os
import py_compile
import re
import shutil
import sys
import urllib.request
import zipfile
from importlib import metadata

PYPI_URL = "https://pypi.org/pypi/yt-dlp/json"
_DIST_INFO = re.compile(r"^yt_dlp-([0-9][^-]*)\.dist-info$")


def packages_dir(data_dir: str) -> str:
    return os.path.join(data_dir, "packages")


def version_key(version: str) -> tuple[int, ...]:
    """"2025.10.22" -> (2025, 10, 22); "2025.10.22.1" sorts after it."""
    return tuple(int(n) for n in re.findall(r"\d+", version))


def installed_version(folder: str) -> str | None:
    """Version of the yt-dlp installed in `folder`, if any."""
    if not os.path.isdir(folder):
        return None
    for name in os.listdir(folder):
        m = _DIST_INFO.match(name)
        if m and os.path.isdir(os.path.join(folder, "yt_dlp")):
            return m.group(1)
    return None


def bundled_version() -> str | None:
    try:
        return metadata.version("yt-dlp")
    except metadata.PackageNotFoundError:
        return None


def activate(data_dir: str) -> str | None:
    """Use the updated yt-dlp if it's newer than the bundled one. Call before importing yt_dlp.
    Returns the version now in use from the data folder, or None. An outdated copy is removed."""
    folder = packages_dir(data_dir)
    updated = installed_version(folder)
    if not updated:
        return None
    bundled = bundled_version()
    if bundled and version_key(updated) <= version_key(bundled):
        shutil.rmtree(folder, ignore_errors=True)
        return None
    if folder not in sys.path:
        sys.path.insert(0, folder)
    return updated


def latest_version(timeout: float = 15.0) -> str:
    """Newest yt-dlp release on PyPI. Blocking."""
    req = urllib.request.Request(PYPI_URL, headers={"User-Agent": "Cadence"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.load(res)["info"]["version"]


def wheel_url(version: str, timeout: float = 15.0) -> tuple[str, str]:
    """(download URL, sha256) of yt-dlp `version`'s universal wheel on PyPI. Blocking."""
    req = urllib.request.Request(f"https://pypi.org/pypi/yt-dlp/{version}/json", headers={"User-Agent": "Cadence"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        files = json.load(res)["urls"]
    for f in files:
        if f["packagetype"] == "bdist_wheel" and f["filename"].endswith("-py3-none-any.whl"):
            return f["url"], f["digests"]["sha256"]
    raise RuntimeError(f"No wheel found for yt-dlp {version}")


def unpack_wheel(data: bytes, sha256: str, target: str) -> None:
    """Check a downloaded wheel against its published hash and unpack it into `target`."""
    if hashlib.sha256(data).hexdigest() != sha256:
        raise RuntimeError("The yt-dlp download was damaged (checksum mismatch). Try again.")
    with zipfile.ZipFile(io.BytesIO(data)) as wheel:
        for name in wheel.namelist():
            # A wheel is a plain zip; refuse paths that would land outside the folder.
            dest = os.path.realpath(os.path.join(target, name))
            if not dest.startswith(os.path.realpath(target) + os.sep):
                raise RuntimeError(f"Unexpected file in the yt-dlp download: {name}")
        wheel.extractall(target)


def install(data_dir: str, version: str) -> None:
    """Install yt-dlp `version` into the data folder, replacing an earlier update. Blocking.
    It's used after Cadence restarts.

    A wheel is a zip of the package, so it's downloaded from PyPI and unpacked directly
    (no pip: it was 850 files in the app for this one job)."""
    folder = packages_dir(data_dir)
    staging = folder + ".new"
    shutil.rmtree(staging, ignore_errors=True)
    os.makedirs(staging)
    try:
        url, sha256 = wheel_url(version)
        req = urllib.request.Request(url, headers={"User-Agent": "Cadence"})
        with urllib.request.urlopen(req, timeout=120) as res:
            data = res.read()
        unpack_wheel(data, sha256, staging)
        if installed_version(staging) != version:
            raise RuntimeError("The yt-dlp download didn't contain the expected version.")
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    # Compile it now: the app doesn't write .pyc files, so it would otherwise recompile yt-dlp every start.
    compileall.compile_dir(
        staging, quiet=1, force=True, workers=0, invalidation_mode=py_compile.PycInvalidationMode.UNCHECKED_HASH,
    )
    shutil.rmtree(folder, ignore_errors=True)
    os.replace(staging, folder)
