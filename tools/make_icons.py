#!/usr/bin/env python3
"""Render the app icons. No dependencies — PNGs are assembled by hand.

    python3 tools/make_icons.py

Writes public/icons/. Re-run after changing the palette or the mark.
"""
import math
import pathlib
import struct
import zlib

OUT = pathlib.Path(__file__).resolve().parent.parent / "public" / "icons"

INK = (0x1C, 0x1B, 0x19)
PAPER = (0xFB, 0xFB, 0xFA)
ACCENT = (0x8A, 0x5A, 0x2B)


def png(width, height, pixels):
    """pixels: flat list of (r, g, b) in row-major order."""
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter type 0 (None)
        for x in range(width):
            raw.extend(pixels[y * width + x])

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def blend(bottom, top, alpha):
    return tuple(round(b + (t - b) * alpha) for b, t in zip(bottom, top))


def coverage(x, y, inside, samples=3):
    """Supersample one pixel so edges come out smooth."""
    hits = sum(
        inside(x + (i + 0.5) / samples, y + (j + 0.5) / samples)
        for i in range(samples)
        for j in range(samples)
    )
    return hits / (samples * samples)


def envelope_mark(size, padding_ratio, shape):
    """An envelope: the plaque, its body outline, and the flap's two diagonals."""
    pad = size * padding_ratio
    width = size - 2 * pad
    height = width * 0.66
    top = (size - height) / 2
    left = pad
    stroke = max(size * 0.045, 1.6)
    radius = size * 0.22

    def in_plaque(x, y):
        # "full" paints edge to edge: a maskable icon is cropped to whatever
        # shape the launcher wants, so any corner left unpainted shows through.
        if shape == "full":
            return True
        cx = min(max(x, radius), size - radius)
        cy = min(max(y, radius), size - radius)
        return (x - cx) ** 2 + (y - cy) ** 2 <= radius**2

    def near_segment(x, y, ax, ay, bx, by):
        dx, dy = bx - ax, by - ay
        length = dx * dx + dy * dy
        t = 0.0 if length == 0 else max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / length))
        return math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= stroke / 2

    right, bottom = left + width, top + height

    def in_mark(x, y):
        on_border = (
            near_segment(x, y, left, top, right, top)
            or near_segment(x, y, right, top, right, bottom)
            or near_segment(x, y, right, bottom, left, bottom)
            or near_segment(x, y, left, bottom, left, top)
        )
        flap = near_segment(x, y, left, top + stroke * 0.3, size / 2, top + height * 0.52) or (
            near_segment(x, y, size / 2, top + height * 0.52, right, top + stroke * 0.3)
        )
        return on_border or flap

    return in_plaque, in_mark


def render(size, *, shape="squircle", background=ACCENT, ink=PAPER, padding_ratio=0.26):
    in_plaque, in_mark = envelope_mark(size, padding_ratio, shape)
    pixels = []

    for y in range(size):
        for x in range(size):
            plaque = coverage(x, y, in_plaque)
            pixel = blend(PAPER, background, plaque)
            mark = coverage(x, y, in_mark) * plaque
            pixels.append(blend(pixel, ink, mark))
    return png(size, size, pixels)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    targets = [
        ("icon-192.png", dict(size=192)),
        ("icon-256.png", dict(size=256)),
        ("icon-512.png", dict(size=512)),
        # Maskable icons are cropped to a circle on some launchers, so the mark
        # has to sit well inside the safe zone.
        ("maskable-512.png", dict(size=512, shape="full", padding_ratio=0.30)),
        ("apple-touch-icon.png", dict(size=180)),
        ("favicon-64.png", dict(size=64)),
    ]

    for name, options in targets:
        path = OUT / name
        path.write_bytes(render(**options))
        print(f"{path.relative_to(OUT.parent.parent)}  {path.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
