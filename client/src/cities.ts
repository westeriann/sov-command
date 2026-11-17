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

/** A tile of city seen from orbit: blocks of roofs, streets, a little green. */
function urbanTexture(): ImageData {
  const S = 128, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const rand = rng(7);
  g.fillStyle = '#a39887';
  g.fillRect(0, 0, S, S);
  const roofs = ['#a39a8b', '#7d756b', '#b4aa98', '#6e6a63', '#958c80', '#a8a196', '#8a7f72'];
  for (let y = 0; y < S; y += 8) {
    for (let x = 0; x < S; x += 8) {
      if (rand() < 0.08) { g.fillStyle = '#6f7a5c'; g.fillRect(x, y, 8, 8); continue; } // parks
      g.fillStyle = roofs[Math.floor(rand() * roofs.length)];
      g.fillRect(x + 1, y + 1, 3 + Math.floor(rand() * 4), 3 + Math.floor(rand() * 4));
      g.fillRect(x + 4, y + 4, 2 + Math.floor(rand() * 3), 2 + Math.floor(rand() * 3));
    }
  }
  // streets: a slightly skewed grid with a few boulevards
  g.strokeStyle = 'rgba(205, 198, 182, 0.55)';
  g.lineWidth = 1;
  for (let i = 0; i <= S; i += 16) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 3, S); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(S, i - 2); g.stroke();
  }
  g.strokeStyle = 'rgba(220, 212, 195, 0.7)';
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, 40); g.lineTo(S, 88); g.stroke();
  g.beginPath(); g.moveTo(70, 0); g.lineTo(52, S); g.stroke();
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

export class Cities {
  constructor(private map: MLMap, private pol: Political, private game: Game) {
    map.addImage('urban', urbanTexture(), { pixelRatio: 2 });
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
      const [lon, lat] = p.label;
      const km = (5 + 14 * Math.sqrt(pop / 1e7)) * (capital ? 1.35 : 1);
      const rings = [blob(lon, lat, km, rand)];
      // suburbs and satellite towns around bigger cities
      const extra = Math.min(4, Math.floor(pop / 3e6) + (capital ? 1 : 0));
      for (let i = 0; i < extra; i++) {
        const a = rand() * Math.PI * 2, d = km * (1.1 + rand() * 0.9);
        const cos = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
        rings.push(blob(lon + (d / 111) * Math.cos(a) / cos, lat + (d / 111) * Math.sin(a), km * (0.25 + rand() * 0.3), rand));
      }
      for (const r of rings) areas.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [r] } });
      cores.push({ type: 'Feature', properties: { size: Math.sqrt(pop / 1e7) * (capital ? 1.4 : 1) }, geometry: { type: 'Point', coordinates: [lon, lat] } });
    }
    map.addSource('cities', { type: 'geojson', data: { type: 'FeatureCollection', features: areas } });
    map.addSource('city-cores', { type: 'geojson', data: { type: 'FeatureCollection', features: cores } });
    map.addSource('buildings', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const below = map.getLayer('graticule') ? 'graticule' : undefined;
    // from orbit: a faint warm smudge where people live
    map.addLayer({
      id: 'city-cores', type: 'circle', source: 'city-cores', maxzoom: 5.5,
      paint: {
        'circle-color': '#efe2c4',
        'circle-blur': 1,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, ['*', 2, ['get', 'size']], 4, ['*', 7, ['get', 'size']]],
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 1, 0.25, 3.5, 0.35, 5.5, 0],
      },
    }, below);
    // up close: the city itself, blended into the terrain
    map.addLayer({
      id: 'cities', type: 'fill', source: 'cities', minzoom: 3,
      paint: {
        'fill-pattern': 'urban',
        'fill-antialias': true,
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0, 4, 0.55, 6, 0.75, 8, 0.8],
      },
    }, below);
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
          geometry: { type: 'Point', coordinates: p.label },
        });
      });
    }
    (this.map.getSource('buildings') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
  }
}
