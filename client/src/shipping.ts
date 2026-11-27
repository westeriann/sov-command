// Trade lanes and merchant shipping on the map. The game decides which nations
// trade by sea and which lanes an enemy warship has cut; here each lane is drawn
// the way a ship would sail it: through the water, round headlands and through
// straits (a path found on a coarse sea grid, then smoothed), faint so it sits
// in the ocean rather than on top of it. Merchant ships sail each open lane;
// on a cut lane they are gone and the lane shows red. Where a route crosses
// land it goes by caravan (a dashed, sandy trail with trucks on it; over foreign
// land that costs a fee), or by canal where one has been dug.
import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl';
import type { Game } from './game';
import type { Political } from './political';

type Pt = [number, number];
const GW = 1024, GH = 512; // the sea grid: about 40 km a cell

export class Shipping {
  private sea: Uint8Array; // 1 = open water, 2 = water next to land
  private paths = new Map<string, Pt[]>();
  private lanes: { key: string; pts: Pt[]; len: number[]; raided: boolean; mine: boolean; land?: boolean }[] = [];
  private start = performance.now();

  constructor(private map: MLMap, private game: Game, private pol: Political) {
    this.sea = this.seaGrid();
    map.addImage('merchant', shipIcon(), { pixelRatio: 2 });
    map.addImage('caravan', caravanIcon(), { pixelRatio: 2 });
    map.addSource('ships', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    if (map.getLayer('lanes')) {
      // the lanes drawn by Presence follow the routed paths now: thin and faint, solid, coloured like water
      map.setPaintProperty('lanes', 'line-color', ['case', ['get', 'raided'], '#ff6b5a', '#9fd6e0'] as never);
      map.setPaintProperty('lanes', 'line-width', ['interpolate', ['linear'], ['zoom'], 1.2, 0.5, 5, 1.1, 7, 1.6] as never);
      map.setPaintProperty('lanes', 'line-opacity', ['case', ['get', 'raided'], 0.75, ['case', ['get', 'mine'], 0.32, 0.14]] as never);
      map.setPaintProperty('lanes', 'line-dasharray', [1, 0] as never);
      map.setPaintProperty('lanes', 'line-blur', 0.6);
      map.setFilter('lanes', ['!=', ['get', 'mode'], 'land']);
      // the stretches over land: a caravan trail
      map.addLayer({
        id: 'caravans', type: 'line', source: 'lanes', minzoom: 1.2, filter: ['==', ['get', 'mode'], 'land'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['case', ['get', 'raided'], '#ff6b5a', '#e0bf7a'] as never,
          'line-width': ['interpolate', ['linear'], ['zoom'], 1.2, 0.8, 5, 1.6, 7, 2.2] as never,
          'line-opacity': ['case', ['get', 'mine'], 0.75, 0.35] as never,
          'line-dasharray': [1.5, 2],
        },
      }, 'lanes');
    }
    map.addLayer({
      id: 'ships', type: 'symbol', source: 'ships', minzoom: 2.6,
      layout: {
        'icon-image': ['get', 'icon'] as never, 'icon-rotate': ['get', 'b'] as never, 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 2.6, 0.35, 5, 0.6, 7.5, 0.9] as never,
        'icon-allow-overlap': true, 'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': ['interpolate', ['linear'], ['zoom'], 2.6, 0, 3.2, 0.9] as never },
    });
    game.on((c) => { if (c.has('war') || c.has('mine')) this.update(); });
    this.update();
    window.setInterval(() => this.sail(), 200);
  }

  /** A route in stretches: sea zone to sea zone (and through canals) by water, the rest overland. */
  private stretches(path: number[], canals: Set<number>): { pts: Pt[]; land: boolean }[] {
    const water = (id: number) => this.pol.provinces.get(id)?.kind === 'sea' || canals.has(id);
    const out: { pts: Pt[]; land: boolean }[] = [];
    let run: number[] = [path[0]], runLand: boolean | null = null;
    const flush = () => {
      if (run.length < 2 || runLand === null) return;
      if (runLand) {
        const pts = run.map((id) => this.pol.provinces.get(id)?.label).filter((p): p is Pt => !!p);
        out.push({ pts: smooth(continuous(pts)), land: true });
      } else {
        // between two sea zones the ships find their way on the sea grid; into and out of a canal, straight
        const pts: Pt[] = [];
        for (let i = 1; i < run.length; i++) {
          const a = this.pol.provinces.get(run[i - 1])?.label, b = this.pol.provinces.get(run[i])?.label;
          if (!a || !b) continue;
          const seg = this.pol.provinces.get(run[i - 1])?.kind === 'sea' && this.pol.provinces.get(run[i])?.kind === 'sea' ? this.hop(run[i - 1], run[i], a, b) : [a, b];
          pts.push(...(pts.length ? seg.slice(1) : seg));
        }
        out.push({ pts: smooth(simplify(continuous(pts))), land: false });
      }
    };
    for (let i = 1; i < path.length; i++) {
      const land = !(water(path[i - 1]) && water(path[i]));
      if (runLand !== null && land !== runLand) { flush(); run = [path[i - 1]]; }
      runLand = land;
      run.push(path[i]);
    }
    flush();
    return out;
  }

  /** The routed line for each of the game's lanes (worked out once per lane, then kept). */
  lineFor(path: number[]): Pt[] {
    const key = path.join(',');
    let line = this.paths.get(key);
    if (!line) {
      const stops = path.map((id) => this.pol.provinces.get(id)?.label).filter((p): p is Pt => !!p);
      line = [stops[0]];
      for (let i = 1; i < stops.length; i++) line.push(...this.hop(path[i - 1], path[i], stops[i - 1], stops[i]).slice(1));
      line = smooth(simplify(continuous(line)));
      this.paths.set(key, line);
    }
    return line;
  }

  private lanesKey = '';
  private update() {
    const me = this.game.mine?.id;
    // only when the lanes changed: re-sending ~20,000 points every game tick made the map stutter at speed
    const key = `${me}|${(this.game.war.lanes ?? []).map((l) => `${l.a}-${l.b}-${l.raided ? 1 : 0}-${l.path.length}`).join(',')}`;
    if (key === this.lanesKey) return;
    this.lanesKey = key;
    // each lane in stretches: by sea (and canal) or over land (by caravan)
    this.lanes = (this.game.war.lanes ?? []).flatMap((l) => this.stretches(l.path, new Set(l.canals ?? [])).map((st, i) => {
      const len = [0];
      for (let k = 1; k < st.pts.length; k++) len.push(len[k - 1] + dist(st.pts[k - 1], st.pts[k]));
      return { key: `${l.a}-${l.b}-${i}`, pts: st.pts, len, raided: l.raided, mine: l.a === me || l.b === me, land: st.land };
    })).filter((l) => l.pts.length > 1);
    // the lanes layer (Presence) draws the routed paths; the caravans layer the land stretches
    const src = this.map.getSource('lanes') as GeoJSONSource | undefined;
    src?.setData({ type: 'FeatureCollection', features: this.lanes.map((l) => ({
      type: 'Feature', properties: { raided: l.raided, mine: l.mine, mode: l.land ? 'land' : 'sea' }, geometry: { type: 'LineString', coordinates: l.pts },
    })) });
  }

  /** Move the merchant ships along their lanes (a couple per lane, each way). */
  private sail() {
    if (this.map.getZoom() < 2.6) return;
    const t = (performance.now() - this.start) / 1000;
    const features: GeoJSON.Feature[] = [];
    for (const [k, l] of this.lanes.entries()) {
      if (l.raided) continue; // a cut lane: no merchant dares it
      const total = l.len[l.len.length - 1];
      if (total <= 0) continue;
      const n = total > 40 ? 2 : 1;
      for (let s = 0; s < n * 2; s++) {
        const back = s % 2 === 1;
        // about 2 degrees of arc a minute: slow, steady traffic
        const d = ((t * 0.035 + (s * total) / (n * 2) + k * 7.3) % total + total) % total;
        const at = back ? total - d : d;
        let i = 1;
        while (i < l.len.length - 1 && l.len[i] < at) i++;
        const f = (at - l.len[i - 1]) / Math.max(1e-6, l.len[i] - l.len[i - 1]);
        const a = l.pts[i - 1], b = l.pts[i];
        const p: Pt = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
        let bearing = (Math.atan2((b[0] - a[0]) * Math.cos((p[1] * Math.PI) / 180), b[1] - a[1]) * 180) / Math.PI;
        if (back) bearing += 180;
        features.push({ type: 'Feature', properties: { b: bearing, icon: l.land ? 'caravan' : 'merchant' }, geometry: { type: 'Point', coordinates: p } });
      }
    }
    (this.map.getSource('ships') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
  }

  // ---- routing through water ----
  private seaGrid() {
    const g = new Uint8Array(GW * GH), pol = this.pol;
    for (let y = 0; y < GH; y++) {
      const lat = 90 - ((y + 0.5) / GH) * 180;
      for (let x = 0; x < GW; x++) {
        const lon = ((x + 0.5) / GW) * 360 - 180;
        const p = pol.provinceAt(lat, lon);
        g[y * GW + x] = !p || p.kind === 'sea' ? 1 : 0;
      }
    }
    // water touching land costs more: ships keep a little off the coast
    const out = g.slice();
    for (let y = 1; y < GH - 1; y++) for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      if (!g[i]) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!g[(y + dy) * GW + ((x + dx + GW) % GW)]) { out[i] = 2; break; }
    }
    return out;
  }

  private cell(p: Pt): [number, number] {
    return [Math.floor(((p[0] + 180) / 360) * GW) % GW, Math.min(GH - 1, Math.max(0, Math.floor(((90 - p[1]) / 180) * GH)))];
  }

  /** One leg between two sea zones, found once and shared by every lane that uses it. */
  private hops = new Map<string, Pt[]>();
  private hop(za: number, zb: number, a: Pt, b: Pt): Pt[] {
    const key = `${za}>${zb}`;
    let h = this.hops.get(key);
    if (!h) {
      const back = this.hops.get(`${zb}>${za}`);
      h = back ? [...back].reverse() : this.route(a, b);
      this.hops.set(key, h);
    }
    return h.map((p) => [p[0], p[1]] as Pt);
  }

  // search memory, kept between searches; a stamp marks which cells this search has touched
  private cost = new Float32Array(GW * GH);
  private prev = new Int32Array(GW * GH);
  private seen = new Uint32Array(GW * GH);
  private stamp = 0;

  /** The cheapest way by water from a to b on the sea grid (A*), as lon/lat points. */
  private route(a: Pt, b: Pt): Pt[] {
    const [ax, ay] = this.nearestSea(this.cell(a)), [bx, by] = this.nearestSea(this.cell(b));
    const start = ay * GW + ax, goal = by * GW + bx;
    const cost = this.cost, prev = this.prev, seen = this.seen, stamp = ++this.stamp;
    const costOf = (i: number) => (seen[i] === stamp ? cost[i] : Infinity);
    const h = (i: number) => { const x = i % GW, y = (i / GW) | 0; const dx = Math.min(Math.abs(x - bx), GW - Math.abs(x - bx)); return Math.hypot(dx, y - by); };
    const heap = new Heap();
    cost[start] = 0; prev[start] = -1; seen[start] = stamp; heap.push(start, h(start));
    let steps = 0;
    while (heap.size && steps++ < 400_000) {
      const i = heap.pop();
      if (i === goal) break;
      const x = i % GW, y = (i / GW) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const ny = y + dy;
        if (ny < 0 || ny >= GH) continue;
        const j = ny * GW + ((x + dx + GW) % GW);
        if (!this.sea[j]) continue;
        // never slip diagonally between two land cells (that is how lanes cut across isthmuses)
        if (dx && dy && !(this.sea[y * GW + ((x + dx + GW) % GW)] && this.sea[ny * GW + x])) continue;
        const c = cost[i] + (dx && dy ? 1.414 : 1) * (this.sea[j] === 2 ? 2.2 : 1);
        if (c < costOf(j)) { cost[j] = c; prev[j] = i; seen[j] = stamp; heap.push(j, c + h(j)); }
      }
    }
    // no way found on the coarse grid: a strait too narrow for it. Look again on the full province map.
    if (seen[goal] !== stamp || (prev[goal] < 0 && goal !== start)) return this.fineRoute(a, b, 80) ?? this.fineRoute(a, b, 260) ?? [a, b];
    const cells: number[] = [];
    for (let i = goal; i >= 0; i = prev[i]) { cells.push(i); if (i === start) break; }
    cells.reverse();
    const pts: Pt[] = cells.map((i) => [((i % GW) + 0.5) / GW * 360 - 180, 90 - (((i / GW) | 0) + 0.5) / GH * 180]);
    // keep longitudes continuous across the date line
    for (let k = 1; k < pts.length; k++) { while (pts[k][0] - pts[k - 1][0] > 180) pts[k][0] -= 360; while (pts[k][0] - pts[k - 1][0] < -180) pts[k][0] += 360; }
    return pts;
  }

  /**
   * The way by water on the full-resolution province map (about 10 km a pixel), searched only in a box
   * round the two ends (margin in pixels): finds the narrow straits the coarse grid cannot see.
   */
  private fineRoute(a: Pt, b: Pt, margin: number): Pt[] | null {
    const pol = this.pol, W = pol.width, H = pol.height;
    if (!W || !H) return null;
    const px = (p: Pt): [number, number] => [Math.floor(((p[0] + 180) / 360) * W) % W, Math.min(H - 1, Math.max(0, Math.floor(((90 - p[1]) / 180) * H)))];
    let [ax, ay] = px(a), [bx, by] = px(b);
    if (Math.abs(ax - bx) > W / 2) { if (ax < bx) ax += W; else bx += W; } // the short way round the date line
    const x0 = Math.min(ax, bx) - margin, y0 = Math.max(0, Math.min(ay, by) - margin);
    const bw = Math.min(W, Math.abs(ax - bx) + 2 * margin + 1), bh = Math.min(H - y0, Math.abs(ay - by) + 2 * margin + 1);
    if (bw * bh > 1_600_000) return null;
    const water = (x: number, y: number) => pol.provinces.get(pol.grid[(y + y0) * W + (((x + x0) % W) + W) % W])?.kind === 'sea';
    const n = bw * bh, cost = new Float32Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
    // start and goal: the nearest water to each end, inside the box
    const near = (cx: number, cy: number) => {
      for (let r = 0; r < 40; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const x = cx - x0 + dx, y = cy - y0 + dy;
        if (x >= 0 && y >= 0 && x < bw && y < bh && water(x, y)) return y * bw + x;
      }
      return -1;
    };
    const start = near(ax, ay), goal = near(bx, by);
    if (start < 0 || goal < 0) return null;
    const gx = goal % bw, gy = (goal / bw) | 0;
    const heap = new Heap();
    cost[start] = 0; heap.push(start, 0);
    let steps = 0;
    while (heap.size && steps++ < 2_000_000) {
      const i = heap.pop();
      if (i === goal) break;
      const x = i % bw, y = (i / bw) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= bw || ny >= bh || !water(nx, ny)) continue;
        if (dx && dy && !(water(x + dx, y) && water(x, y + dy))) continue; // never slip diagonally between two pieces of land
        const j = ny * bw + nx, c = cost[i] + (dx && dy ? 1.414 : 1);
        if (c < cost[j]) { cost[j] = c; prev[j] = i; heap.push(j, c + Math.hypot(nx - gx, ny - gy)); }
      }
    }
    if (prev[goal] < 0 && goal !== start) return null;
    const cells: number[] = [];
    for (let i = goal; i >= 0; i = prev[i]) { cells.push(i); if (i === start) break; }
    cells.reverse();
    // every few pixels is plenty once smoothed
    const pts: Pt[] = cells.filter((_, k) => k % 4 === 0 || k === cells.length - 1).map((i) => {
      const x = (i % bw) + x0, y = ((i / bw) | 0) + y0;
      return [((x + 0.5) / W) * 360 - 180, 90 - ((y + 0.5) / H) * 180] as Pt;
    });
    for (let k = 1; k < pts.length; k++) { while (pts[k][0] - pts[k - 1][0] > 180) pts[k][0] -= 360; while (pts[k][0] - pts[k - 1][0] < -180) pts[k][0] += 360; }
    return [a, ...pts, b];
  }

  private nearestSea([x, y]: [number, number]): [number, number] {
    if (this.sea[y * GW + x]) return [x, y];
    for (let r = 1; r < 30; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const ny = y + dy;
      if (ny < 0 || ny >= GH) continue;
      const nx = (x + dx + GW) % GW;
      if (this.sea[ny * GW + nx]) return [nx, ny];
    }
    return [x, y];
  }
}

class Heap {
  private items: number[] = [];
  private keys: number[] = [];
  get size() { return this.items.length; }
  push(item: number, key: number) {
    const it = this.items, ks = this.keys;
    it.push(item); ks.push(key);
    let i = it.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (ks[p] <= ks[i]) break;
      [it[p], it[i]] = [it[i], it[p]]; [ks[p], ks[i]] = [ks[i], ks[p]];
      i = p;
    }
  }
  pop() {
    const it = this.items, ks = this.keys, top = it[0];
    const li = it.pop()!, lk = ks.pop()!;
    if (it.length) {
      it[0] = li; ks[0] = lk;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < it.length && ks[l] < ks[m]) m = l;
        if (r < it.length && ks[r] < ks[m]) m = r;
        if (m === i) break;
        [it[m], it[i]] = [it[i], it[m]]; [ks[m], ks[i]] = [ks[i], ks[m]];
        i = m;
      }
    }
    return top;
  }
}

const dist = (a: Pt, b: Pt) => Math.hypot((b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180)), b[1] - a[1]);

/** Drop grid points that lie nearly on the line between their neighbours. */
function simplify(pts: Pt[]) {
  if (pts.length < 3) return pts;
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
    const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    if (cross > 0.08 || dist(a, b) > 6) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Gentle curves through the points (Chaikin), as a ship's track would run. */
function smooth(pts: Pt[]) {
  let line = pts;
  for (let k = 0; k < 3 && line.length > 2; k++) {
    const next: Pt[] = [line[0]];
    for (let i = 0; i < line.length - 1; i++) {
      const [a, b] = [line[i], line[i + 1]];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    next.push(line[line.length - 1]);
    line = next;
  }
  return line;
}

/** A merchant ship seen from above: a pale hull with a dark deck line and a small wake. */
function shipIcon(): ImageData {
  const W = 20, H = 44, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.beginPath(); g.moveTo(10, 30); g.lineTo(4, 44); g.lineTo(16, 44); g.closePath(); g.fill(); // wake
  g.fillStyle = '#e8e4da'; g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(10, 2); g.quadraticCurveTo(17, 10, 16, 18); g.lineTo(16, 32); g.lineTo(4, 32); g.lineTo(4, 18); g.quadraticCurveTo(3, 10, 10, 2); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#9a4b3a'; g.fillRect(6, 14, 8, 4); g.fillStyle = '#4a6b8a'; g.fillRect(6, 20, 8, 4); g.fillStyle = '#7d8a55'; g.fillRect(6, 26, 8, 3); // containers
  return g.getImageData(0, 0, W, H);
}

/** A caravan seen from above: a sand-coloured truck with a dark cab. */
function caravanIcon(): ImageData {
  const W = 16, H = 30, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(224,191,122,0.35)'; g.fillRect(5, 24, 6, 6); // dust
  g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1;
  g.fillStyle = '#d8b56c'; g.fillRect(3, 9, 10, 15); g.strokeRect(3, 9, 10, 15); // the load
  g.fillStyle = '#5a4a36'; g.fillRect(4, 2, 8, 6); g.strokeRect(4, 2, 8, 6); // the cab
  g.fillStyle = '#9fd6e0'; g.fillRect(5, 3, 6, 2); // windscreen
  return g.getImageData(0, 0, W, H);
}

/** Keep longitudes continuous along a whole line (each leg is, but where two legs meet one may be a full turn of the globe off). */
function continuous(pts: Pt[]) {
  const out = pts.map((p) => [p[0], p[1]] as Pt);
  for (let k = 1; k < out.length; k++) {
    while (out[k][0] - out[k - 1][0] > 180) out[k][0] -= 360;
    while (out[k][0] - out[k - 1][0] < -180) out[k][0] += 360;
  }
  return out;
}
