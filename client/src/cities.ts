// Cities and buildings drawn into the map so they read as part of the
// satellite picture: irregular urban sprawl with a street texture, a faint warm
// core seen from afar, and small muted icons for the buildings in each province.
import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl';
import type { BuildingType } from '../../shared/buildings';
import type { Game } from './game';
import type { Political, Province } from './political';

const MIN_POP = 900_000; // provinces this populous get a city

/** Deterministic pseudo-random numbers per city, so sprawl looks the same for everyone. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An irregular blob of radius ~km around a point, as a closed ring of lon/lat. */
function blob(lon: number, lat: number, km: number, rand: () => number): [number, number][] {
  const phases = [rand() * 6.28, rand() * 6.28, rand() * 6.28];
  const amps = [0.22 + rand() * 0.15, 0.12 + rand() * 0.1, 0.06 + rand() * 0.06];
  const ring: [number, number][] = [];
  const cos = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const r = km * (1 + amps[0] * Math.sin(2 * a + phases[0]) + amps[1] * Math.sin(3 * a + phases[1]) + amps[2] * Math.sin(5 * a + phases[2]));
    ring.push([lon + (r / 111) * Math.cos(a) / cos, lat + (r / 111) * Math.sin(a)]);
  }
  ring[ring.length - 1] = ring[0];
  return ring;
}

type Climate = 'temperate' | 'arid' | 'tropical' | 'cold';
type Style = 'old' | 'grid' | 'sprawl';
const STYLES: Style[] = ['old', 'grid', 'sprawl'];
const VARIANTS = 3;

/** Roof and pavement colours as seen from orbit, by climate. */
const PALETTE: Record<Climate, string[]> = {
  temperate: ['#6a6765', '#8d8780', '#a9a39a', '#5c5450', '#7b6f66', '#b5aea3'],
  arid: ['#b39b7a', '#c9b796', '#9a8467', '#d8cbb1', '#8c7a63', '#bfae90'],
  tropical: ['#7b7266', '#9a9183', '#6c675c', '#b0a596', '#857565', '#5f6655'],
  cold: ['#7a7c80', '#9a9ca0', '#5d6066', '#b3b4b6', '#6c6a6a', '#8b8f95'],
};

function climateOf(terrain: string): Climate {
  if (['desert_sand', 'desert_rock', 'savanna', 'shrubland', 'steppe', 'mountain_dry'].includes(terrain)) return 'arid';
  if (terrain === 'rainforest') return 'tropical';
  if (['tundra', 'boreal', 'ice'].includes(terrain)) return 'cold';
  return 'temperate';
}

/**
 * A tile of city seen from orbit, on a transparent background so the land
 * shows through: roofs and streets only, laid out as an old organic town, a
 * planned grid, or loose sprawl.
 */
function urbanTexture(style: Style, climate: Climate, seed: number): ImageData {
  const S = 128, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const rand = rng(seed * 131 + STYLES.indexOf(style) * 17 + 3);
  const colors = PALETTE[climate];
  const roof = (alpha: number) => { g.globalAlpha = alpha; g.fillStyle = colors[Math.floor(rand() * colors.length)]; };
  // tiles repeat: draw anything that crosses an edge on the other side too
  const rect = (x: number, y: number, w: number, h: number) => {
    for (const dx of [0, -S]) for (const dy of [0, -S]) g.fillRect(x + dx, y + dy, w, h);
    g.fillRect(x, y, w, h);
  };
  if (style === 'grid') {
    const step = 9 + Math.floor(rand() * 5);
    for (let y = 0; y < S; y += step) for (let x = 0; x < S; x += step) {
      if (rand() < 0.1) continue; // empty lot
      roof(0.28 + rand() * 0.3);
      rect(x + 1, y + 1, step - 3 - Math.floor(rand() * 3), step - 3 - Math.floor(rand() * 3));
    }
    g.globalAlpha = 0.22; g.strokeStyle = '#d9d2c4'; g.lineWidth = 1;
    for (let i = 0; i < S; i += step * 3) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(S, i); g.stroke(); }
  } else if (style === 'old') {
    for (let i = 0; i < 520; i++) {
      roof(0.22 + rand() * 0.32);
      rect(rand() * S, rand() * S, 2 + rand() * 5, 2 + rand() * 4);
    }
    g.globalAlpha = 0.2; g.strokeStyle = '#d6cfc0'; g.lineWidth = 1.2;
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.moveTo(rand() * S, 0);
      g.bezierCurveTo(rand() * S, S * 0.33, rand() * S, S * 0.66, rand() * S, S);
      g.stroke();
    }
  } else {
    for (let i = 0; i < 260; i++) {
      roof(0.18 + rand() * 0.25);
      rect(rand() * S, rand() * S, 2 + rand() * 3, 2 + rand() * 3);
    }
    g.globalAlpha = 0.18; g.fillStyle = climate === 'arid' ? '#9a8a64' : '#56664a'; // gardens, fields between houses
    for (let i = 0; i < 18; i++) rect(rand() * S, rand() * S, 5 + rand() * 9, 4 + rand() * 8);
    g.globalAlpha = 0.16; g.strokeStyle = '#d6cfc0';
    for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(0, rand() * S); g.lineTo(S, rand() * S); g.stroke(); }
  }
  g.globalAlpha = 1;
  return g.getImageData(0, 0, S, S);
}

/** Simple glyphs on a 24×24 grid. */
const GLYPH: Record<BuildingType, string> = {
  fort: 'M3 20V9h3v3h3V9h3v3h3V9h3v3h3V9h3v11z',
  air_defense: 'M6 20l6-8 6 8zM12 12a6 6 0 0 1 7-7l-3 3 2 2 3-3a6 6 0 0 1-7 7z',
  factory: 'M2 20V11l5 3v-3l5 3v-3l5 3V4h3v16z',
  mine: 'M5 20l7-15 7 15h-3l-4-9-4 9zM11 4h2v3h-2z',
  port: 'M11 3h2v3h3v2h-3v10a5 5 0 0 0 4-3l2 1a7 7 0 0 1-12 0l2-1a5 5 0 0 0 4 3V8H8V6h3z',
  airbase: 'M12 2l1.5 6 7.5 5v2l-7.5-2-.5 5 2.5 2v1.5L12 21l-3.5.5V20l2.5-2-.5-5-7.5 2v-2l7.5-5z',
  coal_plant: 'M3 20V12h5V6h3v6h2V4h3v8h5v8zM9 3a2 2 0 1 1 1 3z',
  gas_plant: 'M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-2 1-4 3-6 0 2 1 3 2 3 0-3 0-5 1-8z',
  nuclear_plant: 'M6 21c1-5 1-10-1-15h14c-2 5-2 10-1 15zM10 9h4v2h-4z',
  renewables: 'M11 21V11L5 8l1-2 6 3 1-7h2l-1 7 6-1v2l-6 2v10z',
  missile_defense: 'M5 21l3-9h2l-1 9zM14 21l-1-9h2l3 9zM8 11l4-9 4 9z',
};

function buildingIcon(type: BuildingType): ImageData {
  const S = 48, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(20, 30, 36, 0.62)';
  g.strokeStyle = 'rgba(232, 222, 200, 0.45)';
  g.lineWidth = 2;
  g.beginPath();
  g.roundRect(4, 4, 40, 40, 9);
  g.fill();
  g.stroke();
  g.translate(10, 10);
  g.scale(28 / 24, 28 / 24);
  g.fillStyle = '#e6dcc6';
  g.fill(new Path2D(GLYPH[type]));
  return g.getImageData(0, 0, S, S);
}

// icons sit in an arc below the city, in pixels
const SLOTS: [number, number][] = [[-34, 30], [0, 38], [34, 30], [-56, 10], [56, 10], [0, 62]]; // clear of unit markers

export interface CityShape { at: [number, number]; km: number; core: [number, number][][]; suburbs: [number, number][]; capital: boolean; pop: number; terrain: string }

export class Cities {
  readonly at = new Map<number, [number, number]>(); // where each city stands
  /** Each city's built-up shapes (lon/lat rings, already cut to the land), for the 3D skyline. */
  readonly shapes = new Map<number, CityShape>();

  private land(lon: number, lat: number) {
    return this.pol.provinceAt(lat, lon)?.kind === 'land';
  }

  /** Pull each point of a ring back toward its centre until it stands on land. */
  private onLand(lon: number, lat: number, ring: [number, number][]): [number, number][] {
    const out = ring.map(([x, y]) => {
      let keep = 0.15; // the centre itself is on land
      for (let k = 1; k <= 10; k++) {
        const t = k / 10;
        if (!this.land(lon + (x - lon) * t, lat + (y - lat) * t)) break;
        keep = t;
      }
      return [lon + (x - lon) * keep, lat + (y - lat) * keep] as [number, number];
    });
    out[out.length - 1] = out[0];
    return out;
  }

  /** Night lights: brightness by electricity supply (and wealth). */
  setLights(on: boolean) {
    // these layers always stay switched on (a layer hidden when its data loads has nothing to draw
    // when shown later); day and night differ only in opacity
    this.night = on;
    if (!on) {
      this.map.setPaintProperty('city-lights', 'circle-opacity', 0);
      this.map.setPaintProperty('city-lights-core', 'circle-opacity', 0);
      this.map.setPaintProperty('city-night', 'fill-opacity', 0);
      return;
    }
    this.map.setPaintProperty('city-lights', 'circle-opacity', 0.3);
    this.map.setPaintProperty('city-lights-core', 'circle-opacity', 0.9);
    // brightness by electricity supply (blackouts go dark) and a little by wealth
    const match: unknown[] = ['match', ['get', 'nation']];
    for (const e of this.game.economy.values()) match.push(e.id, this.brightness(e.id));
    match.push(0.6);
    // per-feature circle opacity renders as nothing on the globe in this MapLibre, so the dots use a
    // fixed brightness and nations in heavy blackout are filtered out (their cities go dark)
    const dark = [...this.game.economy.values()].filter((e) => this.brightness(e.id) < 0.3).map((e) => e.id);
    const lit: unknown = dark.length ? ['!', ['in', ['get', 'nation'], ['literal', dark]]] : ['literal', true];
    this.map.setFilter('city-lights', lit as never);
    this.map.setFilter('city-lights-core', lit as never);
    this.map.setPaintProperty('city-night', 'fill-opacity', ['*', ['get', 'w'], match] as never);
  }

  night = false;
  /** How brightly a nation's cities shine at night, 0..1. */
  brightness(nation: number) {
    const e = this.game.economy.get(nation);
    if (!e) return 0.6;
    return Math.max(0.05, (1 - (e.blackout ?? 0) * 3) * Math.min(1, 0.45 + Math.log10(Math.max(1000, e.gdppc)) / 9));
  }

  constructor(private map: MLMap, private pol: Political, private game: Game) {
    for (const st of STYLES) for (const cl of Object.keys(PALETTE) as Climate[]) for (let v = 0; v < VARIANTS; v++) {
      map.addImage(`u-${st}-${cl}-${v}`, urbanTexture(st, cl, v), { pixelRatio: 2 });
    }
    for (const t of Object.keys(GLYPH) as BuildingType[]) map.addImage(`b-${t}`, buildingIcon(t), { pixelRatio: 2 });

    const capitals = new Set([...pol.nations.values()].map((n) => n.capital));
    const areas: GeoJSON.Feature[] = [];
    const cores: GeoJSON.Feature[] = [];
    for (const p of pol.provinces.values()) {
      if (p.kind !== 'land') continue;
      const capital = capitals.has(p.id);
      const pop = p.pop ?? 0;
      if (pop < MIN_POP && !capital) continue;
      const rand = rng(p.id * 7919);
      // port cities sit toward the shore, but always on dry land
      let [lon, lat] = p.label;
      const sea = p.adj.map((q) => pol.provinces.get(q)).find((q) => q?.kind === 'sea');
      if (sea) {
        const dl = Math.max(-1.2, Math.min(1.2, (sea.label[0] - lon) * 0.3)), dt = Math.max(-1.2, Math.min(1.2, (sea.label[1] - lat) * 0.3));
        // walk toward the sea and stop well short of the water's edge
        let last = 0;
        for (let k = 1; k <= 12; k++) { if (!this.land(lon + (dl * k) / 12, lat + (dt * k) / 12)) break; last = k; }
        const t = Math.max(0, last - 3) / 12;
        lon += dl * t; lat += dt * t;
      }
      this.at.set(p.id, [lon, lat]);
      const km = (5 + 14 * Math.sqrt(pop / 1e7)) * (capital ? 1.35 : 1);
      // each city gets its own look: layout by size and luck, palette by climate
      const style: Style = pop > 8e6 || capital ? (rand() < 0.5 ? 'grid' : 'old') : pop > 3e6 ? STYLES[Math.floor(rand() * 2)] : (rand() < 0.6 ? 'sprawl' : 'old');
      const pat = `u-${style}-${climateOf(p.terrain)}-${p.id % VARIANTS}`;
      const sprawl = `u-sprawl-${climateOf(p.terrain)}-${(p.id + 1) % VARIANTS}`;
      // a dense core, then thinner rings, so the city fades into the countryside
      // every shape is cut back to the shore, so cities follow the coast instead of spilling into the sea
      areas.push({ type: 'Feature', properties: { pat: sprawl, w: 0.35, nation: p.nation ?? 0 }, geometry: { type: 'Polygon', coordinates: [this.onLand(lon, lat, blob(lon, lat, km * 1.9, rand))] } });
      const suburbs = this.onLand(lon, lat, blob(lon, lat, km * 1.35, rand));
      areas.push({ type: 'Feature', properties: { pat: sprawl, w: 0.45, nation: p.nation ?? 0 }, geometry: { type: 'Polygon', coordinates: [suburbs] } });
      const rings = [this.onLand(lon, lat, blob(lon, lat, km * 0.8, rand))];
      // suburbs and satellite towns around bigger cities
      const extra = Math.min(4, Math.floor(pop / 3e6) + (capital ? 1 : 0));
      for (let i = 0; i < extra; i++) {
        const a = rand() * Math.PI * 2, d = km * (1.1 + rand() * 0.9);
        const cos = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
        const sx = lon + (d / 111) * Math.cos(a) / cos, sy = lat + (d / 111) * Math.sin(a);
        if (!this.land(sx, sy)) continue; // no towns at sea
        rings.push(this.onLand(sx, sy, blob(sx, sy, km * (0.25 + rand() * 0.3), rand)));
      }
      this.shapes.set(p.id, { at: [lon, lat], km, core: rings, suburbs, capital, pop, terrain: p.terrain });
      rings.forEach((r, i) => areas.push({ type: 'Feature', properties: { pat: i ? sprawl : pat, w: i ? 0.5 : 0.8, nation: p.nation ?? 0 }, geometry: { type: 'Polygon', coordinates: [r] } }));
      cores.push({ type: 'Feature', properties: { size: Math.sqrt(pop / 1e7) * (capital ? 1.4 : 1), nation: p.nation ?? 0 }, geometry: { type: 'Point', coordinates: [lon, lat] } });
    }
    map.addSource('cities', { type: 'geojson', data: { type: 'FeatureCollection', features: areas } });
    map.addSource('city-cores', { type: 'geojson', data: { type: 'FeatureCollection', features: cores } });
    map.addSource('buildings', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const below = map.getLayer('graticule') ? 'graticule' : undefined;
    // from orbit: a faint warm smudge where people live
    map.addLayer({
      id: 'city-cores', type: 'circle', source: 'city-cores', maxzoom: 5.5,
      paint: {
        'circle-color': '#d9ccb0',
        'circle-blur': 1,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, ['*', 2, ['get', 'size']], 4, ['*', 7, ['get', 'size']]],
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 1, 0.12, 3.5, 0.16, 5, 0],
      },
    }, below);
    // up close: the city itself, blended into the terrain
    map.addLayer({
      id: 'cities', type: 'fill', source: 'cities', minzoom: 3,
      paint: {
        'fill-pattern': ['get', 'pat'],
        'fill-antialias': false,
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0, 4.2, ['*', 0.55, ['get', 'w']], 6, ['*', 0.8, ['get', 'w']], 8, ['get', 'w']],
      },
    }, below);
    // Night lights mode: the built-up areas glow warm above the darkened land (same shapes as by day,
    // cut to the coast), with a soft halo of light spilling round each city
    map.addLayer({
      id: 'city-night', type: 'fill', source: 'cities',
      paint: { 'fill-color': '#ffc966', 'fill-opacity': 0, 'fill-antialias': true },
    }, map.getLayer('rivers') ? 'rivers' : undefined);
    map.addLayer({
      id: 'city-lights', type: 'circle', source: 'city-cores',
      paint: {
        'circle-color': '#ffb347',
        'circle-blur': 1,
        'circle-radius': ['interpolate', ['exponential', 1.6], ['zoom'],
          1, ['max', 3.5, ['*', 7, ['get', 'size']]], 4, ['max', 9, ['*', 26, ['get', 'size']]], 7, ['max', 36, ['*', 120, ['get', 'size']]]],
        'circle-opacity': 0,
        'circle-pitch-alignment': 'viewport',
      },
    });
    // a bright point at each city's heart, so every city reads from orbit
    map.addLayer({
      id: 'city-lights-core', type: 'circle', source: 'city-cores',
      paint: {
        'circle-color': '#ffe7ad',
        'circle-blur': 0.35,
        'circle-radius': ['interpolate', ['exponential', 1.5], ['zoom'], 1, ['max', 2.2, ['*', 4, ['get', 'size']]], 4, ['max', 3.5, ['*', 10, ['get', 'size']]], 6, ['max', 5, ['*', 18, ['get', 'size']]]],
        'circle-opacity': 0,
        'circle-pitch-alignment': 'viewport',
      },
    });
    map.addLayer({
      id: 'buildings', type: 'symbol', source: 'buildings', minzoom: 3.8,
      layout: {
        'icon-image': ['concat', 'b-', ['get', 't']],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 3.8, 0.6, 7, 0.95],
        'icon-offset': ['get', 'off'],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': ['interpolate', ['linear'], ['zoom'], 3.8, 0, 4.2, ['case', ['get', 'done'], 0.9, 0.5]] },
    });
    game.on((c) => { if (c.has('war')) this.renderBuildings(); });
    this.renderBuildings();
  }

  private renderBuildings() {
    const features: GeoJSON.Feature[] = [];
    for (const [id, list] of Object.entries(this.game.war.buildings)) {
      const p: Province | undefined = this.pol.provinces.get(Number(id));
      if (!p) continue;
      list.slice(0, SLOTS.length).forEach((b, i) => {
        features.push({
          type: 'Feature',
          properties: { t: b.type, done: b.progress >= 1, off: SLOTS[i] },
          geometry: { type: 'Point', coordinates: this.at.get(p.id) ?? p.label },
        });
      });
    }
    (this.map.getSource('buildings') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
  }
}
