import { addProtocol, setWorkerUrl, type GeoJSONSource, Map as MLMap, Marker, type ExpressionSpecification, type StyleSpecification } from 'maplibre-gl';
import { DEV_STOPS } from './dev';
import { paintNight, sunDir } from './sun';
import type { Feature, FeatureCollection } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import { ASSET_BASE, OFFLINE, bin } from './config';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

// The map's background worker must ship with the build (dev serves it from node_modules).
if (import.meta.env.PROD) setWorkerUrl(mapWorkerUrl);

// Single-player build: terrain and relief tiles come packed in a few bundles (see tools/pack-tiles.mjs)
function packedTiles(scheme: string, name: string) {
  let index: Promise<Record<string, [string, number, number]>> | null = null;
  const bundles = new Map<string, Promise<ArrayBuffer>>();
  addProtocol(scheme, async (params) => {
    index ??= fetch(`${ASSET_BASE}world/${name}-index.json`).then((r) => r.json());
    const key = params.url.replace(`${scheme}://`, '');
    const hit = (await index)[key];
    if (!hit) throw new Error(`no tile ${key}`);
    const [group, offset, length] = hit;
    if (!bundles.has(group)) bundles.set(group, fetch(`${ASSET_BASE}world/${bin(`${name}-${group}.bin`)}`).then((r) => r.arrayBuffer()));
    return { data: (await bundles.get(group)!).slice(offset, offset + length) };
  });
}
if (OFFLINE) {
  packedTiles('pack', 'tiles');
  packedTiles('packdem', 'dem');
}

/** Relief tiles for the 3D map, if this world has them (worlds made before relief existed do not). */
const RELIEF_TILES = OFFLINE ? 'packdem://{z}/{x}/{y}' : `${ASSET_BASE}world/dem/{z}/{x}/{y}.png`;
async function hasRelief() {
  try {
    const r = await fetch(OFFLINE ? `${ASSET_BASE}world/dem-index.json` : `${ASSET_BASE}world/dem/0/0/0.png`, { method: OFFLINE ? 'GET' : 'HEAD' });
    return r.ok && !(r.headers.get('content-type') ?? '').includes('text/html');
  } catch { return false; }
}

/** How much the mountains are raised: strong from orbit, gentler up close, times the player's Relief setting. */
function exaggeration(zoom: number, relief: number) {
  // tall enough to read from orbit without coasts and ridges standing up as walls
  const base = Math.min(8, Math.max(2.2, 8 / Math.pow(1.45, Math.max(0, zoom - 1.5))));
  return base * relief;
}
/** The camera leans over the map as you zoom in, like a commander bending over a table. */
function tiltFor(zoom: number) {
  return Math.min(52, Math.max(0, (zoom - 2.2) * 17));
}
import type { Political, Province } from './political';
import { BIOME_INFO, mercatorCanvas, type World } from './world';
import { SPECIALTIES, SPECIALTY_LIST, specialtyOf } from '../../shared/specialties';

/** Specialties on the resource map: a distinct colour each. */
export const SPECIALTY_COLOURS = Object.fromEntries(SPECIALTY_LIST.map((s, i) => [s, `hsl(${Math.round((i * 360) / SPECIALTY_LIST.length)}, 62%, 52%)`])) as Record<string, string>;
export const RESOURCE_STOPS: [number, string][] = [[1, '#2a2416'], [25, '#7a5a1e'], [50, '#c98a1e'], [75, '#f0c030'], [100, '#fff2a0']];

export type MapMode = 'political' | 'wealth' | 'development' | 'resource' | 'diplomatic' | 'satellite' | 'terrain' | 'elevation' | 'climate' | 'lights';

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

/** Sea colour in the political view: a calm, dark, slightly green navy. */
const SEA_RGB: [number, number, number] = [27, 50, 66];

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

/**
 * Province colours on a Web Mercator canvas, with the coastline drawn as a smooth,
 * anti-aliased contour between grid cells (the same contour the satellite photo's shore
 * follows) rather than as the grid's square steps. Inland, each pixel takes the colour of
 * its own cell; at the coast the colour fades out across the shore.
 */
function provinceFill(pol: Political, byProvince: Uint8Array, size: number) {
  const W = pol.width, H = pol.height, grid = pol.grid;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const alphaOf = (i: number) => byProvince[grid[i] * 4 + 3] / 255;
  for (let y = 0; y < size; y++) {
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / size))) * 180) / Math.PI;
    const fy = ((90 - lat) / 180) * H - 0.5;
    const y0 = Math.max(0, Math.min(H - 1, Math.floor(fy))), y1 = Math.min(H - 1, y0 + 1), ty = Math.max(0, Math.min(1, fy - y0));
    for (let x = 0; x < size; x++) {
      const fx = ((x + 0.5) / size) * W - 0.5;
      const xf = Math.floor(fx), tx = fx - xf;
      const x0 = ((xf % W) + W) % W, x1 = (x0 + 1) % W;
      const i00 = y0 * W + x0, i01 = y0 * W + x1, i10 = y1 * W + x0, i11 = y1 * W + x1;
      // how much of the neighbourhood is coloured land, bilinearly: a smooth coastline
      const f = (alphaOf(i00) * (1 - tx) + alphaOf(i01) * tx) * (1 - ty) + (alphaOf(i10) * (1 - tx) + alphaOf(i11) * tx) * ty;
      const k = (y * size + x) * 4;
      if (f <= 0.3) { d[k + 3] = 0; continue; }
      // the colour of the nearest coloured cell of the four
      let best = grid[tx < 0.5 ? (ty < 0.5 ? i00 : i10) : (ty < 0.5 ? i01 : i11)];
      if (!byProvince[best * 4 + 3]) {
        best = byProvince[grid[i00] * 4 + 3] ? grid[i00] : byProvince[grid[i01] * 4 + 3] ? grid[i01] : byProvince[grid[i10] * 4 + 3] ? grid[i10] : grid[i11];
      }
      const t = Math.min(1, (f - 0.3) / 0.4);
      d[k] = byProvince[best * 4]; d[k + 1] = byProvince[best * 4 + 1]; d[k + 2] = byProvince[best * 4 + 2];
      d[k + 3] = Math.round(255 * t * t * (3 - 2 * t));
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

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
        'sky-color': '#0b1218',
        // a thin, dim halo: a bright horizon band used to glow under the tilted globe
        'horizon-color': '#22323c',
        'fog-color': '#121b21',
        'fog-ground-blend': 0.85,
        'horizon-fog-blend': 0.35,
        'sky-horizon-blend': 0.25,
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.8, 5, 0.4, 7, 0],
      },
      sources: {
        planet: {
          type: 'raster',
          tiles: [OFFLINE ? 'pack://{z}/{x}/{y}' : `${ASSET_BASE}world/tiles/{z}/{x}/{y}.jpg`],
          tileSize: 256,
          maxzoom: max,
          attribution: 'Terrain photography: NASA Earth Observatory, Blue Marble',
        },
        graticule: { type: 'geojson', data: graticule() },
        borders: { type: 'geojson', data: `${ASSET_BASE}world/borders.geojson`, tolerance: 0.2 },
        rivers: { type: 'geojson', data: `${ASSET_BASE}world/rivers.geojson`, tolerance: 0.2 },
      },
      layers: [
        // under the photo: deep-ocean blue, so the poles (beyond the map tiles) and any tile still
        // loading read as dark sea rather than a black (or bright) hole
        { id: 'space', type: 'background', paint: { 'background-color': '#0d1f33' } },
        {
          // the photographed planet, toned down into a map: less saturation, a little more contrast
          id: 'planet', type: 'raster', source: 'planet',
          paint: { 'raster-fade-duration': 150, 'raster-saturation': -0.35, 'raster-contrast': 0.12, 'raster-brightness-max': 0.92 },
        },
        {
          id: 'graticule', type: 'line', source: 'graticule',
          paint: {
            'line-color': '#c9a24a',
            'line-opacity': ['case', ['get', 'major'], 0.45, 0.2],
            'line-width': ['case', ['get', 'major'], 1, 0.6],
          },
          layout: { visibility: 'none' },
        },
        {
          // big rivers from the start, smaller ones appear as you zoom in
          id: 'rivers', type: 'line', source: 'rivers',
          paint: {
            'line-color': '#5f93ad',
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
          // sea zones: barely there, so they are not mistaken for shipping lanes
          paint: { 'line-color': '#7fa6b8', 'line-opacity': zoomFade(3, 4.5, 0, 0.12), 'line-width': 0.6, 'line-dasharray': [1, 4] },
        },
        {
          id: 'province-borders', type: 'line', source: 'borders', minzoom: 2,
          filter: ['==', ['get', 'k'], K_PROVINCE],
          // bold enough to read the jagged provinces against the political colours
          paint: { 'line-color': '#141a1e', 'line-opacity': zoomFade(2, 3.5, 0, 0.7), 'line-width': zoomFade(2, 6, 0.6, 1.7) },
        },
        {
          id: 'nation-casing', type: 'line', source: 'borders',
          filter: ['==', ['get', 'k'], K_NATION],
          paint: { 'line-color': '#0a0d10', 'line-opacity': 0.35, 'line-width': zoomFade(1, 6, 3.5, 7), 'line-blur': 2 },
          layout: { 'line-join': 'round', 'line-cap': 'round' },
        },
        {
          id: 'nation-borders', type: 'line', source: 'borders',
          filter: ['==', ['get', 'k'], K_NATION],
          paint: { 'line-color': '#11161a', 'line-opacity': 0.9, 'line-width': zoomFade(1, 6, 1.2, 2.8) },
          layout: { 'line-join': 'round', 'line-cap': 'round' },
        },
        {
          id: 'nation-selected', type: 'line', source: 'borders', filter: NONE,
          paint: { 'line-color': '#e8c46a', 'line-opacity': 0.95, 'line-width': zoomFade(1, 6, 1.6, 3.4) },
          layout: { 'line-join': 'round' },
        },
        {
          id: 'province-glow', type: 'line', source: 'borders', filter: NONE,
          paint: { 'line-color': '#e8c46a', 'line-opacity': 0.45, 'line-width': 9, 'line-blur': 6 },
          layout: { 'line-join': 'round' },
        },
        {
          id: 'province-selected', type: 'line', source: 'borders', filter: NONE,
          paint: { 'line-color': '#fff1c4', 'line-width': zoomFade(1, 6, 1.8, 3) },
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
      maxZoom: max + 0.6, // just past the photo's full detail: further in only blurs it
      maxPitch: 70,
      // the camera stays at sea level instead of riding up and down over the raised mountains
      centerClampedToGround: false,
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
    this.map.on('pitchstart', (e) => { if ((e as { originalEvent?: Event }).originalEvent) this.autoTilt = false; });
    this.map.on('zoomend', () => this.followZoom());
    this.map.once('load', () => { this.loadedOnce = true; void this.enableRelief(); });
    this.keyboardPan();
  }

  /** WASD moves the camera over the globe, smoothly, for as long as the keys are held. */
  private keyboardPan() {
    const held = new Set<string>();
    const dirs: Record<string, [number, number]> = { w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
    let fast = false, last = 0, frame = 0;
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('input:not([type=checkbox]):not([type=radio]):not([type=range]), select, textarea, [contenteditable]');
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
      last = now;
      let x = 0, y = 0;
      for (const k of held) { x += dirs[k][0]; y += dirs[k][1]; }
      if (x || y) {
        const len = Math.hypot(x, y);
        const speed = (fast ? 1500 : 650) * dt; // screen pixels a second, the same feel at any zoom
        this.map.panBy([(x / len) * speed, (y / len) * speed], { animate: false });
      }
      frame = held.size ? requestAnimationFrame(step) : 0;
    };
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      fast = e.shiftKey;
      if (!(k in dirs) || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      e.preventDefault();
      held.add(k);
      if (!frame) { last = performance.now(); frame = requestAnimationFrame(step); }
    });
    window.addEventListener('keyup', (e) => { held.delete(e.key.toLowerCase()); fast = e.shiftKey; });
    window.addEventListener('blur', () => held.clear()); // a key released in another window never sends keyup
  }

  // ---- 3D relief -----------------------------------------------------------
  private relief = 1;
  private reliefOn = false;
  /** The camera tilts with zoom until the player tilts it by hand (right-drag or Ctrl-drag). */
  autoTilt = true;

  private async enableRelief() {
    if (!(await hasRelief())) return;
    this.map.addSource('relief', { type: 'raster-dem', tiles: [RELIEF_TILES], tileSize: 256, maxzoom: 6, encoding: 'terrarium' });
    this.map.addSource('relief-shade', { type: 'raster-dem', tiles: [RELIEF_TILES], tileSize: 256, maxzoom: 6, encoding: 'terrarium' });
    this.map.addLayer({
      id: 'hillshade', type: 'hillshade', source: 'relief-shade',
      paint: {
        'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 0, 0.5, 5, 0.45, 7, 0.3], // relief shading that stays under the photo's own
        'hillshade-shadow-color': '#0b0d0c',
        'hillshade-highlight-color': '#e9e3cf',
        'hillshade-accent-color': '#2a2a22',
        'hillshade-illumination-direction': 315,
      },
    }, 'graticule');
    this.reliefOn = true;
    this.applyRelief();
  }

  /** Raise or flatten the mountains (0 = flat map). */
  setRelief(v: number) {
    this.relief = v;
    this.applyRelief();
  }

  setAutoTilt(on: boolean) {
    this.autoTilt = on;
    this.map.easeTo({ pitch: on ? tiltFor(this.map.getZoom()) : 0, duration: 500 });
  }

  private applyRelief() {
    if (!this.reliefOn) return;
    if (this.relief <= 0) {
      this.map.setTerrain(null);
      this.map.setLayoutProperty('hillshade', 'visibility', 'none');
      return;
    }
    this.map.setLayoutProperty('hillshade', 'visibility', 'visible');
    const want = exaggeration(this.map.getZoom(), this.relief);
    if (!this.setExaggeration(want)) this.map.setTerrain({ source: 'relief', exaggeration: want });
  }

  /**
   * Change how high the mountains stand without rebuilding the terrain. setTerrain()
   * destroys the 3D terrain and the textures the map is drawn into, so calling it while
   * zooming blanked the globe (or half of it, or the rivers) for a frame.
   */
  private setExaggeration(v: number) {
    type Live = {
      exaggeration: number; options: { exaggeration?: number }; coverage?: { exaggeration: number };
      resetElevationCache?: () => void;
    };
    const m = this.map as unknown as {
      terrain?: Live | null; painter?: { markTerrainDepthDirty?: () => void };
      _camera?: { applyTerrainChange?: () => void };
    };
    const t = m.terrain;
    if (!t || typeof t.exaggeration !== 'number') return false;
    t.exaggeration = v;
    t.options.exaggeration = v;
    if (t.coverage) t.coverage.exaggeration = v;
    t.resetElevationCache?.();
    m.painter?.markTerrainDepthDirty?.();
    m._camera?.applyTerrainChange?.();
    this.map.triggerRepaint();
    return true;
  }

  private followZoom() {
    const z = this.map.getZoom();
    if (this.reliefOn && this.relief > 0) {
      const want = exaggeration(z, this.relief);
      const now = this.map.getTerrain()?.exaggeration ?? 0;
      if (Math.abs(want - now) / Math.max(want, 1) > 0.08) this.applyRelief();
    }
    if (this.autoTilt && !this.map.isMoving()) {
      const p = tiltFor(z);
      if (Math.abs(p - this.map.getPitch()) > 2) this.map.easeTo({ pitch: p, duration: 450 });
    }
  }

  private loadedOnce = false;
  ready() {
    return new Promise<void>((resolve) => {
      if (this.loadedOnce || this.map.loaded()) resolve();
      else this.map.once('load', () => resolve());
    });
  }

  setProjection(type: 'globe' | 'mercator') {
    this.map.setProjection({ type });
    const flat = type === 'mercator';
    // on the globe the background shows only at the poles (ice); flat, it fills the space around the map
    this.map.setPaintProperty('space', 'background-color', flat ? '#05080b' : '#0d1f33');
    if (flat) {
      // centred on the world, never dragged off it, and never zoomed out past the map's width
      const w = this.map.getContainer().clientWidth || 1200;
      this.map.setMinZoom(Math.max(0, Math.log2(w / 512)));
      this.map.setMaxBounds([[-180, -84], [180, 84]]);
      const c = this.map.getCenter();
      this.map.jumpTo({ center: [c.lng, Math.max(-55, Math.min(55, c.lat))], pitch: 0, bearing: 0, zoom: Math.max(this.map.getMinZoom(), this.map.getZoom()) });
    } else {
      this.map.setMaxBounds(null);
      this.map.setMinZoom(0.6);
    }
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

  /** How strongly borders are drawn: 1 as designed, 0 hidden, up to 2 twice as bold. */
  setBorderStrength(k: number) {
    const fade = (from: number, to: number, a: number, b: number): ExpressionSpecification => ['interpolate', ['linear'], ['zoom'], from, a, to, b];
    const c = (x: number) => Math.min(1, Math.max(0, x));
    const set = (id: string, prop: string, v: unknown) => { if (this.map.getLayer(id)) this.map.setPaintProperty(id, prop as never, v as never); };
    set('province-borders', 'line-opacity', fade(2, 3.5, 0, c(0.7 * k)));
    set('province-borders', 'line-width', fade(2, 6, 0.6 * Math.max(1, k * 0.8), 1.7 * Math.max(1, k * 0.8)));
    set('nation-casing', 'line-opacity', c(0.35 * k));
    set('nation-borders', 'line-opacity', c(0.9 * k));
    set('nation-borders', 'line-width', fade(1, 6, 1.2 * Math.max(1, k * 0.8), 2.8 * Math.max(1, k * 0.8)));
  }

  setOverlayOpacity(v: number) {
    this.opacity = v;
    if (this.map.getLayer('overlay')) this.map.setPaintProperty('overlay', 'raster-opacity', v);
    if (this.map.getLayer('province-fill')) this.map.setPaintProperty('province-fill', 'fill-opacity', v);
  }

  private opacity = 0.72;
  private fillsReady = false;
  private fillColour = new Map<number, string>();

  /**
   * Province modes are drawn from each province's traced outline (world/fills.geojson), so the
   * colours meet the coast and lakes exactly where the satellite photo does, stay sharp at any
   * zoom, and recolour in place (no repainting a whole-world picture when a front line moves).
   */
  private addFills() {
    if (this.map.getSource('fills')) return;
    this.map.addSource('fills', { type: 'geojson', data: `${ASSET_BASE}world/fills.geojson`, promoteId: 'p', tolerance: 0.15 });
    this.map.addLayer({
      id: 'province-fill', type: 'fill', source: 'fills',
      paint: { 'fill-color': ['coalesce', ['feature-state', 'c'], 'rgba(0,0,0,0)'] as never, 'fill-opacity': 0, 'fill-antialias': true },
    }, this.map.getLayer('hillshade') ? 'hillshade' : 'graticule');
    this.map.on('sourcedata', (e) => {
      if (e.sourceId !== 'fills' || !e.isSourceLoaded || this.fillsReady) return;
      this.fillsReady = true;
      this.fillColour.clear();
      this.setMode(this.mode, this.opacity);
    });
  }

  /** The colour of each land province in a province-based mode (undefined: unpainted). */
  private provinceColour(mode: MapMode): ((p: Province) => [number, number, number] | undefined) | null {
    const owner = (p: Province) => (p.nation ? this.occupied.get(p.id) ?? p.nation : undefined);
    if (mode === 'political') {
      const colours = new Map<number, [number, number, number]>();
      for (const n of this.pol.nations.values()) colours.set(n.id, hex(n.color));
      return (p) => { const o = owner(p); return o !== undefined ? colours.get(o) : undefined; };
    }
    if (mode === 'diplomatic') return (p) => { const o = owner(p); return o !== undefined ? this.diplo.get(o) : undefined; };
    if (mode === 'terrain') {
      // one terrain per province, painted on the province shapes so it sits exactly on the photo
      const cols = new Map<string, [number, number, number]>();
      return (p) => {
        if (p.kind !== 'land') return undefined;
        let c = cols.get(p.terrain);
        if (!c) { c = hex(BIOME_INFO[p.terrain as keyof typeof BIOME_INFO]?.color ?? '#888888'); cols.set(p.terrain, c); }
        return c;
      };
    }
    if (mode === 'development') return (p) => { const v = this.devValues.get(p.id); return v !== undefined ? ramp(DEV_STOPS, v) : undefined; };
    if (mode === 'wealth') {
      const logStops = WEALTH_STOPS.map(([v, c]) => [Math.log10(v), c] as [number, string]);
      return (p) => { const o = owner(p); const v = o !== undefined ? this.wealth.get(o) : undefined; return v ? ramp(logStops, Math.log10(v)) : undefined; };
    }
    if (mode === 'resource') {
      const key = this.resourceKey;
      if (key === 'specialty') {
        const cols = Object.fromEntries(Object.entries(SPECIALTY_COLOURS).map(([k, c]) => [k, hslRgb(c)]));
        return (p) => { const sp = specialtyOf(p as never); return sp ? cols[sp] : undefined; };
      }
      return (p) => { const v = (p.res as Record<string, number> | undefined)?.[key] ?? 0; return v > 0 ? ramp(RESOURCE_STOPS, v) : undefined; };
    }
    return null;
  }

  /** Set each province's colour, touching only those that changed. */
  private paintFills(colourOf: (p: Province) => [number, number, number] | undefined) {
    for (const p of this.pol.provinces.values()) {
      if (p.kind !== 'land') continue;
      const c = colourOf(p);
      const css = c ? `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})` : '';
      if (this.fillColour.get(p.id) === css) continue;
      this.fillColour.set(p.id, css);
      this.map.setFeatureState({ source: 'fills', id: p.id }, { c: css || null });
    }
  }

  setMode(mode: MapMode, opacity: number) {
    this.mode = mode;
    this.opacity = opacity;
    this.addFills();
    const byProvince = this.provinceColour(mode);
    if (byProvince && this.fillsReady) {
      if (this.map.getLayer('overlay')) this.map.removeLayer('overlay');
      if (this.map.getSource('overlay')) this.map.removeSource('overlay');
      this.paintFills(byProvince);
      this.map.setPaintProperty('province-fill', 'fill-opacity', opacity);
      return;
    }
    this.map.setPaintProperty('province-fill', 'fill-opacity', 0);
    if (this.map.getLayer('overlay')) this.map.removeLayer('overlay');
    if (this.map.getSource('overlay')) this.map.removeSource('overlay');
    if (mode === 'satellite') return;
    const canvas = this.overlayCanvas(mode);
    this.map.addSource('overlay', { type: 'canvas', canvas, coordinates: OVERLAY_COORDS, animate: false });
    this.map.addLayer(
      { id: 'overlay', type: 'raster', source: 'overlay', paint: { 'raster-opacity': opacity, 'raster-fade-duration': 0 } },
      this.map.getLayer('hillshade') ? 'hillshade' : 'graticule',
    );
  }

  /** The game's clock (ms), for where it is night. */
  clock: () => number = () => Date.now();
  private nightCanvas = document.createElement('canvas');
  /** The night lights map follows the sun: repaint the night side. */
  refreshNight() {
    if (this.mode !== 'lights' || !this.map.getSource('overlay')) return;
    paintNight(this.nightCanvas, sunDir(this.clock()));
    const src = this.map.getSource('overlay') as unknown as { play?: () => void; pause?: () => void };
    if (src.play && src.pause) { src.play(); src.pause(); this.map.triggerRepaint(); }
  }

  private wealth = new Map<number, number>();
  private resourceKey = 'farmland';
  private diplo = new Map<number, [number, number, number]>();

  /** Which resource the resource map shows (a province resource, or 'specialty'). */
  setResource(key: string) { this.resourceKey = key; this.refreshMode('resource'); }
  /** The diplomatic map's colours, one per nation. */
  setDiplomatic(colours: Map<number, [number, number, number]>) { this.diplo = colours; this.refreshMode('diplomatic'); }
  private refreshMode(mode: MapMode) {
    this.overlays.delete(mode);
    if (this.mode === mode) this.setMode(mode, this.opacity);
  }

  /** Paint each land province by a value of its own. */
  private provinceCanvas(colourOf: (p: Province) => [number, number, number] | undefined) {
    const pol = this.pol;
    const byProvince = new Uint8Array((Math.max(...pol.provinces.keys()) + 1) * 4);
    for (const p of pol.provinces.values()) {
      const c = p.kind === 'land' ? colourOf(p) : undefined;
      if (c) byProvince.set([...c.map(Math.round), 255], p.id * 4);
    }
    return provinceFill(pol, byProvince, 4096);
  }

  /** New income-per-person figures arrived: refresh the Wealth overlay if it is showing. */
  private occupied = new Map<number, number>();

  /** Front lines moved: recolour occupied provinces in the political view. */
  setOccupied(occ: Map<number, number>, force = false) {
    const same = occ.size === this.occupied.size && [...occ].every(([k, v]) => this.occupied.get(k) === v);
    if (same && !force) return;
    this.occupied = occ;
    this.overlays.delete('political');
    if (this.mode === 'political') {
      this.setMode('political', this.opacity);
    }
  }

  /** Swap to a colour-blind-safe wealth scale. */
  setColorBlind(on: boolean) {
    WEALTH_STOPS.splice(0, WEALTH_STOPS.length, ...(on ? WEALTH_CB : WEALTH_DEFAULT).map((s) => [...s] as [number, string]));
    this.overlays.delete('wealth');
    if (this.mode === 'wealth') {
      this.setMode('wealth', this.opacity);
    }
  }

  /** Nations renamed or recoloured: relabel them and repaint the political view. */
  refreshNations(ids: number[]) {
    for (const l of this.nationLabels) if (ids.includes(l.id)) l.el.textContent = this.pol.nations.get(l.id)!.short.toUpperCase();
    this.overlays.delete('political');
    if (this.mode === 'political') this.setMode('political', this.opacity);
  }

  private borderData: { features: { properties: { k: number; a: number; b: number } }[] } | null = null;

  /** Land changed hands: redraw national borders from current ownership. */
  async refreshBorders() {
    if (!this.borderData) {
      try { this.borderData = await (await fetch(`${ASSET_BASE}world/borders.geojson`)).json(); } catch { return; }
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

  private devValues = new Map<number, number>();
  /** Each province's development (0..100), for the development map. */
  setDevelopment(values: Map<number, number>) {
    this.devValues = values;
    this.refreshMode('development');
  }

  setWealth(values: Map<number, number>) {
    this.wealth = values;
    this.overlays.delete('wealth');
    if (this.mode === 'wealth') {
      this.setMode('wealth', this.opacity);
    }
  }

  /** Paint each land province with its nation's colour (or leave it clear). */
  private nationCanvas(colourOf: (nation: number) => [number, number, number] | undefined, sea?: [number, number, number]) {
    const pol = this.pol;
    const byProvince = new Uint8Array((Math.max(...pol.provinces.keys()) + 1) * 3);
    const owned = new Uint8Array(byProvince.length / 3);
    for (const p of pol.provinces.values()) {
      const c = p.nation ? colourOf(this.occupied.get(p.id) ?? p.nation) : undefined; // occupied land shows the occupier
      if (!c) continue;
      byProvince.set(c.map(Math.round), p.id * 3);
      owned[p.id] = 1;
    }
    const isSea = new Uint8Array(owned.length);
    if (sea) for (const p of pol.provinces.values()) if (p.kind !== 'land') isSea[p.id] = 1;
    return mercatorCanvas(pol.width, pol.height, (i) => {
      const id = pol.grid[i];
      if (sea && (id === 0 || isSea[id])) return [sea[0], sea[1], sea[2], 235];
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
      canvas = this.nationCanvas((id) => colours.get(id), SEA_RGB);
    } else if (mode === 'lights') {
      // the world from orbit at night: dark land and lit cities where it is night, plain day elsewhere
      canvas = this.nightCanvas;
      paintNight(canvas, sunDir(this.clock()));
    } else if (mode === 'diplomatic') {
      canvas = this.nationCanvas((id) => this.diplo.get(id));
    } else if (mode === 'resource') {
      const key = this.resourceKey;
      if (key === 'specialty') {
        const cols = Object.fromEntries(Object.entries(SPECIALTY_COLOURS).map(([k, c]) => [k, hslRgb(c)]));
        canvas = this.provinceCanvas((p) => { const s = specialtyOf(p as never); return s ? cols[s] : undefined; });
      } else {
        canvas = this.provinceCanvas((p) => {
          const v = (p.res as Record<string, number> | undefined)?.[key] ?? 0;
          return v > 0 ? ramp(RESOURCE_STOPS, v) : undefined;
        });
      }
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
    this.attached.add(marker);
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
      this.attached.add(marker);
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
  private labelSize = '';
  /** Label sizes, measured once per font size: reading sizes during a move forces the browser to lay the page out again. */
  private labelBox = new WeakMap<HTMLElement, [number, number]>();
  private attached = new WeakSet<Marker>();

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
    const facing = (lon: number, lat: number) => { if (!globe) return true; const v = toVec(lon, lat); return v[0] * cv[0] + v[1] * cv[1] + v[2] * cv[2] >= 0.2; };
    const canvas = this.map.getCanvas();
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const size = `${Math.round(Math.min(18, 9 + z * 2.4))}px`;
    const resized = size !== this.labelSize;
    this.labelSize = size;
    const box = (el: HTMLElement) => {
      let b = this.labelBox.get(el);
      if (!b || resized) { b = [el.offsetWidth, el.offsetHeight]; this.labelBox.set(el, b); }
      return b;
    };
    const fits = (el: HTMLElement, lon: number, lat: number, pad: number) => {
      const pt = this.map.project([lon, lat]);
      const [bw, bh] = box(el);
      const w = bw / 2 + pad, h = bh / 2 + pad;
      if (pt.x + w < -50 || pt.y + h < -50 || pt.x - w > W + 50 || pt.y - h > H + 50) return false;
      const r: [number, number, number, number] = [pt.x - w, pt.y - h, pt.x + w, pt.y + h];
      if (placed.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) return false;
      placed.push(r);
      return true;
    };
    // nation names: shown zoomed out; only those on the near side stay on the map (each attached marker costs every frame)
    const showNations = this.showProvinceNames && z < 4.6;
    if (resized) for (const l of this.nationLabels) l.el.style.fontSize = size;
    for (const l of this.nationLabels) {
      const { lng, lat } = l.marker.getLngLat();
      const want = showNations && facing(lng, lat);
      if (want && !this.attached.has(l.marker)) { l.marker.addTo(this.map); this.attached.add(l.marker); }
      else if (!want && this.attached.has(l.marker)) { l.marker.remove(); this.attached.delete(l.marker); }
      if (want) l.el.style.visibility = fits(l.el, lng, lat, 6) ? '' : 'hidden';
    }
    for (const m of this.provinceLabels.values()) {
      const el = m.getElement();
      const { lng, lat } = m.getLngLat();
      el.style.visibility = facing(lng, lat) && fits(el, lng, lat, 3) ? '' : 'hidden';
    }
  }

  private updateProvinceLabels() {
    const z = this.map.getZoom();
    const wanted = new Set<number>();
    if (this.showProvinceNames && z >= 4.2) {
      const b = this.map.getBounds();
      for (const p of this.pol.provinces.values()) {
        if (p.kind !== 'land' || p.city) continue; // a city shares its province's name
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

/** 'hsl(h, s%, l%)' to RGB. */
function hslRgb(c: string): [number, number, number] {
  const [h, s, l] = c.match(/[\d.]+/g)!.map(Number);
  const S = s / 100, L = l / 100, k = (n: number) => (n + h / 30) % 12, a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
void SPECIALTIES;
