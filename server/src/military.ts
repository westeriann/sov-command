// Armed forces: land divisions, fleets and air wings. Movement along routes in
// game time, battles on land and at sea, air and naval support, occupation,
// blockades, production and fog of war. Owned by the World; every change comes
// through orders that players and AI submit the same way.
import { DAY } from '../../shared/clock.ts';
import type { BuildingState, BuildingType } from '../../shared/buildings.ts';
import { ROAD, roadKey, type RoadState } from '../../shared/roads.ts';
import { WINTER_ATTRITION, coldLand, seasonAt, seasonSlow } from '../../shared/seasons.ts';
import {
  BEACHHEAD, EQUIP_CAP, EQUIP_PER_BN, GENERAL_BONUS, SUPPLY_HOPS, NO_SUPPLY_LOSS, STRIKERS, NO_SUPPLY_POWER, RIVER_DEFENSE, TERRAIN_DEFENSE, UNIT_SPECS, bestRoute, distanceKm, domainOf, legDays,
  type Domain, type General, type Mission, type QueueItem, type RouteNode, type UnitType, type UnitView, type War,
} from '../../shared/military.ts';

export interface Unit {
  id: number;
  nation: number;
  type: UnitType;
  province: number; // land province, sea zone, or (air) home base
  strength: number; // 0..100
  path: number[]; // provinces still to enter, in order
  next?: number; // province being entered
  legStart?: number; // game ms
  legEnd?: number; // game ms
  fighting?: boolean;
  mission?: Mission; // air wings only
  supplied?: boolean; // land units: false when cut off
  general?: General;
  landedAt?: number; // game ms it came ashore from the sea
  goal?: number; // where it was ordered to: a march halted by a battle resumes toward it
}

export interface NationMil {
  funds: number; // $bn for building, upkeep and reinforcement
  queue: QueueItem[];
  peaceOffers?: number[]; // legacy: offers now live in diplomacy
  warheads?: number;
  lastMissileDay?: number;
  rally?: number; // new land units march here
  satellites?: number;
  equipment?: number; // kit in store
  demil?: { by: number; until: number; provinces: number[] }; // a peace treaty keeps our troops out of these
}

export interface MilitaryState {
  nextId: number;
  units: Unit[];
  wars: War[];
  occupied: Record<number, number>;
  buildings?: Record<number, BuildingState[]>;
  roads?: RoadState[];
  nextRoad?: number;
}

export interface Province extends RouteNode {
  owner?: number; // nation that owns it (land only)
  pop: number;
  elev?: number; // mean metres
  coastal?: boolean;
  name?: string;
  area?: number; // km2
  city?: boolean; // a city's own small province
  parent?: number; // the province a city stands in
}

export type MilEvent = { kind: 'occupied' | 'liberated' | 'destroyed' | 'battle' | 'bombed' | 'promoted'; province: number; nation: number; other?: number };

const RETREAT_AT = 25; // strength below which a unit falls back
const DESTROYED_AT = 5;
const BATTLE_DAMAGE = 8; // strength points per day at even odds
const MUNITIONS_PER_UNIT_DAY = 0.01; // $bn of munitions a fighting unit uses per game day
const TRANSPORT_LOSS = 15; // strength per day for troops at sea under enemy guns
const SUPPORT_RADIUS = 300; // km: strike wings help battles this close to their target
const PATROL_RADIUS = 500; // km: fighters cover this area around their target

export class Military {
  units = new Map<number, Unit>();
  wars: War[] = [];
  /** Set by the World: whether two nations are allied (allies may cross each other's land). */
  allied: (a: number, b: number) => boolean = () => false;
  /** Set by the World: provinces a nation's troops may not enter (a demilitarised border). */
  barred: (nation: number, p: number) => boolean = () => false;
  /** Set by the World: nations whose forces this nation can see through intelligence. */
  intelOn: (nation: number) => number[] = () => [];
  /** Set by the World: a nation's bonus from technology and government (0.1 = +10%). */
  bonus: (nation: number, kind: 'landAttack' | 'landDefense' | 'naval' | 'air' | 'build') => number = () => 0;
  occupied = new Map<number, number>();
  battles = new Set<number>();
  nextId = 1;
  private rand: () => number;

  constructor(public provinces: Map<number, Province>, state: MilitaryState | null, rand: () => number) {
    this.rand = rand;
    if (state) {
      this.nextId = state.nextId;
      for (const u of state.units) this.units.set(u.id, u);
      this.wars = state.wars;
      this.occupied = new Map(Object.entries(state.occupied).map(([k, v]) => [Number(k), v]));
      this.buildings = new Map(Object.entries(state.buildings ?? {}).map(([k, v]) => [Number(k), v]));
      this.roads = state.roads ?? [];
      this.nextRoad = state.nextRoad ?? 1;
      this.indexRoads();
    }
  }

  serialize(): MilitaryState {
    return { nextId: this.nextId, units: [...this.units.values()], wars: this.wars, occupied: Object.fromEntries(this.occupied), buildings: Object.fromEntries(this.buildings),
      roads: this.roads, nextRoad: this.nextRoad };
  }

  buildings = new Map<number, BuildingState[]>();
  roads: RoadState[] = [];
  nextRoad = 1;
  /** Province pairs joined by a finished road. */
  private roadLegs = new Set<string>();

  indexRoads() {
    this.roadLegs.clear();
    for (const r of this.roads) if (r.progress >= 1) for (let i = 1; i < r.path.length; i++) this.roadLegs.add(roadKey(r.path[i - 1], r.path[i]));
  }

  hasRoad(a: number, b: number) { return this.roadLegs.has(roadKey(a, b)); }

  /** Recruitment pace from the nation's development (set by the world each day): x0.9 to x1.1. */
  recruitPace: (nation: number) => number = () => 1;
  /** Current game time, set by the World before each day's fighting. */
  now = 0;
  /** Set by the World: provinces and sea zones under a storm today. */
  storm: (p: number) => boolean = () => false;
  /** Set by the World: damage a nation's economy by a share of GDP (strategic bombing). */
  onEconomicDamage: (nation: number, share: number) => void = () => {};

  // ---- queries -------------------------------------------------------------------
  /** A finished building of this type in the province. */
  built(p: number, type: BuildingType) {
    return !!this.buildings.get(p)?.some((b) => b.type === type && b.progress >= 1 && !b.damaged); // damaged: out of action
  }

  /** Destroy one finished building at random; returns its type. */
  destroyBuilding(p: number): BuildingType | undefined {
    const list = this.buildings.get(p)?.filter((b) => b.progress >= 1);
    if (!list?.length) return undefined;
    const b = list[Math.floor(this.rand() * list.length)];
    this.buildings.set(p, this.buildings.get(p)!.filter((x) => x !== b));
    return b.type;
  }

  /** Combat radius, longer from an air base. */
  rangeOf(u: Unit) {
    return UNIT_SPECS[u.type].range! * (this.built(u.province, 'airbase') ? 1.3 : 1);
  }

  /**
   * Supply: from the capital (or any port we hold) through land that we or our
   * allies control. Units on that land or next to it are supplied; units
   * beyond it, or in pockets cut off from it, are not.
   */
  updateSupply(homeOf: (n: number) => number | undefined) {
    const byNation = new Map<number, Unit[]>();
    for (const u of this.units.values()) {
      if (domainOf(u.type) !== 'land') continue;
      byNation.set(u.nation, [...(byNation.get(u.nation) ?? []), u]);
    }
    for (const [nation, units] of byNation) {
      // the common case: every unit stands on land its own nation holds
      if (units.every((u) => this.controller(u.province) === nation && this.provinces.get(u.province)?.owner === nation)) { for (const u of units) u.supplied = true; continue; }
      const friendly = (p: number) => {
        const c = this.controller(p);
        return c === nation || (c !== undefined && this.allied(nation, c));
      };
      const seeds: number[] = [];
      const home = homeOf(nation);
      if (home !== undefined && this.controller(home) === nation) seeds.push(home);
      for (const [p] of this.buildings) if ((this.built(p, 'port') || this.built(p, 'depot')) && this.controller(p) === nation) seeds.push(p);
      // hops beyond our own land: 0 on land we own and hold, +1 for each province beyond it
      const dist = new Map<number, number>(seeds.map((p) => [p, 0]));
      const queue = [...seeds];
      while (queue.length) {
        queue.sort((a, b) => dist.get(b)! - dist.get(a)!); // a small graph: cheapest last
        const p = queue.pop()!;
        const d0 = dist.get(p)!;
        for (const q of this.provinces.get(p)!.adj) {
          const prov = this.provinces.get(q);
          if (prov?.kind !== 'land' || !friendly(q)) continue;
          const d = d0 + (prov.owner === nation && this.controller(q) === nation ? 0 : 1);
          if (d > SUPPLY_HOPS || (dist.get(q) ?? Infinity) <= d) continue;
          dist.set(q, d);
          queue.push(q);
        }
      }
      const reach = new Set(dist.keys());
      for (const u of units) {
        const at = this.provinces.get(u.province);
        u.supplied = u.type === 'special_forces' || !seeds.length || at?.kind === 'sea' || reach.has(u.province) || !!at?.adj.some((q) => reach.has(q));
        if (!u.supplied) u.strength = Math.max(10, u.strength - NO_SUPPLY_LOSS);
      }
    }
  }

  controller(p: number) {
    return this.occupied.get(p) ?? this.provinces.get(p)?.owner;
  }

  /** At war and fighting: a truce holds the war in suspense. */
  atWar(a: number | undefined, b: number | undefined) {
    if (!a || !b || a === b) return false;
    return this.wars.some((w) => ((w.a === a && w.b === b) || (w.a === b && w.b === a)) && !this.inTruce(w));
  }

  inTruce(w: War) { return (w.truceUntil ?? 0) > this.now; }

  enemiesOf(n: number) {
    return this.wars.filter((w) => !this.inTruce(w)).flatMap((w) => (w.a === n ? [w.b] : w.b === n ? [w.a] : []));
  }

  /**
   * Where a unit may go. Fleets: any sea zone. Land units: their own land, land
   * they control, land of nations they are at war with, and the sea (by transport).
   */
  canEnter(nation: number, p: number, domain: Domain = 'land') {
    const prov = this.provinces.get(p);
    if (!prov) return false;
    if (prov.kind === 'land' && domain === 'land' && this.barred(nation, p)) return false;
    if (domain === 'sea') return prov.kind === 'sea';
    if (prov.kind === 'sea') return domain === 'land';
    const ctrl = this.controller(p);
    return prov.owner === nation || ctrl === nation || this.atWar(nation, ctrl) || this.atWar(nation, prov.owner)
      || (ctrl !== undefined && this.allied(nation, ctrl)); // allies grant military access
  }

  unitsOf(nation: number) {
    return [...this.units.values()].filter((u) => u.nation === nation);
  }

  unitsIn(p: number) {
    return [...this.units.values()].filter((u) => u.province === p);
  }

  private label(p: number) {
    return this.provinces.get(p)!.label;
  }

  /** Population share of a nation's own provinces it still controls. */
  controlShare(nation: number, ownedPop: number) {
    let lost = 0;
    for (const [p, occ] of this.occupied) {
      const prov = this.provinces.get(p)!;
      if (prov.owner === nation && occ !== nation) lost += prov.pop;
    }
    return ownedPop > 0 ? Math.max(0, 1 - lost / ownedPop) : 1;
  }

  /** Share of a nation's coast with enemy warships offshore and none of its own (0..1). */
  blockade(nation: number) {
    const enemies = this.enemiesOf(nation);
    if (!enemies.length) return 0;
    const fleets = new Map<number, { ours: boolean; theirs: boolean }>();
    for (const u of this.units.values()) {
      if (domainOf(u.type) !== 'sea') continue;
      const f = fleets.get(u.province) ?? { ours: false, theirs: false };
      if (u.nation === nation) f.ours = true;
      else if (enemies.includes(u.nation)) f.theirs = true;
      fleets.set(u.province, f);
    }
    let coastal = 0, blocked = 0;
    for (const prov of this.provinces.values()) {
      if (prov.kind !== 'land' || prov.owner !== nation) continue;
      const seas = prov.adj.filter((q) => this.provinces.get(q)?.kind === 'sea');
      if (!seas.length) continue;
      coastal++;
      if (seas.some((q) => fleets.get(q)?.theirs && !fleets.get(q)?.ours)) blocked++;
    }
    return coastal ? blocked / coastal : 0;
  }

  /** Provinces a nation can see into: what it controls, where its forces are and fly, and their neighbours. */
  visibleProvinces(nation: number) {
    const seen = new Set<number>();
    const add = (p: number) => {
      seen.add(p);
      for (const q of this.provinces.get(p)?.adj ?? []) seen.add(q);
    };
    for (const prov of this.provinces.values()) if (prov.kind === 'land' && this.controller(prov.id) === nation) add(prov.id);
    const watched = new Set(this.intelOn(nation));
    for (const u of this.units.values()) {
      if (watched.has(u.nation)) seen.add(u.province);
      if (u.nation !== nation) continue;
      add(u.province);
      if (u.next) add(u.next);
      if (u.mission) add(u.mission.target); // reconnaissance
    }
    return seen;
  }

  view(u: Unit, own: boolean): UnitView {
    const v: UnitView = {
      id: u.id, nation: u.nation, type: u.type, province: u.province,
      strength: own ? Math.round(u.strength) : Math.round(u.strength / 10) * 10,
      status: u.fighting ? 'fighting' : u.next ? 'moving' : 'idle',
    };
    if (u.next) Object.assign(v, { next: u.next, legStart: u.legStart, legEnd: u.legEnd });
    if (own && u.path.length) v.path = [...u.path];
    if (u.mission) v.mission = { ...u.mission };
    if (own && u.supplied === false) v.supplied = false;
    if (u.general) v.general = { ...u.general };
    return v;
  }

  /** Everything this nation is allowed to see. Submarines are hidden unless our ships share their zone. */
  viewFor(nation: number): UnitView[] {
    const seen = this.visibleProvinces(nation);
    const ourShips = new Set([...this.units.values()].filter((u) => u.nation === nation && domainOf(u.type) === 'sea').map((u) => u.province));
    const out: UnitView[] = [];
    for (const u of this.units.values()) {
      if (u.nation === nation) out.push(this.view(u, true));
      else if (u.type === 'submarines' && !ourShips.has(u.province)) continue;
      else if (u.type === 'special_forces' && !this.unitsIn(u.province).some((o) => o.nation === nation)) continue; // special forces stay hidden
      else if (seen.has(u.province) || (u.next && seen.has(u.next))) out.push(this.view(u, false));
    }
    return out;
  }

  // ---- orders ----------------------------------------------------------------------
  spawn(nation: number, type: UnitType, province: number, strength = 100) {
    const u: Unit = { id: this.nextId++, nation, type, province, strength, path: [] };
    this.units.set(u.id, u);
    return u;
  }

  /** Land and sea units follow routes; air wings rebase to a province we control. */
  move(nation: number, ids: number[], to: number, now: number) {
    let moved = 0, days = 0;
    for (const id of ids) {
      const u = this.units.get(id);
      if (!u || u.nation !== nation) continue;
      const domain = domainOf(u.type);
      if (domain === 'air') {
        const prov = this.provinces.get(to);
        if (!prov || prov.kind !== 'land' || this.controller(to) !== nation) continue;
        const d = distanceKm(this.label(u.next ?? u.province), prov.label) / UNIT_SPECS[u.type].speed;
        Object.assign(u, { next: to, legStart: now, legEnd: now + Math.max(0.1, d) * DAY, path: [] });
        moved++;
        days = Math.max(days, d);
        continue;
      }
      const start = u.next ?? u.province;
      const route = bestRoute(this.provinces, start, to, u.type, (p) => this.canEnter(nation, p, domain));
      if (!route) continue;
      moved++;
      u.path = route.path;
      u.goal = route.to;
      if (u.next) {
        days = Math.max(days, route.days + Math.max(0, (u.legEnd! - now) / DAY));
      } else {
        u.fighting = false;
        this.startLeg(u, now);
        days = Math.max(days, route.days);
      }
    }
    return { moved, days };
  }

  /** Give air wings a mission, or stand them down (null). The target must be within combat radius of their base. */
  setMission(nation: number, ids: number[], mission: Mission | null) {
    let done = 0;
    for (const id of ids) {
      const u = this.units.get(id);
      if (!u || u.nation !== nation || domainOf(u.type) !== 'air') continue;
      if (mission) {
        const target = this.provinces.get(mission.target);
        if (!target) continue;
        if (mission.kind !== 'patrol' && !STRIKERS.includes(u.type)) continue;
        if (mission.kind === 'patrol' && u.type !== 'fighters') continue;
        if (distanceKm(this.label(u.province), target.label) > this.rangeOf(u)) continue;
        u.mission = { kind: mission.kind, target: mission.target };
      } else {
        u.mission = undefined;
      }
      done++;
    }
    return done;
  }

  halt(nation: number, ids: number[]) {
    for (const id of ids) {
      const u = this.units.get(id);
      if (u && u.nation === nation) { u.path = []; u.goal = undefined; } // finish the current leg, then stop
    }
  }

  private startLeg(u: Unit, at: number) {
    const next = u.path.shift();
    if (next === undefined) {
      u.next = u.legStart = u.legEnd = undefined;
      if (u.goal === u.province) u.goal = undefined; // arrived
      return;
    }
    u.next = next;
    u.legStart = at;
    const to = this.provinces.get(next)!;
    const slow = domainOf(u.type) === 'land' && to.kind === 'land' ? seasonSlow(at, to.terrain, to.label[1]) : 1; // winter roads
    const road = domainOf(u.type) === 'land' && this.hasRoad(u.province, next) ? ROAD.speed : 1; // a finished road: faster
    u.legEnd = at + legDays(this.provinces.get(u.province)!, to, u.type) * DAY * slow * road;
  }

  declareWar(a: number, b: number, day: number) {
    if (a === b || this.warBetween(a, b)) return false;
    this.wars.push({ a, b, since: day, wins: [0, 0], lost: [0, 0] });
    return true;
  }

  warBetween(a: number, b: number) {
    return this.wars.find((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a));
  }

  /** End a war: occupied land goes back to its owner and units leave land they may no longer enter. */
  makePeace(a: number, b: number, homeOf: (nation: number) => number | undefined) {
    this.wars = this.wars.filter((w) => !((w.a === a && w.b === b) || (w.a === b && w.b === a)));
    for (const [p, occ] of [...this.occupied]) {
      const owner = this.provinces.get(p)!.owner;
      if ((occ === a && owner === b) || (occ === b && owner === a)) this.occupied.delete(p);
    }
    for (const u of this.units.values()) {
      if (u.nation !== a && u.nation !== b) continue;
      if (u.mission && !this.atWar(u.nation, this.controller(u.mission.target)) && this.controller(u.mission.target) !== u.nation) u.mission = undefined;
      if (domainOf(u.type) === 'land' && !this.canEnter(u.nation, u.province)) {
        const home = homeOf(u.nation);
        if (home) Object.assign(u, { province: home, path: [], next: undefined, legStart: undefined, legEnd: undefined, fighting: false, goal: undefined });
      }
    }
  }

  // ---- simulation ---------------------------------------------------------------------
  /** Move units along their routes up to game time `now`. Called every tick. */
  advance(now: number, events: MilEvent[]) {
    for (const u of this.units.values()) {
      const domain = domainOf(u.type);
      // a march stopped by a battle it won: carry on to where it was sent
      if (u.goal !== undefined && u.next === undefined && !u.fighting && domain !== 'air' && u.goal !== u.province) {
        const route = bestRoute(this.provinces, u.province, u.goal, u.type, (p) => this.canEnter(u.nation, p, domain));
        if (route?.path.length) { u.path = route.path; this.startLeg(u, now); } else u.goal = undefined;
      }
      while (u.next !== undefined && u.legEnd! <= now) {
        const target = u.next;
        const legEnd = u.legEnd!;
        if (domain === 'air') { // rebased
          u.province = target;
          u.next = u.legStart = u.legEnd = undefined;
          break;
        }
        if (!this.canEnter(u.nation, target, domain)) { // a peace deal closed the way
          u.path = [];
          u.next = u.legStart = u.legEnd = undefined;
          break;
        }
        if (domain === 'land' && this.provinces.get(u.province)?.kind === 'sea' && this.provinces.get(target)?.kind === 'land') u.landedAt = legEnd;
        u.province = target;
        const kind = this.provinces.get(target)!.kind;
        // land units fight land units on land; fleets fight fleets at sea; troops at sea sail on
        const hostile = (domain === 'land' && kind === 'land' && this.unitsIn(target).some((o) =>
          o.id !== u.id && domainOf(o.type) === 'land' && this.atWar(o.nation, u.nation)))
          || (domain === 'sea' && this.unitsIn(target).some((o) => domainOf(o.type) === 'sea' && this.atWar(o.nation, u.nation)));
        if (hostile) {
          u.fighting = true;
          u.path = [];
          u.next = u.legStart = u.legEnd = undefined;
          break;
        }
        if (domain === 'land' && kind === 'land') this.takeControl(u.nation, target, events);
        this.startLeg(u, legEnd);
      }
    }
  }

  private takeControl(nation: number, p: number, events: MilEvent[]) {
    const prov = this.provinces.get(p)!;
    if (prov.kind !== 'land') return;
    const ctrl = this.controller(p);
    if (ctrl === nation || !this.atWar(nation, ctrl)) return;
    if (prov.owner === nation) {
      this.occupied.delete(p);
      events.push({ kind: 'liberated', province: p, nation, other: ctrl });
    } else {
      this.occupied.set(p, nation);
      events.push({ kind: 'occupied', province: p, nation, other: prov.owner });
    }
  }

  private inRange(u: Unit, p: number, radius: number) {
    const spec = UNIT_SPECS[u.type];
    if (!u.mission || u.next !== undefined) return false;
    const target = this.label(u.mission.target), here = this.label(p);
    return distanceKm(target, here) <= radius && distanceKm(this.label(u.province), here) <= this.rangeOf(u) && !!spec;
  }

  /**
   * One game day of fighting: ships against ships, troops at sea against
   * warships, and land battles backed by air and naval support.
   * spendMunitions(nation, $bn) returns false when the nation has run out.
   */
  fight(spendMunitions: (nation: number, amount: number) => boolean, homeOf: (n: number) => number | undefined, events: MilEvent[]) {
    this.battles.clear();
    this.updateSupply(homeOf);
    const all = [...this.units.values()];
    const air = all.filter((u) => domainOf(u.type) === 'air');
    const ships = all.filter((u) => domainOf(u.type) === 'sea');

    // winter: troops on foreign soil in cold lands lose strength; defenders at home are housed and supplied
    for (const u of all) {
      if (!this.units.has(u.id) || domainOf(u.type) !== 'land') continue;
      const p = this.provinces.get(u.province);
      if (!p || p.kind !== 'land' || p.owner === u.nation || this.allied(u.nation, p.owner ?? -1)) continue;
      if (seasonAt(this.now, p.label[1]) === 'winter' && coldLand(p.terrain, p.label[1])) u.strength = Math.max(10, u.strength - WINTER_ATTRITION);
    }

    // storms at sea: ships are battered, troops on transports suffer worst
    for (const u of all) {
      if (!this.units.has(u.id) || this.provinces.get(u.province)?.kind !== 'sea' || !this.storm(u.province)) continue;
      u.strength -= domainOf(u.type) === 'land' ? 4 : 1.5;
      if (u.strength < DESTROYED_AT) { this.units.delete(u.id); events.push({ kind: 'destroyed', province: u.province, nation: u.nation }); }
    }

    // troops caught at sea by enemy warships
    for (const u of all) {
      if (domainOf(u.type) !== 'land') continue;
      const zone = this.provinces.get(u.province)?.kind === 'sea' ? u.province : u.next !== undefined && this.provinces.get(u.next)?.kind === 'sea' ? u.next : undefined;
      if (zone === undefined) continue;
      const hunters = ships.filter((s) => s.province === zone && this.atWar(s.nation, u.nation)).length;
      if (hunters) {
        u.strength -= TRANSPORT_LOSS * Math.min(2, hunters);
        this.battles.add(zone);
        if (u.strength < DESTROYED_AT) { this.units.delete(u.id); events.push({ kind: 'destroyed', province: zone, nation: u.nation }); }
      }
    }

    const byProvince = new Map<number, Unit[]>();
    for (const u of all) {
      if (u.next !== undefined || !this.units.has(u.id)) continue;
      const domain = domainOf(u.type);
      const kind = this.provinces.get(u.province)?.kind;
      if (domain === 'air' || (domain === 'sea') !== (kind === 'sea')) continue;
      byProvince.set(u.province, [...(byProvince.get(u.province) ?? []), u]);
    }
    const tiredWings = new Set<number>();
    for (const [p, here] of byProvince) {
      const prov = this.provinces.get(p)!;
      const nations = [...new Set(here.map((u) => u.nation))];
      if (nations.length < 2) {
        for (const u of here) u.fighting = false;
        if (prov.kind === 'land') this.takeControl(nations[0], p, events); // holding uncontested enemy land takes it
        continue;
      }
      const ctrl = this.controller(p);
      const defNation = ctrl !== undefined && nations.includes(ctrl) ? ctrl : nations[0];
      const defenders = here.filter((u) => u.nation === defNation);
      const attackers = here.filter((u) => this.atWar(u.nation, defNation));
      if (!attackers.length) continue;
      this.battles.add(p);
      const land = prov.kind === 'land';
      const terrain = land ? (TERRAIN_DEFENSE[prov.terrain] ?? 1) * ((prov.river ?? 0) >= 4 ? RIVER_DEFENSE : 1) * (this.built(p, 'fort') ? 1.5 : 1) : 1;
      const airDefense = land && this.built(p, 'air_defense'); // works for whoever holds the province
      const supply = new Map<number, number>();
      for (const n of nations) {
        const count = here.filter((u) => u.nation === n).length;
        supply.set(n, spendMunitions(n, count * MUNITIONS_PER_UNIT_DAY) ? 1 : 0.6);
      }

      // air superiority and support (land battles only)
      const side = (n: number) => (n === defNation ? 'd' : 'a');
      const cover = { a: 0, d: 0 }, strike = { a: 0, d: 0 }, naval = { a: 0, d: 0 };
      const involved = new Set(here.map((u) => u.nation));
      const isSide = (n: number) => involved.has(n);
      if (land) {
        for (const w of air) {
          if (!isSide(w.nation) || !this.units.has(w.id)) continue;
          if (this.storm(w.province) || (w.mission && this.storm(w.mission.target))) continue; // grounded by weather
          const power = (w.strength / 100) * UNIT_SPECS[w.type].attack * (1 + this.bonus(w.nation, 'air')) * (airDefense && side(w.nation) === 'a' ? 0.5 : 1);
          if (w.type === 'fighters' && w.mission?.kind === 'patrol' && this.inRange(w, p, PATROL_RADIUS)) cover[side(w.nation)] += power;
          if (STRIKERS.includes(w.type) && w.mission?.kind === 'support' && this.inRange(w, p, SUPPORT_RADIUS)) strike[side(w.nation)] += power * (w.type === 'bombers' ? 0.5 : 1);
        }
        for (const s of ships) {
          if (!isSide(s.nation) || !prov.adj.includes(s.province)) continue;
          naval[side(s.nation)] += (s.strength / 100) * UNIT_SPECS[s.type].attack * (s.type === 'carrier' ? 0.6 : 0.3) * (1 + this.bonus(s.nation, 'naval'));
        }
      }
      const totalCover = cover.a + cover.d;
      const share = { a: totalCover ? cover.a / totalCover : 0.5, d: totalCover ? cover.d / totalCover : 0.5 };
      const bonus = (s: 'a' | 'd') => (strike[s] * (0.3 + 0.7 * share[s]) + naval[s]) * 0.5;

      const tech = (u: Unit, role: 'attack' | 'defense') => 1 + this.bonus(u.nation,
        domainOf(u.type) === 'sea' ? 'naval' : domainOf(u.type) === 'air' ? 'air' : role === 'attack' ? 'landAttack' : 'landDefense');
      // the best general on each side lifts that whole side
      const command = (units: Unit[]) => 1 + GENERAL_BONUS * Math.max(0, ...units.map((u) => u.general?.skill ?? 0));
      const power = (units: Unit[], role: 'attack' | 'defense') => units.reduce((sum, u) =>
        sum + (u.strength / 100) * UNIT_SPECS[u.type][role] * (role === 'defense' ? terrain : 1) * supply.get(u.nation)! * tech(u, role)
          * (u.supplied === false ? NO_SUPPLY_POWER : 1)
          // storming ashore: only marines fight at full strength in their first two days on the beach
          * (role === 'attack' && u.landedAt !== undefined && this.now - u.landedAt < 2 * DAY && u.type !== 'marines' ? BEACHHEAD : 1), 0) * command(units)
        * (0.9 + 0.2 * this.rand());
      const pa = Math.max(0.01, power(attackers, 'attack') + bonus('a'));
      const pd = Math.max(0.01, power(defenders, 'defense') + bonus('d'));
      const hasDestroyers = (units: Unit[]) => units.some((u) => u.type === 'destroyers');
      const hit = (u: Unit, ratio: number, foes: Unit[]) => {
        const stealth = u.type === 'submarines' && !hasDestroyers(foes) ? 0.5 : 1;
        u.strength -= Math.min(30, BATTLE_DAMAGE * Math.sqrt(ratio) * stealth);
      };
      for (const u of attackers) { u.fighting = true; hit(u, pd / pa, defenders); }
      for (const u of defenders) { u.fighting = true; hit(u, pa / pd, attackers); }

      // air wings over a contested battle wear down, more so when losing the skies
      for (const w of air) {
        if (!isSide(w.nation) || tiredWings.has(w.id) || !w.mission || !this.inRange(w, p, w.type === 'fighters' ? PATROL_RADIUS : SUPPORT_RADIUS)) continue;
        tiredWings.add(w.id);
        const s = side(w.nation);
        const enemyCover = s === 'a' ? cover.d : cover.a;
        if (w.type === 'fighters') w.strength -= enemyCover ? 3 * (1 - share[s]) + 0.5 : 0;
        else w.strength -= 4 * (1 - share[s]) + 0.5;
        if (airDefense && s === 'a') w.strength -= 2;
        if (w.strength < DESTROYED_AT) { this.units.delete(w.id); events.push({ kind: 'destroyed', province: w.province, nation: w.nation }); }
      }

      // commanders learn from every day of battle
      for (const u of [...attackers, ...defenders]) {
        if (!u.general) continue;
        u.general.xp += 6;
        if (u.general.skill < 5 && u.general.xp >= 100 * u.general.skill) {
          u.general.skill++;
          events.push({ kind: 'promoted', province: p, nation: u.nation });
        }
      }
      for (const u of [...attackers, ...defenders]) this.retreatOrDie(u, events);
      const holding = (u: Unit) => this.units.has(u.id) && u.province === p && u.next === undefined; // not retreating
      const leftAtt = attackers.filter(holding);
      const leftDef = defenders.filter(holding);
      if (!leftDef.length && leftAtt.length) {
        for (const u of leftAtt) u.fighting = false;
        if (land) this.takeControl(leftAtt[0].nation, p, events);
        events.push({ kind: 'battle', province: p, nation: leftAtt[0].nation, other: defNation });
      } else if (!leftAtt.length) {
        for (const u of leftDef) u.fighting = false;
      }
    }

    // strategic bombing: strike wings hit industry in enemy provinces
    for (const w of air) {
      if (!this.units.has(w.id) || !STRIKERS.includes(w.type) || w.mission?.kind !== 'bomb' || w.next !== undefined) continue;
      if (this.storm(w.province) || this.storm(w.mission.target)) continue;
      const t = w.mission.target, owner = this.controller(t);
      if (!this.atWar(w.nation, owner) || distanceKm(this.label(w.province), this.label(t)) > this.rangeOf(w)) continue;
      const defended = this.built(t, 'air_defense');
      const power = (w.strength / 100) * UNIT_SPECS[w.type].attack * (1 + this.bonus(w.nation, 'air')) * (defended ? 0.4 : 1) * (w.type === 'bombers' ? 2.5 : 1);
      this.onEconomicDamage(owner!, 0.00015 * power / 10);
      if (this.rand() < 0.06 * power / 10 && this.destroyBuilding(t)) events.push({ kind: 'bombed', province: t, nation: w.nation, other: owner });
      w.strength -= defended ? 3 : 0.7;
      if (w.strength < DESTROYED_AT) { this.units.delete(w.id); events.push({ kind: 'destroyed', province: t, nation: w.nation }); }
    }

    // special forces behind the lines wreck what they can find
    for (const u of all) {
      if (u.type !== 'special_forces' || !this.units.has(u.id) || u.fighting || u.next !== undefined) continue;
      const owner = this.controller(u.province);
      if (!this.atWar(u.nation, owner)) continue;
      if (this.rand() < 0.04 && this.destroyBuilding(u.province)) events.push({ kind: 'bombed', province: u.province, nation: u.nation, other: owner });
    }

    // air wings whose base fell go home
    for (const w of air) {
      if (this.units.has(w.id) && w.next === undefined && this.controller(w.province) !== w.nation) {
        const home = homeOf(w.nation);
        if (home === undefined) this.units.delete(w.id);
        else { w.province = home; w.mission = undefined; }
      }
    }
  }

  private retreatOrDie(u: Unit, events: MilEvent[]) {
    if (u.strength >= RETREAT_AT) return;
    const sea = domainOf(u.type) === 'sea';
    const safe = this.provinces.get(u.province)!.adj.find((q) => {
      const prov = this.provinces.get(q);
      if (!prov || (prov.kind === 'sea') !== sea) return false;
      if (!sea && this.controller(q) !== u.nation) return false;
      return !this.unitsIn(q).some((o) => this.atWar(o.nation, u.nation) && domainOf(o.type) === domainOf(u.type));
    });
    if (u.strength < DESTROYED_AT || safe === undefined) {
      this.units.delete(u.id);
      events.push({ kind: 'destroyed', province: u.province, nation: u.nation });
      return;
    }
    u.fighting = false;
    u.path = [];
    u.goal = undefined; // beaten back: the attack is called off
    u.next = safe;
    u.legStart = 0;
    u.legEnd = 0; // falls back immediately on the next advance()
  }

  /** Is the unit somewhere it can refit: friendly land, a home air base, or a sea zone off our coast? */
  private atHome(u: Unit) {
    if (u.fighting || u.next !== undefined) return false;
    const prov = this.provinces.get(u.province);
    if (!prov) return false;
    if (prov.kind === 'land') return this.controller(u.province) === u.nation;
    return prov.adj.some((q) => this.controller(q) === u.nation);
  }

  /** Daily logistics for one nation: income, upkeep, production and reinforcement. */
  logistics(nation: number, mil: NationMil, income: number, manpower: number, homeFor: (t: UnitType) => number | undefined, now = 0, equipmentMade = 0) {
    const mine = this.unitsOf(nation);
    const upkeep = mine.reduce((s, u) => s + UNIT_SPECS[u.type].upkeep, 0);
    mil.funds += (income - upkeep) / 365;
    mil.equipment = Math.min(EQUIP_CAP, (mil.equipment ?? 300) + equipmentMade);
    const item = mil.queue[0];
    const where = item ? homeFor(item.type) : undefined;
    if (item && where !== undefined) {
      const spec = UNIT_SPECS[item.type];
      const daily = spec.cost / spec.days;
      const kit = (spec.cost * EQUIP_PER_BN) / spec.days;
      if (mil.funds >= daily && mil.equipment >= kit) {
        mil.funds -= daily;
        mil.equipment -= kit;
        item.progress = Math.min(1, item.progress + ((1 + this.bonus(nation, 'build')) * this.recruitPace(nation)) / spec.days);
        if (item.progress >= 1) {
          mil.queue.shift();
          const u = this.spawn(nation, item.type, where);
          // send new land units to the rally point, if one is set and reachable
          if (mil.rally !== undefined && domainOf(u.type) === 'land' && mil.rally !== where) this.move(nation, [u.id], mil.rally, now);
        }
      }
    }
    for (const u of mine) {
      if (u.strength >= 100 || !this.atHome(u)) continue;
      const cost = UNIT_SPECS[u.type].cost * 0.004;
      const kit = cost * EQUIP_PER_BN;
      if (mil.funds < cost || manpower <= 0 || (mil.equipment ?? 0) < kit) break;
      mil.funds -= cost;
      mil.equipment = (mil.equipment ?? 0) - kit;
      u.strength = Math.min(100, u.strength + 3);
    }
    if (mil.funds < -5) for (const u of mine) u.strength = Math.max(10, u.strength - 0.5); // unpaid forces desert
  }

  menInUniform(nation: number, mil: NationMil) {
    return this.unitsOf(nation).reduce((s, u) => s + (UNIT_SPECS[u.type].men * u.strength) / 100, 0)
      + mil.queue.reduce((s, q) => s + UNIT_SPECS[q.type].men, 0);
  }
}
