"""Pack the bundled Python's pure-Python code into two zip files (Windows build).

Python imports straight from zip files, so the standard library and every
package without compiled code go into stdlib.zip and site-packages.zip. That
turns about 6,800 small files into about 1,000. Installing and updating Cadence
writes each file separately and Windows Defender checks every new one, so the
file count, not the size, was what made an update take a minute.

Packages with compiled code (.pyd/.dll), and the .dist-info folders that
importlib.metadata reads, stay on disk.

Each module is stored as source plus an unchecked-hash .pyc next to it (zip
imports don't read __pycache__), so nothing is recompiled at start-up and
tracebacks still show source lines.

Usage: python pack-python.py <bundled python folder>
"""

import importlib.util
import os
import shutil
import sys
import zipfile

COMPILED = (".pyd", ".dll", ".so", ".exe")
SKIP_DIRS = {"__pycache__"}


def pyc_bytes(source_path: str, name: str) -> bytes:
    """Unchecked-hash .pyc contents for one source file."""
    with open(source_path, "rb") as f:
        source = f.read()
    code = compile(source, name, "exec", dont_inherit=True, optimize=0)
    from importlib._bootstrap_external import _code_to_hash_pyc  # noqa: PLC0415
    return bytes(_code_to_hash_pyc(code, importlib.util.source_hash(source), checked=False))


def add_tree(archive: zipfile.ZipFile, root: str, base: str) -> int:
    """Add `root` (a file or folder) to the zip under its path relative to `base`. Returns files added."""
    count = 0
    paths = [root]
    if os.path.isdir(root):
        paths = []
        for folder, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            paths += [os.path.join(folder, f) for f in files]
    for path in sorted(paths):
        arcname = os.path.relpath(path, base).replace(os.sep, "/")
        if path.endswith(".pyc"):
            continue
        archive.write(path, arcname)
        count += 1
        if path.endswith(".py"):
            try:
                archive.writestr(arcname + "c", pyc_bytes(path, arcname))
            except SyntaxError:
                pass  # e.g. test data written for another Python version: imported never
    return count


def has_compiled_code(path: str) -> bool:
    if os.path.isfile(path):
        return path.endswith(COMPILED)
    return any(f.endswith(COMPILED) for _, _, files in os.walk(path) for f in files)


def pack(python_dir: str) -> None:
    lib = os.path.join(python_dir, "Lib")
    site = os.path.join(lib, "site-packages")
    options = {"compression": zipfile.ZIP_DEFLATED, "compresslevel": 6}

    # Not used when Cadence runs: pip (yt-dlp updates unpack the wheel themselves) and
    # numpy's own test suite.
    for e in os.listdir(site):
        if e == "pip" or (e.startswith("pip-") and e.endswith(".dist-info")):
            shutil.rmtree(os.path.join(site, e))
    for folder, dirs, _ in os.walk(os.path.join(site, "numpy")):
        for d in [d for d in dirs if d == "tests"]:
            shutil.rmtree(os.path.join(folder, d))
            dirs.remove(d)

    # Standard library: everything in Lib except site-packages.
    stdlib_entries = [os.path.join(lib, e) for e in os.listdir(lib) if e not in ("site-packages", "__pycache__")]
    with zipfile.ZipFile(os.path.join(python_dir, "stdlib.zip"), "w", **options) as z:
        n = sum(add_tree(z, e, lib) for e in stdlib_entries)
    print(f"   stdlib.zip: {n} files")

    # Pure-Python packages and modules.
    packed, kept = [], []
    for e in sorted(os.listdir(site)):
        path = os.path.join(site, e)
        # Namespace packages (no __init__.py, e.g. opentelemetry) can't be imported from a zip.
        is_package = os.path.isfile(os.path.join(path, "__init__.py"))
        pure = (
            e not in SKIP_DIRS and (is_package or e.endswith(".py")) and not has_compiled_code(path)
        )
        (packed if pure else kept).append(e)
    with zipfile.ZipFile(os.path.join(python_dir, "site-packages.zip"), "w", **options) as z:
        n = sum(add_tree(z, os.path.join(site, e), site) for e in packed)
    print(f"   site-packages.zip: {n} files from {len(packed)} packages")
    kept = [k for k in kept if not k.endswith(".dist-info") and k not in SKIP_DIRS]
    print(f"   kept on disk (compiled code or helper programs): {', '.join(kept)}")

    # The zips go on the import path ahead of the folders they came from. Written before
    # anything is deleted: this script runs on the Python it packs.
    pth = next(f for f in os.listdir(python_dir) if f.endswith("._pth"))
    with open(os.path.join(python_dir, pth), "w", encoding="utf-8", newline="\r\n") as f:
        f.write("\n".join(["..", "stdlib.zip", "Lib", "DLLs", "site-packages.zip", "Lib\\site-packages", "import site"]) + "\n")

    for path in stdlib_entries + [os.path.join(site, e) for e in packed + ["__pycache__"]]:
        if os.path.isdir(path):
            shutil.rmtree(path)
        elif os.path.exists(path):
            os.remove(path)

    total = sum(len(files) for _, _, files in os.walk(python_dir))
    print(f"   Python files on disk now: {total}")


if __name__ == "__main__":
    pack(sys.argv[1])
