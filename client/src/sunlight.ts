// Sunlight on the map, from a distant sun placed by the game's date and time:
// the night side dims, a warm band of dawn and dusk runs along the terminator,
// and the sea catches a soft glint where the sun stands overhead. Drawn as a
// low-resolution light layer over the photo (light changes slowly across the
// globe, so 512 pixels is plenty) and recomputed as the clock moves. Up close
// the sea also gets moving whitecaps and, now and then, sea life.
import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl';
import type { Game } from './game';
import type { Political } from './political';

const N = 512;
const MERC = 85.0511287798066;
const COORDS: [[number, number], [number, number], [number, number], [number, number]] = [[-180, MERC], [180, MERC], [180, -MERC], [-180, -MERC]];
const D = Math.PI / 180;

export class Sunlight {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;
  private dir: Float32Array; // unit vector per pixel
  private sea: Uint8Array;
  private on = true;
  private lastSun = [0, 0, 0];

  constructor(private map: MLMap, private game: Game, pol: Political) {
    this.canvas.width = this.canvas.height = N;
    this.ctx = this.canvas.getContext('2d')!;
    this.img = this.ctx.createImageData(N, N);
    this.dir = new Float32Array(N * N * 3);
    this.sea = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) {
      const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / N)));
      for (let x = 0; x < N; x++) {
        const lon = ((x + 0.5) / N) * 2 * Math.PI - Math.PI, k = (y * N + x) * 3;
        this.dir[k] = Math.cos(lat) * Math.sin(lon); this.dir[k + 1] = Math.sin(lat); this.dir[k + 2] = Math.cos(lat) * Math.cos(lon);
        this.sea[y * N + x] = pol.provinceAt(lat / D, lon / D)?.kind === 'land' ? 0 : 1;
      }
    }
    try { this.on = localStorage.getItem('sov.sunlight') !== 'off'; } catch { /* storage blocked */ }
    this.paint(true);
    map.addSource('sunlight', { type: 'canvas', canvas: this.canvas, coordinates: COORDS, animate: false });
    map.addLayer({ id: 'sunlight', type: 'raster', source: 'sunlight', paint: { 'raster-opacity': this.on ? 1 : 0, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } },
      map.getLayer('rivers') ? 'rivers' : undefined);
    window.setInterval(() => this.paint(false), 700);
    new Seas(map, pol);
  }

  get enabled() { return this.on; }

  /** Told how sunlit the north and south poles are (0..1) whenever the light is worked out. */
  onPoles: (north: number, south: number) => void = () => {};

  setEnabled(on: boolean) {
    this.on = on;
    try { localStorage.setItem('sov.sunlight', on ? 'on' : 'off'); } catch { /* storage blocked */ }
    if (!on) this.onPoles(1, 1);
    if (this.map.getLayer('sunlight')) this.map.setPaintProperty('sunlight', 'raster-opacity', on ? 1 : 0);
    if (on) this.paint(true);
  }

  private sun(): [number, number, number] {
    const now = this.game.gameNow();
    const doy = (now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 1)) / 864e5;
    const dec = 23.44 * Math.sin((2 * Math.PI * (doy - 81)) / 365) * D;
    const hours = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
    const lon = -(hours - 12) * 15 * D;
    return [Math.cos(dec) * Math.sin(lon), Math.sin(dec), Math.cos(dec) * Math.cos(lon)];
  }

  private paint(force: boolean) {
    if (!this.on && !force) return;
    const [sx, sy, sz] = this.sun();
    const [px, py, pz] = this.lastSun;
    if (!force && Math.abs(sx - px) + Math.abs(sy - py) + Math.abs(sz - pz) < 0.01) return;
    this.lastSun = [sx, sy, sz];
    // the sun's height over each pole is its declination: below the horizon there it is polar night
    const pole = (h: number) => (this.on ? 0.3 + 0.7 * Math.min(1, Math.max(0, (h + 0.06) / 0.25)) : 1);
    this.onPoles(pole(sy), pole(-sy));
    const d = this.img.data, dir = this.dir, sea = this.sea;
    for (let i = 0, k = 0, o = 0; i < N * N; i++, k += 3, o += 4) {
      const cos = dir[k] * sx + dir[k + 1] * sy + dir[k + 2] * sz; // the sun's height in the sky, -1..1
      // night: a deep blue dimming that comes on through civil and nautical twilight
      const night = Math.min(1, Math.max(0, (0.06 - cos) / 0.26));
      // dawn and dusk: a warm band where the sun is on the horizon
      const dusk = Math.max(0, 1 - Math.abs(cos + 0.03) / 0.16) ** 2 * 0.45; // faint: a hint of warmth, not a stripe
      // the glint of the sun on open water, round the point below it
      const glint = sea[i] && cos > 0.9 ? ((cos - 0.9) / 0.1) ** 3 : 0;
      const a = night * 0.5 + dusk * 0.14 + glint * 0.2;
      if (a < 0.004) { d[o + 3] = 0; continue; }
      const r = (night * 0.5 * 6 + dusk * 0.14 * 255 + glint * 0.2 * 255) / a;
      const g = (night * 0.5 * 14 + dusk * 0.14 * 140 + glint * 0.2 * 246) / a;
      const b = (night * 0.5 * 34 + dusk * 0.14 * 70 + glint * 0.2 * 226) / a;
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = Math.min(255, a * 255);
    }
    this.ctx.putImageData(this.img, 0, 0);
    // a still canvas source uploads its picture again when played and paused once
    const src = this.map.getSource('sunlight') as unknown as { play?: () => void; pause?: () => void } | undefined;
    if (src?.play && src.pause) { src.play(); src.pause(); this.map.triggerRepaint(); }
  }
}

/**
 * Up close over the sea: whitecaps that glint and move with the wind, and now and
 * then a whale surfacing or a pod of dolphins, fading in and out.
 */
export class Seas {
  private frame = 0;
  private layer: HTMLElement;
  private still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(private map: MLMap, private pol: Political) {
    for (let f = 0; f < 3; f++) map.addImage(`wave-${f}`, waveIcon(f), { pixelRatio: 2 });
    map.addSource('waves', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'waves', type: 'symbol', source: 'waves', minzoom: 4.6,
      layout: { 'icon-image': 'wave-0', 'icon-rotate': ['get', 'r'] as never, 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 4.6, 0.5, 7.5, 1.1] as never, 'icon-allow-overlap': true, 'icon-ignore-placement': true },
      paint: { 'icon-opacity': ['interpolate', ['linear'], ['zoom'], 4.6, 0, 5.4, 0.55] as never },
    }, map.getLayer('lanes') ? 'lanes' : undefined);
    map.on('moveend', () => this.scatter());
    window.setInterval(() => this.tick(), 450);
    this.layer = document.createElement('div');
    this.layer.className = 'prov-scenes';
    map.getContainer().appendChild(this.layer);
    window.setInterval(() => this.life(), 6000);
  }

  /** Scatter whitecaps over the water in view. */
  private scatter() {
    const src = this.map.getSource('waves') as GeoJSONSource | undefined;
    if (!src) return;
    if (this.map.getZoom() < 4.6) { src.setData({ type: 'FeatureCollection', features: [] }); return; }
    const b = this.map.getBounds(), features: GeoJSON.Feature[] = [];
    const [w, s, e, n] = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    let seed = Math.floor(w * 1000 + s * 77);
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 520; i++) {
      const lon = w + rand() * (e - w), lat = s + rand() * (n - s);
      const p = this.pol.provinceAt(lat, ((lon + 540) % 360) - 180);
      if (p && p.kind === 'land') continue;
      features.push({ type: 'Feature', properties: { r: 60 + rand() * 30 }, geometry: { type: 'Point', coordinates: [lon, lat] } });
    }
    src.setData({ type: 'FeatureCollection', features });
  }

  private tick() {
    if (this.map.getZoom() < 4.6 || this.still || !this.map.getLayer('waves')) return;
    this.frame = (this.frame + 1) % 3;
    this.map.setLayoutProperty('waves', 'icon-image', `wave-${this.frame}`);
  }

  /** Now and then, somewhere on the water in view: a whale's spout and tail, or dolphins. */
  private life() {
    if (this.map.getZoom() < 5 || this.still || document.hidden) return;
    const c = this.map.getContainer();
    for (let tries = 0; tries < 12; tries++) {
      const x = 60 + Math.random() * (c.clientWidth - 120), y = 120 + Math.random() * (c.clientHeight - 240);
      const ll = this.map.unproject([x, y]);
      const p = this.pol.provinceAt(ll.lat, ll.lng);
      if (p && p.kind === 'land') continue;
      const el = document.createElement('div');
      const whale = Math.random() < 0.4;
      el.className = `prov-scene ${whale ? 'whale' : 'dolphins'}`;
      el.innerHTML = whale
        ? '<i style="--x:0px;--y:0px;--d:0s;--s:1"><svg viewBox="0 0 40 24"><path class="body" d="M4 16c6-5 18-6 28-2l4-4v8l-4-2c-8 4-20 4-28 0z"/><path class="spout" d="M12 10c-2-4 0-7 2-8M12 10c1-4 4-6 6-6"/></svg></i>'
        : [0, 1, 2].map((k) => `<i style="--x:${k * 12}px;--y:${(k % 2) * 6}px;--d:${k * 0.25}s;--s:1"><svg viewBox="0 0 24 12"><path class="body" d="M2 10c4-7 12-8 18-3l2-3v6z"/></svg></i>`).join('');
      el.style.transform = `translate(${x}px, ${y}px)`;
      this.layer.appendChild(el);
      window.setTimeout(() => el.remove(), 5200);
      return;
    }
  }
}

/** A few short whitecap crests, in three phases so they seem to roll. */
function waveIcon(phase: number): ImageData {
  const S = 40, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(235,245,250,0.85)';
  g.lineCap = 'round';
  const crests = [[6, 12], [20, 26], [10, 32]];
  crests.forEach(([x, y], i) => {
    const k = (phase + i) % 3;
    g.globalAlpha = [0.9, 0.5, 0.15][k];
    g.lineWidth = 1.4 - k * 0.3;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 5, y - 3 + k, x + 11, y + 1); g.stroke();
  });
  return g.getImageData(0, 0, S, S);
}
