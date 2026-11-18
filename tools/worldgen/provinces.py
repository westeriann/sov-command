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
    biome = np.asarray(Image.open(WORLD / "biome.png"))
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
    core = (d[:, 1] - d[:, 0]) > 0.18 * r
    labels[land_idx[core]] = a[core, 0] + 1
    # borders follow rivers where one runs nearby (rivers are walls the flood cannot cross),
    # otherwise they settle on ridges
    rivers = ndimage.binary_dilation(river_class >= 2, iterations=1)
    relief = (elev.astype(np.float32) / 1500.0) + 3.0 * rivers + 0.6 * (river_class >= 4) + 0.15 * np.abs(
        fbm(Perlin3(seed + 1002), P.T.reshape(3, H, W), 3, freq=1.0 / r))
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
            "area": int(area[pid]), "terrain": BIOMES[dominant[pid]] if is_land[pid] else "ocean",
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
            line = chaikin(rdp(line, 0.75), 2)
            lons = np.round(line[:, 0] / W * 360 - 180, 2)
            lats = np.round(90 - line[:, 1] / H * 180, 2)
            features.append({"type": "Feature", "properties": {"k": kind, "a": pa, "b": pb},
                             "geometry": {"type": "LineString", "coordinates": np.stack([lons, lats], 1).tolist()}})
    (PUBLIC / "borders.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": features},
                                                       separators=(",", ":")))
    sizes = {p.name: f"{p.stat().st_size / 1e6:.1f} MB" for p in PUBLIC.glob("*") if p.suffix in (".json", ".bin", ".geojson")}
    log(f"wrote {len(features):,} border lines; {sizes}")


if __name__ == "__main__":
    main()
