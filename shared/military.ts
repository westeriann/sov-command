// Land forces: unit types, terrain effects and route finding. Shared so the
// client can preview routes and arrival times with the server's exact rules.
// Movement is measured in game days (10 real seconds each at the default speed).
import { DAY } from './clock';

export type Domain = 'land' | 'sea' | 'air';
export type UnitType = 'infantry' | 'mechanized' | 'armored' | 'marines' | 'special_forces' | 'destroyers' | 'submarines' | 'carrier' | 'fighters' | 'strike' | 'drones' | 'bombers';
export const UNIT_TYPES: UnitType[] = ['infantry', 'mechanized', 'armored', 'marines', 'special_forces', 'destroyers', 'submarines', 'carrier', 'fighters', 'strike', 'drones', 'bombers'];

export interface UnitSpec {
  name: string;
  domain: Domain;
  attack: number; // land: vs ground; sea: vs ships; air: fighters vs aircraft, strike vs ground
  defense: number;
  speed: number; // km per game day (land: on open ground)
  cost: number; // $bn to build
  upkeep: number; // $bn per game year
  days: number; // game days to build
  men: number; // reservists needed
  range?: number; // air: combat radius in km; carrier: air cover radius
}

export const UNIT_SPECS: Record<UnitType, UnitSpec> = {
  infantry: { name: 'Infantry division', domain: 'land', attack: 4, defense: 7, speed: 30, cost: 1.5, upkeep: 0.3, days: 14, men: 15_000 },
  mechanized: { name: 'Mechanized division', domain: 'land', attack: 7, defense: 7, speed: 45, cost: 4, upkeep: 0.6, days: 28, men: 12_000 },
  armored: { name: 'Armored division', domain: 'land', attack: 11, defense: 6, speed: 55, cost: 7, upkeep: 1.0, days: 42, men: 10_000 },
  marines: { name: 'Marine brigade', domain: 'land', attack: 7, defense: 5, speed: 40, cost: 3.5, upkeep: 0.5, days: 30, men: 6_000 },
  special_forces: { name: 'Special forces group', domain: 'land', attack: 5, defense: 3, speed: 60, cost: 2.5, upkeep: 0.4, days: 35, men: 2_000 },
  destroyers: { name: 'Destroyer squadron', domain: 'sea', attack: 6, defense: 6, speed: 600, cost: 6, upkeep: 0.6, days: 60, men: 3_000 },
  submarines: { name: 'Submarine flotilla', domain: 'sea', attack: 8, defense: 3, speed: 450, cost: 5, upkeep: 0.5, days: 75, men: 1_500 },
  carrier: { name: 'Carrier strike group', domain: 'sea', attack: 14, defense: 10, speed: 550, cost: 18, upkeep: 2.5, days: 150, men: 6_000, range: 700 },
  fighters: { name: 'Fighter wing', domain: 'air', attack: 8, defense: 6, speed: 2000, cost: 3, upkeep: 0.5, days: 45, men: 1_500, range: 900 },
  strike: { name: 'Strike wing', domain: 'air', attack: 10, defense: 3, speed: 2000, cost: 4, upkeep: 0.6, days: 50, men: 1_500, range: 1200 },
  drones: { name: 'Drone squadron', domain: 'air', attack: 6, defense: 1, speed: 900, cost: 1.2, upkeep: 0.15, days: 25, men: 300, range: 600 },
  bombers: { name: 'Bomber wing', domain: 'air', attack: 14, defense: 4, speed: 1800, cost: 9, upkeep: 1.2, days: 80, men: 1_200, range: 2500 },
};

/** Units that need a technology before they can be built. */
export const UNIT_TECH: Partial<Record<UnitType, string>> = { drones: 'drones', bombers: 'stealth' };
/** What each newer unit is for (shown when recruiting). */
export const UNIT_ROLE: Partial<Record<UnitType, string>> = {
  marines: 'Land from the sea without the beachhead penalty',
  special_forces: 'Never out of supply; hidden unless an enemy unit is in the same province; sabotage enemy buildings',
  drones: 'Cheap short-range support and bombing',
  bombers: 'Long-range strategic bombing, 2.5x as hard on industry; weak in battle support',
};
/** Ordinary troops storming ashore fight at this strength for two days. */
export const BEACHHEAD = 0.6;
/** Air units that fly support and bombing missions (fighters only patrol). */
export const STRIKERS: UnitType[] = ['strike', 'drones', 'bombers'];
export const SATELLITE_COST = 10;
export const ASAT_COST = 4;

export const domainOf = (t: UnitType) => UNIT_SPECS[t].domain;
/** Land units crossing the sea ride transports: slow, and helpless if enemy warships catch them. */
export const TRANSPORT_SPEED = 300; // km per game day
export const EMBARK_DAYS = 3; // loading troops onto ships, or landing them

export type MissionKind = 'patrol' | 'support' | 'bomb';
export interface Mission {
  kind: MissionKind; // patrol: fighters win air superiority; support: strike wings back ground battles; bomb: strike wings hit industry
  target: number; // province the mission is centred on
}

/** How much slower than open ground each terrain is to cross. */
export const TERRAIN_SLOW: Record<string, number> = {
  grassland: 1, steppe: 1, savanna: 1, shrubland: 1.1, temperate_forest: 1.4, boreal: 1.5, rainforest: 1.8,
  desert_sand: 1.5, desert_rock: 1.3, tundra: 1.5, mountain_wet: 2.5, mountain_dry: 2.5, ice: 3, lake: 2,
};

/** Defender's advantage by terrain. */
export const TERRAIN_DEFENSE: Record<string, number> = {
  mountain_wet: 1.7, mountain_dry: 1.7, ice: 1.5, temperate_forest: 1.3, boreal: 1.3, rainforest: 1.4, lake: 1.2,
};
/** Attackers' power by terrain: rough, closed or frozen ground blunts any assault. */
export const TERRAIN_ATTACK: Record<string, number> = {
  mountain_wet: 0.8, mountain_dry: 0.82, rainforest: 0.82, boreal: 0.9, temperate_forest: 0.9, ice: 0.8, tundra: 0.9, lake: 0.85, desert_sand: 0.95,
};
/** Armour (tanks and mechanized) by terrain, attacking or defending: at home on open ground, lost in forest, jungle and mountains. */
export const TERRAIN_ARMOR: Record<string, number> = {
  grassland: 1.15, steppe: 1.2, savanna: 1.1, desert_rock: 1.1, desert_sand: 0.9, shrubland: 1.05,
  temperate_forest: 0.75, boreal: 0.75, rainforest: 0.6, mountain_wet: 0.6, mountain_dry: 0.65, tundra: 0.85, ice: 0.6, lake: 0.7,
};
export const ARMOR_UNITS: UnitType[] = ['armored', 'mechanized'];

/** A province's terrain effects in words, for its panel. */
export function terrainEffects(terrain: string): [string, 'good' | 'bad' | 'none'][] {
  const pct = (x: number) => `${x >= 1 ? '+' : '−'}${Math.round(Math.abs(x - 1) * 100)}%`;
  const d = TERRAIN_DEFENSE[terrain] ?? 1, a = TERRAIN_ATTACK[terrain] ?? 1, m = TERRAIN_ARMOR[terrain] ?? 1, s = TERRAIN_SLOW[terrain] ?? 1.2;
  const out: [string, 'good' | 'bad' | 'none'][] = [];
  if (d !== 1) out.push([`Defenders ${pct(d)}`, 'good']);
  if (a !== 1) out.push([`Attackers ${pct(a)}`, 'bad']);
  if (m !== 1) out.push([`Tanks and mechanized ${pct(m)}`, m > 1 ? 'good' : 'bad']);
  out.push([s <= 1 ? 'Easy going for armies' : `Armies move ${s.toFixed(1)}× slower`, s <= 1 ? 'good' : 'bad']);
  return out;
}
export const RIVER_DEFENSE = 1.25; // attacker crossing a major river (class 4+)
export const RIVER_DELAY_DAYS = 1;

export interface RouteNode {
  id: number;
  label: [number, number]; // lon, lat
  terrain: string;
  river?: number;
  adj: number[];
  kind: 'land' | 'sea';
}

export function distanceKm(a: [number, number], b: [number, number]) {
  const r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Game days for one leg from province a to its neighbour b. */
export function legDays(a: RouteNode, b: RouteNode, type: UnitType) {
  const spec = UNIT_SPECS[type];
  const km = distanceKm(a.label, b.label);
  if (spec.domain !== 'land') return Math.max(0.2, km / spec.speed);
  if (a.kind === 'sea' || b.kind === 'sea') return Math.max(0.5, km / TRANSPORT_SPEED + (a.kind !== b.kind && type !== 'marines' ? EMBARK_DAYS : 0));
  const slow = TERRAIN_SLOW[b.terrain] ?? 1.2;
  const river = (b.river ?? 0) >= 4 || (a.river ?? 0) >= 4 ? RIVER_DELAY_DAYS : 0;
  return Math.max(0.5, (distanceKm(a.label, b.label) / UNIT_SPECS[type].speed) * slow + river);
}

/**
 * Fastest land route (Dijkstra) from one province to another, entering only
 * provinces for which canEnter() is true. Returns the provinces after the
 * start and the total game days, or null if there is no route.
 */
export function findRoute(
  nodes: Map<number, RouteNode>,
  from: number,
  to: number,
  type: UnitType,
  canEnter: (id: number) => boolean,
): { path: number[]; days: number } | null {
  if (from === to) return { path: [], days: 0 };
  const dist = new Map<number, number>([[from, 0]]);
  const prev = new Map<number, number>();
  const heap = new MinHeap();
  heap.push(0, from);
  while (heap.size) {
    const [d, u] = heap.pop();
    if (u === to) break;
    if (d > (dist.get(u) ?? Infinity)) continue;
    const nu = nodes.get(u)!;
    for (const v of nu.adj) {
      const nv = nodes.get(v);
      if (!nv || !canEnter(v)) continue; // canEnter decides land, sea or both
      const nd = d + legDays(nu, nv, type);
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd);
        prev.set(v, u);
        heap.push(nd, v);
      }
    }
  }
  if (!dist.has(to)) return null;
  const path: number[] = [];
  for (let c = to; c !== from; c = prev.get(c)!) path.unshift(c);
  return { path, days: dist.get(to)! };
}

/**
 * The route a commander would pick. Land units march over land whenever they can,
 * and only take ship when there is no way by land or the sea is far quicker (a third
 * the time or less), as for an island or across a gulf. When the destination
 * cannot be entered at all (a neutral country), they go as close to it as they may.
 */
export function bestRoute(
  nodes: Map<number, RouteNode>,
  from: number,
  to: number,
  type: UnitType,
  canEnter: (id: number) => boolean,
): { path: number[]; days: number; to: number } | null {
  const land = UNIT_SPECS[type].domain === 'land';
  let target = to;
  if (!canEnter(to)) {
    const near = nearestEnterable(nodes, from, to, canEnter);
    if (near === undefined || near === from) return null;
    target = near;
  }
  const mixed = findRoute(nodes, from, target, type, canEnter);
  if (!land || nodes.get(target)?.kind !== 'land') return mixed && { ...mixed, to: target };
  const dry = findRoute(nodes, from, target, type, (p) => canEnter(p) && nodes.get(p)?.kind === 'land');
  if (dry && (!mixed || dry.days <= mixed.days * 3)) return { ...dry, to: target };
  return mixed && { ...mixed, to: target };
}

/** Of the provinces reachable from `from`, the one closest to `to`. */
function nearestEnterable(nodes: Map<number, RouteNode>, from: number, to: number, canEnter: (id: number) => boolean) {
  const goal = nodes.get(to)?.label;
  if (!goal) return undefined;
  const seen = new Set([from]);
  const queue = [from];
  let best: number | undefined, bestKm = Infinity;
  while (queue.length) {
    const u = queue.shift()!;
    const n = nodes.get(u)!;
    const km = distanceKm(n.label, goal);
    if (km < bestKm && n.kind === nodes.get(to)!.kind) { bestKm = km; best = u; }
    for (const v of n.adj) if (!seen.has(v) && canEnter(v) && seen.size < 6000) { seen.add(v); queue.push(v); }
  }
  return best;
}

export const daysToMs = (days: number) => days * DAY;

class MinHeap {
  private k: number[] = [];
  private v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, val: number) {
    let i = this.k.length;
    this.k.push(key); this.v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p] <= this.k[i]) break;
      [this.k[p], this.k[i]] = [this.k[i], this.k[p]];
      [this.v[p], this.v[i]] = [this.v[i], this.v[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.k[0], this.v[0]];
    const lk = this.k.pop()!, lv = this.v.pop()!;
    if (this.k.length) {
      this.k[0] = lk; this.v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.k.length && this.k[l] < this.k[m]) m = l;
        if (r < this.k.length && this.k[r] < this.k[m]) m = r;
        if (m === i) break;
        [this.k[m], this.k[i]] = [this.k[i], this.k[m]];
        [this.v[m], this.v[i]] = [this.v[i], this.v[m]];
        i = m;
      }
    }
    return top;
  }
}

/** A unit as a player sees it. Enemy strength is only known roughly. */
/** A commander attached to a land unit: lifts every friendly unit in the same battle. */
export interface General { name: string; skill: number; xp: number } // skill 1..5
export const GENERAL_COST = 1; // $bn
export const GENERAL_BONUS = 0.05; // per skill level
export const UNITS_PER_GENERAL = 8;
/** Out of supply: weaker in battle and worn down each day. */
export const NO_SUPPLY_POWER = 0.6;
export const NO_SUPPLY_LOSS = 2;
/** Strategic weapons. */
export const MISSILE_COST = 1.5; // $bn of military funds
export const MISSILE_RANGE = 2500; // km from any province you control
export const MISSILE_DAMAGE = 15;
export const WARHEAD_COST = 40;

export interface UnitView {
  id: number;
  nation: number;
  type: UnitType;
  province: number;
  strength: number; // 0..100
  status: 'idle' | 'moving' | 'fighting';
  mission?: Mission; // air wings
  path?: number[]; // remaining route (own units only)
  next?: number; // province being moved into
  legStart?: number; // game ms
  legEnd?: number; // game ms
  supplied?: boolean; // false: cut off from supply (own units only)
  general?: General;
  hidden?: boolean; // special forces: invisible to the enemy
}

export interface War {
  a: number; // the attacker
  b: number;
  since: number; // game day index
  goal?: WarGoal; // what the attacker declared it was fighting for
  wins?: [number, number]; // battles won by a and by b
  lost?: [number, number]; // units destroyed of a and of b
  truceUntil?: number; // game ms: a truce holds the lines until then (no fighting, no advancing)
}

/** What an attacker declares a war is for. Peace terms that match it cost half. */
export type WarGoal = 'conquest' | 'subjugate' | 'regime' | 'reparations' | 'humiliate';
export const WAR_GOALS: Record<WarGoal, { name: string; text: string }> = {
  conquest: { name: 'Conquest', text: 'take land: provinces cost half at the peace table' },
  subjugate: { name: 'Subjugation', text: 'make them a vassal at half the cost' },
  regime: { name: 'Regime change', text: 'impose your form of government at half the cost' },
  reparations: { name: 'Reparations', text: 'make them pay: reparations cost half' },
  humiliate: { name: 'Humiliation', text: 'demilitarise their border at half the cost; others think less of them' },
};

/** Equipment: arsenals and factories make it; units need it to be built and reinforced. */
export const EQUIP_PER_BN = 10; // kit per $bn of a unit's cost
export const EQUIP_START = 300;
export const EQUIP_CAP = 4000;
/** Supply reaches this many provinces beyond your own land from a capital, port or depot. */
export const SUPPLY_HOPS = 3;

export interface QueueItem {
  type: UnitType;
  progress: number; // 0..1
  paid?: boolean; // its price was paid when ordered (from defence funds, then the treasury)
}

/** Your nation's military books (private). */
export interface MilitaryPrivate {
  funds: number; // $bn available for building and upkeep
  income: number; // $bn per game year from the military budget
  upkeep: number; // $bn per game year
  manpower: number; // reservists not yet in uniform
  queue: QueueItem[];
  peaceOffers: number[]; // nations that have offered us white peace
  warheads: number;
  missileReady: boolean; // one missile launch per game day
  generals: number;
  maxGenerals: number;
  rally?: number; // province new land units march to
  satellites: number;
  equipment?: number; // kit in store
  equipmentRate?: number; // kit made per game day
  equipmentNeed?: number; // kit a day the production line wants
}
