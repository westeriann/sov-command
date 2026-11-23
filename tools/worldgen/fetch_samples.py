"""Download the real terrain photo samples listed in samples.py.

Usage: python tools/worldgen/fetch_samples.py [--size 1024] [--sheet]

Images are cached in assets/samples/<biome>/<name>.jpg; existing files
are skipped. --sheet also writes assets/samples/contact_sheet.jpg for review.
"""
import argparse
import math
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
from samples import SAMPLES  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets" / "samples"
WMS = (
    "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"
    "?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=BlueMarble_NextGeneration"
    "&STYLES=&CRS=EPSG:4326&BBOX={s},{w},{n},{e}&WIDTH={px}&HEIGHT={px}&FORMAT=image/jpeg"
)


def bbox(lat, lon, span):
    half_lat = span / 2
    half_lon = span / 2 / max(math.cos(math.radians(lat)), 0.2)
    s, n = max(lat - half_lat, -90), min(lat + half_lat, 90)
    w, e = lon - half_lon, lon + half_lon
    return s, w, n, e


def fetch(url, dest, tries=8):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                data = r.read()
            if not data.startswith(b"\xff\xd8"):
                raise RuntimeError(f"not a JPEG: {data[:120]!r}")
            dest.write_bytes(data)
            return
        except Exception as exc:  # network hiccups: back off and retry
            if i == tries - 1:
                raise
            print(f"  retry {i + 1} after error: {exc}")
            time.sleep(min(60, 3 * 2 ** i))  # the imagery server has bad minutes: wait them out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=1024)
    ap.add_argument("--sheet", action="store_true")
    args = ap.parse_args()

    for biome, items in SAMPLES.items():
        (OUT / biome).mkdir(parents=True, exist_ok=True)
        for name, lat, lon, span in items:
            dest = OUT / biome / f"{name}.jpg"
            if dest.exists():
                continue
            s, w, n, e = bbox(lat, lon, span)
            print(f"{biome}/{name}: lat {s:.1f}..{n:.1f} lon {w:.1f}..{e:.1f}")
            fetch(WMS.format(s=s, w=w, n=n, e=e, px=args.size), dest)

    if args.sheet:
        cell, rows = 220, list(SAMPLES.items())
        cols = max(len(v) for v in SAMPLES.values())
        sheet = Image.new("RGB", (cols * cell + 140, len(rows) * cell), "#111")
        d = ImageDraw.Draw(sheet)
        for r, (biome, items) in enumerate(rows):
            d.text((6, r * cell + cell // 2), biome, fill="#fff")
            for c, (name, *_rest) in enumerate(items):
                im = Image.open(OUT / biome / f"{name}.jpg").resize((cell - 6, cell - 6))
                sheet.paste(im, (140 + c * cell, r * cell + 3))
                d.text((144 + c * cell, r * cell + 6), name, fill="#ff0")
        sheet.save(OUT / "contact_sheet.jpg", quality=85)
        print("wrote", OUT / "contact_sheet.jpg")


if __name__ == "__main__":
    main()
