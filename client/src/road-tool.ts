// Roads on the map, and the tool to lay them. Started from the Eco lens (or
// build mode): press on one of your provinces and drag. With snapping on, the
// road runs through province centres (which are where the cities stand); with
// it off, it follows the pointer. Gaps from a fast drag are filled with the
// shortest way through your own land. Release to see the cost, then build.
// Finished roads speed troops along them; roads under way show dashed.
import type { Map as MLMap, GeoJSONSource, MapMouseEvent } from 'maplibre-gl';
import type { Game } from './game';
import type { Political, Province } from './political';
import { ROAD, roadCost, roadDays, type RoadState } from '../../shared/roads';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
type Pt = [number, number];
const EMPTY = { type: 'FeatureCollection' as const, features: [] };

export class RoadTool {
  active = false;
  private bar: HTMLElement;
  private confirm: HTMLElement;
  private snap = true;
  private drawing = false;
  private path: number[] = [];
  private pts: Pt[] = [];
  private lastPx: [number, number] | null = null;

  constructor(root: HTMLElement, private map: MLMap, private game: Game, private pol: Political,
    private act: { build: (path: number[], pts: Pt[]) => void; back: () => void }) {
    try { this.snap = localStorage.getItem('sov.road.snap') !== 'off'; } catch { /* storage blocked */ }
    this.bar = document.createElement('div');
    this.bar.className = 'panel mode-bar';
    this.bar.hidden = true;
    this.confirm = document.createElement('section');
    this.confirm.className = 'panel build-menu road-confirm';
    this.confirm.hidden = true;
    root.append(this.bar, this.confirm);
    this.renderBar();
    this.bar.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-rt]')?.dataset.rt;
      if (b === 'back') this.stop(true);
      else if (b === 'snap') {
        this.snap = !this.snap;
        try { localStorage.setItem('sov.road.snap', this.snap ? 'on' : 'off'); } catch { /* storage blocked */ }
        this.renderBar();
      }
    });
    this.confirm.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-rc]')?.dataset.rc;
      if (b === 'build' && this.path.length > 1) this.act.build(this.path, this.simplify(this.pts));
      if (b) this.clearDraft();
    });
    window.addEventListener('keydown', (e) => {
      if (!this.active || e.key !== 'Escape') return;
      e.stopPropagation();
      if (this.path.length) this.clearDraft(); else this.stop(true);
    }, true);
    map.on('mousedown', (e) => this.down(e));
    map.on('mousemove', (e) => this.moveTo(e));
    map.on('mouseup', () => this.up());
    game.on((c) => { if (c.has('war') || c.has('mine')) this.renderRoads(); });
    if (map.loaded()) this.addLayers(); else map.once('load', () => this.addLayers());
  }

  // ---- the roads on the map ----
  private addLayers() {
    const m = this.map;
    m.addSource('roads', { type: 'geojson', data: EMPTY });
    m.addSource('road-draft', { type: 'geojson', data: EMPTY });
    const before = m.getLayer('nation-selected') ? 'nation-selected' : undefined;
    const w = (a: number, b: number) => ['interpolate', ['exponential', 1.6], ['zoom'], 3, a, 8, b] as never;
    // a dark verge under a pale surface, faint from afar so roads read as part of the land
    m.addLayer({ id: 'roads-casing', type: 'line', source: 'roads', minzoom: 3,
      paint: { 'line-color': '#1b1a17', 'line-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0, 4.5, 0.55] as never, 'line-width': w(1.6, 7), 'line-blur': 0.6 },
      layout: { 'line-join': 'round', 'line-cap': 'round' } }, before);
    m.addLayer({ id: 'roads', type: 'line', source: 'roads', minzoom: 3,
      paint: { 'line-color': ['case', ['get', 'done'], '#d9d2bf', '#c9a24a'] as never, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0, 4.5, 0.85] as never,
        'line-width': w(0.7, 3.6), 'line-dasharray': [2, 1.2] },
      filter: ['!', ['get', 'done']] as never, layout: { 'line-join': 'round', 'line-cap': 'round' } }, before);
    m.addLayer({ id: 'roads-done', type: 'line', source: 'roads', minzoom: 3,
      paint: { 'line-color': '#d9d2bf', 'line-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0, 4.5, 0.85] as never, 'line-width': w(0.7, 3.6) },
      filter: ['get', 'done'] as never, layout: { 'line-join': 'round', 'line-cap': 'round' } }, before);
    m.addLayer({ id: 'road-draft', type: 'line', source: 'road-draft',
      paint: { 'line-color': ['case', ['get', 'ok'], '#7cc4ff', '#ff5caa'] as never, 'line-width': 3.5, 'line-opacity': 0.95 },
      layout: { 'line-join': 'round', 'line-cap': 'round' } });
    m.addLayer({ id: 'road-draft-nodes', type: 'circle', source: 'road-draft', filter: ['==', ['geometry-type'], 'Point'] as never,
      paint: { 'circle-radius': 4, 'circle-color': '#ffffff', 'circle-stroke-color': '#7cc4ff', 'circle-stroke-width': 1.5 } });
    this.renderRoads();
  }

  private roadsKey = '';
  private renderRoads() {
    const src = this.map.getSource('roads') as GeoJSONSource | undefined;
    if (!src) return;
    const roads: RoadState[] = this.game.war.roads ?? [];
    const key = roads.map((r) => `${r.id}${r.progress >= 1 ? 1 : 0}`).join(',');
    if (key === this.roadsKey) return;
    this.roadsKey = key;
    src.setData({ type: 'FeatureCollection', features: roads.map((r) => ({
      type: 'Feature', properties: { done: r.progress >= 1, id: r.id }, geometry: { type: 'LineString', coordinates: this.smooth(r.pts) },
    })) });
  }

  // ---- the tool ----
  start() {
    if (!this.game.mine) return;
    this.active = true;
    this.bar.hidden = false;
    document.body.classList.add('road-mode');
    this.map.dragPan.disable();
    this.map.getCanvas().style.cursor = 'crosshair';
  }

  stop(backToLens: boolean) {
    if (!this.active) return;
    this.active = false;
    this.bar.hidden = true;
    this.clearDraft();
    document.body.classList.remove('road-mode');
    this.map.dragPan.enable();
    this.map.getCanvas().style.cursor = '';
    if (backToLens) this.act.back();
  }

  private renderBar() {
    this.bar.innerHTML = `<span class="tag mono">ROADS</span><span class="mode-hint">Drag across your provinces to lay a road</span>
      <button type="button" class="claim${this.snap ? ' on' : ''}" data-rt="snap" aria-pressed="${this.snap}" title="On: the road runs through province centres and cities. Off: it follows the pointer.">Snap ${this.snap ? 'on' : 'off'}</button>
      <button type="button" class="claim primary" data-rt="back">Back to Eco</button>`;
  }

  private mine(p: Province | undefined | null): p is Province {
    const me = this.game.mine?.id;
    return !!p && p.kind === 'land' && p.nation === me && (this.game.war.occupied[p.id] ?? p.nation) === me;
  }

  private at(e: MapMouseEvent) {
    const ll = e.lngLat.wrap();
    return this.pol.provinceAt(ll.lat, ll.lng);
  }

  private down(e: MapMouseEvent) {
    if (!this.active || (e.originalEvent as MouseEvent).button !== 0) return;
    const p = this.at(e);
    if (!this.mine(p)) return;
    this.clearDraft();
    this.drawing = true;
    this.path = [p.id];
    const ll = e.lngLat.wrap();
    this.pts = [this.snap ? [p.label[0], p.label[1]] : [ll.lng, ll.lat]];
    this.lastPx = [e.point.x, e.point.y];
    this.draw(true);
  }

  private moveTo(e: MapMouseEvent) {
    if (!this.drawing) return;
    const p = this.at(e);
    const ll = e.lngLat.wrap();
    const last = this.path[this.path.length - 1];
    if (!this.mine(p)) { this.draw(false, [ll.lng, ll.lat]); return; }
    if (p.id !== last) {
      const back = this.path.indexOf(p.id);
      if (back >= 0) {
        // dragged back over the road: take the end back to here
        this.path = this.path.slice(0, back + 1);
        if (this.snap) this.pts = this.path.map((q) => this.label(q));
        else this.pts = this.pts.filter((pt) => { const q = this.pol.provinceAt(pt[1], pt[0])?.id; return q !== undefined && this.path.includes(q); });
      } else {
        const gap = this.route(last, p.id);
        if (!gap || this.path.length - 1 + gap.length > ROAD.maxLegs) { this.draw(false, [ll.lng, ll.lat]); return; }
        for (const q of gap) {
          if (this.path.includes(q)) continue;
          this.path.push(q);
          if (this.snap || q !== p.id) this.pts.push(this.label(q));
        }
      }
    }
    if (!this.snap && this.lastPx && Math.hypot(e.point.x - this.lastPx[0], e.point.y - this.lastPx[1]) > 10) {
      this.pts.push([ll.lng, ll.lat]);
      this.lastPx = [e.point.x, e.point.y];
    }
    this.draw(true);
  }

  private up() {
    if (!this.drawing) return;
    this.drawing = false;
    if (this.path.length < 2) { this.clearDraft(); return; }
    if (!this.snap) this.pts.push(this.pts[this.pts.length - 1]);
    this.draw(true);
    const legs = this.path.length - 1;
    const name = (q: number) => esc(this.pol.provinces.get(q)?.name ?? '');
    const busy = (this.game.war.roads ?? []).filter((r) => r.owner === this.game.mine?.id && r.progress < 1).length;
    const cost = roadCost(legs), treasury = this.game.mine?.econ?.treasury ?? 0;
    const why = busy >= ROAD.maxProjects ? `${ROAD.maxProjects} roads are already being built` : '';
    this.confirm.innerHTML = `<span class="label">NEW ROAD</span>
      <p><b>${name(this.path[0])}</b> to <b>${name(this.path[legs])}</b> · ${legs} stretch${legs > 1 ? 'es' : ''}</p>
      <div class="nc-kv"><span>Cost</span><b class="${treasury < cost ? 'down' : ''}">$${cost}bn</b><span>Time</span><b>${roadDays(legs)} days</b><span>Troops along it</span><b class="up">${Math.round((1 / ROAD.speed - 1) * 100)}% faster</b></div>
      ${why ? `<p class="hint down">${why}</p>` : ''}
      <div class="nc-actions"><button type="button" class="claim primary" data-rc="build" ${why ? 'disabled' : ''}>Build road</button><button type="button" class="claim" data-rc="cancel">Cancel</button></div>`;
    this.confirm.hidden = false;
  }

  private clearDraft() {
    this.drawing = false;
    this.path = [];
    this.pts = [];
    this.confirm.hidden = true;
    (this.map.getSource('road-draft') as GeoJSONSource | undefined)?.setData(EMPTY);
  }

  private draw(ok: boolean, tail?: Pt) {
    const line = tail ? [...this.pts, tail] : this.pts;
    const nodes = this.snap ? this.path.map((q) => this.label(q)) : [];
    (this.map.getSource('road-draft') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { ok }, geometry: { type: 'LineString', coordinates: line.length > 1 ? this.smooth(line) : [...line, ...line] } },
      ...nodes.map((c) => ({ type: 'Feature' as const, properties: { ok }, geometry: { type: 'Point' as const, coordinates: c } })),
    ] });
  }

  private label(q: number): Pt { const l = this.pol.provinces.get(q)!.label; return [l[0], l[1]]; }

  /** The shortest way from a to b through our own provinces (excluding a). */
  private route(a: number, b: number): number[] | null {
    const prev = new Map<number, number>([[a, -1]]);
    const queue = [a];
    while (queue.length) {
      const q = queue.shift()!;
      if (q === b) break;
      if (prev.size > 400) return null;
      for (const n of this.pol.provinces.get(q)?.adj ?? []) {
        if (prev.has(n) || !this.mine(this.pol.provinces.get(n))) continue;
        prev.set(n, q);
        queue.push(n);
      }
    }
    if (!prev.has(b)) return null;
    const out: number[] = [];
    for (let q = b; q !== a; q = prev.get(q)!) out.unshift(q);
    return out;
  }

  /** Drop points closer than ~1 km to the last kept one, and keep within the limit. */
  private simplify(pts: Pt[]) {
    const out: Pt[] = [];
    for (const p of pts) { const l = out[out.length - 1]; if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 0.01) out.push(p); }
    const step = Math.ceil(out.length / ROAD.maxPts);
    return step > 1 ? out.filter((_, i) => i % step === 0 || i === out.length - 1) : out;
  }

  /** A gently curving line through the points (Chaikin), so roads do not look ruled. */
  private smooth(pts: Pt[]): Pt[] {
    let line = pts;
    for (let k = 0; k < 2 && line.length > 2; k++) {
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
}
