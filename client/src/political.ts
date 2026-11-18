import { bin } from './config';
import type { FlagSpec } from '../../shared/flags';
import type { NationPublic } from '../../shared/protocol';
// Provinces, sea zones and nations produced by tools/worldgen/provinces.py.
import type { BiomeId } from './world';

export type ResourceId = 'farmland' | 'timber' | 'oil' | 'gas' | 'coal' | 'ore' | 'rare_earths';

export interface Province {
  id: number;
  name: string;
  kind: 'land' | 'sea';
  label: [number, number]; // lon, lat of the label point
  area: number; // km²
  terrain: BiomeId;
  elev: number; // mean metres (negative = depth)
  adj: number[];
  nation?: number;
  coastal?: boolean;
  pop?: number;
  peak?: number;
  river?: number; // biggest river: 0 none .. 5 great river
  lake?: number; // km² of lake water
  res?: Partial<Record<ResourceId, number>>; // 0..100
}

export interface Nation {
  id: number;
  name: string;
  short: string;
  color: string;
  capital: number;
  label_province: number;
  provinces: number;
  area: number;
  pop: number;
  neighbours: number[];
  flag?: FlagSpec; // a player's own flag
  base?: { name: string; short: string; color: string }; // the map's original values
}

export const RESOURCE_NAMES: Record<ResourceId, string> = {
  farmland: 'Farmland',
  timber: 'Timber',
  oil: 'Oil',
  gas: 'Natural gas',
  coal: 'Coal',
  ore: 'Metal ore',
  rare_earths: 'Rare earths',
};

export class Political {
  provinces = new Map<number, Province>();
  nations = new Map<number, Nation>();
  nationProvinces = new Map<number, number[]>();
  /** Owners when the map was made, before any land changed hands (for replays). */
  original = new Map<number, number>();
  grid!: Uint16Array;
  width = 0;
  height = 0;

  static async load(base = '/world'): Promise<Political> {
    const [data, buf] = await Promise.all([
      fetch(`${base}/provinces.json`).then((r) => {
        if (!r.ok) throw new Error(`provinces.json: HTTP ${r.status}. Run the province generator.`);
        return r.json() as Promise<{ provinces: Province[]; nations: Nation[] }>;
      }),
      fetch(`${base}/${bin('provinces.bin')}`).then((r) => {
        if (!r.ok) throw new Error(`provinces.bin: HTTP ${r.status}`);
        return r.arrayBuffer();
      }),
    ]);
    const p = new Political();
    for (const pr of data.provinces) {
      p.provinces.set(pr.id, pr);
      if (pr.nation) p.original.set(pr.id, pr.nation);
      if (pr.nation) {
        const list = p.nationProvinces.get(pr.nation) ?? [];
        list.push(pr.id);
        p.nationProvinces.set(pr.nation, list);
      }
    }
    for (const n of data.nations) p.nations.set(n.id, n);
    p.decode(buf);
    return p;
  }

  /** Run-length rows: per row a uint16 run count, then (length, id) uint16 pairs. */
  private decode(buf: ArrayBuffer) {
    const view = new DataView(buf);
    const magic = new TextDecoder().decode(new Uint8Array(buf, 0, 4));
    if (magic !== 'SCP1') throw new Error(`provinces.bin: unexpected format ${magic}`);
    this.width = view.getUint16(4, true);
    this.height = view.getUint16(6, true);
    this.grid = new Uint16Array(this.width * this.height);
    let o = 8;
    for (let y = 0; y < this.height; y++) {
      const runs = view.getUint16(o, true);
      o += 2;
      let x = y * this.width;
      for (let r = 0; r < runs; r++) {
        const len = view.getUint16(o, true);
        const id = view.getUint16(o + 2, true);
        o += 4;
        this.grid.fill(id, x, x + len);
        x += len;
      }
    }
  }

  idAt(lat: number, lon: number) {
    const x = Math.floor((((lon + 180) % 360 + 360) % 360) / 360 * this.width) % this.width;
    const y = Math.min(this.height - 1, Math.max(0, Math.floor((90 - lat) / 180 * this.height)));
    return this.grid[y * this.width + x];
  }

  provinceAt(lat: number, lon: number) {
    return this.provinces.get(this.idAt(lat, lon));
  }

  /** Land that changed hands by treaty. Returns whether anything changed. */
  transfer(owners: Record<number, number>) {
    let changed = false;
    for (const [k, to] of Object.entries(owners)) {
      const p = this.provinces.get(Number(k));
      if (!p || p.nation === to) continue;
      if (p.nation) this.nationProvinces.set(p.nation, (this.nationProvinces.get(p.nation) ?? []).filter((x) => x !== p.id));
      this.nationProvinces.set(to, [...(this.nationProvinces.get(to) ?? []), p.id]);
      p.nation = to;
      changed = true;
    }
    return changed;
  }

  /** Nations created in play (revolts, civil wars) that the map file does not know. Returns their ids. */
  addBorn(list: Iterable<NationPublic>) {
    const added: number[] = [];
    for (const pub of list) {
      if (!pub.def || this.nations.has(pub.id)) continue;
      this.nations.set(pub.id, {
        id: pub.id, name: pub.def.name, short: pub.def.short, color: pub.def.color, capital: pub.def.capital,
        label_province: pub.def.label, provinces: 0, area: 0, pop: 0, neighbours: [],
      });
      added.push(pub.id);
    }
    return added;
  }

  /** Apply players' names, colours and flags. Returns the nations that changed. */
  applyCustom(list: Iterable<NationPublic>) {
    const changed: number[] = [];
    for (const pub of list) {
      const n = this.nations.get(pub.id);
      if (!n) continue;
      n.base ??= { name: n.name, short: n.short, color: n.color };
      const next = { name: pub.name ?? n.base.name, short: pub.short ?? n.base.short, color: pub.color ?? n.base.color };
      const flag = pub.flag;
      if (next.name !== n.name || next.short !== n.short || next.color !== n.color || JSON.stringify(flag) !== JSON.stringify(n.flag)) {
        Object.assign(n, next, { flag });
        changed.push(n.id);
      }
    }
    return changed;
  }

  nationOf(p: Province | undefined) {
    return p?.nation ? this.nations.get(p.nation) : undefined;
  }
}
