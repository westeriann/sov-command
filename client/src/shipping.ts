// Trade lanes and merchant shipping on the map. The game decides which nations
// trade by sea and which lanes an enemy warship has cut; here each lane is drawn
// the way a ship would sail it: through the water, round headlands and through
// straits (a path found on a coarse sea grid, then smoothed), faint so it sits
// in the ocean rather than on top of it. Merchant ships sail each open lane;
// on a cut lane they are gone and the lane shows red.
import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl';
import type { Game } from './game';
import type { Political } from './political';

type Pt = [number, number];
const GW = 1024, GH = 512; // the sea grid: about 40 km a cell

export class Shipping {
  private sea: Uint8Array; // 1 = open water, 2 = water next to land
  private paths = new Map<string, Pt[]>();
  private lanes: { key: string; pts: Pt[]; len: number[]; raided: boolean; mine: boolean }[] = [];
  private start = performance.now();

  constructor(private map: MLMap, private game: Game, private pol: Political) {
    this.sea = this.seaGrid();
    map.addImage('merchant', shipIcon(), { pixelRatio: 2 });
    map.addSource('ships', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    if (map.getLayer('lanes')) {
      // the lanes drawn by Presence follow the routed paths now: thin and faint, solid, coloured like water
      map.setPaintProperty('lanes', 'line-color', ['case', ['get', 'raided'], '#ff6b5a', '#9fd6e0'] as never);
      map.setPaintProperty('lanes', 'line-width', ['interpolate', ['linear'], ['zoom'], 1.2, 0.5, 5, 1.1, 7, 1.6] as never);
      map.setPaintProperty('lanes', 'line-opacity', ['case', ['get', 'raided'], 0.75, ['case', ['get', 'mine'], 0.32, 0.14]] as never);
      map.setPaintProperty('lanes', 'line-dasharray', [1, 0] as never);
      map.setPaintProperty('lanes', 'line-blur', 0.6);
    }
    map.addLayer({
      id: 'ships', type: 'symbol', source: 'ships', minzoom: 2.6,
      layout: {
        'icon-image': 'merchant', 'icon-rotate': ['get', 'b'] as never, 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 2.6, 0.35, 5, 0.6, 7.5, 0.9] as never,
        'icon-allow-overlap': true, 'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': ['interpolate', ['linear'], ['zoom'], 2.6, 0, 3.2, 0.9] as never },
    });
    game.on((c) => { if (c.has('war') || c.has('mine')) this.update(); });
    this.update();
    window.setInterval(() => this.sail(), 120);
  }

  /** The routed line for each of the game's lanes (worked out once per lane, then kept). */
  lineFor(path: number[]): Pt[] {
    const key = path.join(',');
    let line = this.paths.get(key);
    if (!line) {
      const stops = path.map((id) => this.pol.provinces.get(id)?.label).filter((p): p is Pt => !!p);
      line = [stops[0]];
      for (let i = 1; i < stops.length; i++) line.push(...this.route(stops[i - 1], stops[i]).slice(1));
      line = smooth(simplify(line));
      this.paths.set(key, line);
    }
    return line;
  }

  private update() {
    const me = this.game.mine?.id;
    this.lanes = (this.game.war.lanes ?? []).map((l) => {
      const pts = this.lineFor(l.path);
      const len = [0];
      for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + dist(pts[i - 1], pts[i]));
      return { key: `${l.a}-${l.b}`, pts, len, raided: l.raided, mine: l.a === me || l.b === me };
    }).filter((l) => l.pts.length > 1);
    // the lanes layer (Presence) draws the routed paths
    const src = this.map.getSource('lanes') as GeoJSONSource | undefined;
    src?.setData({ type: 'FeatureCollection', features: this.lanes.map((l) => ({
      type: 'Feature', properties: { raided: l.raided, mine: l.mine }, geometry: { type: 'LineString', coordinates: l.pts },
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
        features.push({ type: 'Feature', properties: { b: bearing }, geometry: { type: 'Point', coordinates: p } });
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

  /** The cheapest way by water from a to b on the sea grid (A*), as lon/lat points. */
  private route(a: Pt, b: Pt): Pt[] {
    const [ax, ay] = this.nearestSea(this.cell(a)), [bx, by] = this.nearestSea(this.cell(b));
    const start = ay * GW + ax, goal = by * GW + bx;
    const cost = new Float32Array(GW * GH).fill(Infinity), prev = new Int32Array(GW * GH).fill(-1);
    const h = (i: number) => { const x = i % GW, y = (i / GW) | 0; const dx = Math.min(Math.abs(x - bx), GW - Math.abs(x - bx)); return Math.hypot(dx, y - by); };
    const heap = new Heap();
    cost[start] = 0; heap.push(start, h(start));
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
        const c = cost[i] + (dx && dy ? 1.414 : 1) * (this.sea[j] === 2 ? 2.2 : 1);
        if (c < cost[j]) { cost[j] = c; prev[j] = i; heap.push(j, c + h(j)); }
      }
    }
    if (prev[goal] < 0 && goal !== start) return [a, b]; // no way by water found: keep the straight hop
    const cells: number[] = [];
    for (let i = goal; i >= 0; i = prev[i]) { cells.push(i); if (i === start) break; }
    cells.reverse();
    const pts: Pt[] = cells.map((i) => [((i % GW) + 0.5) / GW * 360 - 180, 90 - (((i / GW) | 0) + 0.5) / GH * 180]);
    // keep longitudes continuous across the date line
    for (let k = 1; k < pts.length; k++) { while (pts[k][0] - pts[k - 1][0] > 180) pts[k][0] -= 360; while (pts[k][0] - pts[k - 1][0] < -180) pts[k][0] += 360; }
    return pts;
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
