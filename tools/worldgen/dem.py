"""Cut the planet's elevation into relief tiles for the 3D map.

    python tools/worldgen/dem.py [--max-zoom 5]

Reads world/elevation.png (metres + 11000, equirectangular) and writes
client/public/world/dem/{z}/{x}/{y}.png: 256 px Web Mercator tiles in the
Terrarium encoding (height = R * 256 + G + B / 256 - 32768) that MapLibre
raises into 3D terrain and shades as hills. The sea is flattened to sea
level, so the oceans read as a calm, flat board around raised land.
"""
import argparse
import math
from pathlib import Path

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parents[2]
WORLD = ROOT / "world"
OUT = ROOT / "client" / "public" / "world" / "dem"
TILE = 256


def mercator(src: np.ndarray, size: int) -> np.ndarray:
    """Bilinear resample of an equirectangular float grid into a square Web Mercator grid."""
    h, w = src.shape
    y = (np.arange(size) + 0.5) / size
    lat = np.degrees(np.arctan(np.sinh(math.pi * (1 - 2 * y))))
    fy = np.clip((90 - lat) / 180 * h - 0.5, 0, h - 1)
    x = (np.arange(size) + 0.5) / size * w - 0.5
    x0 = np.floor(x).astype(int) % w
    x1 = (x0 + 1) % w
    tx = x - np.floor(x)
    y0 = np.floor(fy).astype(int)
    y1 = np.minimum(y0 + 1, h - 1)
    ty = (fy - y0)[:, None]
    top = src[y0][:, x0] * (1 - tx) + src[y0][:, x1] * tx
    bot = src[y1][:, x0] * (1 - tx) + src[y1][:, x1] * tx
    return (top * (1 - ty) + bot * ty).astype(np.float32)


def terrarium(h: np.ndarray) -> np.ndarray:
    v = h + 32768.0
    r = np.floor(v / 256)
    g = np.floor(v - r * 256)
    b = np.floor((v - r * 256 - g) * 256)
    return np.stack([r, g, b], axis=-1).clip(0, 255).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-zoom", type=int, default=5)
    args = ap.parse_args()

    elev = np.asarray(Image.open(WORLD / "elevation.png")).astype(np.float32) - 11000
    elev = np.maximum(elev, 0)  # flat seas
    size = TILE << args.max_zoom
    print(f"relief: {elev.shape[1]}x{elev.shape[0]} -> mercator {size}x{size}")
    level = mercator(elev, size)
    count = 0
    for z in range(args.max_zoom, -1, -1):
        n = 1 << z
        if z != args.max_zoom:
            level = level.reshape(n * TILE, 2, n * TILE, 2).mean(axis=(1, 3))
        rgb = terrarium(np.round(level))  # whole metres: smaller tiles, no visible difference
        for x in range(n):
            d = OUT / str(z) / str(x)
            d.mkdir(parents=True, exist_ok=True)
            for y in range(n):
                Image.fromarray(rgb[y * TILE:(y + 1) * TILE, x * TILE:(x + 1) * TILE]).save(d / f"{y}.png", optimize=True)
                count += 1
        print(f"z{z}: {n * n} relief tiles")
    print(f"wrote {count} relief tiles")


if __name__ == "__main__":
    main()
