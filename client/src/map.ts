import { type GeoJSONSource, Map as MLMap, Marker, type ExpressionSpecification, type StyleSpecification } from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Political } from './political';
import { BIOME_INFO, mercatorCanvas, type World } from './world';

export type MapMode = 'political' | 'wealth' | 'satellite' | 'terrain' | 'elevation' | 'climate';

/** Income per person ($/yr) colour scale, read on a log scale. */
export const WEALTH_STOPS: [number, string][] = [
  [1000, '#7a2e3a'], [3000, '#c8574a'], [8000, '#e0a64a'], [20000, '#9cc46a'], [45000, '#3fa7a3'], [80000, '#4f86c6'],
];

const WEALTH_DEFAULT = WEALTH_STOPS.map((s) => [...s] as [number, string]);
/** Viridis: readable with every common kind of colour blindness. */
const WEALTH_CB: [number, string][] = [
  [1000, '#440154'], [3000, '#414487'], [8000, '#2a788e'], [20000, '#22a884'], [45000, '#7ad151'], [80000, '#fde725'],
];

const MERC_LAT = 85.051129;
const OVERLAY_COORDS: [[number, number], [number, number], [number, number], [number, number]] = [
  [-180, MERC_LAT], [180, MERC_LAT], [180, -MERC_LAT], [-180, -MERC_LAT],
];

// border kinds written by provinces.py
const K_PROVINCE = 0, K_NATION = 1, K_COAST = 2, K_SEA = 3;

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function ramp(stops: [number, string][], v: number): [number, number, number] {
  if (v <= stops[0][0]) return hex(stops[0][1]);
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      const t = (v - a) / (b - a);
      const A = hex(ca), B = hex(cb);
      return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
    }
  }
  return hex(stops[stops.length - 1][1]);
}

const ELEV_STOPS: [number, string][] = [
  [-7000, '#06142e'], [-3000, '#0d2f5c'], [-200, '#1d5d8a'], [0, '#3f8fb0'],
  [1, '#3e7a3c'], [400, '#8aa54e'], [1200, '#c8b26a'], [2500, '#a0704a'], [4000, '#e6e2dc'],
];
const TEMP_STOPS: [number, string][] = [
  [-30, '#3b4cc0'], [-10, '#7b9ff9'], [5, '#c0d4f5'], [15, '#f2cbb7'], [24, '#ee8468'], [32, '#b40426'],
];

function graticule() {
  const features: Feature[] = [];
  for (let lon = -180; lon < 180; lon += 15) {
    const coords: [number, number][] = [];
    for (let lat = -85; lat <= 85; lat += 2.5) coords.push([lon, lat]);
    features.push({ type: 'Feature', properties: { major: lon === 0 }, geometry: { type: 'LineString', coordinates: coords } });
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    const coords: [number, number][] = [];
    for (let lon = -180; lon <= 180; lon += 2.5) coords.push([lon, lat]);
    features.push({ type: 'Feature', properties: { major: lat === 0 }, geometry: { type: 'LineString', coordinates: coords } });
  }
  return { type: 'FeatureCollection', features } as FeatureCollection;
}

const NONE: ExpressionSpecification = ['==', ['get', 'a'], -1];

export class GameMap {
  map: MLMap;
  private overlays = new Map<MapMode, HTMLCanvasElement>();
  mode: MapMode = 'political';
  private marker: Marker;
  private nationLabels: { id: number; marker: Marker; el: HTMLElement; rank: number }[] = [];
  private provinceLabels = new Map<number, Marker>();
  showProvinceNames = true;

  constructor(container: HTMLElement, private world: World, private pol: Political) {
    const max = world.meta.tiles.max_zoom;
    const zoomFade = (from: number, to: number, a: number, b: number): ExpressionSpecification =>
      ['interpolate', ['linear'], ['zoom'], from, a, to, b];
    const style: StyleSpecification = {
      version: 8,
      projection: { type: 'globe' },
      sky: {
        'sky-color': '#071a2c',
        'horizon-color': '#2c6f96',
        'fog-color': '#0d2a44',
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 0.6, 7, 0],
      },
      sources: {
        planet: {
          type: 'raster',
          tiles: [`${location.origin}/world/tiles/{z}/{x}/{y}.jpg`],
          tileSize: 256,
          maxzoom: max,
          attribution: 'Terrain photography: NASA Earth Observatory, Blue Marble',
        },
        graticule: { type: 'geojson', data: graticule() },
        borders: { type: 'geojson', data: `${location.origin}/world/borders.geojson`, tolerance: 0.2 },
        rivers: { type: 'geojson', data: `${location.origin}/world/rivers.geojson`, tolerance: 0.2 },
      },
      layers: [
        { id: 'space', type: 'background', paint: { 'background-color': '#02060b' } },
        { id: 'planet', type: 'raster', source: 'planet', paint: { 'raster-fade-duration': 150 } },
        {
          id: 'graticule', type: 'line', source: 'graticule',
          paint: {
            'line-color': '#5fd4ea',
            'line-opacity': ['case', ['get', 'major'], 0.45, 0.18],
            'line-width': ['case', ['get', 'major'], 1, 0.6],
          },
          layout: { visibility: 'none' },
        },
        {
          // big rivers from the start, smaller ones appear as you zoom in
          id: 'rivers', type: 'line', source: 'rivers',
          paint: {
            'line-color': '#6cc3ea',
            'line-opacity': ['step', ['zoom'],
              ['case', ['>=', ['get', 'c'], 4], 0.85, 0],
              2.6, ['case', ['>=', ['get', 'c'], 3], 0.85, 0],
              3.4, ['case', ['>=', ['get', 'c'], 2], 0.85, 0],
              4.2, 0.85],
            'line-width': ['interpolate', ['linear'], ['zoom'],
              1, ['*', 0.35, ['interpolate', ['linear'], ['get', 'c'], 1, 0.8, 5, 2.6]],
              4, ['*', 0.8, ['interpolate', ['linear'], ['get', 'c'], 1, 0.8, 5, 2.6]],
              7, ['*', 2, ['interpolate', ['linear'], ['get', 'c'], 1, 0.8, 5, 2.6]]],
          },
          layout: { 'line-join': 'round', 'line-cap': 'round' },
        },
        {
          id: 'sea-zones', type: 'line', source: 'borders', minzoom: 2.5,
          filter: ['==', ['get', 'k'], K_SEA],
          paint: { 'line-color': '#8fd3ea', 'line-opacity': zoomFade(2.5, 4, 0, 0.22), 'line-width': 0.7, 'line-dasharray': [3, 3] },
        },
        {
          id: 'province-borders', type: 'line', source: 'borders', minzoom: 2,
          filter: ['==', ['get', 'k'], K_PROVINCE],
          paint: { 'line-color': '#f4f8fa', 'line-opacity': zoomFade(2, 3.5, 0, 0.42), 'line-width': zoomFade(2, 6, 0.5, 1.3) },
        },
        {
          id: 'nation-casing', type: 'line', source: 'borders',
          filter: ['==', ['get', 'k'], K_NATION],
          paint: { 'line-color': '#04121c', 'line-opacity': 0.45, 'line-width': zoomFade(1, 6, 2.5, 5), 'line-blur': 1 },
          layout: { 'line-join': 'round', 'line-cap': 'round' },
        },
        {
          id: 'nation-borders', type: 'line', source: 'borders',
          filter: ['==', ['get', 'k'], K_NATION],
          paint: { 'line-color': '#f4f8fa', 'line-opacity': 0.85, 'line-width': zoomFade(1, 6, 0.9, 2.2) },
          layout: { 'line-join': 'round', 'line-cap': 'round' },
        },
        {
          id: 'nation-selected', type: 'line', source: 'borders', filter: NONE,
          paint: { 'line-color': '#ffd27a', 'line-opacity': 0.9, 'line-width': zoomFade(1, 6, 1.4, 3), 'line-dasharray': [2, 1.5] },
          layout: { 'line-join': 'round' },
        },
        {
          id: 'province-glow', type: 'line', source: 'borders', filter: NONE,
          paint: { 'line-color': '#5fd4ea', 'line-opacity': 0.5, 'line-width': 9, 'line-blur': 6 },
          layout: { 'line-join': 'round' },
        },
        {
          id: 'province-selected', type: 'line', source: 'borders', filter: NONE,
          paint: { 'line-color': '#9be9f7', 'line-width': zoomFade(1, 6, 1.8, 3) },
          layout: { 'line-join': 'round', 'line-cap': 'round' },
        },
      ],
    };

    this.map = new MLMap({
      container,
      style,
      center: [40, 20],
      zoom: 2.1,
      minZoom: 0.6,
      maxZoom: max + 1.5,
      attributionControl: { compact: true },
      renderWorldCopies: false,
    });

    const el = document.createElement('div');
    el.className = 'pin';
    this.marker = new Marker({ element: el, opacityWhenCovered: '0' });
    let queued = false;
    this.map.on('move', () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; this.declutter(); });
    });
    this.map.on('moveend', () => this.updateProvinceLabels());
  }

  ready() {
    return new Promise<void>((resolve) => {
      if (this.map.loaded()) resolve();
      else this.map.once('load', () => resolve());
    });
  }

  setProjection(type: 'globe' | 'mercator') {
    this.map.setProjection({ type });
  }

  setGrid(on: boolean) {
    this.map.setLayoutProperty('graticule', 'visibility', on ? 'visible' : 'none');
  }

  setBorders(on: boolean) {
    for (const id of ['sea-zones', 'province-borders', 'nation-casing', 'nation-borders']) {
      this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    }
  }

  /** Mark nations led by players, and the player's own nation, on the map labels. */
  setControllers(players: Set<number>, mine: number | null) {
    for (const l of this.nationLabels) {
      l.el.classList.toggle('human', players.has(l.id));
      l.el.classList.toggle('mine', l.id === mine);
    }
  }

  setRivers(on: boolean) {
    this.map.setLayoutProperty('rivers', 'visibility', on ? 'visible' : 'none');
  }

  setLabels(on: boolean) {
    this.showProvinceNames = on;
    for (const l of this.nationLabels) l.el.hidden = !on;
    this.updateNationLabels();
    this.updateProvinceLabels();
  }

  pin(lat: number, lon: number) {
    this.marker.setLngLat([lon, lat]).addTo(this.map);
  }

  /** Outline the selected province, and its nation's border. */
  select(provinceId: number | null) {
    const p = provinceId ? this.pol.provinces.get(provinceId) : undefined;
    if (!p) {
      for (const id of ['province-glow', 'province-selected', 'nation-selected']) this.map.setFilter(id, NONE);
      return;
    }
    const touches: ExpressionSpecification = ['any', ['==', ['get', 'a'], p.id], ['==', ['get', 'b'], p.id]];
    this.map.setFilter('province-glow', touches);
    this.map.setFilter('province-selected', touches);
    const members = p.nation ? this.pol.nationProvinces.get(p.nation) ?? [] : [];
    if (members.length) {
      const inA: ExpressionSpecification = ['in', ['get', 'a'], ['literal', members]];
      const inB: ExpressionSpecification = ['in', ['get', 'b'], ['literal', members]];
      this.map.setFilter('nation-selected', [
        'all',
        ['in', ['get', 'k'], ['literal', [K_NATION, K_COAST]]],
        ['any', ['all', inA, ['!', inB]], ['all', inB, ['!', inA]]],
      ]);
    } else {
      this.map.setFilter('nation-selected', NONE);
    }
  }

  setOverlayOpacity(v: number) {
    if (this.map.getLayer('overlay')) this.map.setPaintProperty('overlay', 'raster-opacity', v);
  }

  setMode(mode: MapMode, opacity: number) {
    this.mode = mode;
    if (this.map.getLayer('overlay')) this.map.removeLayer('overlay');
    if (this.map.getSource('overlay')) this.map.removeSource('overlay');
    if (mode === 'satellite') return;
    const canvas = this.overlayCanvas(mode);
    this.map.addSource('overlay', { type: 'canvas', canvas, coordinates: OVERLAY_COORDS, animate: false });
    this.map.addLayer(
      { id: 'overlay', type: 'raster', source: 'overlay', paint: { 'raster-opacity': opacity, 'raster-fade-duration': 0 } },
      'graticule',
    );
  }

  private wealth = new Map<number, number>();

  /** New income-per-person figures arrived: refresh the Wealth overlay if it is showing. */
  private occupied = new Map<number, number>();

  /** Front lines moved: recolour occupied provinces in the political view. */
  setOccupied(occ: Map<number, number>, force = false) {
    const same = occ.size === this.occupied.size && [...occ].every(([k, v]) => this.occupied.get(k) === v);
    if (same && !force) return;
    this.occupied = occ;
    this.overlays.delete('political');
    if (this.mode === 'political' && this.map.getLayer('overlay')) {
      this.setMode('political', this.map.getPaintProperty('overlay', 'raster-opacity') as number);
    }
  }

  /** Swap to a colour-blind-safe wealth scale. */
  setColorBlind(on: boolean) {
    WEALTH_STOPS.splice(0, WEALTH_STOPS.length, ...(on ? WEALTH_CB : WEALTH_DEFAULT).map((s) => [...s] as [number, string]));
    this.overlays.delete('wealth');
    if (this.mode === 'wealth' && this.map.getLayer('overlay')) {
      this.setMode('wealth', this.map.getPaintProperty('overlay', 'raster-opacity') as number);
    }
  }

  /** Nations renamed or recoloured: relabel them and repaint the political view. */
  refreshNations(ids: number[]) {
    for (const l of this.nationLabels) if (ids.includes(l.id)) l.el.textContent = this.pol.nations.get(l.id)!.short.toUpperCase();
    this.overlays.delete('political');
    if (this.mode === 'political' && this.map.getLayer('overlay')) this.setMode('political', this.map.getPaintProperty('overlay', 'raster-opacity') as number);
  }

  private borderData: { features: { properties: { k: number; a: number; b: number } }[] } | null = null;

  /** Land changed hands: redraw national borders from current ownership. */
  async refreshBorders() {
    if (!this.borderData) {
      try { this.borderData = await (await fetch(`${location.origin}/world/borders.geojson`)).json(); } catch { return; }
    }
    let changed = false;
    for (const f of this.borderData!.features) {
      const pr = f.properties;
      if (pr.k !== K_PROVINCE && pr.k !== K_NATION) continue; // coasts and sea zones never change
      const a = this.pol.provinces.get(pr.a)?.nation, b = this.pol.provinces.get(pr.b)?.nation;
      const k = a !== b ? K_NATION : K_PROVINCE;
      if (k !== pr.k) { pr.k = k; changed = true; }
    }
    if (changed) (this.map.getSource('borders') as GeoJSONSource | undefined)?.setData(this.borderData as unknown as GeoJSON.FeatureCollection);
  }

  setWealth(values: Map<number, number>) {
    this.wealth = values;
    this.overlays.delete('wealth');
    if (this.mode === 'wealth' && this.map.getLayer('overlay')) {
      this.setMode('wealth', this.map.getPaintProperty('overlay', 'raster-opacity') as number);
    }
  }

  /** Paint each land province with its nation's colour (or leave it clear). */
  private nationCanvas(colourOf: (nation: number) => [number, number, number] | undefined) {
    const pol = this.pol;
    const byProvince = new Uint8Array((Math.max(...pol.provinces.keys()) + 1) * 3);
    const owned = new Uint8Array(byProvince.length / 3);
    for (const p of pol.provinces.values()) {
      const c = p.nation ? colourOf(this.occupied.get(p.id) ?? p.nation) : undefined; // occupied land shows the occupier
      if (!c) continue;
      byProvince.set(c.map(Math.round), p.id * 3);
      owned[p.id] = 1;
    }
    return mercatorCanvas(pol.width, pol.height, (i) => {
      const id = pol.grid[i];
      if (!owned[id]) return [0, 0, 0, 0];
      return [byProvince[id * 3], byProvince[id * 3 + 1], byProvince[id * 3 + 2], 255];
    }, 4096);
  }

  private overlayCanvas(mode: MapMode) {
    const cached = this.overlays.get(mode);
    if (cached) return cached;
    let canvas: HTMLCanvasElement;
    if (mode === 'political') {
      const colours = new Map<number, [number, number, number]>();
      for (const n of this.pol.nations.values()) colours.set(n.id, hex(n.color));
      canvas = this.nationCanvas((id) => colours.get(id));
    } else if (mode === 'wealth') {
      const logStops = WEALTH_STOPS.map(([v, c]) => [Math.log10(v), c] as [number, string]);
      canvas = this.nationCanvas((id) => {
        const v = this.wealth.get(id);
        return v ? ramp(logStops, Math.log10(v)) : undefined;
      });
    } else {
      const w = this.world;
      const biomeRgb = w.meta.biomes.map((b) => hex(BIOME_INFO[b].color));
      canvas = w.mercatorCanvas((i) => {
        const b = w.biomeIndexAt(i);
        if (mode === 'terrain') {
          if (b === 0) return [0, 0, 0, 0];
          const [r, g, bl] = biomeRgb[b];
          return [r, g, bl, 255];
        }
        if (mode === 'elevation') {
          const [r, g, bl] = ramp(ELEV_STOPS, w.elevationAt(i));
          return [r, g, bl, 255];
        }
        const [r, g, bl] = ramp(TEMP_STOPS, w.temperatureAt(i));
        return [r, g, bl, b === 0 ? 150 : 255];
      });
    }
    this.overlays.set(mode, canvas);
    return canvas;
  }

  // ---- labels ------------------------------------------------------------
  /** Label a nation created in play. */
  addNationLabel(id: number) {
    const n = this.pol.nations.get(id), anchor = n && this.pol.provinces.get(n.label_province);
    if (!n || !anchor || this.nationLabels.some((l) => l.id === id)) return;
    const el = document.createElement('div');
    el.className = 'nation-label';
    el.textContent = n.short.toUpperCase();
    const marker = new Marker({ element: el, opacityWhenCovered: '0' }).setLngLat(anchor.label).addTo(this.map);
    this.nationLabels.push({ id, marker, el, rank: this.nationLabels.length });
    this.overlays.delete('political');
  }

  addNationLabels() {
    const ranked = [...this.pol.nations.values()].sort((a, b) => b.area - a.area);
    ranked.forEach((n, rank) => {
      const anchor = this.pol.provinces.get(n.label_province);
      if (!anchor) return;
      const el = document.createElement('div');
      el.className = 'nation-label';
      el.textContent = n.short.toUpperCase();
      const marker = new Marker({ element: el, opacityWhenCovered: '0' }).setLngLat(anchor.label).addTo(this.map);
      this.nationLabels.push({ id: n.id, marker, el, rank });
    });
    this.declutter();
  }

  private updateNationLabels() {
    this.declutter();
  }

  /**
   * Hide labels that would overlap a more important one, or that sit on the
   * far side of the globe. Nations go first, larger before smaller, then
   * province names.
   */
  private declutter() {
    const z = this.map.getZoom();
    const placed: [number, number, number, number][] = [];
    const c = this.map.getCenter();
    const toVec = (lon: number, lat: number) => {
      const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
      return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
    };
    const cv = toVec(c.lng, c.lat);
    const globe = this.map.getProjection()?.type !== 'mercator';
    const fits = (el: HTMLElement, lon: number, lat: number, pad: number) => {
      if (globe) {
        const v = toVec(lon, lat);
        if (v[0] * cv[0] + v[1] * cv[1] + v[2] * cv[2] < 0.2) return false;
      }
      const pt = this.map.project([lon, lat]);
      const w = el.offsetWidth / 2 + pad, h = el.offsetHeight / 2 + pad;
      const box: [number, number, number, number] = [pt.x - w, pt.y - h, pt.x + w, pt.y + h];
      if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) return false;
      placed.push(box);
      return true;
    };
    const size = `${Math.round(Math.min(18, 9 + z * 2.4))}px`;
    for (const l of this.nationLabels) {
      l.el.style.fontSize = size;
      l.el.style.visibility = 'hidden';
      l.el.style.display = this.showProvinceNames && z < 4.6 ? '' : 'none';
    }
    for (const l of this.nationLabels) {
      if (l.el.style.display === 'none') continue;
      const { lng, lat } = l.marker.getLngLat();
      if (fits(l.el, lng, lat, 6)) l.el.style.visibility = '';
    }
    for (const m of this.provinceLabels.values()) {
      const el = m.getElement();
      const { lng, lat } = m.getLngLat();
      el.style.visibility = fits(el, lng, lat, 3) ? '' : 'hidden';
    }
  }

  private updateProvinceLabels() {
    const z = this.map.getZoom();
    const wanted = new Set<number>();
    if (this.showProvinceNames && z >= 4.2) {
      const b = this.map.getBounds();
      for (const p of this.pol.provinces.values()) {
        if (p.kind !== 'land') continue;
        const [lon, lat] = p.label;
        if (lat < b.getSouth() || lat > b.getNorth() || lon < b.getWest() || lon > b.getEast()) continue;
        wanted.add(p.id);
        if (wanted.size >= 260) break;
      }
    }
    for (const [id, m] of this.provinceLabels) {
      if (!wanted.has(id)) {
        m.remove();
        this.provinceLabels.delete(id);
      }
    }
    for (const id of wanted) {
      if (this.provinceLabels.has(id)) continue;
      const p = this.pol.provinces.get(id)!;
      const el = document.createElement('div');
      el.className = 'province-label';
      el.textContent = p.name;
      this.provinceLabels.set(id, new Marker({ element: el, opacityWhenCovered: '0' }).setLngLat(p.label).addTo(this.map));
    }
    this.declutter();
  }
}
