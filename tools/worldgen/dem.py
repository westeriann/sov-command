"""Cut the planet's elevation into relief tiles for the 3D map.

    python tools/worldgen/dem.py [--max-zoom 6]

Reads world/elevation.png (metres + 11000, equirectangular) and writes
client/public/world/dem/{z}/{x}/{y}.png: 256 px Web Mercator tiles in the
Terrarium encoding (height = R * 256 + G + B / 256 - 32768) that MapLibre
raises into 3D terrain and shades as hills. The sea is flattened to sea
level, so the oceans read as a calm, flat board around raised land.

Land rises gently from the shore (over about 50 km) instead of standing up as
a wall at the coast: raised by the map's exaggeration, a wall had the photo
stretched down it and caught the hill shading as a bright line along every
coast. Mountains get ridged detail at the finest levels, in proportion to how
high they stand, so close up they have ridges and valleys rather than blobs.
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


def mercator(src: np.ndarray, size: int, y0: int = 0, y1: int | None = None) -> np.ndarray:
    """Bilinear resample of an equirectangular float grid into a square Web Mercator grid (rows y0..y1)."""
    h, w = src.shape
    y = (np.arange(y0, size if y1 is None else y1) + 0.5) / size
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


def smooth(a: np.ndarray, r: int) -> np.ndarray:
    """Two passes of a (2r+1)-wide box blur, wrapping east-west: close to a Gaussian."""
    for _ in range(2):
        c = np.cumsum(np.pad(a, ((0, 0), (r + 1, r)), mode="wrap"), axis=1)
        a = (c[:, 2 * r + 1:] - c[:, :-2 * r - 1]) / (2 * r + 1)
        c = np.cumsum(np.pad(a, ((r + 1, r), (0, 0)), mode="edge"), axis=0)
        a = (c[2 * r + 1:] - c[:-2 * r - 1]) / (2 * r + 1)
    return a.astype(np.float32)


def coastal_ramp(elev: np.ndarray, cells: float) -> np.ndarray:
    """0 at the shore rising to 1 inland over `cells` grid cells (smoothstep), wrapping east-west."""
    from scipy import ndimage
    land = elev > 0
    pad = int(cells * 3) + 2
    wide = np.concatenate([land[:, -pad:], land, land[:, :pad]], axis=1)
    dist = ndimage.distance_transform_edt(wide)[:, pad:-pad]
    t = np.clip(dist / cells, 0, 1)
    return (t * t * (3 - 2 * t)).astype(np.float32)


class Detail:
    """Ridged fractal noise on the Mercator grid, wrapping east-west: the same at every zoom."""
    def __init__(self, seed: int, size: int):
        rng = np.random.default_rng(seed)
        self.size = size
        self.octaves = [(rng.random((n, n), dtype=np.float32), n) for n in (96, 192, 384, 768, 1536)]

    def rows(self, y0: int, y1: int) -> np.ndarray:
        out = np.zeros((y1 - y0, self.size), np.float32)
        amp, total = 1.0, 0.0
        x = (np.arange(self.size) + 0.5) / self.size
        y = (np.arange(y0, y1) + 0.5) / self.size
        for g, n in self.octaves:
            gx, gy = x * n, y * n
            x0 = np.floor(gx).astype(int); tx = (gx - x0).astype(np.float32); x0 %= n; x1 = (x0 + 1) % n
            iy = np.floor(gy).astype(int); ty = (gy - iy).astype(np.float32)[:, None]; iy0 = np.clip(iy, 0, n - 1); iy1 = np.clip(iy + 1, 0, n - 1)
            tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty)
            v = (g[iy0][:, x0] * (1 - tx) + g[iy0][:, x1] * tx) * (1 - ty) + (g[iy1][:, x0] * (1 - tx) + g[iy1][:, x1] * tx) * ty
            out += amp * (1 - np.abs(2 * v - 1))            # ridged: sharp crests, soft valleys
            total += amp
            amp *= 0.55
        return out / total - 0.62                           # roughly centred on zero


def terrarium(h: np.ndarray) -> np.ndarray:
    v = h + 32768.0
    r = np.floor(v / 256)
    g = np.floor(v - r * 256)
    b = np.floor((v - r * 256 - g) * 256)
    return np.stack([r, g, b], axis=-1).clip(0, 255).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-zoom", type=int, default=6)
    args = ap.parse_args()

    raw = np.asarray(Image.open(WORLD / "elevation.png")).astype(np.float32) - 11000
    elev = np.maximum(raw, 0)  # flat seas
    # soften single-cell spikes and cliffs: raised by the map's exaggeration they become
    # walls that the terrain photo is stretched down
    elev = smooth(elev, 2)
    # land rises from the shore over ~5 cells (~50 km) rather than standing up at the coast
    elev *= coastal_ramp(raw, 5.0)
    # how rugged each place is: ridges grow with height, none on the plains or at sea
    rugged = np.clip(elev / 2500, 0, 1.4).astype(np.float32)
    size = TILE << args.max_zoom
    print(f"relief: {elev.shape[1]}x{elev.shape[0]} -> mercator {size}x{size}, ridges at the finest levels")
    detail = Detail(int(json_seed()) + 77, size)

    def write(z: int, level: np.ndarray, row0: int = 0):
        rgb = terrarium(np.round(level))  # whole metres: smaller tiles, no visible difference
        n = 1 << z
        for x in range(n):
            d = OUT / str(z) / str(x)
            d.mkdir(parents=True, exist_ok=True)
            for yy in range(level.shape[0] // TILE):
                Image.fromarray(rgb[yy * TILE:(yy + 1) * TILE, x * TILE:(x + 1) * TILE]).save(d / f"{row0 + yy}.png", optimize=True)
        return n * (level.shape[0] // TILE)

    # the finest level a band of tile rows at a time (the whole of it would not fit in memory),
    # keeping a half-size copy for the coarser levels
    half = np.empty((size // 2, size // 2), np.float32)
    count = 0
    for ty in range(0, size // TILE):
        y0, y1 = ty * TILE, (ty + 1) * TILE
        band = mercator(elev, size, y0, y1)
        r = mercator(rugged, size, y0, y1)
        band = np.maximum(0, band + detail.rows(y0, y1) * r * 900 * (band > 1))
        count += write(args.max_zoom, band, ty)
        half[y0 // 2:y1 // 2] = band.reshape(TILE // 2, 2, size // 2, 2).mean(axis=(1, 3))
    print(f"z{args.max_zoom}: {count} relief tiles")
    level = half
    for z in range(args.max_zoom - 1, -1, -1):
        n = 1 << z
        if z != args.max_zoom - 1:
            level = level.reshape(n * TILE, 2, n * TILE, 2).mean(axis=(1, 3))
        count += write(z, level)
        print(f"z{z}: {n * n} relief tiles")
    print(f"wrote {count} relief tiles")


def json_seed():
    import json
    try:
        return json.loads((WORLD / "world.json").read_text())["seed"]
    except Exception:
        return 0


if __name__ == "__main__":
    main()
