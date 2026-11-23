"""Cut the equirectangular planet into Web Mercator map tiles for the client.

    python tools/worldgen/tiles.py [--max-zoom 7]

Reads world/world.jpg, writes client/public/world/tiles/{z}/{x}/{y}.jpg
(256 px tiles, z0..max-zoom; z7 needs a 32768 px world), rivers.geojson plus client/public/world/terrain.bin, a
compact lookup grid the client uses to say what is under the cursor:

    header  'SCT2' + uint16 width + uint16 height
    biome   uint8  [height][width]  index into world.json "biomes"
    elev    int16  [height][width]  metres, little-endian
    temp    int8   [height][width]  mean temperature, degrees C
    moist   uint8  [height][width]  rainfall index 0..255
"""
import argparse
import json
import shutil
import struct
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(__file__).resolve().parents[2]
WORLD = ROOT / "world"
PUBLIC = ROOT / "client" / "public" / "world"
TILE = 256


def mercator_rows(src, size, r0, r1):
    """Rows r0..r1 of the Web Mercator square of the given size, from the
    equirectangular source (columns linear, rows through inverse Mercator)."""
    h, w, _ = src.shape
    xs = (np.arange(size) + 0.5) / size * w - 0.5
    x0 = np.floor(xs).astype(np.int64)
    fx = (xs - x0).astype(np.float32)[None, :, None]
    x0w, x1w = x0 % w, (x0 + 1) % w
    y = (np.arange(r0, r1) + 0.5) / size
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * y))))
    ys = (90 - lat) / 180 * h - 0.5
    y0 = np.clip(np.floor(ys).astype(np.int64), 0, h - 1)
    y1 = np.clip(y0 + 1, 0, h - 1)
    fy = (ys - np.floor(ys)).astype(np.float32)[:, None, None]
    rows = src[y0].astype(np.float32) * (1 - fy) + src[y1].astype(np.float32) * fy
    return (rows[:, x0w] * (1 - fx) + rows[:, x1w] * fx).clip(0, 255).astype(np.uint8)


def sharpen(img):
    """A light unsharp mask: tiles are seen magnified, so restore the crispness resampling takes away."""
    return img.filter(ImageFilter.UnsharpMask(radius=1.2, percent=45, threshold=2))


def save_level(level, z, quality):
    n = 1 << z
    for x in range(n):
        d = PUBLIC / "tiles" / str(z) / str(x)
        d.mkdir(parents=True, exist_ok=True)
        for y in range(n):
            level.crop((x * TILE, y * TILE, (x + 1) * TILE, (y + 1) * TILE)).save(d / f"{y}.jpg", quality=quality)
    return n * n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-zoom", type=int, default=7)
    ap.add_argument("--quality", type=int, default=88)
    args = ap.parse_args()

    src = np.asarray(Image.open(WORLD / "world.jpg").convert("RGB"))
    # never cut deeper than the source has detail for (one tile pixel per source pixel at the equator)
    max_zoom = min(args.max_zoom, int(np.log2(src.shape[1] / TILE)))
    size = TILE << max_zoom
    print(f"reprojecting {src.shape[1]}x{src.shape[0]} -> mercator {size}x{size}, tiles to z{max_zoom}")
    shutil.rmtree(PUBLIC / "tiles", ignore_errors=True)

    # the deepest level, one band of tile rows at a time (the whole square would not fit in memory),
    # keeping a half-size copy to build the levels above
    n = 1 << max_zoom
    half = Image.new("RGB", (size // 2, size // 2))
    count = 0
    for ty in range(n):
        band = Image.fromarray(mercator_rows(src, size, ty * TILE, (ty + 1) * TILE))
        band = sharpen(band)
        for x in range(n):
            d = PUBLIC / "tiles" / str(max_zoom) / str(x)
            d.mkdir(parents=True, exist_ok=True)
            band.crop((x * TILE, 0, (x + 1) * TILE, TILE)).save(d / f"{ty}.jpg", quality=args.quality)
        half.paste(band.resize((size // 2, TILE // 2), Image.LANCZOS), (0, ty * TILE // 2))
        count += n
    print(f"z{max_zoom}: {n * n} tiles")
    del src
    level = half
    for z in range(max_zoom - 1, -1, -1):
        if z != max_zoom - 1:
            level = level.resize((level.width // 2, level.height // 2), Image.LANCZOS)
        count += save_level(sharpen(level) if z >= 4 else level, z, args.quality)
        print(f"z{z}: {(1 << z) ** 2} tiles")

    meta = json.loads((WORLD / "world.json").read_text())
    biome = np.asarray(Image.open(WORLD / "biome.png"))
    elev = np.asarray(Image.open(WORLD / "elevation.png")).astype(np.int32) - 11000
    temp = np.asarray(Image.open(WORLD / "temperature.png")).astype(np.int16) - 128
    moist = np.asarray(Image.open(WORLD / "moisture.png"))
    step = max(1, biome.shape[1] // 2048)
    biome, elev = biome[::step, ::step], elev[::step, ::step].astype("<i2")
    temp, moist = temp[::step, ::step].astype(np.int8), moist[::step, ::step]
    with open(PUBLIC / "terrain.bin", "wb") as f:
        f.write(b"SCT2" + struct.pack("<HH", biome.shape[1], biome.shape[0]))
        for arr in (biome, elev, temp, moist):
            f.write(np.ascontiguousarray(arr).tobytes())
    meta["tiles"] = {"max_zoom": max_zoom, "tile_size": TILE, "format": "jpg"}
    meta["lookup"] = {"width": int(biome.shape[1]), "height": int(biome.shape[0])}
    (PUBLIC / "world.json").write_text(json.dumps(meta, indent=2))
    shutil.copyfile(WORLD / "rivers.geojson", PUBLIC / "rivers.geojson")
    print(f"wrote {count} tiles and terrain.bin ({biome.shape[1]}x{biome.shape[0]})")


if __name__ == "__main__":
    main()
