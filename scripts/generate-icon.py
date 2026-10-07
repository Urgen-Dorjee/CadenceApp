"""
generate-icon.py
Generates resources/icon.ico (Windows) and resources/icon-1024.png (macOS and
Linux, which build their icons from it) for Cadence: a teal rounded square with white
audio bars, matching the logo in the app's sidebar.

Needs only numpy. Each size is rendered with 4x supersampling and stored as a
PNG inside the .ico (supported by Windows Vista and later).
Run: python scripts/generate-icon.py (with numpy, e.g. backend/venv's Python)
"""

import os
import struct
import zlib

import numpy as np

OUTPUT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "resources", "icon.ico")
SIZES = [16, 24, 32, 48, 64, 128, 256]
SUPERSAMPLE = 4

TOP = np.array([74, 214, 196], dtype=np.float64)     # accent, light
BOTTOM = np.array([13, 138, 124], dtype=np.float64)  # accent, deep
CORNER = 0.23
# (centre x, half height) of each bar, in units of the icon size
BARS = [(0.26, 0.10), (0.38, 0.22), (0.50, 0.30), (0.62, 0.18), (0.74, 0.12)]
BAR_HALF_WIDTH = 0.045


def rounded_rect(xs, ys, x0, y0, x1, y1, r):
    """Boolean mask of a rounded rectangle, for coordinate grids xs/ys."""
    cx = np.clip(xs, x0 + r, x1 - r)
    cy = np.clip(ys, y0 + r, y1 - r)
    return (xs - cx) ** 2 + (ys - cy) ** 2 <= r * r


def render(size):
    n = size * SUPERSAMPLE
    coords = (np.arange(n) + 0.5) / n
    xs, ys = np.meshgrid(coords, coords)

    bg = rounded_rect(xs, ys, 0.0, 0.0, 1.0, 1.0, CORNER)
    bars = np.zeros_like(bg)
    for cx, half in BARS:
        bars |= rounded_rect(xs, ys, cx - BAR_HALF_WIDTH, 0.5 - half, cx + BAR_HALF_WIDTH, 0.5 + half, BAR_HALF_WIDTH)

    t = ys[..., None]
    rgb = TOP * (1 - t) + BOTTOM * t
    rgb = np.where(bars[..., None], 255.0, rgb)
    alpha = bg.astype(np.float64)

    # Downsample: average premultiplied colour and coverage over each 4x4 block.
    def pool(a):
        return a.reshape(size, SUPERSAMPLE, size, SUPERSAMPLE, *a.shape[2:]).mean(axis=(1, 3))

    a = pool(alpha)
    c = pool(rgb * alpha[..., None]) / np.maximum(a[..., None], 1e-9)
    rgba = np.dstack([c, a * 255]).round().clip(0, 255).astype(np.uint8)
    return rgba


def png_bytes(rgba):
    h, w, _ = rgba.shape
    raw = b"".join(b"\x00" + rgba[y].tobytes() for y in range(h))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def write_ico(path, images):
    header = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    entries, blobs = b"", b""
    for size, data in images:
        dim = 0 if size >= 256 else size
        entries += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset)
        blobs += data
        offset += len(data)
    with open(path, "wb") as f:
        f.write(header + entries + blobs)


def main():
    images = [(s, png_bytes(render(s))) for s in SIZES]
    write_ico(OUTPUT_PATH, images)
    preview = os.path.join(os.path.dirname(OUTPUT_PATH), "icon.png")
    with open(preview, "wb") as f:
        f.write(png_bytes(render(256)))
    large = os.path.join(os.path.dirname(OUTPUT_PATH), "icon-1024.png")
    with open(large, "wb") as f:
        f.write(png_bytes(render(1024)))
    print(f"Wrote {OUTPUT_PATH} ({', '.join(str(s) for s in SIZES)} px), {preview} and {large}")


if __name__ == "__main__":
    main()
