"""Generate a planet and texture it with real satellite photos.

    python tools/worldgen/generate.py --seed 300 --width 16384

Pipeline
  1. Elevation: about 24 tectonic plates (continental or oceanic, drifting)
     give continents, mountain chains where plates collide, island arcs and
     rifts; 3D noise on the sphere breaks up the shapes. Sea level is set so
     ~30% of the surface is land.
  2. Climate: temperature from latitude and altitude; rainfall from latitude
     circulation bands and distance from the sea.
  3. Biomes from temperature x rainfall (+ altitude for mountains).
  4. Texture: each biome is painted with NASA Blue Marble photos of real
     terrain using randomised, overlapping patches so the photos do not tile
     visibly; biomes cross-fade; oceans are coloured by depth; relief shading
     comes from the elevation map plus fine noise at full resolution, which
     also roughens the coastline.

Outputs (world/, regenerated, not committed)
  world.jpg        equirectangular colour map, width x width/2
  preview.jpg      2048 x 1024 copy for quick viewing
  elevation.png    16-bit metres + 11000, data resolution
  biome.png        8-bit biome index, data resolution
  temperature.png  8-bit mean temperature in degrees C + 128
  moisture.png     8-bit rainfall index 0..255
  world.json       seed, sizes, biome names, sea level, land fraction
"""
import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).parent))
import hydrology  # noqa: E402
from noise import Perlin3, fbm, ridged, sphere_points  # noqa: E402
from samples import SAMPLES  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
SAMPLE_DIR = ROOT / "assets" / "samples"
OUT = ROOT / "world"
EARTH_KM = 40075.0

BIOMES = [
    "ocean", "ice", "tundra", "boreal", "temperate_forest", "grassland", "steppe",
    "shrubland", "savanna", "rainforest", "desert_sand", "desert_rock",
    "mountain_wet", "mountain_dry", "lake",
]
B = {name: i for i, name in enumerate(BIOMES)}

# Which photo folders paint which biome, and which photos to leave out.
TEXTURE_SOURCES = {
    "ice": ["ice"], "tundra": ["tundra"], "boreal": ["boreal"],
    "temperate_forest": ["temperate_forest"], "grassland": ["grassland"],
    "steppe": ["steppe"], "shrubland": ["shrubland"], "savanna": ["savanna"],
    "rainforest": ["rainforest"], "desert_sand": ["desert_sand"],
    "desert_rock": ["desert_rock"], "mountain_wet": ["mountain:alps"],
    "mountain_dry": ["mountain:puna"],
}
SKIP = {"kitikmeot", "kunlun"}
# Fractional crops (left, top, right, bottom) that cut out snow, sea or lakes.
CROPS = {
    "siberia_east": (0.0, 0.0, 1.0, 0.5),
    "north_australia": (0.0, 0.3, 0.7, 1.0),
    "alps": (0.3, 0.3, 1.0, 0.85),
}


def log(msg, t0=[time.time()]):
    print(f"[{time.time() - t0[0]:6.1f}s] {msg}", flush=True)


def smooth(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def grid(w, h):
    lat = (90 - (np.arange(h) + 0.5) * 180 / h).astype(np.float32)
    lon = (-180 + (np.arange(w) + 0.5) * 360 / w).astype(np.float32)
    return lat, lon


def field(lat, lon, fn, chunk=128):
    out = None
    for r0 in range(0, len(lat), chunk):
        p = sphere_points(lat[r0:r0 + chunk, None], lon[None, :])
        res = fn(p)
        if out is None:
            out = [np.empty((len(lat), len(lon)), np.float32) for _ in res]
        for o, r in zip(out, res):
            o[r0:r0 + chunk] = r
    return out


def wrap_edt(mask):
    """Euclidean distance (pixels) to the nearest False cell, wrapping east-west."""
    pad = mask.shape[1] // 4
    padded = np.concatenate([mask[:, -pad:], mask, mask[:, :pad]], axis=1)
    return ndimage.distance_transform_edt(padded)[:, pad:-pad].astype(np.float32)


def weighted_quantile(values, weights, q):
    idx = np.argsort(values, axis=None)
    v = values.ravel()[idx]
    w = np.broadcast_to(weights, values.shape).ravel()[idx]
    c = np.cumsum(w)
    return float(v[np.searchsorted(c, q * c[-1])])


# ---------------------------------------------------------------- terrain ----
def make_plates(seed, count=24):
    """Random tectonic plates: centre, continental (+1) or oceanic (-1), drift.
    Continental plates are less likely near the poles, so land does not wrap
    around a pole as one ring."""
    rng = np.random.default_rng(seed + 7)
    c = rng.normal(size=(count, 3))
    c /= np.linalg.norm(c, axis=1, keepdims=True)
    p_cont = 0.55 * (1 - 0.8 * np.abs(c[:, 2]) ** 2)
    kind = np.where(rng.random(count) < p_cont, 1.0, -1.0)
    v = np.cross(c, rng.normal(size=(count, 3)))
    v *= (rng.uniform(0.3, 1.0, count) / np.linalg.norm(v, axis=1))[:, None]
    # convergence of plate i towards neighbour j (positive = colliding)
    d = c[None, :, :] - c[:, None, :]
    d /= np.linalg.norm(d, axis=2, keepdims=True) + 1e-9
    conv = np.einsum("ijk,ijk->ij", v[:, None, :] - v[None, :, :], d)
    return c.astype(np.float32), kind.astype(np.float32), np.clip(conv / 1.2, -1, 1).astype(np.float32)


def make_terrain(seed, dw):
    dh = dw // 2
    lat, lon = grid(dw, dh)
    n = [Perlin3(seed + i) for i in range(10)]
    centres, kind, conv_ij = make_plates(seed)

    def shape(p):
        warp = 0.5 * np.stack([
            fbm(n[0], p, 4, freq=1.2, offset=(3.1, 0, 0)),
            fbm(n[0], p, 4, freq=1.2, offset=(0, 7.7, 0)),
            fbm(n[0], p, 4, freq=1.2, offset=(0, 0, 11.3)),
        ])
        q = p + warp
        # plates: nearest and second-nearest centre to the warped point
        pw = q + 0.22 * np.stack([
            fbm(n[9], p, 5, freq=3.5, offset=(1.7, 0, 0)),
            fbm(n[9], p, 5, freq=3.5, offset=(0, 4.1, 0)),
            fbm(n[9], p, 5, freq=3.5, offset=(0, 0, 8.9)),
        ])
        qn = pw / np.linalg.norm(pw, axis=0, keepdims=True)
        dots = np.einsum("k...,nk->n...", qn, centres)
        top = np.argpartition(-dots, 1, axis=0)[:2]
        d2 = np.take_along_axis(dots, top, axis=0)
        first = d2[0] >= d2[1]
        i = np.where(first, top[0], top[1])
        j = np.where(first, top[1], top[0])
        di, dj = np.maximum(d2[0], d2[1]), np.minimum(d2[0], d2[1])
        bd = (np.arccos(np.clip(dj, -1, 1)) - np.arccos(np.clip(di, -1, 1))) * 6371 / 2  # km to boundary
        ki, kj, cv = kind[i], kind[j], conv_ij[i, j]
        wi = 0.5 + 0.5 * smooth(bd, 0, 700)
        plate = wi * ki + (1 - wi) * kj
        collide, pull = np.clip(cv, 0, None), np.clip(-cv, 0, None)
        near = np.exp(-(bd / 260) ** 2)
        side = np.where(ki > 0, 1.0, np.where(kj > 0, 0.15, 0.55))   # ranges on the continental side, arcs at sea
        orogeny = collide * near * side
        rift = pull * np.exp(-(bd / 200) ** 2) * (ki > 0)
        trench = collide * np.exp(-(bd / 140) ** 2) * ((ki < 0) & (kj > 0))

        cont = fbm(n[1], q, 8, freq=1.6)
        belt = smooth(fbm(n[2], p, 3, freq=1.4, offset=(5, 5, 5)), -0.05, 0.3)
        mtn = ridged(n[3], q, 6, freq=3.0)
        detail = fbm(n[4], p, 6, freq=22.0)
        crag = ridged(n[8], p, 4, freq=40.0)
        h = (0.20 * plate + 0.62 * cont
             + 0.30 * orogeny * (0.35 + mtn)
             + 0.10 * mtn * belt
             - 0.10 * rift - 0.08 * trench)
        return h, orogeny * (0.3 + mtn) + 0.45 * mtn ** 2 * belt, detail, crag

    log(f"elevation noise {dw}x{dh}")
    h0, relief, detail, crag = field(lat, lon, shape)
    coslat = np.cos(np.radians(lat))[:, None]

    sea = weighted_quantile(h0, coslat, 0.70)
    # extra roughness near the coast and in uplands breaks smooth outlines
    coastal = np.exp(-((h0 - sea) / 0.06) ** 2)
    h = h0 + (0.035 + 0.03 * coastal) * detail + 0.05 * (crag - 0.45) * (coastal + smooth(relief, 0.1, 0.5))
    sea = weighted_quantile(h, coslat, 0.70)
    land = h > sea
    land_frac = float((land * coslat).sum() / (np.ones_like(h) * coslat).sum())
    log(f"sea level {sea:.3f}, land {land_frac:.1%}")

    km_px = EARTH_KM / dw
    coast_km = wrap_edt(~land) * km_px          # ocean cells: distance to land
    inland_km = wrap_edt(land) * km_px          # land cells: distance to sea

    # land height = gently rising plains + narrow mountain chains from the relief field
    plains = 900 * np.tanh(np.clip(h - sea, 0, None) / 0.12)
    rel = np.clip(relief / np.quantile(relief[land], 0.995), 0, 1.2)
    land_m = plains + 5200 * rel ** 2.2 * (0.6 + 0.4 * (crag + 0.2))
    down = np.clip(sea - h, 0, None) / (sea - h.min())
    ocean_m = -(150 + 6500 * down ** 0.55)
    shelf_km = 40 + 90 * np.clip(0.5 + 1.5 * detail, 0, 1)
    shelf = -(30 + 180 * np.minimum(coast_km / shelf_km, 1.0))
    t_shelf = smooth(coast_km, 0.6 * shelf_km, 1.5 * shelf_km)
    ocean_m = np.minimum(shelf * (1 - t_shelf) + ocean_m * t_shelf, -20)
    elev = np.where(land, land_m, ocean_m).astype(np.float32)

    def climate_noise(p):
        return fbm(n[5], p, 5, freq=3.0), fbm(n[6], p, 5, freq=2.5), fbm(n[7], p, 4, freq=6.0)

    log("climate")
    tn, mn, vn = field(lat, lon, climate_noise)
    alat = np.abs(lat)[:, None]
    temp = 27 - 45 * (alat / 90) ** 1.6 - 6.5 * np.clip(elev, 0, None) / 1000 + 6 * tn
    band = (0.62 * np.exp(-(alat / 13) ** 2) + 0.38 * np.exp(-((alat - 52) / 14) ** 2)
            + 0.18 - 0.22 * np.exp(-((alat - 24) / 9) ** 2))
    moist = band * (0.3 + 0.7 * np.exp(-inland_km / 1300)) + 0.32 * mn + 0.08
    moist = np.clip(moist, 0, 1)

    cell_km2 = (km_px * km_px * coslat * np.ones((1, dw))).astype(np.float32)
    nflat = Perlin3(seed + 77)
    (flat_noise,) = field(lat, lon, lambda p: (fbm(nflat, p, 4, freq=45.0),))
    water = hydrology.build(elev, land, moist, cell_km2, flat_noise=flat_noise, log=log)
    lake = water["lake"]
    land = land | lake                        # lakes belong to the land (and its provinces)
    elev = np.where(lake, water["lake_surface"], elev).astype(np.float32)

    log("biomes")
    t, m, e = temp, moist, elev
    sandy = vn > -0.05
    cls = np.select(
        [~land,
         t < -15,
         (e > 1900) & (m > 0.38), e > 1900,
         t < -1,
         (t < 6) & (m > 0.30), t < 6,
         (t < 19) & (m > 0.55), (t < 19) & (m > 0.36), (t < 19) & (m > 0.22), (t < 19) & (m > 0.12),
         (t < 19),
         (m > 0.62) & (t >= 22), m > 0.58, m > 0.36, m > 0.22,
         sandy],
        [B["ocean"],
         B["ice"],
         B["mountain_wet"], B["mountain_dry"],
         B["tundra"],
         B["boreal"], B["tundra"],
         B["temperate_forest"], B["grassland"], B["steppe"], B["shrubland"],
         B["desert_rock"],
         B["rainforest"], B["temperate_forest"], B["savanna"], B["shrubland"],
         B["desert_sand"]],
        default=B["desert_rock"],
    ).astype(np.uint8)
    cls[lake] = B["lake"]
    sea_ice = smooth(-temp, 11, 16) * (~land)
    return dict(lat=lat, h=h, sea=sea, land=land, elev=elev, temp=temp, moist=moist, relief=rel,
                lake=lake, rivers=water["rivers"], river_class=water["river_class"],
                biome=cls, sea_ice=sea_ice.astype(np.float32), land_frac=land_frac)


# ---------------------------------------------------------------- texture ----
def load_biome_textures(out_km):
    textures = {}
    for biome, sources in TEXTURE_SOURCES.items():
        imgs = []
        for src in sources:
            folder, _, only = src.partition(":")
            for name, lat, _lon, span in SAMPLES[folder]:
                if name in SKIP or (only and name != only):
                    continue
                im = Image.open(SAMPLE_DIR / folder / f"{name}.jpg").convert("RGB")
                km_px = span * 111.2 / im.height
                if name in CROPS:
                    l, t_, r, b_ = CROPS[name]
                    im = im.crop((int(l * im.width), int(t_ * im.height), int(r * im.width), int(b_ * im.height)))
                side = min(im.size)
                im = im.crop(((im.width - side) // 2, (im.height - side) // 2,
                              (im.width + side) // 2, (im.height + side) // 2))
                imgs.append((im, side * km_px / out_km))
        size = max(16, int(min(s for _, s in imgs)))
        arrs = [np.asarray(im.resize((size, size), Image.LANCZOS), dtype=np.float32) for im, _ in imgs]
        mu = np.mean([a.mean((0, 1)) for a in arrs], axis=0)
        sd = np.mean([a.std((0, 1)) for a in arrs], axis=0)
        variants = []
        for a in arrs:
            # pull every photo towards the biome's average colour and contrast so
            # neighbouring patches from different photos do not show as squares
            a_mu, a_sd = a.mean((0, 1)), a.std((0, 1)) + 1e-3
            norm = (a - a_mu) * (sd / a_sd) + mu
            a = 0.25 * a + 0.75 * norm
            for k in range(4):
                r = np.rot90(a, k)
                variants += [r, r[:, ::-1]]
        textures[biome] = np.stack(variants)
    return textures


class Bomber:
    """Stochastic tiling: four half-offset grids of randomly chosen, randomly
    placed, rotated/flipped photo patches, blended with weights that sum to 1."""

    def __init__(self, stack, ow, oh, rng):
        self.stack = stack
        self.size = stack.shape[1]
        c = 1 << int(np.log2(max(8, self.size * 0.75)))
        self.c, self.ow = c, ow
        ncx, ncy = ow // c, oh // c + 2
        self.tables = []
        for _ in range(4):
            self.tables.append((
                rng.integers(len(stack), size=(ncy, ncx)),
                rng.integers(0, self.size - c + 1, size=(ncy, ncx)),
                rng.integers(0, self.size - c + 1, size=(ncy, ncx)),
            ))

    def render(self, ys, coslat):
        c, ow = self.c, self.ow
        xs = np.arange(ow)
        out = np.zeros((len(ys), ow, 3), np.float32)
        wsum = np.zeros((len(ys), ow), np.float32)
        for k, (var, oxs, oys) in enumerate(self.tables):
            sx, sy = (c // 2) * (k & 1), (c // 2) * (k >> 1)
            yy, xx = ys + sy, (xs + sx) % ow
            cy, cx = yy // c, xx // c
            ly, lx = yy - cy * c, xx - cx * c
            w = (1 - np.abs(2 * (ly + 0.5) / c - 1))[:, None] * (1 - np.abs(2 * (lx + 0.5) / c - 1))[None, :]
            lxs = np.minimum((lx[None, :] * coslat[:, None]).astype(np.int32), c - 1)
            v = var[cy[:, None], cx[None, :]]
            px = self.stack[v, oys[cy[:, None], cx[None, :]] + ly[:, None], oxs[cy[:, None], cx[None, :]] + lxs]
            out += px * w[..., None]
            wsum += w
        return out / wsum[..., None]


def ocean_colour(depth_m):
    stops = np.array([0, 60, 200, 1200, 3500, 7000], np.float32)
    cols = np.array([[38, 104, 124], [28, 84, 112], [19, 60, 96], [12, 40, 78], [8, 27, 58], [6, 20, 46]], np.float32)
    d = np.clip(-depth_m, 0, 7000)
    return np.stack([np.interp(d, stops, cols[:, i]) for i in range(3)], axis=-1)


def hillshade(elev, dw, lat):
    km_px = EARTH_KM / dw
    z = np.clip(elev, 0, None) * 0.001 * 18          # km, vertically exaggerated
    dzdx = (np.roll(z, -1, 1) - np.roll(z, 1, 1)) / (2 * km_px * np.cos(np.radians(lat))[:, None].clip(0.05))
    dzdy = (np.roll(z, 1, 0) - np.roll(z, -1, 0)) / (2 * km_px)
    lx, ly, lz = -0.55, 0.55, 0.63                   # light from the north-west
    shade = (lx * -dzdx + ly * -dzdy + lz) / np.sqrt(dzdx ** 2 + dzdy ** 2 + 1)
    return (shade / lz).astype(np.float32)


class RowSampler:
    """Bilinear resampling of data-resolution grids to output rows, one strip at
    a time, wrapping east-west. Keeps memory flat at any output size."""

    def __init__(self, dw, ow):
        f = ow / dw
        sx = (np.arange(ow) + 0.5) / f - 0.5
        x0 = np.floor(sx).astype(np.int64)
        self.fx = (sx - x0).astype(np.float32)
        self.x0, self.x1 = x0 % dw, (x0 + 1) % dw
        self.f = f

    def __call__(self, a, ys):
        dh = a.shape[0]
        sy = (ys + 0.5) / self.f - 0.5
        y0 = np.floor(sy).astype(np.int64)
        fy = (sy - y0).astype(np.float32)[:, None]
        y0c, y1c = np.clip(y0, 0, dh - 1), np.clip(y0 + 1, 0, dh - 1)
        rows = a[y0c] * (1 - fy) + a[y1c] * fy
        return rows[:, self.x0] * (1 - self.fx) + rows[:, self.x1] * self.fx


def draw_rivers(rivers, ow, oh):
    """Rasterise river lines at full resolution: a sharp water mask and a wide,
    soft riparian (river-bank vegetation) mask."""
    water = Image.new("L", (ow, oh), 0)
    banks = Image.new("L", (ow, oh), 0)
    dw_, db_ = ImageDraw.Draw(water), ImageDraw.Draw(banks)
    scale = ow / 16384
    for pts, k, _q in rivers:
        xy = np.stack([(pts[:, 0] + 180) / 360 * ow, (90 - pts[:, 1]) / 180 * oh], 1)
        xy = [tuple(v) for v in xy.tolist()]
        width = max(1, round([1, 1, 2, 2, 3][k - 1] * scale))
        dw_.line(xy, fill=255, width=width, joint="curve")
        if k >= 2:
            db_.line(xy, fill=255, width=max(2, round((4 + 3 * k) * scale)), joint="curve")
    water = water.filter(ImageFilter.GaussianBlur(0.6))
    banks = banks.filter(ImageFilter.GaussianBlur(5 * scale + 1))
    return np.asarray(water), np.asarray(banks)


def make_texture(terrain, seed, ow, dw):
    oh = ow // 2
    rng = np.random.default_rng(seed + 99)
    out_km = EARTH_KM / ow
    log(f"loading photo samples at {out_km:.2f} km/px")
    textures = load_biome_textures(out_km)
    bombers = {b: Bomber(stack, ow, oh, rng) for b, stack in textures.items()}

    log("biome weights")
    weights = {}
    pad = dw // 4
    no_tex = ~terrain["land"] | terrain["lake"]
    sea_mask = np.concatenate([no_tex[:, -pad:], no_tex, no_tex[:, :pad]], axis=1)
    _, (iy, ix) = ndimage.distance_transform_edt(sea_mask, return_indices=True)
    iy, ix = iy[:, pad:-pad], (ix[:, pad:-pad] - pad) % dw
    filled = terrain["biome"][iy, ix]      # every sea cell takes its nearest land biome
    for b in textures:
        m = (filled == B[b]).astype(np.float32)
        if m.any():
            weights[b] = ndimage.gaussian_filter(m, 1.3, mode=("nearest", "wrap"))
    height = (terrain["h"] - terrain["sea"]).astype(np.float32)
    upland = smooth(terrain["elev"], 150, 2200).astype(np.float32)
    n_coast, n_micro = Perlin3(seed + 60), Perlin3(seed + 61)
    lat_o, lon_o = grid(ow, oh)
    shade = np.clip(hillshade(terrain["elev"], dw, terrain["lat"]), 0.35, 1.5)
    nvar = Perlin3(seed + 50)
    (tone,) = field(terrain["lat"], grid(dw, dw // 2)[1], lambda p: (fbm(nvar, p, 4, freq=5.0),))
    # water colour comes from a softened depth map so shallows have no stair-steps
    sea_depth = ndimage.gaussian_filter(np.minimum(terrain["elev"], 0), 1.6, mode=("nearest", "wrap"))
    rs = RowSampler(dw, ow)
    coslat = np.cos(np.radians(grid(ow, oh)[0]))

    log(f"drawing {len(terrain['rivers']):,} rivers")
    river_px, riparian = draw_rivers(terrain["rivers"], ow, oh)
    lake_soft = ndimage.gaussian_filter(terrain["lake"].astype(np.float32), 1.0, mode=("nearest", "wrap"))
    lake_ice = smooth(-terrain["temp"], 6, 12).astype(np.float32)
    dryness = (1 - terrain["moist"]).astype(np.float32)

    img = np.empty((oh, ow, 3), np.uint8)
    strip = 256
    for r0 in range(0, oh, strip):
        ys = np.arange(r0, min(oh, r0 + strip))
        sl = slice(r0, r0 + len(ys))
        ws = {b: rs(w, ys) for b, w in weights.items()}
        total = sum(ws.values()) + 1e-6
        landc = np.zeros((len(ys), ow, 3), np.float32)
        for b, w in ws.items():
            wb = w / total
            if wb.max() < 1e-3:
                continue
            landc += bombers[b].render(ys, coslat[sl]) * wb[..., None]
        tn = rs(tone, ys)
        landc *= (1 + 0.10 * tn)[..., None] * (1 + 0.55 * (rs(shade, ys) - 1))[..., None]
        ocean = ocean_colour(rs(sea_depth, ys)) * (1 + 0.06 * tn)[..., None]
        si = rs(terrain["sea_ice"], ys)[..., None]
        if si.max() > 1e-3:
            ocean = ocean * (1 - si) + bombers["ice"].render(ys, coslat[sl]) * 0.93 * si
        # full-resolution noise: fractal coastline and fine relief shading
        p = sphere_points(lat_o[sl][:, None], lon_o[None, :])
        coast_noise = fbm(n_coast, p, 6, freq=140.0)
        micro = ridged(n_micro, p, 3, freq=300.0)
        relief = (np.roll(micro, 1, axis=1) - np.roll(micro, -1, axis=1)) * (0.3 + 0.7 * rs(upland, ys))
        landc *= (1 + 1.1 * relief)[..., None]
        # green strips along rivers in dry country (oases, like the Nile)
        rip = riparian[sl].astype(np.float32)[..., None] / 255 * (0.25 + 0.6 * rs(dryness, ys))[..., None]
        if rip.max() > 0.01:
            landc = landc * (1 - rip) + bombers["temperate_forest"].render(ys, coslat[sl]) * 1.05 * rip
        a = smooth(rs(height, ys) + 0.012 * coast_noise, -0.0012, 0.0012)[..., None]
        out = landc * a + ocean * (1 - a)
        # lakes: a softened mask with the same fractal shoreline noise
        la = smooth(rs(lake_soft, ys) - 0.5 + 0.22 * coast_noise, -0.06, 0.06)[..., None]
        if la.max() > 0:
            lake_col = np.array([24, 64, 92], np.float32) * (1 + 0.05 * tn)[..., None]
            li = rs(lake_ice, ys)[..., None]
            lake_col = lake_col * (1 - li) + bombers["ice"].render(ys, coslat[sl]) * 0.9 * li
            out = out * (1 - la) + lake_col * la
        rv = (river_px[sl].astype(np.float32) / 255)[..., None] * a * 0.9
        out = out * (1 - rv) + np.array([30, 62, 82], np.float32) * rv
        img[sl] = np.clip(out, 0, 255).astype(np.uint8)
        if (r0 // strip) % 8 == 0:
            log(f"texture rows {r0}/{oh}")
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=300)
    ap.add_argument("--width", type=int, default=16384, help="colour map width (power of two)")
    ap.add_argument("--data-width", type=int, default=4096, help="elevation/climate grid width")
    args = ap.parse_args()
    OUT.mkdir(exist_ok=True)

    terrain = make_terrain(args.seed, args.data_width)
    elev16 = np.clip(terrain["elev"] + 11000, 0, 65535).astype(np.uint16)
    Image.fromarray(elev16).save(OUT / "elevation.png")
    Image.fromarray(terrain["biome"]).save(OUT / "biome.png")
    Image.fromarray(np.clip(np.round(terrain["temp"]) + 128, 0, 255).astype(np.uint8)).save(OUT / "temperature.png")
    Image.fromarray(np.clip(terrain["moist"] * 255, 0, 255).astype(np.uint8)).save(OUT / "moisture.png")
    Image.fromarray(terrain["river_class"]).save(OUT / "rivers.png")
    features = [{"type": "Feature", "properties": {"c": k, "q": round(q)},
                 "geometry": {"type": "LineString", "coordinates": np.round(pts, 3).tolist()}}
                for pts, k, q in terrain["rivers"]]
    (OUT / "rivers.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": features},
                                                   separators=(",", ":")))

    img = make_texture(terrain, args.seed, args.width, args.data_width)
    im = Image.fromarray(img)
    im.save(OUT / "world.jpg", quality=92)
    im.resize((2048, 1024), Image.LANCZOS).save(OUT / "preview.jpg", quality=88)

    counts = np.bincount(terrain["biome"].ravel(), minlength=len(BIOMES))
    meta = dict(seed=args.seed, width=args.width, data_width=args.data_width,
                land_fraction=round(terrain["land_frac"], 4), biomes=BIOMES,
                biome_cells={b: int(c) for b, c in zip(BIOMES, counts)},
                elevation_encoding="uint16 PNG, metres + 11000",
                imagery_credit="NASA Earth Observatory, Blue Marble: Next Generation")
    (OUT / "world.json").write_text(json.dumps(meta, indent=2))
    log("done")


if __name__ == "__main__":
    main()
