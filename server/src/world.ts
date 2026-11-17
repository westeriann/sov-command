// The authoritative world. One instance per game world, one process each.
//
// Every nation has a controller: the AI, or a human (who may hand the nation
// to the AI on autopilot). Orders from both go through submit(), so the rules
// are identical, and the AI only reads what any player could see.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DAY, gameTimeAt } from '../../shared/clock.ts';
import {
  FOCI, LIMITS,
  type ChatLine, type ClockInfo, type ErrorCode, type EventKind, type Focus, type NationPrivate,
  type NationPublic, type Order, type Personality, type Policy, type WorldEvent,
} from '../../shared/protocol.ts';
import { COMMODITIES, normalizeBudget, type Commodity } from '../../shared/economy.ts';
import type { EconomyUpdate } from '../../shared/protocol.ts';
import { AiBrain, personalityFor } from './ai.ts';
import {
  HISTORY_EVERY_DAYS, SPEND_RATE, initEconomies, initMarket, marketSnapshot, privateEcon, publicEcon, runDay,
  type EconSeed, type MarketState, type NationEcon,
} from './economy.ts';
import type { User } from './auth.ts';
import { getMeta, setMeta, transaction, type DB } from './db.ts';
import { Military, type MilEvent, type NationMil, type Province } from './military.ts';
import { UNIT_SPECS, UNIT_TYPES, type MilitaryPrivate, type UnitType, type UnitView } from '../../shared/military.ts';
import type { WarState } from '../../shared/protocol.ts';
import { Diplomacy } from './diplomacy.ts';
import {
  MAX_ALLIANCES, MAX_TRADE_DEALS, dealText, type Deal,
} from '../../shared/diplomacy.ts';

/** New players cannot be attacked by the AI for this long after claiming a nation. */
const NEWCOMER_PROTECTION_MS = 2 * 3_600_000;

export interface NationDef {
  id: number;
  name: string;
  short: string;
  capital: number;
  neighbours: number[];
  provinces: number;
  pop: number;
  area: number;
  seed: EconSeed;
}

export interface NationState {
  id: number;
  controller: 'ai' | 'human';
  userId?: number;
  player?: string;
  autopilot: boolean;
  autopilotReason?: 'player' | 'inactive';
  personality: Personality;
  policy: Policy;
  claimedAt?: number; // real ms
  lastSeen?: number; // real ms, human nations
  nextThink: number; // game ms
  econ: NationEcon;
  mil: NationMil;
  annexedBy?: number; // conquered: the nation no longer exists
}

export interface WorldOptions {
  speed: number; // game seconds per real second
  startGame: number; // game ms the world opens on
  aiBudgetPerTick: number; // most AI decisions per tick, keeps CPU flat
  autopilotAfterMs: number; // real ms offline before the AI steps in
  releaseAfterMs: number; // real ms offline before the nation returns to the AI
}

export interface WorldListener {
  nation(n: NationPublic): void;
  mine(userId: number, n: NationPrivate | null): void;
  event(e: WorldEvent): void;
  chat(line: ChatLine): void;
  economy(update: EconomyUpdate): void;
  units(userId: number, units: UnitView[]): void;
  war(state: WarState): void;
}

/** Province resource scores (0..100) feeding each good. */
const RESOURCE_OF: Record<Commodity, string> = {
  food: 'farmland', oil: 'oil', gas: 'gas', coal: 'coal', metals: 'ore', rare_earths: 'rare_earths',
};
/** After downtime, simulate at most this many missed days (60 days ≈ 1.2 s of work). */
const MAX_CATCH_UP_DAYS = 60;
/** AI governments review policy about once a game week (~70 real seconds at 8640x). */
const AI_REVIEW_DAYS = 7;

export type Result = { ok: true } | { ok: false; code: ErrorCode; message: string };
const ok: Result = { ok: true };
const fail = (code: ErrorCode, message: string): Result => ({ ok: false, code, message });

export function loadNationDefs(worldDir: string): { seed: number; nations: NationDef[]; provinces: Province[] } {
  const raw = JSON.parse(readFileSync(join(worldDir, 'provinces.json'), 'utf8')) as {
    seed: number;
    nations: Omit<NationDef, 'seed'>[];
    provinces: {
      id: number; kind: 'land' | 'sea'; nation?: number; area: number; coastal?: boolean; res?: Record<string, number>;
      label: [number, number]; terrain: string; river?: number; adj: number[]; pop?: number; name: string;
    }[];
  };
  // aggregate each nation's provinces into its economic potential
  const seeds = new Map<number, EconSeed & { count: number }>();
  for (const n of raw.nations) {
    seeds.set(n.id, { pop: n.pop, raw: Object.fromEntries(COMMODITIES.map((c) => [c, 0])) as Record<Commodity, number>, coastal: 0, farm: 0, count: 0 });
  }
  for (const p of raw.provinces) {
    const s = p.kind === 'land' && p.nation ? seeds.get(p.nation) : undefined;
    if (!s) continue;
    s.count++;
    if (p.coastal) s.coastal++;
    s.farm += p.res?.farmland ?? 0;
    // a province's output grows with its score and, less than linearly, with its size
    const size = Math.pow(p.area / 10_000, 0.7);
    for (const c of COMMODITIES) s.raw[c] += ((p.res?.[RESOURCE_OF[c]] ?? 0) / 100) * size;
  }
  return {
    seed: raw.seed,
    nations: raw.nations.map((n) => {
      const s = seeds.get(n.id)!;
      return {
        id: n.id, name: n.name, short: n.short, capital: n.capital, neighbours: n.neighbours,
        provinces: n.provinces, pop: n.pop, area: n.area,
        seed: { pop: s.pop, raw: s.raw, coastal: s.coastal / Math.max(1, s.count), farm: s.farm / Math.max(1, s.count) },
      };
    }),
    provinces: raw.provinces.map((p) => ({
      id: p.id, kind: p.kind, label: p.label, terrain: p.terrain, river: p.river, adj: p.adj,
      owner: p.kind === 'land' ? p.nation : undefined, pop: p.pop ?? 0, name: p.name,
    })),
  };
}

/** Stand-in map for tests without province data: one province per nation at its capital. */
function stubProvinces(defs: NationDef[]): Province[] {
  const capitalOf = new Map(defs.map((d) => [d.id, d.capital]));
  return defs.map((d) => ({
    id: d.capital, kind: 'land' as const, label: [d.id * 2, 0] as [number, number], terrain: 'grassland',
    adj: d.neighbours.map((n) => capitalOf.get(n)!).filter((x) => x !== undefined), owner: d.id, pop: d.pop,
  }));
}

export class World {
  readonly defs = new Map<number, NationDef>();
  readonly nations = new Map<number, NationState>();
  readonly clock: Omit<ClockInfo, 'serverNow'>;
  private byUser = new Map<number, number>();
  private online = new Set<number>();
  private dirty = new Set<number>();
  private recentEvents: WorldEvent[] = [];
  private recentChat: ChatLine[] = [];
  private brain: AiBrain;
  market: MarketState;
  private worldStart: number; // game ms of day 0
  military: Military;
  private ownedPop = new Map<number, number>();
  private warStamp = '';
  diplomacy: Diplomacy;
  listener: WorldListener | null = null;

  constructor(private db: DB, seed: number, defs: NationDef[], private opts: WorldOptions, provinces?: Province[]) {
    for (const d of defs) this.defs.set(d.id, d);
    const storedSeed = getMeta(db, 'seed');
    if (storedSeed && Number(storedSeed) !== seed) {
      throw new Error(`Database belongs to world seed ${storedSeed}, but the map files are seed ${seed}.`);
    }
    if (!storedSeed) {
      setMeta(db, 'seed', String(seed));
      setMeta(db, 'clock', JSON.stringify({ openedReal: Date.now(), openedGame: opts.startGame, speed: opts.speed }));
    }
    this.clock = JSON.parse(getMeta(db, 'clock')!);
    this.worldStart = Number(getMeta(db, 'start') ?? this.clock.openedGame);
    setMeta(db, 'start', String(this.worldStart));
    if (opts.speed !== this.clock.speed) {
      // speed changed in the config: keep today's game time, run at the new speed from now on
      const now = Date.now();
      this.clock = { openedReal: now, openedGame: gameTimeAt(this.clock, now), speed: opts.speed };
      setMeta(db, 'clock', JSON.stringify(this.clock));
    }
    this.brain = new AiBrain(seed, this);
    const storedMarket = getMeta(db, 'market');
    this.market = storedMarket ? JSON.parse(storedMarket) : initMarket();

    const rows = db.prepare('select state from nations').all() as { state: string }[];
    for (const r of rows) {
      const n = JSON.parse(r.state) as NationState;
      if (!this.defs.has(n.id)) continue;
      this.nations.set(n.id, n);
      if (n.controller === 'human' && n.userId) this.byUser.set(n.userId, n.id);
    }
    const now = this.gameNow();
    const missing = defs.filter((d) => !this.nations.has(d.id) || !this.nations.get(d.id)!.econ);
    const economies = missing.length
      ? initEconomies(new Map(defs.map((d) => [d.id, d.seed])), mulberry(seed + 77))
      : new Map<number, NationEcon>();
    for (const d of missing) {
      const econ = economies.get(d.id)!;
      const existing = this.nations.get(d.id);
      if (existing) {
        existing.econ = econ;
      } else {
        const personality = personalityFor(seed, d.id);
        this.nations.set(d.id, {
          id: d.id, controller: 'ai', autopilot: false, personality,
          policy: this.brain.initialPolicy(personality),
          // spread first decisions over a game day so AI work never bunches up
          nextThink: now + ((d.id * 7919) % 1000) / 1000 * AI_REVIEW_DAYS * DAY,
          econ,
          mil: { funds: 0, queue: [] },
        });
      }
      const n = this.nations.get(d.id)!;
      n.econ.budget = this.brain.initialBudget(n.personality);
      // start with about half a war reserve of munitions
      n.econ.munitions = n.econ.gdp * SPEND_RATE * 0.9 * (n.econ.budget.military / 100) * 0.25;
      this.dirty.add(d.id);
    }
    if (missing.length && !storedMarket) this.market.day = this.dayIndex();

    // land forces: the map, saved state, or fresh starting armies
    const provList = provinces ?? stubProvinces(defs);
    const storedDiplo = getMeta(db, 'diplomacy');
    this.diplomacy = new Diplomacy(storedDiplo ? JSON.parse(storedDiplo) : null);
    const byId = new Map(provList.map((p) => [p.id, p]));
    for (const [p, owner] of this.diplomacy.owners) { const prov = byId.get(p); if (prov) prov.owner = owner; }
    const storedMil = getMeta(db, 'military');
    this.military = new Military(byId, storedMil ? JSON.parse(storedMil) : null, mulberry(seed + 99));
    this.military.allied = (a, b) => this.diplomacy.has('alliance', a, b);
    this.countOwnedPop();
    for (const n of this.nations.values()) {
      n.mil ??= { funds: 0, queue: [] };
      // peace offers saved before diplomacy existed become white-peace proposals
      for (const from of n.mil.peaceOffers ?? []) this.diplomacy.propose({ from, to: n.id, deal: { kind: 'peace', terms: 'white' }, day: this.market.day });
      delete n.mil.peaceOffers;
    }
    if (!storedMil) this.deployStartingArmies();
    else if (![...this.military.units.values()].some((u) => UNIT_SPECS[u.type].domain !== 'land')) {
      // upgrade a world saved before navies and air forces existed
      for (const n of this.nations.values()) this.deployAirAndSea(n, Math.max(2, Math.min(40, Math.round(this.defenceIncome(n) / 4))));
    }
    setMeta(db, 'military', JSON.stringify(this.military.serialize()));
    this.persist();
    this.recentEvents = (db.prepare('select at, kind, nation, text from events order by id desc limit 60').all() as
      { at: number; kind: EventKind; nation: number | null; text: string }[])
      .reverse().map((e) => ({ at: e.at, kind: e.kind, nation: e.nation ?? undefined, text: e.text }));
    this.recentChat = (db.prepare('select at, name, nation, text from chat order by id desc limit 60').all() as
      { at: number; name: string; nation: number | null; text: string }[])
      .reverse().map((c) => ({ at: c.at, from: c.name, nation: c.nation ?? undefined, text: c.text }));
  }

  gameNow(realNow = Date.now()) {
    return gameTimeAt(this.clock, realNow);
  }

  /** Military budget per game year: the share of government spending set aside for defence. */
  defenceIncome(n: NationState) {
    return n.econ.gdp * SPEND_RATE * 0.9 * (n.econ.budget.military / 100) * 0.7; // 30% goes to munitions
  }

  manpower(n: NationState) {
    const reservists = n.econ.pop * (0.004 + (0.01 * n.econ.budget.military) / 100);
    return Math.max(0, reservists - this.military.menInUniform(n.id, n.mil));
  }

  /** Where a new unit appears: land and air at home; ships in a sea zone off our coast (capital first). */
  homeFor(nation: number, type: UnitType): number | undefined {
    const home = this.home(nation);
    if (UNIT_SPECS[type].domain !== 'sea') return home;
    const provs = this.military.provinces;
    const seaNear = (p: number | undefined) => p === undefined ? undefined : provs.get(p)?.adj.find((q) => provs.get(q)?.kind === 'sea');
    const fromCapital = seaNear(home);
    if (fromCapital !== undefined) return fromCapital;
    for (const p of provs.values()) {
      if (p.kind === 'land' && this.military.controller(p.id) === nation) {
        const s = seaNear(p.id);
        if (s !== undefined) return s;
      }
    }
    return undefined;
  }

  /** Share of a nation's people not under enemy occupation. */
  controlOf(nation: number) {
    return this.military.controlShare(nation, this.ownedPop.get(nation) ?? 0);
  }

  /** Where new units appear: the capital if we hold it, else any province we control. */
  home(nation: number): number | undefined {
    const cap = this.defs.get(nation)?.capital;
    if (cap !== undefined && this.military.controller(cap) === nation) return cap;
    for (const p of this.military.provinces.values()) if (p.kind === 'land' && this.military.controller(p.id) === nation) return p.id;
    return undefined;
  }

  private deployStartingArmies() {
    const provs = this.military.provinces;
    const border = new Map<number, number[]>();
    for (const p of provs.values()) {
      if (p.kind !== 'land' || !p.owner) continue;
      if (p.adj.some((q) => provs.get(q)?.kind === 'land' && provs.get(q)!.owner !== p.owner)) {
        border.set(p.owner, [...(border.get(p.owner) ?? []), p.id]);
      }
    }
    const rand = mulberry(this.nations.size * 31 + 7);
    for (const n of this.nations.values()) {
      const income = this.defenceIncome(n);
      const count = Math.max(2, Math.min(40, Math.round(income / 4)));
      const aggressive = n.personality === 'expansionist' || n.personality === 'opportunist';
      const cap = this.defs.get(n.id)!.capital;
      const edge = border.get(n.id) ?? [];
      for (let i = 0; i < count; i++) {
        const r = rand();
        const type = r < (aggressive ? 0.25 : 0.1) ? 'armored' : r < (aggressive ? 0.5 : 0.3) ? 'mechanized' : 'infantry';
        const at = i < count * 0.4 || !edge.length ? cap : edge[i % edge.length];
        if (provs.has(at)) this.military.spawn(n.id, type, at);
      }
      this.deployAirAndSea(n, count);
      n.mil.funds = income * 0.1;
    }
  }

  /** Air force about a quarter the size of the army; a navy if the nation has a coast. */
  private deployAirAndSea(n: NationState, count: number) {
    const cap = this.home(n.id);
    if (cap === undefined) return;
    for (let i = 0; i < Math.max(1, Math.round(count * 0.25)); i++) {
      const w = this.military.spawn(n.id, i % 2 ? 'strike' : 'fighters', cap);
      if (w.type === 'fighters') w.mission = { kind: 'patrol', target: cap };
    }
    const sea = this.homeFor(n.id, 'destroyers');
    if (sea === undefined) return;
    const ships = Math.max(1, Math.round(count * 0.15));
    for (let i = 0; i < ships; i++) this.military.spawn(n.id, i === 0 && count >= 20 ? 'carrier' : i % 3 === 2 ? 'submarines' : 'destroyers', sea);
  }

  warState(): WarState {
    return {
      wars: this.military.wars, occupied: Object.fromEntries(this.military.occupied), battles: [...this.military.battles],
      treaties: this.diplomacy.treaties, owners: Object.fromEntries(this.diplomacy.owners),
    };
  }

  private countOwnedPop() {
    this.ownedPop.clear();
    for (const p of this.military.provinces.values()) if (p.kind === 'land' && p.owner) this.ownedPop.set(p.owner, (this.ownedPop.get(p.owner) ?? 0) + p.pop);
  }

  private saveState() {
    setMeta(this.db, 'military', JSON.stringify(this.military.serialize()));
    setMeta(this.db, 'diplomacy', JSON.stringify(this.diplomacy.serialize()));
  }

  /** Units visible to a user's nation (none for players without a nation). */
  unitsFor(userId: number): UnitView[] {
    const n = this.nationOf(userId);
    return n ? this.military.viewFor(n.id) : [];
  }

  private milPrivate(n: NationState): MilitaryPrivate {
    const upkeep = this.military.unitsOf(n.id).reduce((s, u) => s + UNIT_SPECS[u.type].upkeep, 0);
    return {
      funds: Math.round(n.mil.funds * 100) / 100, income: Math.round(this.defenceIncome(n) * 100) / 100,
      upkeep: Math.round(upkeep * 100) / 100, manpower: Math.round(this.manpower(n)),
      queue: n.mil.queue.map((q) => ({ ...q })),
      peaceOffers: this.diplomacy.incoming(n.id).filter((p) => p.deal.kind === 'peace' && p.deal.terms === 'white').map((p) => p.from),
    };
  }

  // ---- views ------------------------------------------------------------------
  publicView(n: NationState): NationPublic {
    const army = Math.round((this.military?.unitsOf(n.id).length ?? 0) / 5) * 5;
    if (n.annexedBy) return { id: n.id, controller: 'ai', focus: n.policy.focus, army: 0, annexedBy: n.annexedBy };
    return n.controller === 'human'
      ? { id: n.id, controller: 'human', player: n.player, online: this.online.has(n.userId!), autopilot: n.autopilot, focus: n.policy.focus, army }
      : { id: n.id, controller: 'ai', personality: n.personality, focus: n.policy.focus, army };
  }

  privateView(n: NationState): NationPrivate {
    return {
      ...this.publicView(n), tax: n.policy.tax, claimedAt: n.claimedAt,
      econ: privateEcon(n.econ, n.policy.tax, this.market.day), mil: this.milPrivate(n),
      diplo: { incoming: this.diplomacy.incoming(n.id), outgoing: this.diplomacy.outgoing(n.id) },
    };
  }

  economyUpdate(): EconomyUpdate {
    return {
      market: marketSnapshot(this.market),
      nations: [...this.nations.values()].filter((n) => !n.annexedBy).map((n) => publicEcon(n.id, n.econ)),
    };
  }

  /** Whole game days since the world opened. */
  dayIndex(realNow = Date.now()) {
    return Math.floor((this.gameNow(realNow) - this.worldStart) / DAY);
  }

  allPublic() {
    return [...this.nations.values()].map((n) => this.publicView(n));
  }

  nationOf(userId: number) {
    const id = this.byUser.get(userId);
    return id ? this.nations.get(id) ?? null : null;
  }

  recent() {
    return { events: this.recentEvents.slice(-40), chat: this.recentChat.slice(-40) };
  }

  humanCount() {
    return this.byUser.size;
  }

  // ---- presence ---------------------------------------------------------------
  setPresence(userId: number, isOnline: boolean) {
    if (isOnline) this.online.add(userId);
    else this.online.delete(userId);
    const n = this.nationOf(userId);
    if (!n) return;
    n.lastSeen = Date.now();
    if (isOnline && n.autopilot && n.autopilotReason === 'inactive') {
      n.autopilot = false;
      n.autopilotReason = undefined;
      this.event('autopilot', n.id, `${n.player} is back and governs ${this.defs.get(n.id)!.short} again.`);
      this.listener?.mine(userId, this.privateView(n));
    }
    this.touch(n);
  }

  // ---- control ------------------------------------------------------------------
  claim(user: User, nationId: number): Result {
    if (this.byUser.has(user.id)) return fail('already_ruling', 'You already lead a nation. Release it first.');
    const n = this.nations.get(nationId);
    if (!n) return fail('not_found', 'No such nation.');
    if (n.annexedBy) return fail('not_allowed', 'That nation no longer exists.');
    if (n.controller === 'human') return fail('taken', `${n.player} already leads this nation.`);
    Object.assign(n, {
      controller: 'human', userId: user.id, player: user.name, autopilot: false,
      autopilotReason: undefined, claimedAt: Date.now(), lastSeen: Date.now(),
    });
    this.byUser.set(user.id, n.id);
    this.event('claim', n.id, `${user.name} took control of the ${this.defs.get(n.id)!.name}.`);
    this.touch(n);
    this.listener?.mine(user.id, this.privateView(n));
    return ok;
  }

  release(userId: number, reason = 'stepped down'): Result {
    const n = this.nationOf(userId);
    if (!n) return fail('not_ruling', 'You do not lead a nation.');
    const name = n.player;
    this.byUser.delete(userId);
    Object.assign(n, {
      controller: 'ai', userId: undefined, player: undefined, autopilot: false, autopilotReason: undefined,
      claimedAt: undefined, lastSeen: undefined, nextThink: this.gameNow(),
    });
    this.event('release', n.id, `${name} ${reason}; the ${this.defs.get(n.id)!.name} is run by the AI again.`);
    this.touch(n);
    this.listener?.mine(userId, null);
    return ok;
  }

  /** The single entry point for orders, from players and from the AI alike. */
  submit(nationId: number, order: Order, actor: 'human' | 'ai'): Result {
    const n = this.nations.get(nationId);
    if (!n || typeof order !== 'object' || order === null) return fail('bad_request', 'Unknown order.');
    if (actor === 'ai' && n.controller === 'human' && !n.autopilot) return fail('not_ruling', 'Player in control.');
    if (n.annexedBy) return fail('not_allowed', 'Your nation no longer exists.');
    switch (order.kind) {
      case 'policy': {
        const p = order.policy ?? {};
        const next: Policy = { ...n.policy };
        if (p.focus !== undefined) {
          if (!FOCI.includes(p.focus as Focus)) return fail('bad_request', 'Unknown focus.');
          next.focus = p.focus;
        }
        if (p.tax !== undefined) {
          if (typeof p.tax !== 'number' || !Number.isFinite(p.tax)) return fail('bad_request', 'Tax must be a number.');
          next.tax = Math.round(Math.min(LIMITS.taxMax, Math.max(LIMITS.taxMin, p.tax)));
        }
        const focusChanged = next.focus !== n.policy.focus;
        n.policy = next;
        if (focusChanged && actor === 'human') {
          this.event('policy', n.id, `The ${this.defs.get(n.id)!.name} shifts its national focus to ${next.focus}.`);
        }
        this.touch(n, focusChanged);
        return ok;
      }
      case 'budget': {
        if (typeof order.budget !== 'object' || order.budget === null) return fail('bad_request', 'Budget must be an object.');
        n.econ.budget = normalizeBudget(order.budget, n.econ.budget);
        this.touch(n, false);
        return ok;
      }
      case 'recruit': {
        const spec = UNIT_SPECS[order.unit];
        if (!spec || !UNIT_TYPES.includes(order.unit)) return fail('bad_request', 'Unknown unit type.');
        if (n.mil.queue.length >= 10) return fail('not_allowed', 'The production queue is full (10).');
        if (this.manpower(n) < spec.men) return fail('not_allowed', 'Not enough reservists. Raise the military budget or wait for losses to be replaced.');
        if (this.homeFor(n.id, order.unit) === undefined) return fail('not_allowed', 'Ships need a coast: your nation holds no coastal province.');
        n.mil.queue.push({ type: order.unit, progress: 0 });
        this.touch(n, false);
        return ok;
      }
      case 'move': {
        const ids = Array.isArray(order.units) ? order.units.slice(0, 200).map(Number) : [];
        const to = Number(order.to);
        if (!ids.length || !this.military.provinces.has(to)) return fail('bad_request', 'Choose units and a land province.');
        const { moved } = this.military.move(n.id, ids, to, this.gameNow());
        if (!moved) return fail('no_route', 'No route there. Units can only enter your own land and the land of nations you are at war with.');
        this.pushUnits(n);
        return ok;
      }
      case 'mission': {
        const ids = Array.isArray(order.units) ? order.units.slice(0, 200).map(Number) : [];
        const m = order.mission;
        if (m && (!['patrol', 'support'].includes(m.kind) || !this.military.provinces.has(Number(m.target)))) {
          return fail('bad_request', 'Missions are patrol or support over a province.');
        }
        const done = this.military.setMission(n.id, ids, m ? { kind: m.kind, target: Number(m.target) } : null);
        if (!done) return fail('no_route', 'Out of range: move the air wings to a closer base first.');
        this.pushUnits(n);
        return ok;
      }
      case 'halt': {
        this.military.halt(n.id, Array.isArray(order.units) ? order.units.map(Number) : []);
        this.pushUnits(n);
        return ok;
      }
      case 'war': {
        const t = this.nations.get(Number(order.target));
        if (!t || t.id === n.id) return fail('bad_request', 'Choose another nation.');
        if (t.annexedBy) return fail('not_allowed', 'That nation no longer exists.');
        if (this.military.atWar(n.id, t.id)) return fail('not_allowed', 'Already at war.');
        if (this.diplomacy.has('alliance', n.id, t.id)) return fail('not_allowed', 'You are allies. End the alliance first.');
        if (actor === 'ai' && t.controller === 'human' && Date.now() - (t.claimedAt ?? 0) < NEWCOMER_PROTECTION_MS) {
          return fail('not_allowed', 'That leader is new and protected.');
        }
        this.military.declareWar(n.id, t.id, this.market.day);
        this.diplomacy.withdraw(n.id, t.id);
        this.diplomacy.withdraw(t.id, n.id);
        this.diplomacy.cancel('trade', n.id, t.id);
        this.event('war', n.id, `The ${this.defs.get(n.id)!.name} declares war on the ${this.defs.get(t.id)!.name}.`);
        // defensive alliances: the target's allies join against the aggressor (no further chain)
        for (const ally of this.diplomacy.partners('alliance', t.id)) {
          if (ally === n.id || this.diplomacy.has('alliance', ally, n.id) || this.military.atWar(ally, n.id)) continue;
          this.military.declareWar(ally, n.id, this.market.day);
          this.diplomacy.cancel('trade', ally, n.id);
          this.event('war', ally, `The ${this.defs.get(ally)!.name} honours its alliance and enters the war against the ${this.defs.get(n.id)!.name}.`);
          const a = this.nations.get(ally)!;
          a.nextThink = Math.min(a.nextThink, this.gameNow());
          this.touch(a, false);
          this.pushUnits(a);
        }
        this.warChanged();
        this.touch(t, false);
        this.touch(n, false);
        return ok;
      }
      case 'peace':
        return this.submit(n.id, { kind: 'propose', target: order.target, deal: { kind: 'peace', terms: 'white' } }, actor);
      case 'propose': {
        const t = this.nations.get(Number(order.target));
        const deal = cleanDeal(order.deal);
        if (!t || t.id === n.id || !deal) return fail('bad_request', 'Choose another nation and a deal.');
        const problem = this.dealProblem(n.id, t.id, deal);
        if (problem) return fail('not_allowed', problem);
        // proposing exactly what they already offered us is accepting it
        const theirs = this.diplomacy.pending(t.id, n.id, deal.kind);
        if (theirs && JSON.stringify(theirs.deal) === JSON.stringify(deal)) {
          this.diplomacy.withdraw(t.id, n.id, deal.kind);
          this.conclude(t, n, deal);
          return ok;
        }
        if (t.controller === 'ai' || t.autopilot) {
          // AI governments answer at once
          if (!this.brain.answer(t, n.id, deal)) return fail('not_allowed', `The ${this.defs.get(t.id)!.short} declines the ${dealText(deal)}.`);
          this.conclude(n, t, deal);
          return ok;
        }
        this.diplomacy.propose({ from: n.id, to: t.id, deal, day: this.market.day });
        this.event('diplomacy', n.id, `The ${this.defs.get(n.id)!.name} proposes ${dealText(deal)} to the ${this.defs.get(t.id)!.name}.`);
        this.touch(t, false);
        this.touch(n, false);
        return ok;
      }
      case 'answer': {
        const from = this.nations.get(Number(order.from));
        const p = from && this.diplomacy.pending(from.id, n.id, order.deal);
        if (!from || !p) return fail('not_found', 'That proposal is no longer on the table.');
        this.diplomacy.withdraw(from.id, n.id, order.deal);
        if (order.accept) {
          const problem = this.dealProblem(from.id, n.id, p.deal);
          if (problem) { this.touch(n, false); return fail('not_allowed', problem); }
          this.conclude(from, n, p.deal);
        } else {
          this.event('diplomacy', n.id, `The ${this.defs.get(n.id)!.name} rejects the ${dealText(p.deal)} offered by the ${this.defs.get(from.id)!.name}.`);
          this.touch(from, false);
          this.touch(n, false);
        }
        return ok;
      }
      case 'cancel': {
        const t = this.nations.get(Number(order.target));
        if (!t || (order.pact !== 'alliance' && order.pact !== 'trade')) return fail('bad_request', 'Unknown treaty.');
        if (!this.diplomacy.cancel(order.pact, n.id, t.id)) return fail('not_found', 'There is no such treaty.');
        this.event('diplomacy', n.id, `The ${this.defs.get(n.id)!.name} ends its ${order.pact === 'alliance' ? 'alliance' : 'trade agreement'} with the ${this.defs.get(t.id)!.name}.`);
        this.warChanged();
        this.touch(t, false);
        this.touch(n, false);
        return ok;
      }
      case 'autopilot': {
        if (actor !== 'human' || n.controller !== 'human') return fail('not_ruling', 'Only a player can do that.');
        n.autopilot = !!order.on;
        n.autopilotReason = n.autopilot ? 'player' : undefined;
        if (n.autopilot) n.nextThink = this.gameNow();
        this.touch(n);
        return ok;
      }
      default:
        return fail('bad_request', 'Unknown order.');
    }
  }

  chat(user: User, text: string): Result {
    const clean = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, LIMITS.chatLength);
    if (!clean) return fail('bad_request', 'Empty message.');
    const nation = this.byUser.get(user.id);
    const line: ChatLine = { at: Date.now(), from: user.name, nation, text: clean };
    this.db.prepare('insert into chat (at, user_id, name, nation, text) values (?, ?, ?, ?, ?)')
      .run(line.at, user.id, user.name, nation ?? null, clean);
    this.recentChat.push(line);
    if (this.recentChat.length > 200) this.recentChat.splice(0, 100);
    this.listener?.chat(line);
    return ok;
  }

  // ---- simulation -----------------------------------------------------------------
  /** Called once a real second. Cheap: a scan of nations plus a bounded slice of AI work. */
  tick(realNow = Date.now()) {
    const now = this.gameNow(realNow);
    const due: NationState[] = [];
    for (const n of this.nations.values()) {
      if (n.annexedBy) continue;
      if (n.controller === 'human' && !n.autopilot && !this.online.has(n.userId!)) {
        const away = realNow - (n.lastSeen ?? realNow);
        if (away > this.opts.releaseAfterMs) {
          this.release(n.userId!, 'was away too long');
          continue;
        }
        if (away > this.opts.autopilotAfterMs) {
          n.autopilot = true;
          n.autopilotReason = 'inactive';
          n.nextThink = now;
          this.event('autopilot', n.id, `${n.player} is away; advisers govern the ${this.defs.get(n.id)!.short} meanwhile.`);
          this.touch(n);
        }
      }
      if ((n.controller === 'ai' || n.autopilot) && n.nextThink <= now) due.push(n);
    }
    due.sort((a, b) => a.nextThink - b.nextThink);
    for (const n of due.slice(0, this.opts.aiBudgetPerTick)) {
      for (const order of this.brain.think(n)) this.submit(n.id, order, 'ai');
      // nations at war review every 2 game days (20 s), others weekly
      const every = this.military.enemiesOf(n.id).length ? 2 : AI_REVIEW_DAYS;
      n.nextThink = now + every * DAY * (0.8 + 0.4 * this.brain.random());
      this.dirty.add(n.id);
    }
    const events: MilEvent[] = [];
    this.military.advance(now, events);
    this.handleMilEvents(events);
    this.runEconomy(realNow);
    this.persist();
  }

  private handleMilEvents(events: MilEvent[]) {
    if (!events.length) return;
    let changed = false;
    for (const e of events) {
      const prov = this.military.provinces.get(e.province);
      const where = prov?.name ?? `province ${e.province}`;
      const who = this.defs.get(e.nation)?.short ?? '?';
      if (e.kind === 'occupied') {
        changed = true;
        this.event('war', e.nation, `${who} forces occupy ${where}${e.other ? ` in the ${this.defs.get(e.other)?.short}` : ''}.`);
      } else if (e.kind === 'liberated') {
        changed = true;
        this.event('war', e.nation, `${who} retakes ${where}.`);
      } else if (e.kind === 'destroyed') {
        const n = this.nations.get(e.nation);
        if (n?.controller === 'human') this.event('war', e.nation, `A ${who} division was destroyed near ${where}.`);
      }
    }
    if (changed) this.warChanged();
  }

  private warChanged() {
    const state = this.warState();
    const stamp = JSON.stringify(state);
    if (stamp === this.warStamp) return;
    this.warStamp = stamp;
    this.saveState();
    this.listener?.war(state);
  }

  /** Send a nation's player what they can now see. */
  private pushUnits(n: NationState) {
    if (n.controller === 'human' && n.userId && this.online.has(n.userId)) this.listener?.units(n.userId, this.military.viewFor(n.id));
  }

  /** One game day of fighting, pay, upkeep, production and reinforcement. */
  private militaryDay() {
    const events: MilEvent[] = [];
    this.military.fight(
      (nation, amount) => {
        const e = this.nations.get(nation)?.econ;
        if (!e || e.munitions < amount) return false;
        e.munitions -= amount;
        return true;
      },
      (x) => this.home(x),
      events,
    );
    for (const n of this.nations.values()) {
      this.military.logistics(n.id, n.mil, this.defenceIncome(n), this.manpower(n), (t) => this.homeFor(n.id, t));
    }
    this.handleMilEvents(events);
  }

  /**
   * Simulate any whole game days that have passed; all nations share one market.
   * Players get their own figures every game day; the world-wide update (all
   * nations' public figures and prices) goes out and is saved once a game week.
   */
  private runEconomy(realNow: number) {
    const today = this.dayIndex(realNow);
    if (today <= this.market.day) return;
    if (today - this.market.day > MAX_CATCH_UP_DAYS) this.market.day = today - MAX_CATCH_UP_DAYS;
    let weekly = false;
    while (this.market.day < today) {
      this.militaryDay();
      // occupation costs the owner output, revenue and stability
      if (this.diplomacy.expire(this.market.day)) this.warChanged();
      const inputs = [...this.nations.values()].filter((n) => !n.annexedBy).map((n) => ({
        econ: n.econ, tax: n.policy.tax, focus: n.policy.focus,
        control: this.military.controlShare(n.id, this.ownedPop.get(n.id) ?? 0),
        atWar: this.military.enemiesOf(n.id).length > 0,
        blockade: this.military.blockade(n.id),
        tradeDeals: this.diplomacy.partners('trade', n.id).length,
      }));
      runDay(inputs, this.market, this.market.day + 1);
      if (this.market.day % HISTORY_EVERY_DAYS === 0) weekly = true;
    }
    this.saveState();
    if (this.military.battles.size) this.listener?.war(this.warState());
    for (const n of this.nations.values()) {
      if (n.controller === 'human' && n.userId) {
        this.listener?.mine(n.userId, this.privateView(n));
        this.pushUnits(n);
      }
    }
    if (!weekly) return;
    for (const n of this.nations.values()) this.dirty.add(n.id);
    setMeta(this.db, 'market', JSON.stringify(this.market));
    this.listener?.economy({ ...this.economyUpdate(), market: marketSnapshot(this.market, 1) });
  }

  /** Save everything now (used on shutdown, since economies are only saved weekly). */
  persistAll() {
    for (const n of this.nations.values()) this.dirty.add(n.id);
    setMeta(this.db, 'market', JSON.stringify(this.market));
    this.saveState();
    this.persist();
  }

  // ---- diplomacy -----------------------------------------------------------------
  /** Why a deal between two nations cannot be made right now, or null if it can. */
  dealProblem(a: number, b: number, deal: Deal): string | null {
    const na = this.nations.get(a), nb = this.nations.get(b);
    if (!na || !nb || na.annexedBy || nb.annexedBy) return 'That nation no longer exists.';
    const d = this.diplomacy, name = this.defs.get(b)!.short;
    if (deal.kind === 'peace') return this.military.atWar(a, b) ? null : `You are not at war with the ${name}.`;
    if (this.military.atWar(a, b)) return `You are at war with the ${name}. Make peace first.`;
    if (d.has(deal.kind, a, b)) return `You already have that treaty with the ${name}.`;
    const max = deal.kind === 'alliance' ? MAX_ALLIANCES : MAX_TRADE_DEALS;
    if (d.partners(deal.kind, a).length >= max) return `You already have ${max} ${deal.kind === 'alliance' ? 'alliances' : 'trade agreements'}.`;
    if (d.partners(deal.kind, b).length >= max) return `The ${name} cannot take on another ${dealText(deal)}.`;
    if (deal.kind === 'alliance' && this.military.enemiesOf(b).some((e) => this.diplomacy.has('alliance', a, e))) {
      return `The ${name} is at war with one of your allies.`;
    }
    return null;
  }

  /** Put a deal into effect. `from` proposed it, `to` accepted. */
  private conclude(from: NationState, to: NationState, deal: Deal) {
    const A = this.defs.get(from.id)!.name, B = this.defs.get(to.id)!.name;
    if (deal.kind === 'peace') {
      const ceded = deal.terms === 'cede' ? this.cede(from.id, to.id) : 0;
      this.military.makePeace(from.id, to.id, (x) => this.home(x));
      this.event('peace', from.id, ceded
        ? `The ${A} and the ${B} make peace. The ${B} cedes ${ceded} province${ceded > 1 ? 's' : ''}.`
        : `The ${A} and the ${B} make peace. Occupied land is returned.`);
      if (to.annexedBy) this.event('peace', from.id, `The ${B} has ceased to exist; its last lands pass to the ${A}.`);
    } else {
      this.diplomacy.sign(deal.kind, from.id, to.id, this.market.day);
      this.event('diplomacy', from.id, `The ${A} and the ${B} sign ${deal.kind === 'alliance' ? 'a defensive alliance' : 'a trade agreement'}.`);
    }
    this.warChanged();
    for (const x of [from, to]) { this.touch(x, false); this.pushUnits(x); }
  }

  /** The winner keeps the loser's provinces it occupies, with their people and output. Returns how many. */
  private cede(winner: number, loser: number) {
    const m = this.military, lose = this.nations.get(loser)!, win = this.nations.get(winner)!;
    const taken = [...m.occupied].filter(([p, occ]) => occ === winner && m.provinces.get(p)!.owner === loser).map(([p]) => p);
    if (!taken.length) return 0;
    const pop = taken.reduce((s, p) => s + m.provinces.get(p)!.pop, 0);
    const f = Math.min(1, pop / Math.max(1, this.ownedPop.get(loser) ?? 0));
    for (const p of taken) {
      m.provinces.get(p)!.owner = winner;
      m.occupied.delete(p);
      this.diplomacy.owners.set(p, winner);
    }
    // people and output move with the land
    const a = lose.econ, b = win.econ;
    b.gdp += a.gdp * f; b.pop += a.pop * f;
    a.gdp *= 1 - f; a.pop *= 1 - f;
    for (const c of COMMODITIES) { b.capacity[c] += a.capacity[c] * f; a.capacity[c] *= 1 - f; }
    this.countOwnedPop();
    if (![...m.provinces.values()].some((p) => p.kind === 'land' && p.owner === loser)) this.annex(lose, winner);
    return taken.length;
  }

  /** A nation with no land left ceases to exist. */
  private annex(n: NationState, by: number) {
    if (n.controller === 'human' && n.userId) this.release(n.userId, `lost the last of the ${this.defs.get(n.id)!.short}`);
    n.annexedBy = by;
    n.mil.queue = [];
    const m = this.military;
    for (const u of [...m.units.values()]) if (u.nation === n.id) m.units.delete(u.id);
    for (const [p, occ] of [...m.occupied]) if (occ === n.id) m.occupied.delete(p);
    m.wars = m.wars.filter((w) => w.a !== n.id && w.b !== n.id);
    this.diplomacy.forget(n.id);
    this.listener?.nation(this.publicView(n));
    this.dirty.add(n.id);
  }

  // ---- internals --------------------------------------------------------------------
  private touch(n: NationState, broadcast = true) {
    this.dirty.add(n.id);
    if (broadcast) this.listener?.nation(this.publicView(n));
    if (n.controller === 'human' && n.userId) this.listener?.mine(n.userId, this.privateView(n));
  }

  private event(kind: EventKind, nation: number | undefined, text: string) {
    const e: WorldEvent = { at: this.gameNow(), kind, nation, text };
    this.db.prepare('insert into events (at, kind, nation, text) values (?, ?, ?, ?)').run(e.at, kind, nation ?? null, text);
    this.recentEvents.push(e);
    if (this.recentEvents.length > 200) this.recentEvents.splice(0, 100);
    this.listener?.event(e);
  }

  persist() {
    if (!this.dirty.size) return;
    const stmt = this.db.prepare('insert into nations (id, state) values (?, ?) on conflict(id) do update set state = excluded.state');
    transaction(this.db, () => {
      for (const id of this.dirty) stmt.run(id, JSON.stringify(this.nations.get(id)));
    });
    this.dirty.clear();
  }
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cleanDeal(d: unknown): Deal | null {
  const x = d as Deal | undefined;
  if (!x || typeof x !== 'object') return null;
  if (x.kind === 'alliance' || x.kind === 'trade') return { kind: x.kind };
  if (x.kind === 'peace') return { kind: 'peace', terms: x.terms === 'cede' ? 'cede' : 'white' };
  return null;
}
