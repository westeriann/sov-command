// The generated planet: metadata plus a lookup grid for "what is at this point".

export type BiomeId =
  | 'ocean' | 'ice' | 'tundra' | 'boreal' | 'temperate_forest' | 'grassland' | 'steppe'
  | 'shrubland' | 'savanna' | 'rainforest' | 'desert_sand' | 'desert_rock'
  | 'mountain_wet' | 'mountain_dry' | 'lake';

export interface WorldMeta {
  seed: number;
  width: number;
  land_fraction: number;
  biomes: BiomeId[];
  biome_cells: Record<BiomeId, number>;
  imagery_credit: string;
  tiles: { max_zoom: number; tile_size: number; format: string };
  lookup: { width: number; height: number };
}

export interface Sample {
  lat: number;
  lon: number;
  biome: BiomeId;
  elevation: number; // metres; negative below sea level
  temperature: number; // mean annual, degrees C
  rainfall: number; // 0..1 index
}

export const BIOME_INFO: Record<BiomeId, { name: string; color: string }> = {
  ocean: { name: 'Ocean', color: '#123c63' },
  ice: { name: 'Ice sheet', color: '#e9f0f4' },
  tundra: { name: 'Tundra', color: '#8f9a7a' },
  boreal: { name: 'Boreal forest', color: '#2f5a3c' },
  temperate_forest: { name: 'Temperate forest', color: '#4a8a3f' },
  grassland: { name: 'Grassland and farmland', color: '#a3b95c' },
  steppe: { name: 'Steppe', color: '#c8b67c' },
  shrubland: { name: 'Shrubland', color: '#b48d5c' },
  savanna: { name: 'Savanna', color: '#d0b24a' },
  rainforest: { name: 'Rainforest', color: '#1d6b35' },
  desert_sand: { name: 'Sand desert', color: '#ead09a' },
  desert_rock: { name: 'Rock desert', color: '#bb7449' },
  mountain_wet: { name: 'Mountains', color: '#8d8c7d' },
  mountain_dry: { name: 'Dry mountains', color: '#a58e78' },
  lake: { name: 'Lake', color: '#2f78a8' },
};

export class World {
  private biome!: Uint8Array;
  private elev!: Int16Array;
  private temp!: Int8Array;
  private moist!: Uint8Array;
  width = 0;
  height = 0;

  constructor(public meta: WorldMeta) {}

  static async load(base = '/world'): Promise<World> {
    const [meta, buf] = await Promise.all([
      fetch(`${base}/world.json`).then((r) => {
        if (!r.ok) throw new Error(`world.json: HTTP ${r.status}. Run the world generator first.`);
        return r.json() as Promise<WorldMeta>;
      }),
      fetch(`${base}/terrain.bin`).then((r) => {
        if (!r.ok) throw new Error(`terrain.bin: HTTP ${r.status}`);
        return r.arrayBuffer();
      }),
    ]);
    const w = new World(meta);
    w.parse(buf);
    return w;
  }

  private parse(buf: ArrayBuffer) {
    const magic = new TextDecoder().decode(new Uint8Array(buf, 0, 4));
    if (magic !== 'SCT2') throw new Error(`terrain.bin: unexpected format ${magic}`);
    const view = new DataView(buf);
    this.width = view.getUint16(4, true);
    this.height = view.getUint16(6, true);
    const n = this.width * this.height;
    let o = 8;
    this.biome = new Uint8Array(buf, o, n); o += n;
    // int16 data may sit on an odd offset, so copy it into an aligned array
    this.elev = new Int16Array(buf.slice(o, o + n * 2)); o += n * 2;
    this.temp = new Int8Array(buf, o, n); o += n;
    this.moist = new Uint8Array(buf, o, n);
  }

  index(lat: number, lon: number) {
    const x = Math.floor((((lon + 180) % 360 + 360) % 360) / 360 * this.width) % this.width;
    const y = Math.min(this.height - 1, Math.max(0, Math.floor((90 - lat) / 180 * this.height)));
    return y * this.width + x;
  }

  sample(lat: number, lon: number): Sample {
    const i = this.index(lat, lon);
    return {
      lat, lon,
      biome: this.meta.biomes[this.biome[i]],
      elevation: this.elev[i],
      temperature: this.temp[i],
      rainfall: this.moist[i] / 255,
    };
  }

  /** Paint a per-cell colour into a Web Mercator canvas for use as a map overlay. */
  mercatorCanvas(colorAt: (i: number) => [number, number, number, number], size = 2048) {
    return mercatorCanvas(this.width, this.height, colorAt, size);
  }

  biomeIndexAt(i: number) { return this.biome[i]; }
  elevationAt(i: number) { return this.elev[i]; }
  temperatureAt(i: number) { return this.temp[i]; }
}

/**
 * Reproject an equirectangular grid (width x height cells, row 0 at 90°N)
 * into a square Web Mercator canvas, colouring each pixel from its cell index.
 */
export function mercatorCanvas(
  width: number,
  height: number,
  colorAt: (i: number) => [number, number, number, number],
  size = 2048,
) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const colX = new Int32Array(size);
  for (let x = 0; x < size; x++) colX[x] = Math.floor(((x + 0.5) / size) * width);
  for (let y = 0; y < size; y++) {
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / size))) * 180) / Math.PI;
    const row = Math.min(height - 1, Math.floor(((90 - lat) / 180) * height)) * width;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = colorAt(row + colX[x]);
      const k = (y * size + x) * 4;
      data[k] = r; data[k + 1] = g; data[k + 2] = b; data[k + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function formatLatLon(lat: number, lon: number) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  const fmt = (v: number) => {
    const a = Math.abs(v);
    const d = Math.floor(a);
    const m = Math.floor((a - d) * 60);
    return `${d}°${String(m).padStart(2, '0')}′`;
  };
  return `${fmt(lat)}${ns} ${fmt(lon)}${ew}`;
}
