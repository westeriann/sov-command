"""Divide the generated planet into provinces, sea zones and starting nations.

    python tools/worldgen/provinces.py [--land 4000] [--sea 600] [--nations 150]

Run after generate.py. Reads world/ and writes, for the client:
  client/public/world/provinces.json   provinces, sea zones and nations
  client/public/world/provinces.bin    province id for every map cell
  client/public/world/borders.geojson  border lines (province, nation, coast, sea)

How it works
  1. Seeds are spread with density weighted towards fertile lowlands and
     coasts, then relaxed (Lloyd's algorithm on the sphere) so provinces are
     compact: small and numerous where people would live, large in deserts,
     tundra and mountains.
  2. Each cell joins its nearest seed after a noise warp, so borders wander.
     Near borders a watershed pass lets them settle on ridges.
  3. Detached pieces become island provinces when big enough.
  4. Nations grow outward from capitals over the province graph; mountains,
     deserts and water slow them down, so borders follow natural barriers and
     nearby islands join the mainland nation.
  5. Population and resources come from terrain, climate and noise.
"""
import argparse
import sys as _sys
import heapq
import json
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.spatial import cKDTree
from skimage.measure import label as connected
from skimage.segmentation import watershed

sys.path.insert(0, str(Path(__file__).parent))
from generate import BIOMES, grid, log, smooth, wrap_edt  # noqa: E402
from noise import Perlin3, fbm, sphere_points  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
_sys.setrecursionlimit(100000)
WORLD = ROOT / "world"
PUBLIC = ROOT / "client" / "public" / "world"
R_KM = 6371.0
WORLD_POPULATION = 8.1e9

HABITABILITY = {
    "ocean": 0, "ice": 0.02, "tundra": 0.12, "boreal": 0.35, "temperate_forest": 0.85,
    "grassland": 1.0, "steppe": 0.45, "shrubland": 0.45, "savanna": 0.6, "rainforest": 0.5,
    "desert_sand": 0.08, "desert_rock": 0.1, "mountain_wet": 0.25, "mountain_dry": 0.12, "lake": 0,
}
FARMING = {
    "ocean": 0, "ice": 0, "tundra": 0.02, "boreal": 0.15, "temperate_forest": 0.7,
    "grassland": 1.0, "steppe": 0.35, "shrubland": 0.25, "savanna": 0.5, "rainforest": 0.3,
    "desert_sand": 0.02, "desert_rock": 0.03, "mountain_wet": 0.12, "mountain_dry": 0.04, "lake": 0,
}
FOREST = {
    "rainforest": 1.0, "boreal": 0.9, "temperate_forest": 0.8, "savanna": 0.2, "mountain_wet": 0.4,
    "grassland": 0.1, "shrubland": 0.1,
}
# cost for a nation to expand into a province of this terrain
EXPANSION_COST = {
    "ice": 6, "tundra": 2.2, "boreal": 1.6, "temperate_forest": 1.1, "grassland": 1.0,
    "steppe": 1.3, "shrubland": 1.3, "savanna": 1.2, "rainforest": 1.8, "desert_sand": 2.6,
    "desert_rock": 2.4, "mountain_wet": 3.2, "mountain_dry": 3.6, "lake": 2.5,
}
SEA_CROSSING = 3.5

SYLLABLES = (
    "al an ar as av ba bel bor bra ca cor da dor dra el en er es fa fen gal gar hal han "
    "is ka kar kel kor la len lor lu ma mar mer mir mo na nor o ol or pa pel ra ran rel "
    "ro sa sel sen sor ta tal tar tor u ul ur va val ven vir za zar zel ki mi su te ny "
    "qa sha tse khe ji wen yu lo ae io ou ei"
).split()
ENDINGS = "ia a or en ar stan land os is um ova heim grad ica ene ar mark ad un ir".split()
NATION_FORMS = [
    "Republic of {}", "Kingdom of {}", "{} Federation", "Union of {}", "{} Commonwealth",
    "Democratic Republic of {}", "{} Confederation", "Grand Duchy of {}", "Sultanate of {}",
    "Federal Republic of {}", "People's Republic of {}", "Emirate of {}", "{} Republic",
    "United States of {}", "Principality of {}",
]
PALETTE = [
    "#4f86c6", "#c8574a", "#d6a73e", "#5aa469", "#8f6fc1", "#d9773a",
    "#3fa7a3", "#c25c8f", "#8a9a3b", "#b98a5e", "#6d7f99", "#e0c95a",
]
MIN_NATION_PROVINCES = 4


# ---------------------------------------------------------------- helpers ----
def lloyd(cells, weight, n, iters, rng):
    """Weighted centroidal Voronoi seeds on the sphere. cells: (M,3) unit vectors."""
    p = weight / weight.sum()
    seeds = cells[rng.choice(len(cells), n, replace=False, p=p)].copy()
    for _ in range(iters):
        _, a = cKDTree(seeds).query(cells, workers=-1)
        mass = np.bincount(a, weights=weight, minlength=n)
        new = np.stack([np.bincount(a, weights=weight * cells[:, k], minlength=n) for k in range(3)], 1)
        ok = mass > 0
        new[ok] /= np.linalg.norm(new[ok], axis=1, keepdims=True)
        seeds[ok] = new[ok]
    return seeds


def warped(cells, noise, amp, freq):
    q = cells.T
    w = np.stack([fbm(noise, q, 4, freq=freq, offset=o) for o in ((2.3, 0, 0), (0, 5.1, 0), (0, 0, 9.7))])
    out = (q + amp * w).T
    return out / np.linalg.norm(out, axis=1, keepdims=True)


def pad_x(a, pad):
    return np.concatenate([a[:, -pad:], a, a[:, :pad]], axis=1)


def make_name(rng, lang, ending=True):
    n = rng.integers(1, 3) + (0 if ending else 1)
    s = "".join(rng.choice(lang, n))
    if ending:
        s += rng.choice(ENDINGS)
    s = s.replace("aa", "a").replace("ii", "i").replace("uu", "u")
    return s[:1].upper() + s[1:]


def rdp(pts, eps):
    """Ramer-Douglas-Peucker line simplification."""
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    ab = b - a
    L = np.hypot(*ab)
    rel = pts - a
    d = np.abs(ab[0] * rel[:, 1] - ab[1] * rel[:, 0]) / L if L > 0 else np.hypot(rel[:, 0], rel[:, 1])
    i = int(np.argmax(d))
    if d[i] > eps:
        return np.vstack([rdp(pts[: i + 1], eps)[:-1], rdp(pts[i:], eps)])
    return np.array([a, b])


def chaikin(pts, rounds=2):
    closed = len(pts) > 3 and np.allclose(pts[0], pts[-1])
    for _ in range(rounds):
        if len(pts) < 3:
            break
        q = 0.75 * pts[:-1] + 0.25 * pts[1:]
        r = 0.25 * pts[:-1] + 0.75 * pts[1:]
        mid = np.empty((2 * len(q), 2))
        mid[0::2], mid[1::2] = q, r
        pts = np.vstack([mid, mid[:1]]) if closed else np.vstack([pts[:1], mid, pts[-1:]])
    return pts


def chain(segs):
    """Join unit pixel-edge segments ((x0,y0),(x1,y1)) into polylines."""
    nbr = {}
    for i, (x0, y0, x1, y1) in enumerate(segs):
        nbr.setdefault((x0, y0), []).append(i)
        nbr.setdefault((x1, y1), []).append(i)
    used = np.zeros(len(segs), bool)
    lines = []
    starts = [p for p, v in nbr.items() if len(v) != 2] + list(nbr)
    for start in starts:
        for si in nbr[start]:
            if used[si]:
                continue
            line, cur, s = [start], start, si
            while s is not None:
                used[s] = True
                x0, y0, x1, y1 = segs[s]
                cur = (x1, y1) if (x0, y0) == cur else (x0, y0)
                line.append(cur)
                nxt = [k for k in nbr[cur] if not used[k]]
                s = nxt[0] if len(nbr[cur]) == 2 and nxt else None
            lines.append(np.array(line, float))
    return lines


# ------------------------------------------------------------------- main ----
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--land", type=int, default=4000)
    ap.add_argument("--sea", type=int, default=600)
    ap.add_argument("--nations", type=int, default=150)
    args = ap.parse_args()

    meta = json.loads((WORLD / "world.json").read_text())
    seed = meta["seed"]
    rng = np.random.default_rng(seed + 1000)
    elev = np.asarray(Image.open(WORLD / "elevation.png")).astype(np.int32) - 11000
    # provinces, names and nations come from the original biome rules (so they stay the same when the
    # land's look changes); each province's terrain label comes from the current biomes
    biome_now = np.asarray(Image.open(WORLD / "biome.png"))
    biome = np.asarray(Image.open(WORLD / "biome_legacy.png")) if (WORLD / "biome_legacy.png").exists() else biome_now
    moist = np.asarray(Image.open(WORLD / "moisture.png")).astype(np.float32) / 255
    river_class = np.asarray(Image.open(WORLD / "rivers.png"))
    lake2d = biome == BIOMES.index("lake")
    H, W = elev.shape
    lat, lon = grid(W, H)
    P = sphere_points(lat[:, None], lon[None, :]).reshape(3, -1).T          # (H*W, 3)
    cell_km2 = ((2 * np.pi * R_KM / W) * (np.pi * R_KM / H) * np.cos(np.radians(lat)))[:, None].repeat(W, 1).ravel()
    land = (biome != BIOMES.index("ocean")).ravel()       # lakes count as land
    land2d = land.reshape(H, W)
    km_px = 2 * np.pi * R_KM / W
    inland_km = wrap_edt(land2d).ravel() * km_px
    coast_km = wrap_edt(~land2d).ravel() * km_px
    hab = np.array([HABITABILITY[b] for b in BIOMES], np.float32)[biome.ravel()]
    hab = hab * (1 + 0.5 * np.exp(-inland_km / 150)) * land

    # ---- seeds -------------------------------------------------------------
    land_idx, sea_idx = np.flatnonzero(land), np.flatnonzero(~land)
    log(f"{len(land_idx):,} land cells, {len(sea_idx):,} sea cells")
    land_w = cell_km2[land_idx] * (0.12 + hab[land_idx])
    land_seeds = lloyd(P[land_idx], land_w, args.land, 4, rng)
    sea_w = cell_km2[sea_idx] * (1 + 2.0 * np.exp(-coast_km[sea_idx] / 400))
    sea_seeds = lloyd(P[sea_idx], sea_w, args.sea, 3, rng)
    log("seeds placed")

    # ---- land: nearest warped seed, then watershed near borders --------------
    land_area = cell_km2[land_idx].sum()
    r = np.sqrt(land_area / args.land) / R_KM                     # typical province radius (radians)
    nwarp = Perlin3(seed + 1001)
    lw = warped(P[land_idx], nwarp, 0.45 * r, 1.2 / r)
    d, a = cKDTree(land_seeds).query(lw, k=2, workers=-1)
    labels = np.zeros(H * W, np.int32)
    # only the heart of each province is fixed; the rest is settled by the terrain below
    core = (d[:, 1] - d[:, 0]) > 0.4 * r  # a small heart: most of each province is settled by rivers and ridges
    labels[land_idx[core]] = a[core, 0] + 1
    # borders follow rivers where one runs nearby (rivers are walls the flood cannot cross),
    # otherwise they settle on ridges
    # big rivers are wide walls, so a border anywhere near one snaps onto it
    rivers = ndimage.binary_dilation(river_class >= 2, iterations=1) | ndimage.binary_dilation(river_class >= 3, iterations=2)
    sph = P.T.reshape(3, H, W)
    relief = ((elev.astype(np.float32) / 1500.0) + 8.0 * rivers + 2.0 * (river_class >= 4)
              # coarse wander plus fine raggedness: borders are irregular, not straight or gently curved
              + 0.2 * np.abs(fbm(Perlin3(seed + 1002), sph, 3, freq=1.0 / r))
              + 0.45 * np.abs(fbm(Perlin3(seed + 1003), sph, 3, freq=5.0 / r)))
    pad = W // 8
    ws = watershed(pad_x(relief, pad), pad_x(labels.reshape(H, W), pad), mask=pad_x(land2d, pad))[:, pad:-pad]
    labels = ws.ravel().astype(np.int32)
    missing = land & (labels == 0)
    labels[missing] = a[np.searchsorted(land_idx, np.flatnonzero(missing)), 0] + 1
    log("land provinces assigned")

    # ---- detached pieces: big islands become provinces, slivers merge ---------
    lab2d = labels.reshape(H, W)
    comp = connected(lab2d, background=0, connectivity=1)
    parent = np.arange(comp.max() + 1)

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    for y in np.flatnonzero((lab2d[:, 0] == lab2d[:, -1]) & (lab2d[:, 0] > 0)):   # join across the dateline
        ra, rb = find(comp[y, 0]), find(comp[y, -1])
        if ra != rb:
            parent[rb] = ra
    roots = np.array([find(i) for i in range(len(parent))])
    comp = roots[comp]
    comp_area = np.bincount(comp.ravel(), weights=cell_km2, minlength=len(parent))
    comp_prov = np.zeros(len(parent), np.int64)
    comp_prov[comp.ravel()] = lab2d.ravel()
    main_comp = {}
    for c in np.flatnonzero(comp_area > 0):
        if c == 0:
            continue
        pv = comp_prov[c]
        if pv not in main_comp or comp_area[c] > comp_area[main_comp[pv]]:
            main_comp[pv] = c
    next_id = args.land + 1
    min_island = 0.25 * land_area / args.land
    slices = ndimage.find_objects(comp)
    for c in np.flatnonzero(comp_area > 0):
        if c == 0 or main_comp[comp_prov[c]] == c:
            continue
        sl = slices[c - 1]
        if sl is None:
            continue
        sl = (slice(max(sl[0].start - 1, 0), sl[0].stop + 1), slice(max(sl[1].start - 1, 0), sl[1].stop + 1))
        piece = comp[sl] == c
        ring = ndimage.binary_dilation(piece) & ~piece
        around = lab2d[sl][ring]
        around = around[(around > 0) & (around != comp_prov[c])]
        if len(around):                                   # touches another province: merge into it
            lab2d[sl][piece] = np.bincount(around).argmax()
        elif comp_area[c] >= min_island:                  # sizeable separate island: own province
            lab2d[sl][piece] = next_id
            next_id += 1
    labels = lab2d.ravel()
    ids = np.unique(labels[labels > 0])
    remap = np.zeros(labels.max() + 1, np.int32)
    remap[ids] = np.arange(1, len(ids) + 1)
    labels = remap[labels]
    n_land = len(ids)
    log(f"{n_land} land provinces after islands")

    # ---- sea zones -------------------------------------------------------------
    sw = warped(P[sea_idx], nwarp, 0.3 * np.sqrt((cell_km2[sea_idx].sum()) / args.sea) / R_KM, 1.0 / r)
    _, sa = cKDTree(sea_seeds).query(sw, workers=-1)
    labels[sea_idx] = n_land + 1 + sa
    ids = np.unique(labels)
    remap = np.zeros(labels.max() + 1, np.int32)
    remap[ids] = np.arange(1, len(ids) + 1)
    labels = remap[labels]
    n_total = len(ids)
    n_sea = n_total - n_land
    lab2d = labels.reshape(H, W)
    log(f"{n_sea} sea zones")

    # ---- statistics ----------------------------------------------------------------
    N = n_total + 1
    area = np.bincount(labels, weights=cell_km2, minlength=N)
    cen = np.stack([np.bincount(labels, weights=cell_km2 * P[:, k], minlength=N) for k in range(3)], 1)
    cen /= np.linalg.norm(cen, axis=1, keepdims=True) + 1e-12
    mean_elev = np.bincount(labels, weights=cell_km2 * elev.ravel(), minlength=N) / np.maximum(area, 1)
    max_elev = np.asarray(ndimage.maximum(elev, lab2d, index=np.arange(N)))
    biggest_river = np.asarray(ndimage.maximum(river_class, lab2d, index=np.arange(N))).astype(int)
    lake_km2 = np.bincount(labels, weights=cell_km2 * lake2d.ravel(), minlength=N)
    mean_hab = np.bincount(labels, weights=cell_km2 * hab, minlength=N) / np.maximum(area, 1)
    mean_moist = np.bincount(labels, weights=cell_km2 * moist.ravel(), minlength=N) / np.maximum(area, 1)
    bc = np.bincount(labels * len(BIOMES) + biome.ravel(), weights=cell_km2, minlength=N * len(BIOMES))
    bc = bc.reshape(N, len(BIOMES))
    bc_land = bc.copy()
    bc_land[:, BIOMES.index("lake")] *= 0.25          # a province is only "lake" if it is mostly water
    dominant = bc_land.argmax(1)
    bc_now = np.bincount(labels * len(BIOMES) + biome_now.ravel(), weights=cell_km2, minlength=N * len(BIOMES)).reshape(N, len(BIOMES))
    bc_now[:, BIOMES.index("lake")] *= 0.25
    dominant_now = bc_now.argmax(1)
    share = bc / np.maximum(bc.sum(1, keepdims=True), 1)

    # label point: the cell furthest from the province's edge
    edge = (lab2d != np.roll(lab2d, 1, 1)) | (lab2d != np.roll(lab2d, -1, 1))
    edge[1:] |= lab2d[1:] != lab2d[:-1]
    edge[:-1] |= lab2d[:-1] != lab2d[1:]
    inner = ndimage.distance_transform_edt(~edge)
    label_pos = ndimage.maximum_position(inner, lab2d, index=np.arange(1, N))

    # ---- adjacency -------------------------------------------------------------------
    pairs = []
    for a_, b_ in ((lab2d, np.roll(lab2d, -1, 1)), (lab2d[:-1], lab2d[1:])):
        m = a_ != b_
        pairs.append(np.stack([np.minimum(a_[m], b_[m]), np.maximum(a_[m], b_[m])], 1))
    pairs, counts = np.unique(np.vstack(pairs), axis=0, return_counts=True)
    adj = [[] for _ in range(N)]
    for (pa, pb), c in zip(pairs, counts):
        adj[pa].append(int(pb))
        adj[pb].append(int(pa))
    is_land = np.zeros(N, bool)
    is_land[1:n_land + 1] = True
    coastal = np.array([is_land[i] and any(not is_land[j] for j in adj[i]) for i in range(N)])
    log(f"{len(pairs):,} adjacencies")

    # ---- nations ---------------------------------------------------------------------
    land_ids = np.arange(1, n_land + 1)
    spacing = 0.8 * np.sqrt(land_area / args.nations) / R_KM
    order = land_ids[np.argsort(-(mean_hab[land_ids] + 0.15) * rng.random(n_land))]
    capitals = []
    for pid in order:
        if area[pid] < 0.3 * land_area / args.land:
            continue
        if capitals and np.max(cen[capitals] @ cen[pid]) > np.cos(spacing):
            continue
        capitals.append(int(pid))
        if len(capitals) == args.nations:
            break
    strength = rng.lognormal(0, 0.35, len(capitals))
    owner = np.zeros(N, np.int32)
    best = np.full(N, np.inf)
    heap = []
    for k, cp in enumerate(capitals):
        best[cp] = 0
        heap.append((0.0, cp, k + 1))
    heapq.heapify(heap)
    cost_of = np.array([EXPANSION_COST.get(BIOMES[b], 1.0) for b in dominant])
    while heap:
        c, pid, nat = heapq.heappop(heap)
        if c > best[pid] or (owner[pid] and owner[pid] != nat):
            continue
        if is_land[pid]:
            owner[pid] = nat
        for q in adj[pid]:
            step = (cost_of[q] if is_land[q] else SEA_CROSSING) / strength[nat - 1]
            step *= np.sqrt(area[q] / (land_area / args.land)) if is_land[q] else 1.0
            nc = c + step
            if nc < best[q]:
                best[q] = nc
                heapq.heappush(heap, (nc, q, nat))
    # fold very small nations into the nearest other nation
    counts = np.bincount(owner[1:n_land + 1], minlength=len(capitals) + 1)
    small = [k for k in range(1, len(capitals) + 1) if counts[k] < MIN_NATION_PROVINCES]
    if small:
        big_ids = land_ids[~np.isin(owner[land_ids], small)]
        tree = cKDTree(cen[big_ids])
        for k in small:
            mine = land_ids[owner[land_ids] == k]
            _, nn = tree.query(cen[mine])
            owner[mine] = owner[big_ids[nn]]
        keep = [k for k in range(1, len(capitals) + 1) if k not in small]
        renum = np.zeros(len(capitals) + 1, np.int32)
        renum[keep] = np.arange(1, len(keep) + 1)
        owner = renum[owner]
        capitals = [capitals[k - 1] for k in keep]
    log(f"{len(capitals)} nations ({len(small)} tiny ones merged)")

    # ---- population and resources ------------------------------------------------
    pts = cen[1:].T
    rnoise = {k: fbm(Perlin3(seed + 2000 + i), pts, 4, freq=f)
              for i, (k, f) in enumerate([("oil", 9), ("gas", 9), ("coal", 7), ("ore", 11), ("rare", 14), ("pop", 6)])}
    rn = {k: np.concatenate([[0], v]) for k, v in rnoise.items()}
    weight = area * mean_hab ** 1.5 * (1 + 0.4 * coastal) * np.exp(0.8 * rn["pop"])
    weight[~is_land] = 0
    weight[capitals] *= 3
    population = WORLD_POPULATION * weight / weight.sum()
    farm = np.array([FARMING[b] for b in BIOMES])
    forest = np.array([FOREST.get(b, 0) for b in BIOMES])
    lowland = smooth(-mean_elev, -900, -200)
    dry_or_cold = share[:, [BIOMES.index(b) for b in ("desert_sand", "desert_rock", "steppe", "tundra")]].sum(1)
    upland = smooth(max_elev, 600, 2500)
    shelf = (~is_land) & (mean_elev > -400)

    def score(x):
        return np.clip(np.round(x * 100), 0, 100).astype(int)

    res = {
        "farmland": score((share @ farm) * (0.6 + 0.6 * mean_moist) * (0.5 + 0.5 * lowland)),
        "timber": score(share @ forest),
        "oil": score(np.clip(rn["oil"] * 3.2 - 0.25, 0, 1) * np.where(is_land, (0.4 + 0.6 * lowland) * (0.8 + 0.6 * dry_or_cold), shelf * 1.0)),
        "gas": score(np.clip(rn["gas"] * 3.0 - 0.25, 0, 1) * np.where(is_land, 0.5 + 0.5 * lowland, shelf * 0.9)),
        "coal": score(np.clip(rn["coal"] * 3.0 - 0.2, 0, 1) * (0.5 + 0.5 * share @ forest + 0.3 * upland) * is_land),
        "ore": score(np.clip(rn["ore"] * 3.0 - 0.15, 0, 1) * (0.35 + 0.9 * upland) * is_land),
        "rare_earths": score(np.clip(rn["rare"] * 4.0 - 0.6, 0, 1) * (0.3 + upland) * is_land),
    }

    # ---- names and colours ---------------------------------------------------------
    nat_lang = [list(rng.choice(SYLLABLES, 12, replace=False)) for _ in capitals]
    used = set()

    def unique(fn):
        for _ in range(50):
            s = fn()
            if s not in used and len(s) >= 3:
                used.add(s)
                return s
        s = fn() + str(len(used))
        used.add(s)
        return s

    nation_short = [unique(lambda lg=lg: make_name(rng, lg)) for lg in nat_lang]
    lang_any = SYLLABLES
    prov_name = [""] * N
    for pid in range(1, N):
        if is_land[pid]:
            lg = nat_lang[owner[pid] - 1] if owner[pid] else lang_any
            prov_name[pid] = unique(lambda lg=lg: make_name(rng, lg, ending=rng.random() < 0.6))
    for pid in range(n_land + 1, N):
        base = make_name(rng, lang_any, ending=False)
        prov_name[pid] = unique(lambda b=base: f"{b} {rng.choice(['Sea', 'Gulf', 'Strait', 'Basin', 'Deep', 'Shelf', 'Bight', 'Waters'])}")

    nat_adj = [set() for _ in capitals]
    for pa, pb in pairs:
        oa, ob = owner[pa], owner[pb]
        if oa and ob and oa != ob:
            nat_adj[oa - 1].add(ob - 1)
            nat_adj[ob - 1].add(oa - 1)
    colours = [None] * len(capitals)
    use = np.zeros(len(PALETTE), int)
    for k in np.argsort([-len(s) for s in nat_adj]):
        taken = {colours[j] for j in nat_adj[k] if colours[j] is not None}
        free = [i for i in np.argsort(use, kind="stable") if i not in taken] or list(range(len(PALETTE)))
        colours[k] = int(free[0])
        use[free[0]] += 1

    # ---- write -------------------------------------------------------------------------
    def ll(v):
        return round(float(np.degrees(np.arcsin(np.clip(v[2], -1, 1)))), 3), round(float(np.degrees(np.arctan2(v[1], v[0]))), 3)

    provinces = []
    for pid in range(1, N):
        ly, lx = label_pos[pid - 1]
        rec = {
            "id": pid, "name": prov_name[pid], "kind": "land" if is_land[pid] else "sea",
            "label": [round(float(lon[lx]), 3), round(float(lat[ly]), 3)],
            "area": int(area[pid]), "terrain": BIOMES[dominant_now[pid]] if is_land[pid] else "ocean",
            "elev": int(mean_elev[pid]), "adj": adj[pid],
        }
        if is_land[pid]:
            rec.update(nation=int(owner[pid]), coastal=bool(coastal[pid]), pop=int(population[pid]),
                       peak=int(max_elev[pid]), river=int(biggest_river[pid]), lake=int(lake_km2[pid]),
                       res={k: int(v[pid]) for k, v in res.items() if v[pid] > 0})
        else:
            sea_res = {k: int(res[k][pid]) for k in ("oil", "gas") if res[k][pid] > 0}
            if sea_res:
                rec["res"] = sea_res
        provinces.append(rec)

    nations = []
    for k, cp in enumerate(capitals):
        mine = land_ids[owner[land_ids] == k + 1]
        a_w = area[mine]
        c = (cen[mine] * a_w[:, None]).sum(0)
        c /= np.linalg.norm(c)
        anchor = mine[np.argmax(cen[mine] @ c)]          # province nearest the nation's centre of mass
        form = NATION_FORMS[rng.integers(len(NATION_FORMS))]
        nations.append({
            "id": k + 1, "name": form.format(nation_short[k]), "short": nation_short[k],
            "color": PALETTE[colours[k]], "capital": int(cp), "label_province": int(anchor),
            "provinces": int(len(mine)), "area": int(a_w.sum()), "pop": int(population[mine].sum()),
            "neighbours": sorted(int(j) + 1 for j in nat_adj[k]),
        })

    # ---- cities: each big town (and every capital) becomes its own small province -------
    is_land, owner = carve_cities(lab2d, provinces, nations, is_land, owner, elev, river_class, lake2d,
                                  land2d, hab.reshape(H, W), cell_km2.reshape(H, W), lat, lon, seed)

    PUBLIC.mkdir(parents=True, exist_ok=True)
    (PUBLIC / "provinces.json").write_text(json.dumps(
        {"seed": seed, "land": n_land, "sea": n_sea, "provinces": provinces, "nations": nations},
        separators=(",", ":")))

    with open(PUBLIC / "provinces.bin", "wb") as f:
        f.write(b"SCP1" + struct.pack("<HH", W, H))
        for y in range(H):
            row = lab2d[y]
            cut = np.flatnonzero(np.diff(row)) + 1
            starts = np.concatenate([[0], cut])
            lens = np.diff(np.concatenate([starts, [W]]))
            runs = np.empty(2 * len(starts), "<u2")
            runs[0::2], runs[1::2] = lens, row[starts]
            f.write(struct.pack("<H", len(starts)))
            f.write(runs.tobytes())
    log("lookup written")

    # ---- borders ---------------------------------------------------------------------------
    a_, b_ = lab2d, np.roll(lab2d, -1, 1)
    ys, xs = np.nonzero(a_ != b_)
    vert = np.stack([xs + 1, ys, xs + 1, ys + 1], 1)
    keys_v = np.minimum(a_[ys, xs], b_[ys, xs]).astype(np.int64) * 65536 + np.maximum(a_[ys, xs], b_[ys, xs])
    ys2, xs2 = np.nonzero(lab2d[:-1] != lab2d[1:])
    hori = np.stack([xs2, ys2 + 1, xs2 + 1, ys2 + 1], 1)
    keys_h = (np.minimum(lab2d[ys2, xs2], lab2d[ys2 + 1, xs2]).astype(np.int64) * 65536
              + np.maximum(lab2d[ys2, xs2], lab2d[ys2 + 1, xs2]))
    allsegs = np.vstack([vert, hori])
    allkeys = np.concatenate([keys_v, keys_h])
    order_k = np.argsort(allkeys, kind="stable")
    allsegs, allkeys = allsegs[order_k], allkeys[order_k]
    bounds = np.flatnonzero(np.diff(allkeys)) + 1
    features = []
    for grp, key in zip(np.split(allsegs, bounds), allkeys[np.concatenate([[0], bounds])]):
        pa, pb = int(key // 65536), int(key % 65536)
        la, lb = is_land[pa], is_land[pb]
        if la and lb:
            kind = 1 if owner[pa] != owner[pb] else 0
        elif la or lb:
            kind = 2
        else:
            kind = 3
        segs_l = [tuple(s) for s in grp.tolist()]
        for line in chain(segs_l):
            line = chaikin(rdp(line, 0.35), 1)  # keep the raggedness: light simplification, one smoothing pass
            lons = np.round(line[:, 0] / W * 360 - 180, 2)
            lats = np.round(90 - line[:, 1] / H * 180, 2)
            features.append({"type": "Feature", "properties": {"k": kind, "a": pa, "b": pb},
                             "geometry": {"type": "LineString", "coordinates": np.stack([lons, lats], 1).tolist()}})
    (PUBLIC / "borders.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": features},
                                                       separators=(",", ":")))
    land_lines = write_fills(lab2d, is_land, lake2d, W, H, owner)
    # every border that touches land is cut from the province outlines themselves, so the lines
    # and the coloured fills can never disagree; only sea-zone lines (sea to sea) come from the grid
    features = trim_to_land([f for f in features if f["properties"]["k"] != 2], W, H) + land_lines
    (PUBLIC / "borders.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": features},
                                                       separators=(",", ":")))
    sizes = {p.name: f"{p.stat().st_size / 1e6:.1f} MB" for p in PUBLIC.glob("*") if p.suffix in (".json", ".bin", ".geojson")}
    log(f"wrote {len(features):,} border lines; {sizes}")


CITY_POP = 900_000


def carve_cities(lab2d, provinces, nations, is_land, owner, elev, river_class, lake2d, land2d, hab, cell_km2, lat, lon, seed):
    """Every province with a big town (or a capital) gives a few cells to a city province of its own,
    placed by what is around it: a shore, a lake, a river, the foot of the mountains, a valley or an
    island, each province weighing these its own way. The existing provinces keep their ids, names
    and nations; the new ones are numbered after them. The city takes about half the people.
    Changes lab2d in place; returns is_land and owner extended to the new ids."""
    H, W = lab2d.shape
    first = len(provinces) + 1
    capitals = {n["capital"] for n in nations}
    picked = [r for r in provinces if r["kind"] == "land" and (r["pop"] >= CITY_POP or r["id"] in capitals)]
    log(f"carving {len(picked)} city provinces")
    landish = land2d & ~lake2d & (ndimage.gaussian_filter(lake2d.astype(np.float32), 1.0, mode=("nearest", "wrap")) < 0.3)
    if (WORLD / "height.npy").exists():                   # and land in the photo too
        hgt = np.load(WORLD / "height.npy")
        landish &= (hgt > 0.004) & (ndimage.uniform_filter(hgt, 3, mode=("nearest", "wrap")) > 0.004)
    d_sea = wrap_edt(land2d)                      # cells to the nearest sea cell
    d_lake = wrap_edt(~lake2d)
    d_river = wrap_edt(river_class == 0)
    e = elev.astype(np.float32)
    high = ndimage.maximum_filter(e, size=(9, 9), mode=("nearest", "wrap"))
    mean = ndimage.uniform_filter(e, size=(9, 9), mode=("nearest", "wrap"))
    f_coast = np.where(landish, np.exp(-(d_sea - 1) / 1.5), 0)
    f_lake = np.where(landish, np.exp(-(d_lake - 1) / 1.5), 0)
    f_river = np.exp(-d_river / 1.2)
    f_foot = np.clip((high - e - 500) / 1500, 0, 1) * (e < 1200)
    f_valley = np.clip((mean - e) / 300, 0, 1) * (high > 1500)
    f_alt = np.clip((e - 1500) / 1500, 0, 1)
    habn = hab / max(float(hab.max()), 1e-6)
    # cells next to another land province: a city keeps two cells clear of them, so the old
    # provinces keep every neighbour they had
    other = np.zeros((H, W), bool)
    for b_ in (np.roll(lab2d, -1, 1), np.roll(lab2d, 1, 1)):
        other |= (lab2d != b_) & is_land[b_]
    other[:-1] |= (lab2d[:-1] != lab2d[1:]) & is_land[lab2d[1:]]
    other[1:] |= (lab2d[1:] != lab2d[:-1]) & is_land[lab2d[:-1]]
    other &= is_land[lab2d]                               # (sea cells along the shore do not count)
    d_other = wrap_edt(~other)
    objs = ndimage.find_objects(lab2d)
    new_land, new_owner = [], []
    nid = first
    city_of = {}
    for r in picked:
        pid = r["id"]
        sl = objs[pid - 1]
        if sl is None:
            continue
        sub = lab2d[sl] == pid
        rng = np.random.default_rng(seed * 7919 + pid)
        w = rng.uniform(0.2, 1.6, 6)
        ok = sub & landish[sl] & (d_other[sl] >= 2)
        if ok.sum() < 3:
            continue
        # a small separate piece of land inside the province is an island
        comp, nc = connected(sub & landish[sl], connectivity=1, return_num=True)
        f_isle = np.zeros(sub.shape, np.float32)
        if nc > 1 and rng.random() < 0.35:
            sizes = np.bincount(comp.ravel())
            sizes[0] = 0
            big = sizes.argmax()
            small = (sizes >= 3) & (np.arange(len(sizes)) != big)
            f_isle = small[comp].astype(np.float32)
        score = (w[0] * f_coast[sl] + w[1] * f_lake[sl] + w[2] * f_river[sl] + w[3] * f_foot[sl]
                 + w[4] * f_valley[sl] + w[5] * 1.2 * f_isle + 0.5 * habn[sl] - 1.5 * f_alt[sl]
                 + 0.35 * rng.random(sub.shape))
        score = np.where(ok, score, -np.inf)
        n_cells = 1 + (r["pop"] >= 2_500_000) + (r["pop"] >= 6_000_000) + (pid in capitals)
        comps_before = connected(sub, connectivity=1, return_num=True)[1]
        chosen = None
        for flat in np.argsort(-score, axis=None)[:12]:
            y, x = np.unravel_index(flat, sub.shape)
            if not np.isfinite(score[y, x]):
                break
            cells = [(y, x)]
            while len(cells) < n_cells:
                best, bv = None, -np.inf
                for cy, cx in cells:
                    for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                        if 0 <= ny < sub.shape[0] and 0 <= nx < sub.shape[1] and (ny, nx) not in cells and score[ny, nx] > bv:
                            best, bv = (ny, nx), score[ny, nx]
                if best is None:
                    break
                cells.append(best)
            rest = sub.copy()
            for c in cells:
                rest[c] = False
            if connected(rest, connectivity=1, return_num=True)[1] == comps_before:
                chosen = cells
                break
        if chosen is None:
            continue
        ys = np.array([c[0] for c in chosen]) + sl[0].start
        xs = np.array([c[1] for c in chosen]) + sl[1].start
        lab2d[ys, xs] = nid
        km2 = float(cell_km2[ys, xs].sum())
        share = rng.uniform(0.42, 0.58)
        pop = int(r["pop"] * share)
        r["pop"] -= pop
        r["area"] = int(max(1, r["area"] - km2))
        y0, x0 = ys[0], xs[0]
        provinces.append({
            "id": nid, "name": r["name"], "kind": "land",
            "label": [round(float(lon[x0]), 3), round(float(lat[y0]), 3)],
            "area": int(round(km2)), "terrain": r["terrain"], "elev": int(elev[ys, xs].mean()), "adj": [],
            "nation": r["nation"], "coastal": False, "pop": pop, "peak": int(elev[ys, xs].max()),
            "river": int(river_class[ys, xs].max()), "lake": 0, "res": {}, "city": True, "parent": pid,
        })
        r["cityProvince"] = nid
        city_of[pid] = nid
        new_land.append(True)
        new_owner.append(owner[pid])
        nid += 1
    is_land = np.concatenate([is_land, np.array(new_land, bool)])
    owner = np.concatenate([owner, np.array(new_owner, owner.dtype)])
    # neighbours of the new provinces, both ways
    byid = {r["id"]: r for r in provinces}
    for a_, b_ in ((lab2d, np.roll(lab2d, -1, 1)), (lab2d[:-1], lab2d[1:])):
        m = (a_ != b_) & ((a_ >= first) | (b_ >= first))
        for pa, pb in np.unique(np.stack([np.minimum(a_[m], b_[m]), np.maximum(a_[m], b_[m])], 1), axis=0):
            pa, pb = int(pa), int(pb)
            for p, q in ((pa, pb), (pb, pa)):
                if q not in byid[p]["adj"]:
                    byid[p]["adj"].append(q)
    for r in provinces[first - 1:]:
        r["coastal"] = any(byid[q]["kind"] == "sea" for q in r["adj"])
    for n in nations:
        if n["capital"] in city_of:
            n["capital"] = city_of[n["capital"]]
        n["provinces"] = sum(1 for r in provinces if r.get("nation") == n["id"])
    log(f"{nid - first} city provinces carved")
    return is_land, owner


def write_fills(lab2d, is_land, lake2d, W, H, owner):
    """Every land province as a polygon traced along the 0.5 line of its own (lake-free) cells,
    read bilinearly between cell centres: the same line the satellite photo's shore follows, so
    the political colours meet the coast and lakes exactly, and neighbours share their edges.
    Written to client/public/world/fills.geojson."""
    from skimage import measure
    P = 48
    lines = []
    lab = lab2d   # lakes stay part of their provinces: the photo's lake shapes are cut out below
    from scipy import ndimage as ndi
    height = np.load(WORLD / "height.npy") if (WORLD / "height.npy").exists() else np.where(is_land[lab2d], 1.0, -1.0).astype(np.float32)
    lake_soft = ndi.gaussian_filter(lake2d.astype(np.float32), 1.0, mode=("nearest", "wrap"))
    # where the photo shows land but the grid calls the cell sea (the photo's shore runs a little
    # beyond the grid's), the colour comes from the nearest province: drawing only, the game's
    # grid is unchanged. Without this a strip of real shore stayed uncoloured.
    landm = is_land[lab]
    pad2 = 64
    wl = np.concatenate([landm[:, -pad2:], landm, landm[:, :pad2]], axis=1)
    _, (iy, ix) = ndi.distance_transform_edt(~wl, return_indices=True)
    iy, ix = iy[:, pad2:-pad2], (ix[:, pad2:-pad2] - pad2) % W
    nearest = lab[iy, ix]
    lab = np.where(~landm & (height > 0), nearest, lab)
    wide = np.concatenate([lab[:, -P:], lab, lab[:, :P]], axis=1)
    hwide = np.concatenate([height[:, -P:], height, height[:, :P]], axis=1)
    lwide = np.concatenate([lake_soft[:, -P:], lake_soft, lake_soft[:, :P]], axis=1)
    wide = np.concatenate([lab[:, -P:], lab, lab[:, :P]], axis=1)
    ys, xs = np.nonzero(lab)
    ids = lab[ys, xs]
    order = np.argsort(ids, kind="stable")
    ys, xs, ids = ys[order], xs[order], ids[order]
    bounds = np.flatnonzero(np.diff(ids)) + 1
    feats = []
    for gy, gx, gid in zip(np.split(ys, bounds), np.split(xs, bounds), ids[np.concatenate([[0], bounds])]):
        pid = int(gid)
        if not len(gx) or not is_land[pid]:
            continue
        # the province's cells as one block, across the date line if it straddles it
        if gx.max() - gx.min() > W // 2:
            gx = np.where(gx < W // 2, gx + W, gx)
        x0, x1 = gx.min() - 4, gx.max() + 5
        y0, y1 = max(0, gy.min() - 4), min(H, gy.max() + 5)
        if x1 - x0 > W // 2 + P:  # too wide to window (a huge province): skip, the raster draws it
            continue
        win = np.zeros((y1 - y0 + 2, x1 - x0 + 2), np.float32)
        sub = wide[y0:y1, x0 + P:x1 + P] if x1 + P <= wide.shape[1] else np.take(lab, np.arange(x0, x1) % W, axis=1)[y0:y1]
        win[1:-1, 1:-1] = sub == pid
        hwin = np.full_like(win, -1.0)
        hwin[1:-1, 1:-1] = hwide[y0:y1, x0 + P:x1 + P] if x1 + P <= hwide.shape[1] else np.take(height, np.arange(x0, x1) % W, axis=1)[y0:y1]
        lwin = np.zeros_like(win)
        lwin[1:-1, 1:-1] = lwide[y0:y1, x0 + P:x1 + P] if x1 + P <= lwide.shape[1] else np.take(lake_soft, np.arange(x0, x1) % W, axis=1)[y0:y1]
        # inland the province keeps its own (jagged) cells, against every neighbour; the coast is
        # where the photo's height field crosses sea level, and lake shores where the photo's
        # softened lakes cross one half: exactly the lines the satellite photo is painted on
        rival = np.zeros_like(win)
        for q in np.unique(sub[is_land[sub]]):
            if q != pid:
                np.maximum(rival, np.pad(sub == q, 1).astype(np.float32), out=rival)
        # traced on a grid four times finer, each part interpolated first: the coast's height jumps
        # sharply, so tracing the combined field between cell centres stopped well short of the shore
        U = 4
        gy_, gx_ = np.mgrid[0:(win.shape[0] - 1) * U + 1, 0:(win.shape[1] - 1) * U + 1] / U
        fine = lambda a: ndi.map_coordinates(a, [gy_, gx_], order=1, mode="nearest")
        fill_f = np.minimum(np.minimum(fine(win - rival), fine(hwin) * 400.0), 0.5 - fine(lwin))
        # only the coasts and lake shores are cut from these outlines; borders between provinces
        # keep their original jagged lines
        for c in measure.find_contours(fill_f, 0.0):
            if len(c) >= 4 * U:
                c = rdp(c[:, ::-1], 0.35)[:, ::-1] if len(c) > 8 else c
                cut_lines(lines, pid, c[:, 0] / U - 1 + y0, c[:, 1] / U - 1 + x0, lab, is_land, owner, W, H, coast_only=True)
        rings = []
        for c in measure.find_contours(fill_f, 0.0):
            if len(c) < 4:
                continue
            c = rdp(c[:, ::-1], 0.35)[:, ::-1] if len(c) > 8 else c   # thinned to ~1/10 of a cell
            yy, xx = c[:, 0] / U - 1 + y0, c[:, 1] / U - 1 + x0
            area = 0.5 * np.sum(xx[:-1] * yy[1:] - xx[1:] * yy[:-1])
            lon = np.round((xx + 0.5) / W * 360 - 180, 3)
            lat = np.round(90 - (yy + 0.5) / H * 180, 3)
            rings.append((area, np.stack([lon, lat], 1).tolist()))
        if not rings:
            continue
        # outer rings wind one way and holes (lakes, enclaves) the other: the largest is outer
        big = max(rings, key=lambda r: abs(r[0]))
        sign = np.sign(big[0])
        outers = [r for r in rings if np.sign(r[0]) == sign]
        holes = [r for r in rings if np.sign(r[0]) != sign]
        polys = [[o[1]] for o in outers]
        for h in holes:
            hx, hy = h[1][0]
            for poly, o in zip(polys, outers):
                if point_in(hx, hy, o[1]):
                    poly.append(h[1])
                    break
        feats.append({"type": "Feature", "id": pid, "properties": {"p": pid},
                      "geometry": {"type": "MultiPolygon", "coordinates": polys}})
    (PUBLIC / "fills.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")))
    log(f"wrote {len(feats):,} province outlines, {len(lines):,} border lines cut from them")
    return lines


def cut_lines(lines, pid, yy, xx, lab, is_land, owner, W, H, coast_only=False):
    """Split one outline of province pid into runs by what lies across it (another province,
    the sea, a lake) and keep each run as a border line (once per pair: from the lower id)."""
    n = len(yy)
    def across(i):
        my, mx = (yy[i] + yy[i + 1]) / 2, (xx[i] + xx[i + 1]) / 2
        dy, dx = yy[i + 1] - yy[i], xx[i + 1] - xx[i]
        ln = (dx * dx + dy * dy) ** 0.5 or 1
        for sgn in (1, -1):
            cy, cx = int(round(my + sgn * dx / ln * 0.5)), int(round(mx - sgn * dy / ln * 0.5))
            q = int(lab[min(H - 1, max(0, cy)), cx % W])
            if q != pid:
                return q
        return pid
    seg_other = [across(i) for i in range(n - 1)]
    start = 0
    for i in range(1, n):
        if i == n - 1 or seg_other[i] != seg_other[start]:
            q = seg_other[start]
            if q != pid and (q == 0 or not is_land[q] or (pid < q and not coast_only)):
                if q == 0:
                    kind = 2  # a lake shore
                elif not is_land[q]:
                    kind = 2  # the coast
                else:
                    kind = 1 if owner[pid] != owner[q] else 0
                pts = np.stack([np.round((xx[start:i + 1] + 0.5) / W * 360 - 180, 3), np.round(90 - (yy[start:i + 1] + 0.5) / H * 180, 3)], 1)
                if len(pts) >= 2:
                    lines.append({"type": "Feature", "properties": {"k": kind, "a": int(pid), "b": int(q)},
                                  "geometry": {"type": "LineString", "coordinates": pts.tolist()}})
            start = i


def trim_to_land(features, W, H):
    """Cut province and nation lines where they would cross the photo's water (lakes, a bay the
    grid counted as land), so no border is drawn over water the colours leave unpainted."""
    from scipy import ndimage as ndi
    height = np.load(WORLD / "height.npy") if (WORLD / "height.npy").exists() else None
    biome = np.asarray(Image.open(WORLD / "biome_legacy.png")) if (WORLD / "biome_legacy.png").exists() else None
    if height is None or biome is None:
        return features
    lake_soft = ndi.gaussian_filter((biome == BIOMES.index("lake")).astype(np.float32), 1.0, mode=("nearest", "wrap"))
    def wet(lon, lat):
        fx, fy = (lon + 180) / 360 * W - 0.5, (90 - lat) / 180 * H - 0.5
        x0, y0 = int(np.floor(fx)), min(H - 2, max(0, int(np.floor(fy))))
        tx, ty = fx - np.floor(fx), min(1.0, max(0.0, fy - y0))
        def at(a):
            v00, v01 = a[y0, x0 % W], a[y0, (x0 + 1) % W]
            v10, v11 = a[y0 + 1, x0 % W], a[y0 + 1, (x0 + 1) % W]
            return (v00 * (1 - tx) + v01 * tx) * (1 - ty) + (v10 * (1 - tx) + v11 * tx) * ty
        return at(height) <= 0 or at(lake_soft) >= 0.5
    out = []
    for f in features:
        if f["properties"]["k"] == 3:
            out.append(f)
            continue
        run = []
        for lon, lat in f["geometry"]["coordinates"]:
            if wet(lon, lat):
                if len(run) >= 2:
                    out.append({**f, "geometry": {"type": "LineString", "coordinates": run}})
                run = []
            else:
                run.append([lon, lat])
        if len(run) >= 2:
            out.append({**f, "geometry": {"type": "LineString", "coordinates": run}})
    return out


def point_in(x, y, ring):
    inside = False
    for i in range(len(ring)):
        (x1, y1), (x2, y2) = ring[i], ring[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-12) + x1:
            inside = not inside
    return inside


if __name__ == "__main__":
    main()
