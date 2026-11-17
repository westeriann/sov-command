"""Rivers and lakes for the generated planet.

1. Priority-flood with epsilon (Barnes, Lehman & Mulla 2014): starting from the
   ocean, every land cell is reached in order of height. Pits get filled up to
   their spill point, so every cell has a downhill path to the sea, and the
   filled depth tells us where lakes would form.
2. Flow accumulation: each cell passes its rainfall (and everything upstream)
   to the cell it drains into. The total is the river's discharge.
3. Rivers are cells whose discharge passes a threshold; they are traced into
   polylines between sources, confluences and mouths.

The grid is equirectangular and wraps east-west.
"""
import heapq

import numpy as np
from scipy import ndimage

NEIGHBOURS = ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1))


def flood(elev, outlet, eps=1e-3, speed=None):
    """Returns (filled surface, receiver list, processing order).

    speed (optional, per cell, around 1) scales the tiny rise used to order
    cells across flat filled basins. A smooth noise field here makes rivers
    wander across flats instead of running in straight lines.

    receiver[i] is the cell that i drains into (-1 for outlets). The order runs
    from the sea inland, so walking it backwards visits upstream cells first.
    """
    H, W = elev.shape
    E = elev.ravel().astype(np.float64).tolist()
    S = (speed.ravel().astype(np.float64) * eps).tolist() if speed is not None else [eps] * (H * W)
    filled = list(E)
    seen = bytearray(outlet.ravel().astype(np.uint8).tobytes())
    recv = [-1] * (H * W)
    inland = ~outlet
    near = np.zeros_like(outlet)
    for dy, dx in NEIGHBOURS:
        near |= np.roll(np.roll(inland, dy, 0), dx, 1)
    seeds = np.flatnonzero(outlet & near).tolist()
    for i in seeds:
        filled[i] = 0.0                       # the sea drains at sea level
    heap = [(0.0, i) for i in seeds]
    heapq.heapify(heap)
    pop, push = heapq.heappop, heapq.heappush
    order = []
    while heap:
        e, c = pop(heap)
        order.append(c)
        y, x = divmod(c, W)
        for dy, dx in NEIGHBOURS:
            ny = y + dy
            if ny < 0 or ny >= H:
                continue
            n = ny * W + (x + dx) % W
            if seen[n]:
                continue
            seen[n] = 1
            en = E[n]
            if en <= e + S[n]:
                en = e + S[n]
            filled[n] = en
            recv[n] = c
            push(heap, (en, n))
    return np.array(filled, np.float32).reshape(H, W), recv, order


def accumulate(order, recv, weight):
    acc = weight.ravel().astype(np.float64).tolist()
    for c in reversed(order):
        d = recv[c]
        if d >= 0:
            acc[d] += acc[c]
    return np.array(acc)


def find_lakes(elev, filled, outlet, moist, cell_km2, min_depth=22.0, min_area=3000.0, min_moist=0.25,
               max_area=40_000.0):
    """Filled basins deep and big enough to hold water, in climates wet enough
    to keep them full. Dry basins stay dry (salt flats, endorheic deserts)."""
    lake = ((filled - elev) > min_depth) & ~outlet
    lab, n = ndimage.label(lake, structure=np.ones((3, 3)))
    if n == 0:
        return lake
    idx = np.arange(1, n + 1)
    area = ndimage.sum(cell_km2, lab, idx)
    wet = ndimage.mean(moist, lab, idx)
    keep = np.zeros(n + 1, bool)
    keep[1:] = (area >= min_area) & (wet >= min_moist)
    lake = keep[lab]

    # Evaporation keeps big basins from filling to the brim: cap each lake's
    # area (smaller in drier climates) by keeping only its deepest water.
    depth = filled - elev
    slices = ndimage.find_objects(lab)
    for i in np.flatnonzero(keep[1:]):
        cap = max_area * float(np.clip((wet[i] - min_moist) / 0.3, 0.25, 1.0))
        if area[i] <= cap:
            continue
        sl = slices[i]
        inside = lab[sl] == i + 1
        d, a = depth[sl][inside], cell_km2[sl][inside]
        order = np.argsort(-d)
        cut = d[order][np.searchsorted(np.cumsum(a[order]), cap)]
        sub = lake[sl]
        sub[inside & (depth[sl] < cut)] = False
    return lake


def river_paths(recv, acc, river):
    """Split the river network into polylines (lists of cell indices) running
    downstream from each source or confluence to the next confluence, lake or
    the sea."""
    N = len(river)
    idx = np.flatnonzero(river)
    rv = np.asarray(recv)
    down = rv[idx]
    tgt = down[down >= 0]
    up_count = np.bincount(tgt[river[tgt]], minlength=N)
    heads = idx[up_count[idx] != 1]
    paths = []
    for h in heads.tolist():
        path, c = [h], h
        while True:
            d = recv[c]
            if d < 0:
                break
            path.append(d)
            if not river[d] or up_count[d] != 1:
                break
            c = d
        if len(path) >= 2:
            paths.append(path)
    return paths


def chaikin(pts, rounds=2):
    for _ in range(rounds):
        if len(pts) < 3:
            break
        q = 0.75 * pts[:-1] + 0.25 * pts[1:]
        r = 0.25 * pts[:-1] + 0.75 * pts[1:]
        mid = np.empty((2 * len(q), 2))
        mid[0::2], mid[1::2] = q, r
        pts = np.vstack([pts[:1], mid, pts[-1:]])
    return pts


def size_class(q, threshold):
    """1 (stream) .. 5 (great river) from discharge relative to the threshold."""
    r = q / threshold
    return int(np.searchsorted([3, 10, 30, 100], r, side="right") + 1)


def build(elev, land, moist, cell_km2, river_threshold=9000.0, flat_noise=None, log=print):
    """Run the whole hydrology step. Returns lakes, lake surface, rivers."""
    H, W = elev.shape
    water_lab, nw = ndimage.label(~land)
    # water bodies joined across the dateline count as one
    join = (water_lab[:, 0] > 0) & (water_lab[:, -1] > 0)
    remap = np.arange(nw + 1)
    for a, b in zip(water_lab[join, 0], water_lab[join, -1]):
        ra, rb = remap[a], remap[b]
        if ra != rb:
            remap[remap == rb] = ra
    water_lab = remap[water_lab]
    area = np.bincount(water_lab.ravel(), weights=cell_km2.ravel(), minlength=nw + 1)
    big = area >= 250_000
    big[0] = False
    outlet = big[water_lab]

    log("rivers: filling basins")
    speed = None if flat_noise is None else 0.15 + 4.0 * np.clip(flat_noise + 0.5, 0, 1) ** 2
    filled, recv, order = flood(elev, outlet, speed=speed)
    lake = find_lakes(elev, filled, outlet, moist, cell_km2)
    log("rivers: routing water")
    acc = accumulate(order, recv, (moist ** 1.5) * cell_km2).reshape(H, W)
    river = (acc >= river_threshold) & ~lake & ~outlet
    paths = river_paths(recv, acc.ravel(), river.ravel())

    lat = 90 - (np.arange(H) + 0.5) * 180 / H
    lon = -180 + (np.arange(W) + 0.5) * 360 / W
    rivers, river_class = [], np.zeros((H, W), np.uint8)
    flat_class = river_class.ravel()
    for path in paths:
        last_river = path[-2] if not river.ravel()[path[-1]] else path[-1]
        q = float(acc.ravel()[last_river])
        k = size_class(q, river_threshold)
        cells = np.array(path)
        flat_class[cells[river.ravel()[cells]]] = np.maximum(flat_class[cells[river.ravel()[cells]]], k)
        ys, xs = np.divmod(cells, W)
        pts = np.stack([lon[xs], lat[ys]], 1)
        # break at the dateline so lines do not cross the whole map
        jumps = np.flatnonzero(np.abs(np.diff(pts[:, 0])) > 180) + 1
        for part in np.split(pts, jumps):
            if len(part) >= 2:
                rivers.append((chaikin(part, 2), k, q))
    lakes_n = ndimage.label(lake)[1]
    log(f"rivers: {len(rivers):,} river lines, {lakes_n} lakes")
    return dict(lake=lake, lake_surface=filled, rivers=rivers, river_class=river_class, discharge=acc)
