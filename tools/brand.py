"""Make every size of the game's logo and banner from the two originals.

    python tools/brand.py

Reads  assets/brand/logo.png    the emblem (square, transparent background)
       assets/brand/banner.png  the wide banner for the README
Writes client/public/brand/logo.png    menu, splash and top bar (512 px)
       client/public/brand/icon-64.png browser tab icon
       desktop/build/icon.png          the desktop app's icon (1024 px square)
       docs/banner.png                 the README banner (2000 px wide at most)
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets" / "brand"


def square(img, size):
    """Fit the image in a transparent square without stretching it."""
    img = img.convert("RGBA")
    img.thumbnail((size, size), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, ((size - img.width) // 2, (size - img.height) // 2), img)
    return out


def main():
    logo = Image.open(SRC / "logo.png")
    pub = ROOT / "client" / "public" / "brand"
    pub.mkdir(parents=True, exist_ok=True)
    square(logo, 512).save(pub / "logo.png", optimize=True)
    square(logo, 64).save(pub / "icon-64.png", optimize=True)
    square(logo, 1024).save(ROOT / "desktop" / "build" / "icon.png", optimize=True)
    banner = Image.open(SRC / "banner.png").convert("RGB")
    if banner.width > 2000:
        banner = banner.resize((2000, round(banner.height * 2000 / banner.width)), Image.LANCZOS)
    (ROOT / "docs").mkdir(exist_ok=True)
    banner.save(ROOT / "docs" / "banner.png", optimize=True)
    print("logo, icons and banner written")


if __name__ == "__main__":
    main()
