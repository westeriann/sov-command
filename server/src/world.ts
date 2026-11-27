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
  type ChatChannel, type ChatLine, type ClockInfo, type SeasonInfo, type ErrorCode, type EventKind, type Focus, type NationPrivate,
  PERSONALITIES, type NationPublic, type Order, type Personality, type Policy, type WorldEvent,
} from '../../shared/protocol.ts';
import { COMMODITIES, COMMODITY_INFO, normalizeBudget, type Commodity, type EnergyStats } from '../../shared/economy.ts';
import type { EconomyUpdate } from '../../shared/protocol.ts';
import { AiBrain, personalityFor } from './ai.ts';
import {
  HISTORY_EVERY_DAYS, SPEND_RATE, initEconomies, usePerYear, initMarket, marketSnapshot, privateEcon, publicEcon, runDay,
  type EconSeed, type MarketState, type NationEcon,
} from './economy.ts';
import type { User } from './auth.ts';
import { getMeta, setMeta, transaction, type DB } from './db.ts';
import { Military, type MilEvent, type NationMil, type Province } from './military.ts';
import { UNIT_SPECS, UNIT_TYPES, type MilitaryPrivate, type UnitType, type UnitView } from '../../shared/military.ts';
import type { WarState } from '../../shared/protocol.ts';
import { Diplomacy } from './diplomacy.ts';
import { cleanFlag, isColor, type FlagSpec } from '../../shared/flags.ts';
import type { GlobalEventKind, WorldState } from '../../shared/protocol.ts';
import { ACHIEVEMENTS, MISSION_CASH, MISSION_KINDS, MISSION_REWARD_DAYS, type AchievementKey, type GoalKind, type SeasonMission } from '../../shared/goals.ts';
import { EARNED_EMBLEMS } from '../../shared/flags.ts';
import { HARVEST, WINTER_POWER, seasonAt } from '../../shared/seasons.ts';
import { GOV_LIBERTY, PROPAGANDA_COST, type Faction, type Ideology, type PropagandaMode } from '../../shared/society.ts';
import { specialtyBonus, specialtyOf, SPECIALTIES, type Specialty, type SpecialtyBonus } from '../../shared/specialties.ts';
import { BUILDINGS, BUILDING_TYPES, FACTORY_GROWTH, MAX_CONSTRUCTION, MAX_FACTORIES, POWER_FUEL, POWER_SHARE, REPAIR_COST_SHARE, REPAIR_TIME_SHARE, type BuildingType } from '../../shared/buildings.ts';
import { findRoute, type RouteNode } from '../../shared/military.ts';
import { ASAT_COST, GENERAL_COST, MISSILE_COST, MISSILE_DAMAGE, MISSILE_RANGE, SATELLITE_COST, UNITS_PER_GENERAL, UNIT_TECH, WARHEAD_COST, distanceKm } from '../../shared/military.ts';
import { MISSILE_SHIELD_KM } from '../../shared/buildings.ts';
import { ROAD, roadCost, roadDays } from '../../shared/roads.ts';
import { buildSpeed, devLean, development, MILITARY_WORKS, recruitSpeed } from '../../shared/development.ts';
import {
  GOVERNMENTS, GOVERNMENT_INFO, MAX_RESEARCH_QUEUE, REFORM_COOLDOWN_DAYS, REFORM_DAYS, TECHS as TECHS_LIST, TECH_BY_ID, effectsOf, missing, ready, techCost,
  type Effects, type Government, type ResearchPrivate, type TechId,
} from '../../shared/research.ts';
import {
  TRUCE_DAYS, CONTRACT_YEARS, ENVOY_COST, ENVOY_DAYS, MAX_BLOC, MAX_CONTRACTS, MAX_ENVOYS, MAX_OPEN_RESOLUTIONS, MAX_SPY_OPS, PACTS, PACT_INFO, RESOLUTION_TEXT, SPY_COST, SPY_DAYS, SPY_MISSIONS,
  TRIBUTE_SHARE, VOTE_DAYS, dealText, type Deal, type Opinion, type Pact, type ResolutionKind, type SpyMission,
} from '../../shared/diplomacy.ts';
import {
  DECREE_DISCOUNT, HIGH_TAX, HIGH_TAX_SUPPORT, LAWS, LAW_IDS, LEGISLATURE, MAX_CAPITAL, WAR_SUPPORT, lawVote,
  type Demand, type DemandKind, type LawId, type Legislature, type PoliticsPrivate,
} from '../../shared/politics.ts';
import { ideologyGap } from '../../shared/society.ts';
import { EVENTS, EVENT_DAYS, type EventKey, type PendingEvent } from '../../shared/events.ts';
import { ADVISER_AREAS, type AdviserArea } from '../../shared/protocol.ts';
import { AUTONOMY_COST, CAMPAIGN_COST, CAMPAIGN_DAYS, COALITION_COST, PARTIES_PER_NATION, PARTY_POOL, type Party } from '../../shared/parties.ts';
import { DEMIL_YEARS, MAX_REPARATIONS, REPARATION_YEARS, treatyCost, treatyText, type PeaceTreaty } from '../../shared/peace.ts';
import { COUNTER_INTEL_COST, MAX_NETWORKS, NETWORK_COST, NETWORK_GROWTH } from '../../shared/diplomacy.ts';
import { EQUIP_PER_BN, WAR_GOALS } from '../../shared/military.ts';
import { normalizeSettings, type GameSettings } from '../../shared/settings.ts';

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
  custom?: { name?: string; short?: string; color?: string; flag?: FlagSpec; renamedAt?: number };
  missions?: SeasonMission[];
  soc?: { ideology: Ideology; factions: Record<Faction, number>; propaganda: { mode: PropagandaMode; target?: number } };
  born?: { name: string; short: string; color: string; capital: number; label: number; parent: number }; // nations created in play
  missionSeason?: number;
  missionsDone?: number; // all-time, for the achievement
  reports?: string[]; // intelligence reports for the player
  spyOps?: { target: number; mission: SpyMission; day: number }[];
  intel?: Record<number, number>; // nation -> game day our view of its forces lasts until
  tech: { current?: TechId; partial: Partial<Record<TechId, number>>; done: TechId[]; queue?: TechId[] };
  gov: { government: Government; reformUntil?: number; reformedAt?: number; nextElection?: number; oppositionUntil?: number };
  /** Domestic politics: political capital, laws in force, parliament's support and what it asks. */
  pol?: { capital: number; support: number; laws: LawId[]; demand?: Demand; nextDemand?: number; claims: number[]; goodwill: number; lastLaw?: number };
  mem?: Record<number, number>; // what this nation remembers of others: gifts, insults, betrayals (fades)
  envoys?: { target: number; until: number }[];
  event?: PendingEvent; // a decision waiting for the player
  nextEvent?: number; // game day
  flags?: Record<string, number>; // event chains: key -> game day it fires
  parties?: Party[];
  campaign?: number; // poll bonus for the governing parties until the election
  spy?: { nets: Record<number, number>; building: number[]; counter: number };
  repay?: { to: number; share: number; until: number }[]; // reparations we owe
  autonomy?: number[]; // provinces granted autonomy
  advisers?: AdviserArea[]; // single player: what the advisers handle
  adviserLog?: string[];
}

export interface WorldOptions {
  speed: number; // game seconds per real second
  startGame: number; // game ms the world opens on
  aiBudgetPerTick: number; // most AI decisions per tick, keeps CPU flat
  autopilotAfterMs: number; // real ms offline before the AI steps in
  releaseAfterMs: number; // real ms offline before the nation returns to the AI
  seasonMs?: number; // real length of a season (default 28 days)
  singlePlayer?: boolean; // the world runs in the player's own window: advisers may help them govern
  settings?: GameSettings; // how a new world is made (an existing one keeps its own)
}

export interface WorldListener {
  nation(n: NationPublic): void;
  mine(userId: number, n: NationPrivate | null): void;
  event(e: WorldEvent): void;
  chat(line: ChatLine): void;
  economy(update: EconomyUpdate): void;
  units(userId: number, units: UnitView[]): void;
  war(state: WarState): void;
  clock?(c: ClockInfo): void; // the world paused or resumed
}

/** Province resource scores (0..100) feeding each good. */
const RESOURCE_OF: Record<Commodity, string> = {
  food: 'farmland', timber: 'timber', oil: 'oil', gas: 'gas', coal: 'coal', metals: 'ore', rare_earths: 'rare_earths',
};
/** After downtime, simulate at most this many missed days (60 days ≈ 1.2 s of work). */
const MAX_CATCH_UP_DAYS = 60;
/** AI governments review policy about once a game week (~70 real seconds at 8640x). */
const AI_REVIEW_DAYS = 7;

export type Result = { ok: true } | { ok: false; code: ErrorCode; message: string };
const ok: Result = { ok: true };
const fail = (code: ErrorCode, message: string): Result => ({ ok: false, code, message });

export function loadNationDefs(worldDir: string): { seed: number; nations: NationDef[]; provinces: Province[] } {
  return nationDefsFrom(JSON.parse(readFileSync(join(worldDir, 'provinces.json'), 'utf8')));
}

/** Nations and provinces from the generator's provinces.json (already parsed). */
export function nationDefsFrom(rawJson: unknown): { seed: number; nations: NationDef[]; provinces: Province[] } {
  const raw = rawJson as {
    seed: number;
    nations: Omit<NationDef, 'seed'>[];
    provinces: {
      id: number; kind: 'land' | 'sea'; nation?: number; area: number; coastal?: boolean; res?: Record<string, number>; city?: boolean; parent?: number;
      label: [number, number]; terrain: string; river?: number; adj: number[]; pop?: number; name: string; elev?: number;
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
      owner: p.kind === 'land' ? p.nation : undefined, pop: p.pop ?? 0, name: p.name, elev: p.elev, coastal: p.coastal,
      area: p.area, city: p.city, parent: p.parent,
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

/** Names given to hurricanes in turn. */
const HURRICANE_NAMES = ['Adara', 'Boris', 'Celine', 'Dmitri', 'Esme', 'Farid', 'Greta', 'Hugo', 'Ines', 'Jonas', 'Kaia', 'Lev', 'Mira', 'Nestor', 'Olya', 'Pablo', 'Rhea', 'Sami', 'Talia', 'Viktor', 'Wren', 'Yusuf', 'Zora'];

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
  private rand: () => number;
  private effectCache = new Map<number, Effects>();
  private factories = new Map<number, number>();
  globe: WorldState & { lastClimateDay: number; low: number[]; oilCut?: Record<number, number> } = { warming: 0, lastClimateDay: 0, low: [] };
  private migrants = new Map<number, { in: number; out: number }>();
  storms: { lon: number; lat: number; r: number; vlon: number; vlat: number; until: number; kind?: 'storm' | 'hurricane'; cat?: number; name?: string; hit?: number[] }[] = [];
  private hurricaneCount = 0;
  /** Each land province's specialty (from its climate and place). */
  readonly specialty = new Map<number, Specialty>();
  private specialtyCache = new Map<number, { own: Partial<Record<Specialty, number>>; shared: Specialty[]; bonus: SpecialtyBonus }>();

  /** The specialties a nation holds (provinces it owns and controls), luxuries its trade partners share, and the bonus. */
  specialties(nation: number) {
    let c = this.specialtyCache.get(nation);
    if (c) return c;
    const own: Partial<Record<Specialty, number>> = {};
    for (const [p, sp] of this.specialty) {
      const prov = this.military.provinces.get(p);
      if (prov?.owner === nation && this.military.controller(p) === nation) own[sp] = (own[sp] ?? 0) + 1;
    }
    const shared = new Set<Specialty>();
    for (const partner of this.diplomacy.partners('trade', nation)) {
      for (const [p, sp] of this.specialty) {
        if (!SPECIALTIES[sp].luxury || own[sp] || shared.has(sp)) continue;
        if (this.military.provinces.get(p)?.owner === partner && this.military.controller(p) === partner) shared.add(sp);
      }
    }
    c = { own, shared: [...shared], bonus: specialtyBonus(own, [...shared]) };
    this.specialtyCache.set(nation, c);
    return c;
  }

  /** Whether a nation can draw on a specialty: its own provinces, or a trade partner's. */
  hasAccess(nation: number, sp: Specialty) {
    if (this.specialties(nation).own[sp]) return true;
    return this.diplomacy.partners('trade', nation).some((x) => this.specialties(x).own[sp]);
  }
  private stormy = new Set<number>();
  lanes: { a: number; b: number; path: number[]; raided: boolean }[] = [];
  private laneCache = new Map<string, number[] | null>();
  private plants = new Map<number, { share: number; thermal: number; coal: number; gas: number }>();
  nuked: number[] = [];
  private warDirty = false;
  season: { number: number; startedAt: number; endsAt: number; scores: Record<number, number>; history: { d: number; s: Record<number, number>; p?: Record<number, number> }[]; dominance: number };
  private power = new Map<number, number>();
  listener: WorldListener | null = null;
  /** The map and mode this world was made with. */
  readonly settings: GameSettings;
  /** Set by the server: achievements are kept on the account, not the nation. */
  achievements: { list(userId: number): string[]; award(userId: number, key: string): boolean } = { list: () => [], award: () => false };

  constructor(private db: DB, seed: number, defs: NationDef[], private opts: WorldOptions, provinces?: Province[]) {
    for (const d of defs) this.defs.set(d.id, d);
    const storedSeed = getMeta(db, 'seed');
    if (storedSeed && Number(storedSeed) !== seed) {
      throw new Error(`Database belongs to world seed ${storedSeed}, but the map files are seed ${seed}.`);
    }
    if (!storedSeed) {
      setMeta(db, 'seed', String(seed));
      setMeta(db, 'clock', JSON.stringify({ openedReal: Date.now(), openedGame: opts.startGame, speed: opts.speed }));
      setMeta(db, 'settings', JSON.stringify(normalizeSettings(opts.settings)));
    }
    // worlds made before there were settings play as they always have: the Earth, at the full pace
    this.settings = normalizeSettings(JSON.parse(getMeta(db, 'settings') ?? '{}'));
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
    this.rand = mulberry(seed + 555);
    const storedMarket = getMeta(db, 'market');
    this.market = storedMarket ? JSON.parse(storedMarket) : initMarket();

    const rows = db.prepare('select state from nations').all() as { state: string }[];
    for (const r of rows) {
      const born = (JSON.parse(r.state) as NationState).born;
      if (born && !this.defs.has((JSON.parse(r.state) as NationState).id)) {
        const id = (JSON.parse(r.state) as NationState).id;
        this.defs.set(id, { id, name: born.name, short: born.short, capital: born.capital, neighbours: [], provinces: 0, pop: 0, area: 0, seed: { pop: 0, raw: Object.fromEntries(COMMODITIES.map((c) => [c, 0])) as Record<Commodity, number>, coastal: 0, farm: 0 } });
      }
    }
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
          tech: { partial: {}, done: [] },
          gov: { government: startingGovernment(personality, d.id) },
        });
      }
      const n = this.nations.get(d.id)!;
      n.econ.budget = this.brain.initialBudget(n.personality);
      // start with about half a war reserve of munitions
      n.econ.munitions = n.econ.gdp * SPEND_RATE * 0.9 * (n.econ.budget.military / 100) * 0.25;
      this.dirty.add(d.id);
    }
    if (missing.length && !storedMarket) this.market.day = this.dayIndex();
    // goods added since this world was saved (e.g. timber): seed them as a new world would
    const newGoods = COMMODITIES.filter((c) => [...this.nations.values()].some((n) => n.econ && n.econ.capacity[c] === undefined));
    if (newGoods.length) {
      const fresh = initEconomies(new Map(defs.map((d) => [d.id, d.seed])), mulberry(seed + 77));
      for (const n of this.nations.values()) {
        const f = fresh.get(n.id);
        for (const c of newGoods) {
          const scale = f ? n.econ.gdp / Math.max(1e-6, f.gdp) : 1;
          n.econ.capacity[c] = (f?.capacity[c] ?? usePerYear(c, n.econ.gdp, n.econ.pop)) * scale;
          n.econ.stock[c] = (f?.stock[c] ?? 0) * scale;
          n.econ.trade[c] = 0; n.econ.short[c] = 0;
        }
        this.dirty.add(n.id);
      }
      for (const c of newGoods) this.market.prices[c] ??= COMMODITY_INFO[c].basePrice;
    }

    // land forces: the map, saved state, or fresh starting armies
    const provList = provinces ?? stubProvinces(defs);
    const storedDiplo = getMeta(db, 'diplomacy');
    this.diplomacy = new Diplomacy(storedDiplo ? JSON.parse(storedDiplo) : null);
    const byId = new Map(provList.map((p) => [p.id, p]));
    for (const [p, owner] of this.diplomacy.owners) { const prov = byId.get(p); if (prov) prov.owner = owner; }
    const seasonMs = opts.seasonMs ?? 28 * 86_400_000;
    this.season = JSON.parse(getMeta(db, 'season') ?? 'null') ?? { number: 1, startedAt: Date.now(), endsAt: Date.now() + seasonMs, scores: {}, history: [], dominance: 0 };
    this.nuked = JSON.parse(getMeta(db, 'nuked') ?? '[]');
    this.globe = { ...this.globe, ...JSON.parse(getMeta(db, 'globe') ?? '{}') };
    this.migrants = new Map(Object.entries(JSON.parse(getMeta(db, 'migrants') ?? '{}')).map(([k, v]) => [Number(k), v as { in: number; out: number }]));
    for (const p of this.nuked) { const prov = byId.get(p); if (prov) prov.pop *= 0.7; }
    const storedMil = getMeta(db, 'military');
    this.military = new Military(byId, storedMil ? JSON.parse(storedMil) : null, mulberry(seed + 99));
    this.military.allied = (a, b) => this.diplomacy.allied(a, b) || this.diplomacy.has('access', a, b);
    this.military.barred = (nation, p) => { const d = this.nations.get(nation)?.mil.demil; return !!d && d.until > this.market.day && d.provinces.includes(p); };
    for (const p of byId.values()) { const sp = specialtyOf(p as never); if (sp) this.specialty.set(p.id, sp); }
    this.military.intelOn = (nation) => [
      ...Object.entries(this.nations.get(nation)?.intel ?? {}).filter(([, until]) => until >= this.market.day).map(([id]) => Number(id)),
      ...((this.nations.get(nation)?.mil.satellites ?? 0) > 0 ? this.military.enemiesOf(nation) : []), // satellites watch every enemy
    ];
    this.countOwnedPop();
    // the lowest-lying coastal provinces are the first to flood as the seas rise
    if (!this.globe.low.length) {
      const coast = [...byId.values()].filter((p) => p.kind === 'land' && p.coastal && p.elev !== undefined).sort((a, b) => a.elev! - b.elev!);
      this.globe.low = coast.slice(0, Math.ceil(coast.length * 0.15)).map((p) => p.id);
    }
    for (const n of this.nations.values()) {
      n.mil ??= { funds: 0, queue: [] };
      // peace offers saved before diplomacy existed become white-peace proposals
      for (const from of n.mil.peaceOffers ?? []) this.diplomacy.propose({ from, to: n.id, deal: { kind: 'peace', terms: 'white' }, day: this.market.day });
      delete n.mil.peaceOffers;
      // worlds saved before research and governments existed
      n.tech ??= { partial: {}, done: [] };
      n.gov ??= { government: startingGovernment(n.personality, n.id) };
    }
    for (const n of this.nations.values()) this.applyCustom(n);
    this.recomputeNeighbours();
    for (const n of this.nations.values()) { n.soc ??= this.initialSociety(n); n.pol ??= this.initialPolitics(n); }
    this.military.bonus = (nation, kind) => this.effects(nation)[kind];
    this.military.storm = (p) => this.stormy.has(p);
    this.storms = JSON.parse(getMeta(db, 'storms') ?? '[]');
    this.military.recruitPace = (n) => recruitSpeed(this.avgDevelopment(n));
    this.military.onEconomicDamage = (nation, share) => {
      const e = this.nations.get(nation)?.econ;
      if (!e) return;
      e.gdp *= 1 - share;
      e.stability = Math.max(0, e.stability - share * 300);
    };
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

  // ---- the pause vote (shared worlds) ----------------------------------------------
  private pauseVotes = new Set<number>();
  private pausedSpeed: number | null = null;
  private pausedAt = 0;

  /** Players leading nations who are online now. */
  private onlineLeaders() {
    return [...this.nations.values()].filter((n) => n.controller === 'human' && !n.autopilot && n.userId !== undefined && this.online.has(n.userId)).map((n) => n.id);
  }

  pauseState(nation: number) {
    const online = this.onlineLeaders();
    return { votes: online.filter((x) => this.pauseVotes.has(x)).length, needed: online.length, mine: this.pauseVotes.has(nation), paused: this.pausedSpeed !== null };
  }

  /** Pause when every leader online has voted for it; resume when any takes the vote back, or after ten minutes. */
  private checkPause() {
    const online = this.onlineLeaders();
    const all = online.length > 0 && online.every((x) => this.pauseVotes.has(x));
    if (all && this.pausedSpeed === null) {
      this.pausedSpeed = this.clock.speed;
      this.pausedAt = Date.now();
      this.setSpeed(0);
      this.event('world', undefined, 'Every leader agrees: the world is paused.');
    } else if (this.pausedSpeed !== null && (!all || Date.now() - this.pausedAt > 600_000)) {
      this.setSpeed(this.pausedSpeed);
      this.pausedSpeed = null;
      this.pauseVotes.clear();
      this.event('world', undefined, 'The world resumes.');
    } else return;
    this.listener?.clock?.({ ...this.clock, serverNow: Date.now() });
    for (const n of this.nations.values()) if (n.controller === 'human') this.touch(n, false);
  }

  /** Change the game speed, keeping today's date (single-player). */
  setSpeed(speed: number) {
    const now = Date.now();
    (this as { clock: Omit<ClockInfo, 'serverNow'> }).clock = { openedReal: now, openedGame: this.gameNow(now), speed };
    setMeta(this.db, 'clock', JSON.stringify(this.clock));
  }

  gameNow(realNow = Date.now()) {
    return gameTimeAt(this.clock, realNow);
  }

  /** Military budget per game year: the share of government spending set aside for defence. */
  defenceIncome(n: NationState) {
    return n.econ.gdp * SPEND_RATE * 0.9 * (n.econ.budget.military / 100) * 0.7; // 30% goes to munitions
  }

  /** Bonuses from technology and government, cached for the game day. */
  effects(nation: number): Effects {
    let e = this.effectCache.get(nation);
    if (e) return e;
    const n = this.nations.get(nation);
    if (!n) return effectsOf('democracy', []);
    e = effectsOf(n.gov.government, n.tech.done, n.gov.reformUntil !== undefined);
    if (n.gov.government === 'democracy' && this.military.enemiesOf(nation).length) e.stability -= 5; // war weariness
    if (n.policy.focus === 'military') { e.build += 0.2; e.manpower += 0.15; } // a war footing: faster arms output, more men called up
    for (const l of n.pol?.laws ?? []) for (const [k, v] of Object.entries(LAWS[l].effects)) e[k as keyof Effects] += v as number;
    e.research += 0.05 * this.diplomacy.partners('research', nation).length; // research cooperation
    const sb = this.specialties(nation).bonus; // what the land is known for
    e.stability += sb.stability; e.growth += sb.growth; e.research += sb.research; e.build += sb.build;
    if ((n.gov.oppositionUntil ?? -1) > this.market.day) { e.growth -= 0.002; e.stability += 3; } // a new government's honeymoon
    if ((n.flags?.slump ?? -1) > this.market.day) e.growth -= 0.003; // a long strike
    if ((n.flags?.purge ?? -1) > this.market.day) { e.landAttack -= 0.1; e.landDefense -= 0.1; } // officers purged
    // society: how well the government suits the people, what the factions think, propaganda at home
    if (n.soc) {
      e.stability += this.fit(n);
      const f = n.soc.factions;
      if (f.military > 75) e.build += 0.1; else if (f.military < 25) e.landAttack -= 0.1;
      if (f.business > 75) e.growth += 0.003; else if (f.business < 25) e.growth -= 0.006;
      if (f.public > 75) e.stability += 4; else if (f.public < 25) e.stability -= 8;
      if (n.soc.propaganda.mode === 'home') e.stability += 4;
      // open societies get more out of trade
      e.growth += Math.max(0, n.soc.ideology.openness) * this.diplomacy.partners('trade', nation).length * 0.0006;
    }
    // armies without fuel fight worse; without metals, factories build slower; without rare earths, labs slow down
    const short = n.econ.short;
    const fuel = 0.4 * Math.min(1, short.oil);
    e.landAttack -= fuel; e.landDefense -= fuel * 0.5; e.naval -= fuel; e.air -= fuel;
    e.build -= 0.6 * Math.min(1, short.metals);
    e.research -= 0.5 * Math.min(1, short.rare_earths);
    this.effectCache.set(nation, e);
    return e;
  }

  /** Oil burned by the armed forces, and coal and gas by power stations (per year). */
  extraUse(n: NationState): Partial<Record<Commodity, number>> {
    const units = this.military.unitsOf(n.id);
    const atWar = this.military.enemiesOf(n.id).length > 0;
    let oil = 0;
    for (const u of units) {
      const d = UNIT_SPECS[u.type].domain;
      oil += d === 'land' ? (u.type === 'infantry' ? 0.0004 : 0.001) : d === 'sea' ? 0.002 : 0.0015;
    }
    if (atWar) oil *= 2;
    const p = this.plants.get(n.id);
    const base = (c: Commodity) => (n.econ.gdp / 105_000) * COMMODITY_INFO[c].worldUse;
    return { oil, coal: p ? p.coal * 2 * base('coal') : 0, gas: p ? p.gas * 2 * base('gas') : 0 };
  }

  /** Electricity at a glance, for the player. */
  energyStats(n: NationState): EnergyStats {
    const e = n.econ, p = this.plants.get(n.id);
    const fuelShort = Math.min(1, (e.short.coal + e.short.gas) / 2);
    const grid = e.grid ?? e.gdp;
    const plants = e.gdp * (p?.share ?? 0);
    return {
      demand: Math.round(e.gdp), grid: Math.round(grid), plants: Math.round(plants),
      supply: Math.round(grid * (1 - 0.6 * fuelShort) + e.gdp * ((p?.share ?? 0) - (p?.thermal ?? 0) * fuelShort)),
      blackout: Math.round((e.blackout ?? 0) * 1000) / 1000, militaryOil: Math.round((this.extraUse(n).oil ?? 0) * 1000) / 1000,
    };
  }

  /** Research points a technology of this tier costs in this world (Dash: half). */
  techCost(tier: number) { return techCost(tier, this.settings); }

  /** Research points a nation earns per game day: its research spending as a share of GDP, scaled a little by size. */
  researchRate(n: NationState) {
    const share = SPEND_RATE * 0.9 * (n.econ.budget.research / 100);
    const size = Math.min(1.3, Math.max(0.7, 0.8 + 0.1 * Math.log10(Math.max(1, n.econ.gdp) / 10)));
    return share * 1000 * size * (1 + this.effects(n.id).research) * (n.policy.focus === 'research' ? 1.25 : 1);
  }

  private researchView(n: NationState): ResearchPrivate {
    return {
      current: n.tech.current, progress: Math.round(n.tech.current ? n.tech.partial[n.tech.current] ?? 0 : 0),
      rate: Math.round(this.researchRate(n) * 10) / 10, done: [...n.tech.done], queue: [...(n.tech.queue ?? [])], government: n.gov.government,
      reformUntil: n.gov.reformUntil, reformedAt: n.gov.reformedAt, nextElection: n.gov.nextElection, oppositionUntil: n.gov.oppositionUntil,
    };
  }

  manpower(n: NationState) {
    const reservists = n.econ.pop * (0.004 + (0.01 * n.econ.budget.military) / 100) * (1 + this.effects(n.id).manpower);
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
      buildings: Object.fromEntries(this.military.buildings), nuked: this.nuked, embargoes: this.diplomacy.embargoes, roads: this.military.roads,
      unrest: Object.fromEntries([...this.diplomacy.unrest].map(([p, u]) => [p, Math.round(u)])),
      blocs: this.diplomacy.blocs, council: this.diplomacy.council, vassals: Object.fromEntries(this.diplomacy.overlords),
      storms: this.storms.map((s) => ({
        lon: Math.round(s.lon * 10) / 10, lat: Math.round(s.lat * 10) / 10, r: Math.round(s.r),
        kind: s.kind ?? 'storm', cat: s.cat !== undefined ? Math.max(1, Math.round(s.cat)) : undefined, name: s.name,
        vlon: Math.round(s.vlon * 10) / 10, vlat: Math.round(s.vlat * 10) / 10,
      })),
      lanes: this.lanes,
    };
  }

  private countOwnedPop() {
    this.ownedPop.clear();
    for (const p of this.military.provinces.values()) if (p.kind === 'land' && p.owner) this.ownedPop.set(p.owner, (this.ownedPop.get(p.owner) ?? 0) + p.pop);
  }

  private saveState() {
    setMeta(this.db, 'military', JSON.stringify(this.military.serialize()));
    setMeta(this.db, 'diplomacy', JSON.stringify(this.diplomacy.serialize()));
    setMeta(this.db, 'nuked', JSON.stringify(this.nuked));
    setMeta(this.db, 'season', JSON.stringify(this.season));
    setMeta(this.db, 'globe', JSON.stringify(this.globe));
    setMeta(this.db, 'storms', JSON.stringify(this.storms));
    setMeta(this.db, 'migrants', JSON.stringify(Object.fromEntries(this.migrants)));
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
      satellites: n.mil.satellites ?? 0,
      warheads: n.mil.warheads ?? 0, missileReady: (n.mil.lastMissileDay ?? -1) < this.market.day,
      generals: this.military.unitsOf(n.id).filter((u) => u.general).length, maxGenerals: this.maxGenerals(n.id), rally: n.mil.rally,
      equipment: Math.round(n.mil.equipment ?? 0), equipmentRate: Math.round(this.equipmentRate(n) * 10) / 10,
      equipmentNeed: Math.round((n.mil.queue[0] ? UNIT_SPECS[n.mil.queue[0].type].cost * EQUIP_PER_BN / UNIT_SPECS[n.mil.queue[0].type].days : 0) * 10) / 10,
    };
  }

  // ---- views ------------------------------------------------------------------
  publicView(n: NationState): NationPublic {
    const army = Math.round((this.military?.unitsOf(n.id).length ?? 0) / 5) * 5;
    if (n.annexedBy) return { id: n.id, controller: 'ai', focus: n.policy.focus, army: 0, annexedBy: n.annexedBy };
    const pol = {
      government: n.gov?.government, techs: n.tech?.done.length, nuclear: (n.mil?.warheads ?? 0) > 0 || undefined,
      name: n.custom?.name, short: n.custom?.short, color: n.custom?.color, flag: n.custom?.flag, satellites: n.mil?.satellites || undefined,
      ideology: n.soc ? { liberty: Math.round(n.soc.ideology.liberty * 100) / 100, openness: Math.round(n.soc.ideology.openness * 100) / 100 } : undefined,
      parties: n.parties?.map((x) => ({ name: x.name, colour: x.colour, seats: Math.round(x.seats * 1000) / 1000, gov: x.gov, liberty: x.liberty })),
      def: n.born ? { name: n.born.name, short: n.born.short, color: n.born.color, capital: n.born.capital, label: n.born.label } : undefined,
    };
    return n.controller === 'human'
      ? { id: n.id, controller: 'human', player: n.player, online: this.online.has(n.userId!), autopilot: n.autopilot, focus: n.policy.focus, army, ...pol }
      : { id: n.id, controller: 'ai', personality: n.personality, focus: n.policy.focus, army, ...pol };
  }

  privateView(n: NationState): NationPrivate {
    return {
      ...this.publicView(n), tax: n.policy.tax, claimedAt: n.claimedAt,
      econ: { ...privateEcon(n.econ, n.policy.tax, this.market.day, this.energyStats(n)), migration: { refugeesIn: Math.round(this.migrants.get(n.id)?.in ?? 0), refugeesOut: Math.round(this.migrants.get(n.id)?.out ?? 0) } },
      mil: this.milPrivate(n), openBorders: n.policy.openBorders !== false, missions: n.missions,
      society: n.soc ? { ...n.soc, fit: Math.round(this.fit(n) * 10) / 10 } : undefined,
      diplo: { incoming: this.diplomacy.incoming(n.id), outgoing: this.diplomacy.outgoing(n.id) },
      research: this.researchView(n),
      specialties: { own: this.specialties(n.id).own, shared: this.specialties(n.id).shared },
      politics: this.politicsView(n),
      relations: Object.fromEntries([...this.nations.values()].filter((x) => x.id !== n.id && !x.annexedBy).map((x) => [x.id, this.opinion(x.id, n.id)])),
      contracts: this.diplomacy.contractsOf(n.id),
      envoys: (n.envoys ?? []).filter((v) => v.until > this.market.day),
      event: n.event, parties: n.parties, election: n.parties ? n.gov.nextElection : undefined, campaigned: (n.campaign ?? 0) > 0,
      spy: n.spy ? { nets: Object.fromEntries(Object.entries(n.spy.nets).map(([k, v]) => [k, Math.round(v)])), building: n.spy.building, counter: n.spy.counter,
        foreign: Math.round(Math.max(0, ...[...this.nations.values()].map((x) => x.spy?.nets[n.id] ?? 0))) } : { nets: {}, building: [], counter: 0, foreign: Math.round(Math.max(0, ...[...this.nations.values()].map((x) => x.spy?.nets[n.id] ?? 0))) },
      warScores: Object.fromEntries(this.military.enemiesOf(n.id).map((x) => [x, this.warScore(n.id, x)])),
      reparations: [...(n.repay ?? []).map((r) => ({ to: r.to, share: r.share, until: r.until })),
        ...[...this.nations.values()].flatMap((x) => (x.repay ?? []).filter((r) => r.to === n.id).map((r) => ({ to: x.id, share: -r.share, until: r.until })))],
      demil: n.mil.demil && n.mil.demil.until > this.market.day ? n.mil.demil : undefined,
      rate: Math.round(this.interestRate(n) * 1000) / 1000,
      autonomy: n.autonomy,
      pause: this.pauseState(n.id),
      advisers: { areas: n.advisers ?? [], log: (n.adviserLog ?? []).slice(0, 20), available: !!this.opts.singlePlayer },
      reports: (n.reports ?? []).slice(0, 12), spyOps: n.spyOps?.length ?? 0,
    };
  }

  economyUpdate(): EconomyUpdate {
    return {
      market: marketSnapshot(this.market),
      nations: [...this.nations.values()].filter((n) => !n.annexedBy).map((n) => publicEcon(n.id, n.econ)),
      season: this.seasonInfo(),
      world: { warming: Math.round(this.globe.warming * 100) / 100, event: this.globe.event },
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

  recent(userId?: number) {
    return { events: this.recentEvents.slice(-40), chat: this.recentChat.filter((l) => this.canRead(l, userId)).slice(-40) };
  }

  /** Who may read a chat line: everyone for world chat; the two nations for direct; allies of the sender for allies. */
  canRead(line: ChatLine, userId?: number) {
    if (!line.channel || line.channel === 'world') return true;
    const me = userId !== undefined ? this.byUser.get(userId) : undefined;
    if (me === undefined) return false;
    if (me === line.nation) return true;
    if (line.channel === 'direct') return me === line.to;
    return line.nation !== undefined && this.diplomacy.allies(line.nation).includes(me);
  }

  /** Users who should receive a private line right now. */
  audience(line: ChatLine) {
    return [...this.byUser.keys()].filter((u) => this.canRead(line, u));
  }

  /** Recent events about one nation, for its history page. */
  history(nation: number) {
    const name = this.defs.get(nation)?.name;
    if (!name) return [];
    return (this.db.prepare('select at, kind, text from events where nation = ? or text like ? order by id desc limit 80')
      .all(nation, `%${name}%`) as { at: number; kind: string; text: string }[]);
  }

  /** Weekly territory snapshots for replays. */
  replay() {
    return (this.db.prepare('select day, data from snapshots order by day desc limit 520').all() as { day: number; data: string }[])
      .reverse().map((r) => ({ day: r.day, ...JSON.parse(r.data) }));
  }

  /** Weekly GDP, forces and provinces for a few nations. */
  stats(ids: number[]) {
    const pick = ids.slice(0, 6);
    return this.replay().filter((f) => f.g).map((f) => ({
      day: f.day,
      v: Object.fromEntries(pick.map((id) => [id, { g: f.g[id] ?? 0, a: f.a[id] ?? 0, p: f.p[id] ?? 0 }])),
    }));
  }

  seasonInfo(): SeasonInfo {
    const s = this.season;
    const badges = (id: number) => { const n = this.nations.get(id); return n?.controller === 'human' && n.userId ? this.achievements.list(n.userId).length || undefined : undefined; };
    const leaders = Object.entries(s.scores).map(([id, score]) => ({ nation: Number(id), score: Math.round(score), power: Math.round((this.power.get(Number(id)) ?? 0) * 1000) / 10, badges: badges(Number(id)) }))
      .sort((a, b) => b.score - a.score).slice(0, 20);
    const hallOfFame = (this.db.prepare('select number, ended_at, standings from seasons order by number desc limit 10').all() as { number: number; ended_at: number; standings: string }[])
      .map((r) => ({ season: r.number, endedAt: r.ended_at, ...(JSON.parse(r.standings)[0] ?? {}) }));
    return { number: s.number, startedAt: s.startedAt, endsAt: s.endsAt, leaders, history: s.history, hallOfFame };
  }

  /** Daily scores: a weighted share of the world's wealth, people, armed strength and science. */
  private scoreDay() {
    const live = [...this.nations.values()].filter((n) => !n.annexedBy);
    const strength = (n: NationState) => this.military.unitsOf(n.id).reduce((s, u) => s + UNIT_SPECS[u.type].cost * u.strength / 100, 0);
    const str = new Map(live.map((n) => [n.id, strength(n)]));
    const tot = { gdp: 0, pop: 0, mil: 0, tech: 0 };
    for (const n of live) { tot.gdp += n.econ.gdp; tot.pop += n.econ.pop; tot.mil += str.get(n.id)!; tot.tech += n.tech.done.length; }
    let top = 0;
    this.power.clear();
    for (const n of live) {
      const p = 0.4 * n.econ.gdp / tot.gdp + 0.3 * n.econ.pop / tot.pop + 0.2 * str.get(n.id)! / Math.max(1, tot.mil) + 0.1 * n.tech.done.length / Math.max(1, tot.tech);
      this.power.set(n.id, p);
      this.season.scores[n.id] = (this.season.scores[n.id] ?? 0) + p * 100;
      top = Math.max(top, p);
    }
    // domination: a nation holding 40% of world power for 60 game days ends the season early
    this.season.dominance = top >= 0.4 ? this.season.dominance + 1 : 0;
    // every other day: the leaders' scores and their share of world power (which rises and falls)
    if (this.market.day % 2 === 0) {
      const best = Object.entries(this.season.scores).sort((a, b) => b[1] - a[1]).slice(0, 8);
      this.season.history.push({
        d: this.market.day, s: Object.fromEntries(best.map(([id, v]) => [id, Math.round(v)])),
        p: Object.fromEntries(best.map(([id]) => [id, Math.round((this.power.get(Number(id)) ?? 0) * 10000) / 100])),
      });
      // keep the last year in full, older history thinned to fortnightly
      const cut = this.market.day - 365;
      this.season.history = this.season.history.filter((h) => h.d >= cut || h.d % 14 === 0).slice(-500);
    }
    if (this.market.day % 7 === 0) {
      this.db.prepare('insert or replace into snapshots (day, data) values (?, ?)')
        .run(this.market.day, JSON.stringify({
          o: Object.fromEntries(this.diplomacy.owners), x: Object.fromEntries(this.military.occupied),
          // per-nation figures for comparison charts: GDP ($bn), forces (units), provinces held
          g: Object.fromEntries(live.map((n) => [n.id, Math.round(n.econ.gdp)])),
          a: Object.fromEntries(live.map((n) => [n.id, this.military.unitsOf(n.id).length])),
          p: Object.fromEntries(live.map((n) => [n.id, [...this.military.provinces.values()].filter((q) => q.kind === 'land' && this.military.controller(q.id) === n.id).length])),
        }));
    }
  }

  /** Close the season: record the standings in the hall of fame and start a new one. Nations keep going. */
  endSeason(reason: string) {
    const s = this.season;
    const standings = Object.entries(s.scores).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, score]) => {
      const n = this.nations.get(Number(id))!;
      return { nation: n.id, name: this.defs.get(n.id)!.name, player: n.player, score: Math.round(score) };
    });
    this.db.prepare('insert or replace into seasons (number, ended_at, standings) values (?, ?, ?)').run(s.number, Date.now(), JSON.stringify(standings));
    standings.forEach((st, i) => {
      const n = this.nations.get(st.nation);
      if (n?.controller !== 'human' || !n.userId) return;
      this.achievements.award(n.userId, 'top10');
      if (i === 0) this.achievements.award(n.userId, 'champion');
    });
    const w = standings[0];
    if (w) this.event('world', w.nation, `Season ${s.number} ends (${reason}). Victory to the ${w.name}${w.player ? ` led by ${w.player}` : ''} with ${w.score.toLocaleString('en-US')} points.`);
    const length = s.endsAt - s.startedAt;
    this.season = { number: s.number + 1, startedAt: Date.now(), endsAt: Date.now() + length, scores: {}, history: [], dominance: 0 };
    this.saveState();
    this.listener?.economy({ ...this.economyUpdate(), market: marketSnapshot(this.market, 1) });
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
    if (!isOnline) this.pauseVotes.delete(n.id);
    this.checkPause();
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
    if (n.custom) { n.custom = undefined; this.applyCustom(n); } // the nation goes back to its own name and flag
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
          if (next.tax > HIGH_TAX && next.tax > n.policy.tax && this.needsVote(n) && (n.pol?.support ?? 50) < HIGH_TAX_SUPPORT) {
            return fail('not_allowed', `Parliament will not pass taxes above ${HIGH_TAX}% (support ${Math.round(n.pol?.support ?? 0)}%, needs ${HIGH_TAX_SUPPORT}%).`);
          }
        }
        const focusChanged = next.focus !== n.policy.focus;
        n.policy = next;
        if (focusChanged) this.effectCache.delete(n.id);
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
        const needs = UNIT_TECH[order.unit];
        if (needs && !n.tech.done.includes(needs as TechId)) return fail('not_allowed', `Research ${TECH_BY_ID.get(needs as TechId)?.name ?? needs} first.`);
        // the whole price on ordering: from the defence funds first, the rest from the treasury
        const fromFunds = Math.min(Math.max(0, n.mil.funds), spec.cost), rest = spec.cost - fromFunds;
        if (rest > 0 && n.econ.treasury - rest < -n.econ.gdp * 0.3) return fail('no_funds', `A ${spec.name.toLowerCase()} costs $${spec.cost}bn: the defence funds and the treasury cannot cover it.`);
        n.mil.funds -= fromFunds;
        n.econ.treasury -= rest;
        n.mil.queue.push({ type: order.unit, progress: 0, paid: true });
        this.touch(n, false);
        return ok;
      }
      case 'move': {
        const ids = Array.isArray(order.units) ? order.units.slice(0, 200).map(Number) : [];
        const to = Number(order.to);
        if (!ids.length || !this.military.provinces.has(to)) return fail('bad_request', 'Choose units and a land province.');
        const { moved } = this.military.move(n.id, ids, to, this.gameNow());
        if (!moved) return fail('no_route', 'No route there. Units can only enter your own land, allies’ land, and the land of nations you are at war with.');
        this.pushUnits(n);
        return ok;
      }
      case 'mission': {
        const ids = Array.isArray(order.units) ? order.units.slice(0, 200).map(Number) : [];
        const m = order.mission;
        if (m && (!['patrol', 'support', 'bomb'].includes(m.kind) || !this.military.provinces.has(Number(m.target)))) {
          return fail('bad_request', 'Missions are patrol, support or bombing over a province.');
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
        if (this.military.warBetween(n.id, t.id)) return fail('not_allowed', 'A truce holds: wait for it to end, or make peace.');
        const d = this.diplomacy, overlord = d.overlords.get(n.id);
        if (overlord !== undefined && overlord !== t.id) return fail('not_allowed', 'A vassal cannot start wars. Declare independence first (war on your overlord).');
        if (d.overlords.get(t.id) === n.id) return fail('not_allowed', 'That is your vassal. Release it first.');
        if ((n.gov.oppositionUntil ?? -1) > this.market.day) return fail('not_allowed', 'After losing the election, parliament blocks any new war.');
        const justified = this.justified(n.id, t.id);
        if (overlord !== t.id && this.needsVote(n)) {
          const need = justified ? 25 : WAR_SUPPORT;
          if ((n.pol?.support ?? 50) < need) return fail('not_allowed', `Parliament will not back this war (support ${Math.round(n.pol?.support ?? 0)}%, needs ${need}%). Raise its support, win a claim (a demand they refuse), or pass Emergency powers.`);
        }
        const betrayal = this.diplomacy.has('nap', n.id, t.id);
        if (overlord === t.id) {
          d.overlords.delete(n.id);
          this.event('war', n.id, `The ${this.defs.get(n.id)!.name} declares independence from the ${this.defs.get(t.id)!.name}!`);
        } else if (d.allied(n.id, t.id)) return fail('not_allowed', d.has('alliance', n.id, t.id) ? 'You are allies. End the alliance first.' : 'You are in the same bloc. Leave it first.');
        if (actor === 'ai' && t.controller === 'human' && Date.now() - (t.claimedAt ?? 0) < NEWCOMER_PROTECTION_MS) {
          return fail('not_allowed', 'That leader is new and protected.');
        }
        this.military.declareWar(n.id, t.id, this.market.day);
        const goal = order.goal && WAR_GOALS[order.goal] ? order.goal : undefined;
        if (goal) this.military.warBetween(n.id, t.id)!.goal = goal;
        this.diplomacy.withdraw(n.id, t.id);
        this.diplomacy.withdraw(t.id, n.id);
        this.diplomacy.sever(n.id, t.id);
        this.event('war', n.id, betrayal
          ? `The ${this.defs.get(n.id)!.name} breaks its non-aggression pact and declares war on the ${this.defs.get(t.id)!.name}!`
          : `The ${this.defs.get(n.id)!.name} declares war on the ${this.defs.get(t.id)!.name}${justified ? ', pressing its claim' : ''}${goal ? ` (war goal: ${WAR_GOALS[goal].name.toLowerCase()})` : ''}.`);
        // the world remembers: the victim most, everyone a little, betrayal and unprovoked wars most of all
        this.remember(t.id, n.id, betrayal ? -100 : -60);
        for (const x of this.nations.values()) if (x.id !== n.id && x.id !== t.id && !x.annexedBy) this.remember(x.id, n.id, betrayal ? -25 : justified ? -3 : -10);
        if (n.pol) n.pol.claims = n.pol.claims.filter((c) => c !== t.id);
        // the aggressor's vassals follow it to war
        for (const v of this.diplomacy.vassalsOf(n.id)) {
          if (v === t.id || this.military.atWar(v, t.id) || this.diplomacy.allied(v, t.id)) continue;
          this.military.declareWar(v, t.id, this.market.day);
        }
        // defensive alliances, blocs and overlords: the target's allies join against the aggressor (no further chain)
        for (const ally of this.diplomacy.allies(t.id)) {
          if (ally === n.id || this.diplomacy.allied(ally, n.id) || this.military.atWar(ally, n.id)) continue;
          this.military.declareWar(ally, n.id, this.market.day);
          this.diplomacy.cancel('trade', ally, n.id);
          this.event('war', ally, `The ${this.defs.get(ally)!.name} honours its alliance and enters the war against the ${this.defs.get(n.id)!.name}.`);
          const a = this.nations.get(ally)!;
          a.nextThink = Math.min(a.nextThink, this.gameNow());
          this.touch(a, false);
          this.pushUnits(a);
        }
        // guarantors keep their word
        for (const g of this.diplomacy.guarantorsOf(t.id)) {
          if (g === n.id || this.diplomacy.allied(g, n.id) || this.military.atWar(g, n.id) || this.nations.get(g)?.annexedBy) continue;
          this.military.declareWar(g, n.id, this.market.day);
          this.diplomacy.sever(g, n.id);
          this.event('war', g, `The ${this.defs.get(g)!.name} stands by its guarantee of the ${this.defs.get(t.id)!.name} and declares war on the ${this.defs.get(n.id)!.name}.`);
          const a = this.nations.get(g)!;
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
        // a gift needs no answer
        if (deal.kind === 'gift') { this.conclude(n, t, deal); return ok; }
        // proposing exactly what they already offered us is accepting it
        const theirs = this.diplomacy.pending(t.id, n.id, deal.kind);
        if (theirs && JSON.stringify(theirs.deal) === JSON.stringify(deal)) {
          this.diplomacy.withdraw(t.id, n.id, deal.kind);
          this.conclude(t, n, deal);
          return ok;
        }
        if (t.controller === 'ai' || t.autopilot) {
          // AI governments answer at once
          if (!this.brain.answer(t, n.id, deal)) {
            if (deal.kind === 'demand') { this.refused(n, t); return fail('not_allowed', `The ${this.defs.get(t.id)!.short} refuses. You now hold a claim on them: a war on them is justified.`); }
            return fail('not_allowed', `The ${this.defs.get(t.id)!.short} declines the ${dealText(deal)}.`);
          }
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
          if (p.deal.kind === 'demand') this.refused(from, n);
          this.event('diplomacy', n.id, `The ${this.defs.get(n.id)!.name} rejects the ${dealText(p.deal)} offered by the ${this.defs.get(from.id)!.name}.`);
          this.touch(from, false);
          this.touch(n, false);
        }
        return ok;
      }
      case 'research': {
        const t = TECH_BY_ID.get(order.tech);
        if (!t) return fail('bad_request', 'Unknown technology.');
        if (n.tech.done.includes(t.id)) return fail('not_allowed', 'Already researched.');
        const pre = missing(t, new Set(n.tech.done));
        if (pre) return fail('not_allowed', `Research ${pre.name} first.`);
        n.tech.current = t.id; // progress on any other tech is kept for later
        n.tech.queue = (n.tech.queue ?? []).filter((q) => q !== t.id);
        this.touch(n, false);
        return ok;
      }
      case 'research_queue': {
        const t = TECH_BY_ID.get(order.tech);
        if (!t) return fail('bad_request', 'Unknown technology.');
        const queue = n.tech.queue ?? [];
        if (order.remove) {
          // anything later in the queue that needed it goes too
          const gone = new Set([t.id]);
          n.tech.queue = queue.filter((q) => { const x = TECH_BY_ID.get(q); if (gone.has(q) || !x || x.needs.some((id) => gone.has(id))) { gone.add(q); return false; } return true; });
          this.touch(n, false);
          return ok;
        }
        if (n.tech.done.includes(t.id) || n.tech.current === t.id || queue.includes(t.id)) return fail('not_allowed', 'Already researched or lined up.');
        if (queue.length >= MAX_RESEARCH_QUEUE) return fail('not_allowed', `The queue holds ${MAX_RESEARCH_QUEUE} technologies.`);
        const known = new Set(n.tech.done), lined = new Set([...n.tech.done, ...queue, ...(n.tech.current ? [n.tech.current] : [])]);
        const pre = missing(t, lined);
        if (pre) return fail('not_allowed', `Line up ${pre.name} first.`);
        if (!n.tech.current && ready(t, known)) n.tech.current = t.id; // nothing under way: start at once
        else n.tech.queue = [...queue, t.id];
        this.touch(n, false);
        return ok;
      }
      case 'government': {
        const g = order.government;
        if (!GOVERNMENTS.includes(g)) return fail('bad_request', 'Unknown government.');
        if (g === n.gov.government) return fail('not_allowed', 'That is already your government.');
        if (n.gov.reformUntil !== undefined) return fail('not_allowed', 'A reform is already under way.');
        const day = this.market.day;
        if (n.gov.reformedAt !== undefined && day - n.gov.reformedAt < REFORM_COOLDOWN_DAYS) {
          return fail('not_allowed', `The country needs time: the next reform is possible in ${REFORM_COOLDOWN_DAYS - (day - n.gov.reformedAt)} game days.`);
        }
        n.gov = { government: g, reformUntil: day + REFORM_DAYS, reformedAt: day };
        this.effectCache.delete(n.id);
        this.event('politics', n.id, `The ${this.defs.get(n.id)!.name} begins a transition to ${GOVERNMENT_INFO[g].name.toLowerCase()}.`);
        this.touch(n);
        return ok;
      }
      case 'build': {
        const p = this.military.provinces.get(Number(order.province)), spec = BUILDINGS[order.building as BuildingType];
        if (!p || !spec || !BUILDING_TYPES.includes(order.building)) return fail('bad_request', 'Unknown building or province.');
        if (p.owner !== n.id || this.military.controller(p.id) !== n.id) return fail('not_allowed', 'You can only build in provinces you own and hold.');
        const here = this.military.buildings.get(p.id) ?? [];
        if (here.some((b) => b.type === order.building)) return fail('not_allowed', `There is already a ${spec.name.toLowerCase()} here.`);
        if (spec.coastal && !p.adj.some((q) => this.military.provinces.get(q)?.kind === 'sea')) return fail('not_allowed', 'A port needs a coast.');
        const busy = [...this.military.buildings].filter(([q, list]) => this.military.provinces.get(q)?.owner === n.id && list.some((b) => b.progress < 1)).length;
        if (busy >= MAX_CONSTRUCTION) return fail('not_allowed', `At most ${MAX_CONSTRUCTION} projects at a time.`);
        // uranium (ours or a trade partner's) makes nuclear power much cheaper
        const cost = order.building === 'nuclear_plant' && this.hasAccess(n.id, 'uranium') ? spec.cost * 0.6
          : order.building === 'renewables' && this.hasLaw(n, 'green_energy') ? spec.cost * 0.5 : spec.cost;
        if (n.econ.treasury < cost - n.econ.gdp * 0.3) return fail('no_funds', 'The treasury cannot borrow any more.');
        n.econ.treasury -= cost;
        this.military.buildings.set(p.id, [...here, { type: order.building, progress: 0 }]);
        if (actor === 'human') this.warChanged(); else this.warDirty = true; // AI projects go out with the daily update
        this.touch(n, false);
        return ok;
      }
      case 'road': {
        // a road dragged across our own provinces: each stretch joins neighbours
        const path = Array.isArray(order.path) ? order.path.map(Number) : [];
        const pts = Array.isArray(order.pts) ? order.pts.filter((q) => Array.isArray(q) && q.length === 2 && q.every((v) => Number.isFinite(v) && Math.abs(v) <= 360))
          .map((q) => [Math.round(q[0] * 1e4) / 1e4, Math.round(q[1] * 1e4) / 1e4] as [number, number]) : [];
        const legs = path.length - 1;
        if (legs < 1 || legs > ROAD.maxLegs || pts.length < 2 || pts.length > ROAD.maxPts) return fail('bad_request', `A road joins 2 to ${ROAD.maxLegs + 1} provinces.`);
        for (let i = 0; i < path.length; i++) {
          const p = this.military.provinces.get(path[i]);
          if (!p || p.kind !== 'land' || p.owner !== n.id || this.military.controller(p.id) !== n.id) return fail('not_allowed', 'Roads can only cross provinces you own and hold.');
          if (i > 0 && !p.adj.includes(path[i - 1])) return fail('bad_request', 'Each stretch of road must join neighbouring provinces.');
          if (path.indexOf(path[i]) !== i) return fail('bad_request', 'A road cannot cross the same province twice.');
        }
        if (path.slice(1).every((q, i) => this.military.hasRoad(path[i], q))) return fail('not_allowed', 'There is already a road there.');
        const building = this.military.roads.filter((r) => r.owner === n.id && r.progress < 1).length;
        if (building >= ROAD.maxProjects) return fail('not_allowed', `At most ${ROAD.maxProjects} roads under construction at a time.`);
        const cost = roadCost(legs);
        if (n.econ.treasury < cost - n.econ.gdp * 0.3) return fail('no_funds', 'The treasury cannot borrow any more.');
        n.econ.treasury -= cost;
        this.military.roads.push({ id: this.military.nextRoad++, owner: n.id, path, pts, progress: 0 });
        if (actor === 'human') this.warChanged(); else this.warDirty = true;
        this.touch(n, false);
        return ok;
      }
      case 'repair': {
        const p = this.military.provinces.get(Number(order.province)), spec = BUILDINGS[order.building as BuildingType];
        const b = p && (this.military.buildings.get(p.id) ?? []).find((x) => x.type === order.building);
        if (!p || !spec || !b) return fail('bad_request', 'No such building.');
        if (p.owner !== n.id || this.military.controller(p.id) !== n.id) return fail('not_allowed', 'You can only repair in provinces you own and hold.');
        if (!b.damaged) return fail('not_allowed', 'It is not damaged.');
        if (b.repair !== undefined) return fail('not_allowed', 'Repairs are already under way.');
        const cost = spec.cost * REPAIR_COST_SHARE;
        if (n.econ.treasury < cost - n.econ.gdp * 0.3) return fail('no_funds', 'The treasury cannot borrow any more.');
        n.econ.treasury -= cost;
        b.repair = 0;
        this.warChanged();
        this.touch(n, false);
        return ok;
      }
      case 'general': {
        const u = this.military.units.get(Number(order.unit));
        if (!u || u.nation !== n.id || UNIT_SPECS[u.type].domain !== 'land') return fail('bad_request', 'Generals command land units.');
        if (u.general) return fail('not_allowed', 'That unit already has a general.');
        if (this.military.unitsOf(n.id).filter((x) => x.general).length >= this.maxGenerals(n.id)) {
          return fail('not_allowed', `One general per ${UNITS_PER_GENERAL} land units.`);
        }
        if (n.mil.funds < GENERAL_COST) return fail('no_funds', 'Not enough military funds.');
        n.mil.funds -= GENERAL_COST;
        u.general = { name: generalName(this.rand), skill: 1, xp: 0 };
        this.pushUnits(n);
        this.touch(n, false);
        return ok;
      }
      case 'missile': {
        if (!n.tech.done.includes('hypersonics')) return fail('not_allowed', 'Research Hypersonic missiles first.');
        const p = Number(order.province), target = this.military.controller(p);
        if (!this.military.atWar(n.id, target)) return fail('not_allowed', 'You can only strike nations you are at war with.');
        if ((n.mil.lastMissileDay ?? -1) >= this.market.day) return fail('not_allowed', 'One missile salvo per game day.');
        if (n.mil.funds < MISSILE_COST) return fail('no_funds', 'Not enough military funds.');
        if (!this.inStrikeRange(n.id, p)) return fail('no_route', `Out of range: missiles reach ${MISSILE_RANGE.toLocaleString('en-US')} km from your territory.`);
        n.mil.funds -= MISSILE_COST;
        n.mil.lastMissileDay = this.market.day;
        const where = this.military.provinces.get(p)?.name ?? `province ${p}`;
        if (this.shielded(target!, p) ? this.rand() < 0.8 : this.military.built(p, 'air_defense') && this.rand() < 0.5) {
          this.event('war', n.id, `Air defenses in ${where} intercept a ${this.defs.get(n.id)!.short} missile salvo.`);
        } else {
          for (const u of this.military.unitsIn(p)) {
            if (u.nation !== target) continue;
            u.strength -= MISSILE_DAMAGE;
            if (u.strength < 5) this.military.units.delete(u.id);
          }
          const hit = this.rand() < 0.3 ? this.military.destroyBuilding(p) : undefined;
          this.event('war', n.id, `${this.defs.get(n.id)!.short} missiles strike ${where}${hit ? `, destroying the ${BUILDINGS[hit].name.toLowerCase()}` : ''}.`);
          this.warChanged();
        }
        this.touch(n, false);
        for (const x of [n, this.nations.get(target!)]) if (x) this.pushUnits(x);
        return ok;
      }
      case 'warhead': {
        if (!n.tech.done.includes('nuclear')) return fail('not_allowed', 'Research Nuclear deterrent first.');
        if (!this.hasAccess(n.id, 'uranium')) return fail('not_allowed', 'Warheads need uranium: hold a uranium province, or sign a trade agreement with a nation that does.');
        if (n.mil.funds < WARHEAD_COST) return fail('no_funds', `A warhead costs ${WARHEAD_COST} bn of military funds.`);
        n.mil.funds -= WARHEAD_COST;
        n.mil.warheads = (n.mil.warheads ?? 0) + 1;
        if (n.mil.warheads === 1) this.event('politics', n.id, `The ${this.defs.get(n.id)!.name} has become a nuclear power.`);
        this.touch(n, false);
        return ok;
      }
      case 'nuke': {
        const p = Number(order.province), target = this.military.controller(p);
        if (!(n.mil.warheads ?? 0)) return fail('not_allowed', 'You have no nuclear warheads.');
        if (!this.military.provinces.has(p) || !this.military.atWar(n.id, target)) return fail('not_allowed', 'You can only strike nations you are at war with.');
        if (this.shielded(target!, p) && this.rand() < 0.4) {
          n.mil.warheads = Math.max(0, (n.mil.warheads ?? 1) - 1);
          this.event('war', n.id, `Missile defenses shoot down a ${this.defs.get(n.id)!.short} nuclear missile over ${this.military.provinces.get(p)?.name ?? 'the target'}. The world holds its breath.`);
          for (const kind of ['alliance', 'trade'] as const) for (const x of this.diplomacy.partners(kind, n.id)) this.diplomacy.cancel(kind, n.id, x);
          this.warChanged();
          this.touch(n);
          return ok;
        }
        this.nuke(n, p);
        return ok;
      }
      case 'bloc_create': {
        const name = String(order.name ?? '').replace(/[^\p{L}\p{N} '\-&.]/gu, '').trim().slice(0, 32);
        if (name.length < 3) return fail('bad_request', 'Give the bloc a name of at least 3 letters.');
        if (this.diplomacy.blocOf(n.id)) return fail('not_allowed', 'You are already in a bloc. Leave it first.');
        if (this.diplomacy.blocs.some((b) => b.name.toLowerCase() === name.toLowerCase())) return fail('not_allowed', 'That name is taken.');
        this.diplomacy.blocs.push({ id: this.diplomacy.nextId++, name, leader: n.id, members: [n.id], since: this.market.day });
        this.event('diplomacy', n.id, `The ${this.defs.get(n.id)!.name} founds a new bloc: ${name}.`);
        this.warChanged();
        this.touch(n, false);
        return ok;
      }
      case 'bloc_leave': {
        const b = this.diplomacy.leaveBloc(n.id);
        if (!b) return fail('not_allowed', 'You are not in a bloc.');
        this.event('diplomacy', n.id, `The ${this.defs.get(n.id)!.name} leaves ${b.name}.`);
        this.warChanged();
        this.touch(n, false);
        return ok;
      }
      case 'resolution': {
        const kind = order.resolution as ResolutionKind, t = this.nations.get(Number(order.target));
        const t2 = order.target2 !== undefined ? this.nations.get(Number(order.target2)) : undefined;
        if (!['sanction', 'condemn', 'ceasefire'].includes(kind) || !t || t.annexedBy) return fail('bad_request', 'Choose a resolution and a nation.');
        if (kind === 'ceasefire' && (!t2 || !this.military.atWar(t.id, t2.id))) return fail('bad_request', 'A ceasefire needs two nations at war.');
        const open = this.diplomacy.council.filter((r) => !r.result);
        if (open.length >= MAX_OPEN_RESOLUTIONS) return fail('not_allowed', 'The council agenda is full. Wait for a vote to close.');
        if (open.some((r) => r.by === n.id)) return fail('not_allowed', 'You already have a resolution before the council.');
        const r = { id: this.diplomacy.nextId++, kind, target: t.id, target2: t2?.id, by: n.id, day: this.market.day, yes: [n.id], no: [] as number[] };
        this.diplomacy.council.push(r);
        // AI governments cast their votes at once; players have 7 game days
        for (const x of this.nations.values()) {
          if (x.id === n.id || x.annexedBy || !(x.controller === 'ai' || x.autopilot)) continue;
          const v = this.brain.vote(x, r);
          if (v !== undefined) (v ? r.yes : r.no).push(x.id);
        }
        this.event('diplomacy', n.id, `World council: the ${this.defs.get(n.id)!.short} tables ${RESOLUTION_TEXT[kind]} the ${this.defs.get(t.id)!.name}${t2 ? ` and the ${this.defs.get(t2.id)!.name}` : ''}. Voting closes in ${VOTE_DAYS} days.`);
        this.warChanged();
        return ok;
      }
      case 'vote': {
        const r = this.diplomacy.council.find((x) => x.id === Number(order.id) && !x.result);
        if (!r) return fail('not_found', 'That vote has closed.');
        r.yes = r.yes.filter((x) => x !== n.id);
        r.no = r.no.filter((x) => x !== n.id);
        (order.yes ? r.yes : r.no).push(n.id);
        this.warChanged();
        return ok;
      }
      case 'spy': {
        const t = this.nations.get(Number(order.target)), mission = order.mission as SpyMission;
        if (!t || t.id === n.id || t.annexedBy || !SPY_MISSIONS[mission]) return fail('bad_request', 'Choose a nation and a mission.');
        if (mission.startsWith('cyber') && !n.tech.done.includes('digital_state')) return fail('not_allowed', 'Cyber operations need Digital government research.');
        const net = n.spy?.nets[t.id] ?? 0;
        if (net < SPY_MISSIONS[mission].need) return fail('not_allowed', `Needs an agent network of ${SPY_MISSIONS[mission].need} there (yours: ${Math.floor(net)}). Build one in Espionage.`);
        n.spyOps ??= [];
        if (n.spyOps.length >= MAX_SPY_OPS) return fail('not_allowed', `At most ${MAX_SPY_OPS} operations at a time.`);
        if (n.mil.funds < SPY_COST) return fail('no_funds', 'Not enough military funds.');
        n.mil.funds -= SPY_COST;
        n.spyOps.push({ target: t.id, mission, day: this.market.day });
        this.touch(n, false);
        return ok;
      }
      case 'satellite': {
        if (!n.tech.done.includes('orbital_recon')) return fail('not_allowed', 'Research Orbital reconnaissance first.');
        if (n.mil.funds < SATELLITE_COST) return fail('no_funds', `A launch costs ${SATELLITE_COST} bn of military funds.`);
        n.mil.funds -= SATELLITE_COST;
        n.mil.satellites = (n.mil.satellites ?? 0) + 1;
        this.event('war', n.id, `The ${this.defs.get(n.id)!.name} launches a reconnaissance satellite.`);
        this.touch(n);
        for (const x of [n]) this.pushUnits(x);
        return ok;
      }
      case 'asat': {
        const t = this.nations.get(Number(order.target));
        if (!t || !this.military.atWar(n.id, t.id)) return fail('not_allowed', 'Only satellites of a nation you are at war with.');
        if (!n.tech.done.includes('hypersonics')) return fail('not_allowed', 'Research Hypersonic missiles first.');
        if (!(t.mil.satellites ?? 0)) return fail('not_allowed', 'They have no satellites.');
        if (n.mil.funds < ASAT_COST) return fail('no_funds', 'Not enough military funds.');
        n.mil.funds -= ASAT_COST;
        t.mil.satellites = (t.mil.satellites ?? 1) - 1;
        this.event('war', n.id, `A ${this.defs.get(n.id)!.short} missile destroys a ${this.defs.get(t.id)!.short} satellite in orbit.`);
        this.touch(n); this.touch(t); this.pushUnits(t);
        return ok;
      }
      case 'propaganda': {
        const mode = order.mode;
        if (!['off', 'home', 'abroad'].includes(mode)) return fail('bad_request', 'Unknown campaign.');
        const t = order.target !== undefined ? this.nations.get(Number(order.target)) : undefined;
        if (mode === 'abroad' && (!t || t.id === n.id || t.annexedBy)) return fail('bad_request', 'Choose a nation to target.');
        n.soc ??= this.initialSociety(n);
        n.soc.propaganda = { mode, target: mode === 'abroad' ? t!.id : undefined };
        this.effectCache.delete(n.id);
        this.touch(n, false);
        return ok;
      }
      case 'borders': {
        n.policy.openBorders = !!order.open;
        this.touch(n);
        return ok;
      }
      case 'customize': {
        if (actor !== 'human') return fail('not_allowed', 'Only players customise nations.');
        const c = { ...(n.custom ?? {}) };
        const clean = (s: unknown, max: number) => String(s ?? '').replace(/[^\p{L}\p{N} '\-.&]/gu, '').replace(/\s+/g, ' ').trim().slice(0, max);
        if (order.name !== undefined || order.short !== undefined) {
          const name = clean(order.name ?? c.name ?? this.defs.get(n.id)!.name, 40);
          const short = clean(order.short ?? c.short ?? this.defs.get(n.id)!.short, 16);
          if (name.length < 3 || short.length < 2) return fail('bad_request', 'Names need at least 3 letters, short names 2.');
          const taken = [...this.defs.values()].some((d) => d.id !== n.id && (d.name.toLowerCase() === name.toLowerCase() || d.short.toLowerCase() === short.toLowerCase()));
          if (taken) return fail('not_allowed', 'Another nation already uses that name.');
          const changing = name !== this.defs.get(n.id)!.name || short !== this.defs.get(n.id)!.short;
          if (changing) {
            if (c.renamedAt && Date.now() - c.renamedAt < 86_400_000) return fail('not_allowed', 'A nation can be renamed once a day.');
            const old = this.defs.get(n.id)!.name;
            Object.assign(c, { name, short, renamedAt: Date.now() });
            n.custom = c;
            this.applyCustom(n);
            this.event('politics', n.id, `The ${old} is now known as the ${name}.`);
          }
        }
        if (order.color !== undefined) {
          if (!isColor(order.color)) return fail('bad_request', 'Choose a colour.');
          c.color = order.color.toLowerCase();
        }
        if (order.flag !== undefined) {
          const f = cleanFlag(order.flag);
          if (!f) return fail('bad_request', 'That flag is not valid.');
          if (EARNED_EMBLEMS.includes(f.emblem)) {
            const mine = n.userId ? this.achievements.list(n.userId) : [];
            const earned = (Object.entries(ACHIEVEMENTS) as [AchievementKey, { emblem?: string }][]).some(([k, a]) => a.emblem === f.emblem && mine.includes(k));
            if (!earned) return fail('not_allowed', 'That emblem is earned through an achievement.');
          }
          c.flag = f;
        }
        n.custom = c;
        this.touch(n);
        return ok;
      }
      case 'rally': {
        if (order.province === null) { n.mil.rally = undefined; this.touch(n, false); return ok; }
        const p = this.military.provinces.get(Number(order.province));
        if (!p || p.kind !== 'land' || this.military.controller(p.id) !== n.id) return fail('not_allowed', 'Rally points must be in land you hold.');
        n.mil.rally = p.id;
        this.touch(n, false);
        return ok;
      }
      case 'release': {
        const t = this.nations.get(Number(order.target));
        if (!t || this.diplomacy.overlords.get(t.id) !== n.id) return fail('not_allowed', 'That nation is not your vassal.');
        this.diplomacy.overlords.delete(t.id);
        this.event('diplomacy', n.id, `The ${this.defs.get(n.id)!.name} grants the ${this.defs.get(t.id)!.name} full independence.`);
        this.warChanged();
        this.touch(t, false);
        this.touch(n, false);
        return ok;
      }
      case 'embargo': {
        const t = this.nations.get(Number(order.target));
        if (!t || t.id === n.id || t.annexedBy) return fail('bad_request', 'Choose another nation.');
        const d = this.diplomacy, has = d.embargoed(n.id, t.id);
        if (order.on === has) return fail('not_allowed', has ? 'You already embargo them.' : 'There is no embargo to lift.');
        if (order.on) {
          d.embargoes.push({ from: n.id, to: t.id });
          d.cancel('trade', n.id, t.id);
          this.event('diplomacy', n.id, `The ${this.defs.get(n.id)!.name} imposes a trade embargo on the ${this.defs.get(t.id)!.name}.`);
        } else {
          d.embargoes = d.embargoes.filter((e) => !(e.from === n.id && e.to === t.id));
          this.event('diplomacy', n.id, `The ${this.defs.get(n.id)!.name} lifts its embargo on the ${this.defs.get(t.id)!.name}.`);
        }
        this.warChanged();
        this.touch(t, false);
        this.touch(n, false);
        return ok;
      }
      case 'cancel': {
        const t = this.nations.get(Number(order.target));
        if (!t || !PACTS.includes(order.pact)) return fail('bad_request', 'Unknown treaty.');
        if (!this.diplomacy.cancel(order.pact, n.id, t.id)) return fail('not_found', 'There is no such treaty.');
        this.remember(t.id, n.id, order.pact === 'nap' || order.pact === 'guarantee' || order.pact === 'alliance' ? -20 : -8);
        this.event('diplomacy', n.id, `The ${this.defs.get(n.id)!.name} ends its ${PACT_INFO[order.pact].name.toLowerCase()} with the ${this.defs.get(t.id)!.name}.`);
        this.warChanged();
        this.touch(t, false);
        this.touch(n, false);
        return ok;
      }
      case 'law': {
        if (!LAW_IDS.includes(order.law)) return fail('bad_request', 'Unknown law.');
        return this.passLaw(n, order.law, !!order.enact);
      }
      case 'dismiss_demand': {
        const pol = n.pol, dem = pol?.demand;
        if (!pol || !dem) return fail('not_found', 'Nobody is asking anything of you.');
        this.demandOutcome(n, false, true);
        this.touch(n, false);
        return ok;
      }
      case 'denounce': {
        const t = this.nations.get(Number(order.target));
        if (!t || t.id === n.id || t.annexedBy) return fail('bad_request', 'Choose another nation.');
        if (this.diplomacy.allied(n.id, t.id)) return fail('not_allowed', 'You cannot denounce an ally.');
        this.remember(t.id, n.id, -30);
        for (const e of this.military.enemiesOf(t.id)) this.remember(e, n.id, 10);
        for (const a of this.diplomacy.allies(t.id)) this.remember(a, n.id, -10);
        if (n.pol) n.pol.capital = Math.min(MAX_CAPITAL, n.pol.capital + 5); // rallying the home front
        this.event('diplomacy', n.id, `The ${this.defs.get(n.id)!.name} publicly denounces the ${this.defs.get(t.id)!.name}.`);
        this.touch(t, false);
        this.touch(n, false);
        return ok;
      }
      case 'envoy': {
        const t = this.nations.get(Number(order.target));
        if (!t || t.id === n.id || t.annexedBy) return fail('bad_request', 'Choose another nation.');
        if (this.military.atWar(n.id, t.id)) return fail('not_allowed', 'Not while at war with them.');
        const active = (n.envoys ?? []).filter((v) => v.until > this.market.day);
        if (active.some((v) => v.target === t.id)) return fail('not_allowed', 'An envoy is already there.');
        if (active.length >= MAX_ENVOYS) return fail('not_allowed', `All ${MAX_ENVOYS} envoys are abroad.`);
        if (n.econ.treasury < ENVOY_COST) return fail('no_funds', `An embassy costs $${ENVOY_COST}bn.`);
        n.econ.treasury -= ENVOY_COST;
        n.envoys = [...active, { target: t.id, until: this.market.day + ENVOY_DAYS }];
        this.touch(n, false);
        return ok;
      }
      case 'end_contract': {
        const c = this.diplomacy.contracts.find((x) => x.id === Number(order.id) && (x.seller === n.id || x.buyer === n.id));
        if (!c) return fail('not_found', 'No such contract.');
        this.diplomacy.contracts = this.diplomacy.contracts.filter((x) => x !== c);
        const other = c.seller === n.id ? c.buyer : c.seller;
        this.remember(other, n.id, -15);
        this.event('diplomacy', n.id, `The ${this.defs.get(n.id)!.name} breaks off a supply contract with the ${this.defs.get(other)!.name}.`);
        const o = this.nations.get(other);
        if (o) this.touch(o, false);
        this.touch(n, false);
        return ok;
      }
      case 'pause_vote': {
        if (actor !== 'human') return fail('not_allowed', 'Only players vote.');
        if (order.on) this.pauseVotes.add(n.id); else this.pauseVotes.delete(n.id);
        this.checkPause();
        this.touch(n, false);
        return ok;
      }
      case 'advisers': {
        if (!this.opts.singlePlayer) return fail('not_allowed', 'Advisers help only in single player; in shared worlds they take over while you are away.');
        n.advisers = (Array.isArray(order.areas) ? order.areas : []).filter((a) => ADVISER_AREAS.some(([k]) => k === a));
        this.touch(n, false);
        return ok;
      }
      case 'appeal': {
        const pol = n.pol!;
        if (pol.capital < 50) return fail('no_funds', 'A national appeal needs 50 political capital.');
        pol.capital -= 50;
        n.econ.stability = Math.min(100, n.econ.stability + 6);
        pol.goodwill += 5;
        if (n.controller === 'human') this.event('politics', n.id, `${this.defs.get(n.id)!.name}: the leader addresses the nation (+6 stability).`);
        this.touch(n, false);
        return ok;
      }
      case 'choose': {
        const ev = n.event;
        if (!ev || ev.key !== order.event) return fail('not_found', 'That decision has already been made.');
        const opts = EVENTS[ev.key].options;
        const i = Math.floor(Number(order.option));
        if (!(i >= 0 && i < opts.length)) return fail('bad_request', 'Choose one of the options.');
        this.resolveEvent(n, i);
        return ok;
      }
      case 'campaign': {
        const pol = n.pol!, day = this.market.day;
        if (this.legislature(n) !== 'parliament' || !n.parties) return fail('not_allowed', 'Only parliaments hold elections.');
        if ((n.gov.nextElection ?? Infinity) - day > CAMPAIGN_DAYS) return fail('not_allowed', `Campaigns open ${CAMPAIGN_DAYS} days before the election.`);
        if ((n.campaign ?? 0) >= 0.12) return fail('not_allowed', 'The campaign is already at full stretch.');
        if (pol.capital < CAMPAIGN_COST) return fail('no_funds', `A campaign push needs ${CAMPAIGN_COST} political capital.`);
        pol.capital -= CAMPAIGN_COST;
        n.econ.treasury -= n.econ.gdp * 0.0005;
        n.campaign = (n.campaign ?? 0) + 0.04;
        this.pollDay(n);
        this.touch(n, false);
        return ok;
      }
      case 'coalition': {
        const pol = n.pol!, party = n.parties?.find((x) => x.name === order.party);
        if (!party) return fail('not_found', 'No such party.');
        if (order.join === party.gov) return fail('not_allowed', party.gov ? 'They are already in government.' : 'They are not in government.');
        if (order.join) {
          if (pol.capital < COALITION_COST) return fail('no_funds', `Bringing a party into government needs ${COALITION_COST} political capital.`);
          const ours = n.parties!.filter((x) => x.gov);
          const gap = ours.length ? Math.min(...ours.map((x) => Math.abs(x.liberty - party.liberty) + Math.abs(x.openness - party.openness))) : 0;
          if (gap > 1.6) return fail('not_allowed', `The ${party.name} will not sit with your government: too far apart.`);
          pol.capital -= COALITION_COST;
        } else if (n.parties!.filter((x) => x.gov).length <= 1) return fail('not_allowed', 'The government needs at least one party.');
        party.gov = order.join;
        this.event('politics', n.id, `${this.defs.get(n.id)!.name}: the ${party.name} ${order.join ? 'joins' : 'leaves'} the government.`);
        this.touch(n, false);
        return ok;
      }
      case 'autonomy': {
        const p = Number(order.province), prov = this.military.provinces.get(p);
        if (!prov || prov.owner !== n.id) return fail('not_allowed', 'Only your own provinces.');
        if (n.autonomy?.includes(p)) return fail('not_allowed', 'It already governs itself.');
        if ((n.pol?.capital ?? 0) < AUTONOMY_COST) return fail('no_funds', `Autonomy needs ${AUTONOMY_COST} political capital.`);
        n.pol!.capital -= AUTONOMY_COST;
        n.autonomy = [...(n.autonomy ?? []), p];
        const u = this.diplomacy.unrest.get(p);
        if (u !== undefined) this.diplomacy.unrest.set(p, u * 0.5);
        this.event('politics', n.id, `${this.defs.get(n.id)!.name} grants ${prov.name ?? 'a province'} self-government.`);
        this.touch(n, false);
        return ok;
      }
      case 'network': {
        const t = this.nations.get(Number(order.target));
        if (!t || t.id === n.id || t.annexedBy) return fail('bad_request', 'Choose another nation.');
        const spy = n.spy ??= { nets: {}, building: [], counter: 0 };
        if (order.build) {
          if (spy.building.includes(t.id)) return fail('not_allowed', 'Agents are already being recruited there.');
          if (spy.building.length >= MAX_NETWORKS) return fail('not_allowed', `At most ${MAX_NETWORKS} networks can be built up at once.`);
          spy.building.push(t.id);
        } else spy.building = spy.building.filter((x) => x !== t.id);
        this.touch(n, false);
        return ok;
      }
      case 'counter_intel': {
        const lvl = Math.max(0, Math.min(3, Math.round(Number(order.level) || 0)));
        (n.spy ??= { nets: {}, building: [], counter: 0 }).counter = lvl;
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

  chat(user: User, text: string, channel: ChatChannel = 'world', to?: number): Result {
    const clean = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, LIMITS.chatLength);
    if (!clean) return fail('bad_request', 'Empty message.');
    const nation = this.byUser.get(user.id);
    if (!['world', 'allies', 'direct'].includes(channel)) return fail('bad_request', 'Unknown channel.');
    if (channel !== 'world' && !nation) return fail('not_ruling', 'Lead a nation to use private channels.');
    if (channel === 'direct' && (!this.nations.has(Number(to)) || Number(to) === nation)) return fail('bad_request', 'Choose a nation to write to.');
    if (channel === 'allies' && !this.diplomacy.allies(nation!).length) return fail('not_allowed', 'You have no allies to talk to.');
    const line: ChatLine = { at: Date.now(), from: user.name, nation, text: clean };
    if (channel !== 'world') line.channel = channel;
    if (channel === 'direct') line.to = Number(to);
    this.db.prepare('insert into chat (at, user_id, name, nation, text, channel, to_nation) values (?, ?, ?, ?, ?, ?, ?)')
      .run(line.at, user.id, user.name, nation ?? null, clean, channel, line.to ?? null);
    this.recentChat.push(line);
    if (this.recentChat.length > 200) this.recentChat.splice(0, 100);
    this.listener?.chat(line);
    return ok;
  }

  // ---- simulation -----------------------------------------------------------------
  /** Called once a real second. Cheap: a scan of nations plus a bounded slice of AI work. */
  tick(realNow = Date.now()) {
    if (this.pausedSpeed !== null) this.checkPause(); // the ten-minute limit
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
    if (realNow >= this.season.endsAt) this.endSeason('time is up');
    else if (this.season.dominance >= 60) this.endSeason('one nation dominates the world');
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
        const w = e.other !== undefined ? this.military.warBetween(e.nation, e.other) : undefined;
        if (w) { w.wins ??= [0, 0]; w.wins[w.a === e.nation ? 0 : 1]++; }
        this.event('war', e.nation, `${who} forces occupy ${where}${e.other ? ` in the ${this.defs.get(e.other)?.short}` : ''}.`);
      } else if (e.kind === 'liberated') {
        changed = true;
        this.event('war', e.nation, `${who} retakes ${where}.`);
      } else if (e.kind === 'bombed') {
        this.event('war', e.nation, `${who} bombers destroy industry in ${where}${e.other ? ` (${this.defs.get(e.other)?.short})` : ''}.`);
      } else if (e.kind === 'promoted') {
        const n = this.nations.get(e.nation);
        if (n?.controller === 'human') this.event('war', e.nation, `A ${who} general is promoted after the fighting near ${where}.`);
      } else if (e.kind === 'destroyed') {
        for (const foe of this.military.enemiesOf(e.nation)) {
          if (this.military.controller(e.province) !== foe && !this.military.unitsIn(e.province).some((u) => u.nation === foe)) continue;
          const w = this.military.warBetween(e.nation, foe)!;
          w.lost ??= [0, 0]; w.lost[w.a === e.nation ? 0 : 1]++;
          break;
        }
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
    this.military.now = this.gameNow();
    for (const w of this.military.wars) {
      if (w.truceUntil !== undefined && w.truceUntil <= this.military.now) {
        w.truceUntil = undefined;
        this.event('war', w.a, `The truce between the ${this.defs.get(w.a)?.name} and the ${this.defs.get(w.b)?.name} runs out: the war resumes.`);
        this.warDirty = true;
      }
    }
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
      this.military.logistics(n.id, n.mil, this.defenceIncome(n), this.manpower(n), (t) => this.homeFor(n.id, t), this.gameNow(), this.equipmentRate(n));
      // a demilitarised border: our troops there go home
      if (n.mil.demil && n.mil.demil.until > this.market.day) {
        const home = this.home(n.id);
        for (const u of this.military.unitsOf(n.id)) if (n.mil.demil.provinces.includes(u.province) && home !== undefined) { u.province = home; u.path = []; u.next = undefined; }
      }
    }
    this.insurgency();
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
      this.effectCache.clear();
      this.specialtyCache.clear();
      this.constructionDay();
      this.contractsDay();
      this.unrestDay();
      const inputs = [...this.nations.values()].filter((n) => !n.annexedBy).map((n) => ({
        econ: n.econ, tax: n.policy.tax, focus: n.policy.focus,
        control: Math.max(0, this.military.controlShare(n.id, this.ownedPop.get(n.id) ?? 0) - this.unrestLoss(n.id)),
        atWar: this.military.enemiesOf(n.id).length > 0,
        blockade: Math.min(0.9, this.military.blockade(n.id) + this.embargoPressure(n.id)),
        tradeDeals: this.diplomacy.partners('trade', n.id).length - this.lanes.filter((l) => l.raided && (l.a === n.id || l.b === n.id)).length,
        bonusGrowth: this.effects(n.id).growth + this.eventGrowth(n),
        factoryGrowth: Math.min(MAX_FACTORIES, this.factories.get(n.id) ?? 0) * FACTORY_GROWTH,
        plantPower: this.plants.get(n.id)?.share ?? 0,
        thermalPlants: this.plants.get(n.id)?.thermal ?? 0,
        extraUse: this.extraUse(n),
        ...this.seasonFactors(n),
        bonusStability: this.effects(n.id).stability,
        foodBonus: this.specialties(n.id).bonus.food + this.effects(n.id).food,
        spendFactor: this.hasLaw(n, 'austerity') ? 0.9 : 1,
        shortageFactor: this.hasLaw(n, 'rationing') ? 0.5 : 1,
        stockFactor: this.hasLaw(n, 'strategic_reserves') ? 1.5 : 1,
        tradeGrowth: this.hasLaw(n, 'free_trade') ? 1.5 : 1,
        interest: this.interestRate(n),
      }));
      runDay(inputs, this.market, this.market.day + 1);
      this.politicsDay(this.market.day);
      this.scoreDay();
      this.goalsDay();
      this.worldDay(this.market.day);
      this.societyDay();
      this.weatherDay();
      this.lanesDay();
      if (this.market.day % HISTORY_EVERY_DAYS === 0) weekly = true;
    }
    if (this.warDirty) { this.warDirty = false; this.warChanged(); }
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

  // ---- council and intelligence --------------------------------------------------------
  private councilDay(day: number) {
    const d = this.diplomacy;
    let changed = false;
    for (const r of d.council) {
      if (r.result || day - r.day < VOTE_DAYS) continue;
      changed = true;
      const members = [...this.nations.values()].filter((n) => !n.annexedBy).length;
      const pass = r.yes.length > r.no.length && r.yes.length >= members * 0.25;
      r.result = pass ? 'passed' : 'failed';
      const T = this.defs.get(r.target)?.name ?? '?';
      this.event('diplomacy', r.by, `World council: the resolution on the ${T} ${pass ? 'passes' : 'fails'}, ${r.yes.length} to ${r.no.length}.`);
      if (!pass) continue;
      const t = this.nations.get(r.target);
      if (!t || t.annexedBy) continue;
      if (r.kind === 'condemn') t.econ.stability = Math.max(0, t.econ.stability - 10);
      if (r.kind === 'sanction') {
        for (const id of r.yes) if (id !== t.id && !d.embargoed(id, t.id)) { d.embargoes.push({ from: id, to: t.id }); d.cancel('trade', id, t.id); }
      }
      if (r.kind === 'ceasefire' && r.target2 !== undefined && this.military.atWar(r.target, r.target2)) {
        this.military.makePeace(r.target, r.target2, (x) => this.home(x));
        for (const x of [r.target, r.target2]) { const n = this.nations.get(x); if (n) { this.touch(n); this.pushUnits(n); } }
      }
    }
    // keep the open agenda and the last few results
    const closed = d.council.filter((r) => r.result);
    if (closed.length > 6) d.council = [...d.council.filter((r) => !r.result), ...closed.slice(-6)];
    if (changed) this.warChanged();
  }

  private report(n: NationState, text: string) {
    n.reports = [`Day ${this.market.day}: ${text}`, ...(n.reports ?? [])].slice(0, 20);
  }

  /** Operations finish after a few days: success depends on the target's stability and research. */
  private spyDay(day: number) {
    for (const n of this.nations.values()) {
      if (!n.spyOps?.length) continue;
      const due = n.spyOps.filter((o) => day - o.day >= SPY_DAYS);
      if (!due.length) continue;
      n.spyOps = n.spyOps.filter((o) => day - o.day < SPY_DAYS);
      for (const op of due) {
        const t = this.nations.get(op.target);
        if (!t || t.annexedBy) continue;
        const T = this.defs.get(t.id)!.name, A = this.defs.get(n.id)!.name;
        const net = n.spy?.nets[t.id] ?? 0;
        const chance = Math.min(0.9, Math.max(0.2, 0.55 - t.econ.stability / 250 + (n.tech.done.length - t.tech.done.length) * 0.005 + this.effects(n.id).spy - this.effects(t.id).spy * 0.5 + net / 250 - (t.spy?.counter ?? 0) * 0.08));
        const success = this.rand() < chance;
        if (success) {
          if (op.mission === 'steal') {
            const mineKnown = new Set(n.tech.done), theirs = new Set(t.tech.done);
            const pick = TECHS_LIST.find((x) => theirs.has(x.id) && !mineKnown.has(x.id) && ready(x, mineKnown));
            if (pick) { n.tech.partial[pick.id] = (n.tech.partial[pick.id] ?? 0) + this.techCost(pick.tier) * 0.4; this.report(n, `Our agents in the ${T} stole research on ${pick.name}.`); }
            else this.report(n, `Our agents found nothing worth stealing in the ${T}.`);
          } else if (op.mission === 'sabotage') {
            const own = [...this.military.buildings.keys()].filter((p) => this.military.provinces.get(p)?.owner === t.id);
            const hit = own.length ? this.military.destroyBuilding(own[Math.floor(this.rand() * own.length)]) : undefined;
            if (hit) this.report(n, `Saboteurs destroyed a ${BUILDINGS[hit].name.toLowerCase()} in the ${T}.`);
            else { t.econ.munitions *= 0.85; this.report(n, `Saboteurs blew up munitions depots in the ${T}.`); }
            this.warDirty = true;
          } else if (op.mission === 'recon') {
            n.intel = { ...(n.intel ?? {}), [t.id]: day + 30 };
            this.report(n, `Agents in the ${T} report their forces' positions for the next 30 days.`);
          } else if (op.mission === 'cyber_grid') {
            t.econ.grid = (t.econ.grid ?? t.econ.gdp) * 0.85;
            this.report(n, `Our hackers knocked out 15% of the power grid of the ${T}.`);
          } else if (op.mission === 'blueprints') {
            n.mil.equipment = (n.mil.equipment ?? 0) + 150;
            if (n.mil.queue[0]) n.mil.queue[0].progress = Math.min(0.99, n.mil.queue[0].progress + 0.3);
            this.report(n, `Our agents copied arms blueprints in the ${T}: +150 equipment.`);
          } else if (op.mission === 'rig_election') {
            if (t.pol) { t.pol.support = Math.max(0, t.pol.support - 20); t.pol.goodwill -= 10; }
            if (t.gov.nextElection !== undefined && t.gov.nextElection - day < 120 && t.parties) for (const x of t.parties) if (x.gov) x.poll *= 0.85;
            this.report(n, `Our money and media campaign turned the parliament of the ${T} against its government.`);
          } else if (op.mission === 'back_coup') {
            if (t.econ.stability < 45 && this.rand() < 0.6) {
              t.gov = { government: 'junta', reformedAt: day };
              t.econ.stability = 40;
              this.effectCache.delete(t.id);
              this.event('politics', t.id, `Coup in the ${T}: officers seize power and declare a military junta.`);
              this.report(n, `The coup we backed in the ${T} succeeded.`);
              this.touch(t);
            } else this.report(n, `The officers we armed in the ${T} lost their nerve.`);
          } else if (op.mission === 'cyber_heist') {
            const take = Math.max(0, t.econ.treasury * 0.015) || t.econ.gdp * 0.002;
            t.econ.treasury -= take; n.econ.treasury += take;
            this.report(n, `Our hackers siphoned $${take.toFixed(1)}bn from the ${T}.`);
          } else {
            t.econ.stability = Math.max(0, t.econ.stability - 6);
            this.report(n, `Agitators spread unrest in the ${T} (−6 stability).`);
          }
        } else this.report(n, `Our ${SPY_MISSIONS[op.mission].name.toLowerCase()} operation in the ${T} failed.`);
        // caught agents make the news
        if (this.rand() < (success ? 0.15 : 0.4) + (t.spy?.counter ?? 0) * 0.1) {
          this.diplomacy.cancel('trade', n.id, t.id);
          this.remember(t.id, n.id, -20);
          if (n.spy) n.spy.nets[t.id] = (n.spy.nets[t.id] ?? 0) * 0.6;
          this.event('diplomacy', t.id, `Spy scandal: agents of the ${A} are caught in the ${T}.`);
          if (t.controller === 'human' && !t.event) t.event = { key: 'spy_caught', day, about: n.id };
        }
        this.touch(n, false);
      }
    }
  }

  /** A player's chosen name replaces the map's in everything the server says. */
  private applyCustom(n: NationState) {
    const d = this.defs.get(n.id);
    if (!d) return;
    const original = (d as NationDef & { original?: { name: string; short: string } });
    original.original ??= { name: d.name, short: d.short };
    d.name = n.custom?.name ?? original.original.name;
    d.short = n.custom?.short ?? original.original.short;
  }

  /** The season at a nation's capital sets its harvest and its heating bill. */
  seasonFactors(n: NationState) {
    const lat = this.military.provinces.get(this.defs.get(n.id)?.capital ?? -1)?.label[1] ?? 0;
    const s = seasonAt(this.worldStart + this.market.day * DAY, lat);
    return { harvest: s ? HARVEST[s] : 1, powerDemand: s === 'winter' && Math.abs(lat) >= 30 ? WINTER_POWER : 1 };
  }

  // ---- weather and shipping lanes ----------------------------------------------------------
  /** Storm systems drift with the prevailing winds; aircraft under them are grounded and ships battered. */
  private weatherDay() {
    const day = this.market.day;
    this.storms = this.storms.filter((s) => s.until > day && (s.kind !== 'hurricane' || (s.cat ?? 0) >= 0.6));
    const month = new Date(this.worldStart + day * DAY).getUTCMonth();
    for (const s of this.storms) {
      if (s.kind === 'hurricane') this.hurricaneDay(s, day);
      s.lon += s.vlon; s.lat = Math.max(-70, Math.min(70, s.lat + s.vlat));
      if (s.lon > 180) s.lon -= 360; if (s.lon < -180) s.lon += 360;
    }
    // ordinary weather: rain and thunderstorms, and gales at high latitudes in winter
    while (this.storms.filter((s) => s.kind !== 'hurricane').length < 7 && this.rand() < 0.5) {
      const hemi = this.rand() < 0.5 ? 1 : -1;
      const winterGale = (hemi > 0 ? month <= 1 || month === 11 : month >= 5 && month <= 7) && this.rand() < 0.5;
      const lat = hemi * (winterGale ? 40 + this.rand() * 25 : 8 + this.rand() * 50);
      const westerly = Math.abs(lat) > 30;
      this.storms.push({
        lon: this.rand() * 360 - 180, lat, r: 300 + this.rand() * 500, kind: 'storm',
        vlon: (westerly ? 1 : -1) * (3 + this.rand() * 4), vlat: Math.sign(lat) * this.rand() * 0.6, until: day + 5 + Math.floor(this.rand() * 10),
      });
    }
    // hurricanes: rare, born only over warm tropical sea in each hemisphere's season
    const season = (hemi: number) => (hemi > 0 ? month >= 6 && month <= 9 : month <= 2);
    for (const hemi of [1, -1]) {
      if (!season(hemi) || this.storms.filter((s) => s.kind === 'hurricane').length >= 2 || this.rand() > 0.03) continue;
      const warm = [...this.military.provinces.values()].filter((p) => p.kind === 'sea' && p.label[1] * hemi >= 8 && p.label[1] * hemi <= 22);
      if (!warm.length) continue;
      const at = warm[Math.floor(this.rand() * warm.length)];
      this.storms.push({
        lon: at.label[0], lat: at.label[1], r: 260 + this.rand() * 120, kind: 'hurricane', cat: 1,
        name: HURRICANE_NAMES[this.hurricaneCount++ % HURRICANE_NAMES.length],
        vlon: -(2.5 + this.rand() * 1.5), vlat: hemi * (0.3 + this.rand() * 0.3), until: day + 24, hit: [],
      });
    }
    this.stormy.clear();
    for (const p of this.military.provinces.values()) {
      if (this.storms.some((s) => distanceKm([s.lon, s.lat], p.label) < s.r)) this.stormy.add(p.id);
    }
    this.warDirty = true;
  }

  /**
   * One day of a hurricane: it strengthens over warm sea and weakens over land or cool water,
   * curves poleward and east as it leaves the tropics, and where its eye crosses land it can
   * damage buildings (they stop working until repaired).
   */
  private hurricaneDay(h: World['storms'][number], day: number) {
    // the province or sea zone under the eye
    let centre: Province | undefined, near = Infinity;
    for (const p of this.military.provinces.values()) {
      const km = distanceKm([h.lon, h.lat], p.label);
      if (km < near) { near = km; centre = p; }
    }
    const overSea = !centre || centre.kind === 'sea';
    const alat = Math.abs(h.lat);
    let cat = h.cat ?? 1;
    if (overSea && alat < 28) cat += 0.35; // warm water feeds it
    if (!overSea) cat -= 0.9; // land starves it
    if (alat > 32) cat -= 0.6; // cool water
    h.cat = Math.min(5, cat);
    h.r = 240 + 40 * Math.max(1, h.cat);
    // steering: westward in the trade winds, then recurving poleward and east
    if (alat > 24) { h.vlon = Math.min(5, h.vlon + 0.9); h.vlat += Math.sign(h.lat) * 0.15; }
    if (overSea || (h.cat ?? 0) < 1) return;
    // landfall: buildings near the eye may be damaged, once per province per storm
    const eye = 70 + 25 * h.cat;
    const struck = new Map<number, { name: string; lost: BuildingType[] }>();
    for (const p of this.military.provinces.values()) {
      if (p.kind !== 'land' || (h.hit ?? []).includes(p.id) || distanceKm([h.lon, h.lat], p.label) > eye) continue;
      h.hit = [...(h.hit ?? []), p.id];
      const lost: BuildingType[] = [];
      for (const b of this.military.buildings.get(p.id) ?? []) {
        if (b.progress >= 1 && !b.damaged && this.rand() < 0.08 * h.cat) { b.damaged = true; lost.push(b.type); }
      }
      const owner = p.owner !== undefined ? this.nations.get(p.owner) : undefined;
      if (owner) owner.econ.gdp *= 1 - 0.0015 * h.cat;
      if (owner) {
        const s = struck.get(owner.id) ?? { name: p.name ?? 'the coast', lost: [] };
        s.lost.push(...lost);
        struck.set(owner.id, s);
      }
    }
    for (const [id, s] of struck) {
      const n = this.nations.get(id)!;
      this.event('war', id, `Hurricane ${h.name} (category ${Math.round(h.cat)}) makes landfall at ${s.name} in the ${this.defs.get(id)!.short}${s.lost.length ? `, damaging the ${[...new Set(s.lost)].map((t) => BUILDINGS[t].name.toLowerCase()).join(', ')}: repairs are needed` : ''}.`);
      this.touch(n, n.controller === 'human');
      this.effectCache.delete(id);
    }
    void day;
  }

  /** Trade agreements between coastal nations sail a sea route; an enemy warship on it cuts the deal's value. */
  private lanesDay() {
    const m = this.military, lanes: typeof this.lanes = [];
    const sea = m.provinces as unknown as Map<number, RouteNode>;
    const portOf = (id: number) => {
      const cap = m.provinces.get(this.defs.get(id)?.capital ?? -1)?.label;
      let best: number | undefined, bestD = Infinity;
      for (const p of m.provinces.values()) {
        if (p.kind !== 'land' || p.owner !== id || m.controller(p.id) !== id) continue;
        const zone = p.adj.find((q) => m.provinces.get(q)?.kind === 'sea');
        if (zone === undefined) continue;
        const d = (m.built(p.id, 'port') ? 0 : 1) * 1e6 + (cap ? distanceKm(cap, p.label) : 0);
        if (d < bestD) { bestD = d; best = zone; }
      }
      return best;
    };
    const fleets = new Map<number, Set<number>>(); // sea zone -> nations with warships there
    for (const u of m.units.values()) {
      if (UNIT_SPECS[u.type].domain !== 'sea') continue;
      if (!fleets.has(u.province)) fleets.set(u.province, new Set());
      fleets.get(u.province)!.add(u.nation);
    }
    for (const t of this.diplomacy.treaties) {
      if (t.kind !== 'trade') continue;
      const key = `${Math.min(t.a, t.b)}-${Math.max(t.a, t.b)}`;
      let path = this.laneCache.get(key);
      if (path === undefined) {
        const za = portOf(t.a), zb = portOf(t.b);
        const r = za !== undefined && zb !== undefined ? findRoute(sea, za, zb, 'destroyers', (q) => m.provinces.get(q)?.kind === 'sea') : null;
        path = r ? [za!, ...r.path] : null;
        this.laneCache.set(key, path);
      }
      if (!path || path.length < 2) continue; // neighbours trading overland
      const raided = path.some((z) => [...(fleets.get(z) ?? [])].some((x) => m.atWar(x, t.a) || m.atWar(x, t.b)));
      lanes.push({ a: t.a, b: t.b, path, raided });
    }
    if (this.market.day % 30 === 0) this.laneCache.clear(); // ports and coasts change hands
    this.lanes = lanes;
  }

  // ---- society: ideology, factions, propaganda; new nations ----------------------------------
  private initialSociety(n: NationState) {
    const gov = GOV_LIBERTY[n.gov?.government ?? 'democracy'] ?? 0;
    const open = { trader: 0.5, idealist: 0.4, opportunist: 0.1, turtle: -0.3, expansionist: -0.5 }[n.personality] ?? 0;
    const jitter = ((n.id * 7919) % 100) / 250 - 0.2;
    return {
      ideology: { liberty: Math.max(-1, Math.min(1, gov * 0.8 + jitter)), openness: Math.max(-1, Math.min(1, open - jitter)) },
      factions: { military: 55, business: 55, public: 55 },
      propaganda: { mode: 'off' as PropagandaMode },
    };
  }

  /** Stability gained or lost from how well the government suits what the people believe. */
  fit(n: NationState) {
    if (!n.soc) return 0;
    const gap = Math.abs(n.soc.ideology.liberty - (GOV_LIBERTY[n.gov.government] ?? 0));
    return 2 - gap * 9; // +2 when they match, about −13 for a junta over liberals
  }

  /** Daily drift of beliefs and factions, propaganda, and civil war. */
  private societyDay() {
    const d = this.diplomacy;
    for (const n of this.nations.values()) {
      if (n.annexedBy || !n.soc) continue;
      const s = n.soc, e = n.econ, ide = s.ideology;
      const atWar = this.military.enemiesOf(n.id).length > 0;
      const gdppc = e.gdp * 1e9 / e.pop;
      // beliefs drift: toward the government (faster with propaganda), wealth breeds liberty, war breeds nationalism, trade openness
      const pull = (s.propaganda.mode === 'home' ? 0.004 : 0.0012);
      // development leans politics: cities and crowded country liberal and open, the remote countryside
      // authoritarian and looking after its own
      const lean = devLean(this.avgDevelopment(n.id));
      ide.liberty += ((GOV_LIBERTY[n.gov.government] ?? 0) - ide.liberty) * pull + (Math.log10(Math.max(1000, gdppc)) - 4) * 0.0004 + lean;
      ide.openness += (atWar ? -0.002 : 0) + d.partners('trade', n.id).length * 0.0003 - (n.policy.openBorders === false ? 0.0006 : 0) + (0 - ide.openness) * 0.0005 + lean;
      ide.liberty = Math.max(-1, Math.min(1, ide.liberty));
      ide.openness = Math.max(-1, Math.min(1, ide.openness));
      // factions
      const lost = 1 - this.controlOf(n.id);
      const target = {
        military: 30 + e.budget.military * 1.5 - lost * 80 + (n.gov.government === 'junta' ? 20 : 0) - (e.short.oil > 0.1 ? 15 : 0),
        business: 50 + e.growth * 800 - (n.policy.tax - 25) * 2 + d.partners('trade', n.id).length * 3 - (e.blackout ?? 0) * 100 - d.embargoes.filter((x) => x.to === n.id).length * 5,
        public: 20 + e.budget.welfare * 0.8 + (e.stability - 50) * 0.5 - (atWar ? 10 : 0) - (e.blackout ?? 0) * 80 - (n.gov.government === 'junta' ? 10 : 0),
      };
      for (const l of n.pol?.laws ?? []) {
        for (const [f, v] of Object.entries(LAWS[l].lean)) target[f as Faction] += (v as number) * 6;
        ide.liberty = Math.max(-1, Math.min(1, ide.liberty + (LAWS[l].liberty ?? 0) / 365));
      }
      for (const f of ['military', 'business', 'public'] as Faction[]) {
        s.factions[f] += (Math.max(0, Math.min(100, target[f])) - s.factions[f]) * 0.02;
      }
      // propaganda costs money; abroad it unsettles the target and pulls its people toward ours
      if (s.propaganda.mode !== 'off') {
        e.treasury -= e.gdp * PROPAGANDA_COST / 365;
        const t = s.propaganda.target !== undefined ? this.nations.get(s.propaganda.target) : undefined;
        if (s.propaganda.mode === 'abroad' && t?.soc && !t.annexedBy) {
          t.econ.stability = Math.max(0, t.econ.stability - 0.04);
          t.soc.ideology.liberty += (ide.liberty - t.soc.ideology.liberty) * 0.002;
          t.soc.ideology.openness += (ide.openness - t.soc.ideology.openness) * 0.002;
        }
      }
      // civil war: deep turmoil and an angry public or army split the nation
      if (e.stability < 15 && Math.min(s.factions.public, s.factions.military) < 20 && this.rand() < 1 / 150) this.civilWar(n);
    }
  }

  private recomputeNeighbours() {
    const m = this.military, sets = new Map<number, Set<number>>();
    for (const p of m.provinces.values()) {
      if (p.kind !== 'land' || !p.owner) continue;
      for (const q of p.adj) {
        const o = m.provinces.get(q)?.owner;
        if (o && o !== p.owner) { if (!sets.has(p.owner)) sets.set(p.owner, new Set()); sets.get(p.owner)!.add(o); }
      }
    }
    for (const d of this.defs.values()) d.neighbours = [...(sets.get(d.id) ?? [])];
  }

  /** A new nation from provinces of an existing one, at war with it. Returns the new nation. */
  private createNation(parent: NationState, provinces: number[], kind: 'revolt' | 'civil war'): NationState {
    const m = this.military;
    const id = Math.max(...this.defs.keys()) + 1;
    const capital = [...provinces].sort((a, b) => m.provinces.get(b)!.pop - m.provinces.get(a)!.pop)[0];
    const place = (m.provinces.get(capital)?.name ?? 'Free').replace(/[^\p{L}\p{N} '\-]/gu, '');
    const styles = kind === 'revolt' ? ['Free State of', 'Republic of', 'Commonwealth of'] : ["People's Republic of", 'Federation of', 'Liberated'];
    const name = `${styles[id % styles.length]} ${place}`;
    const hue = (id * 137) % 360;
    const color = hslHex(hue, 55, 52);
    const born = { name, short: place.slice(0, 16), color, capital, label: capital, parent: parent.id };
    this.defs.set(id, { id, name, short: born.short, capital, neighbours: [], provinces: provinces.length, pop: 0, area: 0, seed: this.defs.get(parent.id)!.seed });
    const zero = Object.fromEntries(COMMODITIES.map((c) => [c, 0])) as Record<Commodity, number>;
    const econ = { ...structuredClone(parent.econ), gdp: 0, pop: 0, capacity: { ...zero }, stock: { ...zero }, treasury: 0, history: [], munitions: 0, grid: 0 };
    const personality = PERSONALITIES[id % PERSONALITIES.length];
    const n: NationState = {
      id, controller: 'ai', autopilot: false, personality, policy: this.brain.initialPolicy(personality), nextThink: this.gameNow(),
      econ, mil: { funds: 3, queue: [] }, tech: { partial: {}, done: [...parent.tech.done] },
      gov: { government: parent.gov.government === 'democracy' ? 'autocracy' : 'democracy', reformedAt: this.market.day },
      born,
    };
    this.nations.set(id, n);
    const before = parent.econ.grid ?? parent.econ.gdp;
    this.transfer(provinces, parent, n);
    n.econ.grid = before * (n.econ.gdp / Math.max(1, n.econ.gdp + parent.econ.gdp)); parent.econ.grid = before - n.econ.grid;
    n.econ.treasury = n.econ.gdp * 0.02;
    n.econ.stability = 50;
    n.soc = this.initialSociety(n);
    if (parent.soc) n.soc.ideology = { liberty: -parent.soc.ideology.liberty * 0.5, openness: parent.soc.ideology.openness };
    // forces stationed in the breakaway land change sides
    for (const u of [...m.units.values()]) if (u.nation === parent.id && provinces.includes(u.province)) u.nation = id;
    this.recomputeNeighbours();
    m.declareWar(id, parent.id, this.market.day);
    this.diplomacy.forget(id);
    this.dirty.add(id);
    this.listener?.nation(this.publicView(n));
    this.warChanged();
    return n;
  }

  /** Turmoil splits a nation: its provinces farthest from the capital break away. */
  private civilWar(n: NationState) {
    const m = this.military, cap = m.provinces.get(this.defs.get(n.id)!.capital)?.label;
    const own = [...m.provinces.values()].filter((p) => p.kind === 'land' && p.owner === n.id && m.controller(p.id) === n.id && p.id !== this.defs.get(n.id)!.capital);
    if (own.length < 3 || !cap) return;
    own.sort((a, b) => distanceKm(b.label, cap) - distanceKm(a.label, cap));
    const rebels = this.createNation(n, own.slice(0, Math.floor(own.length * 0.4)).map((p) => p.id), 'civil war');
    n.econ.stability = 30;
    this.event('war', rebels.id, `Civil war: the ${this.defs.get(n.id)!.name} splits apart. The ${rebels.born!.name} declares itself independent, and its armies follow.`);
  }

  /** A player without a nation leads a revolt in a restless province of an AI nation. */
  found(user: User, provinceId: number): Result {
    if (this.byUser.has(user.id)) return fail('already_ruling', 'You already lead a nation.');
    const m = this.military, p = m.provinces.get(provinceId);
    if (!p || p.kind !== 'land' || !p.owner) return fail('bad_request', 'Choose a province on land.');
    const parent = this.nations.get(p.owner)!;
    if (parent.controller === 'human') return fail('not_allowed', 'A player governs that nation: claim an AI nation instead.');
    if (this.defs.get(parent.id)!.capital === p.id) return fail('not_allowed', 'A revolt cannot start in the capital.');
    const unrest = this.diplomacy.unrest.get(p.id) ?? 0;
    if (parent.econ.stability >= 50 && unrest < 20) return fail('not_allowed', `The people here are content (stability ${Math.round(parent.econ.stability)}%). Revolts need stability under 50% or unrest in the province.`);
    if (p.pop < 5e5) return fail('not_allowed', 'Too few people live here to carry a revolt.');
    const provs = [p.id, ...p.adj.filter((q) => m.provinces.get(q)?.kind === 'land' && m.provinces.get(q)!.owner === parent.id && m.controller(q) === parent.id && q !== this.defs.get(parent.id)!.capital).slice(0, 2)];
    const n = this.createNation(parent, provs, 'revolt');
    for (const _ of [0, 1]) m.spawn(n.id, 'infantry', p.id, 70); // the revolutionaries take up arms
    this.event('war', n.id, `${user.name} leads a revolt in ${p.name}: the ${n.born!.name} declares independence from the ${this.defs.get(parent.id)!.name}.`);
    return this.claim(user, n.id);
  }

  // ---- goals: season missions and achievements ---------------------------------------
  powerOf(nation: number) {
    return this.power.get(nation) ?? 0;
  }

  private provincesHeld(id: number) {
    let c = 0;
    for (const p of this.military.provinces.values()) if (p.kind === 'land' && this.military.controller(p.id) === id) c++;
    return c;
  }

  private measure(n: NationState, kind: GoalKind): number {
    const m = this.military, d = this.diplomacy, id = n.id;
    const builtHere = (types: string[]) => [...m.buildings].filter(([p]) => m.provinces.get(p)?.owner === id).reduce((s, [, l]) => s + l.filter((b) => b.progress >= 1 && types.includes(b.type)).length, 0);
    switch (kind) {
      case 'grow': return n.econ.gdp;
      case 'industry': return builtHere(['factory']);
      case 'power': return (n.econ.blackout ?? 0) < 0.005 ? builtHere(['coal_plant', 'gas_plant', 'nuclear_plant', 'renewables']) : 0;
      case 'bloc': { const b = d.blocOf(id); return b ? b.members.length : 0; }
      case 'trade': return d.partners('trade', id).length;
      case 'tech': return n.tech.done.length;
      case 'territory': return this.provincesHeld(id);
      case 'stability': return n.econ.stability;
      case 'navy': return m.unitsOf(id).filter((u) => UNIT_SPECS[u.type].domain === 'sea').length;
      case 'allies': return d.allies(id).length;
    }
  }

  /** Three goals for the season, sized to what this nation has now. */
  private assignMissions(n: NationState) {
    const pool = [...MISSION_KINDS].sort(() => this.rand() - 0.5);
    const out: SeasonMission[] = [];
    for (const kind of pool) {
      if (out.length >= 3) break;
      const now = this.measure(n, kind);
      const goal: Record<GoalKind, [number, string]> = {
        grow: [now * 1.15, 'Grow the economy by 15%'],
        industry: [now + 3, `Run ${now + 3} factory complexes`],
        power: [Math.max(3, now + 2), `Keep the lights on with ${Math.max(3, now + 2)} power stations`],
        bloc: [Math.max(4, now + 2), `Belong to a bloc of ${Math.max(4, now + 2)} nations`],
        trade: [Math.min(6, now + 2), `Hold ${Math.min(6, now + 2)} trade agreements`],
        tech: [now + 3, 'Research three more technologies'],
        territory: [now + 3, `Hold ${now + 3} provinces`],
        stability: [Math.min(90, Math.max(70, now + 10)), `Raise stability to ${Math.min(90, Math.max(70, Math.round(now + 10)))}%`],
        navy: [now + 4, `Field ${now + 4} naval units`],
        allies: [now + 2, `Have ${now + 2} allies`],
      };
      if (kind === 'trade' && now >= 6) continue;
      if (kind === 'stability' && now >= 88) continue;
      out.push({ kind, target: goal[kind][0], base: now, text: goal[kind][1] });
    }
    n.missions = out;
    n.missionSeason = this.season.number;
  }

  private goalsDay() {
    for (const n of this.nations.values()) {
      if (n.controller !== 'human' || n.annexedBy || !n.userId) continue;
      if (n.missionSeason !== this.season.number || !n.missions) this.assignMissions(n);
      for (const ms of n.missions!) {
        if (ms.done || this.measure(n, ms.kind) < ms.target) continue;
        ms.done = true;
        const reward = MISSION_REWARD_DAYS * (this.power.get(n.id) ?? 0) * 100;
        this.season.scores[n.id] = (this.season.scores[n.id] ?? 0) + reward;
        n.econ.treasury += n.econ.gdp * MISSION_CASH;
        n.missionsDone = (n.missionsDone ?? 0) + 1;
        this.event('politics', n.id, `${this.defs.get(n.id)!.short} completes a season mission: ${ms.text} (+${Math.round(reward).toLocaleString('en-US')} points).`);
        this.touch(n, false);
      }
      // achievements, kept by the player's account
      const award = (key: AchievementKey) => {
        if (this.achievements.award(n.userId!, key)) {
          this.event('politics', n.id, `${n.player} earns the ${ACHIEVEMENTS[key].name} achievement: ${ACHIEVEMENTS[key].text}.`);
          this.touch(n, false);
        }
      };
      if ((n.missionsDone ?? 0) >= 9) award('missions');
      if ((n.mil.warheads ?? 0) > 0) award('nuclear_power');
      if (n.tech.done.length >= TECHS_LIST.length) award('full_tree');
      const bloc = this.diplomacy.blocOf(n.id);
      if (bloc && bloc.leader === n.id && bloc.members.length >= 5) award('bloc_founder');
      if (this.market.day % 30 === 0 && this.provincesHeld(n.id) >= 60) award('empire');
    }
  }

  // ---- the wider world: global events, refugees, climate ---------------------------------
  /** How today's global event changes a nation's growth (per year). */
  eventGrowth(n: NationState) {
    const ev = this.globe.event;
    if (!ev) return 0;
    const e = n.econ;
    if (ev.kind === 'crash') return -0.04 - Math.max(0, -e.treasury / e.gdp) * 0.05; // the indebted suffer most
    if (ev.kind === 'pandemic') return -0.03 * (1 - Math.min(0.7, (e.budget.welfare - 20) / 40)); // health systems blunt it
    if (ev.kind === 'tech_boom') return 0.012 + (e.budget.research / 100) * 0.04; // research spenders gain most
    return 0;
  }

  private worldDay(day: number) {
    const g = this.globe;
    // global events: about one a game year, lasting a few months
    if (g.event && day >= g.event.until) {
      if (g.event.kind === 'oil_shock' && g.oilCut) {
        for (const [id, cut] of Object.entries(g.oilCut)) { const n = this.nations.get(Number(id)); if (n) n.econ.capacity.oil /= cut; }
        g.oilCut = undefined;
      }
      this.event('world', undefined, `The ${g.event.kind === 'crash' ? 'financial crisis' : g.event.kind === 'pandemic' ? 'pandemic' : g.event.kind === 'oil_shock' ? 'oil shock' : 'technology boom'} is over.`);
      g.event = undefined;
    } else if (!g.event && this.rand() < 1 / 365) {
      const kinds: GlobalEventKind[] = ['crash', 'pandemic', 'oil_shock', 'tech_boom'];
      const kind = kinds[Math.floor(this.rand() * kinds.length)];
      const days = 90 + Math.floor(this.rand() * 90);
      const text = {
        crash: 'A global financial crisis: growth collapses everywhere, worst for nations in debt.',
        pandemic: 'A pandemic sweeps the world: growth falls and people die; strong welfare systems limit the damage.',
        oil_shock: 'An oil shock: the largest producers cut output by a third and prices soar.',
        tech_boom: 'A technology boom: growth accelerates, most of all where research is funded.',
      }[kind];
      g.event = { kind, until: day + days, text };
      if (kind === 'oil_shock') {
        const top = [...this.nations.values()].filter((n) => !n.annexedBy).sort((a, b) => b.econ.capacity.oil - a.econ.capacity.oil).slice(0, 8);
        g.oilCut = Object.fromEntries(top.map((n) => [n.id, 0.67]));
        for (const n of top) n.econ.capacity.oil *= 0.67;
      }
      if (kind === 'pandemic') {
        for (const n of this.nations.values()) {
          if (n.annexedBy) continue;
          const shield = Math.min(0.7, (n.econ.budget.welfare - 20) / 40);
          n.econ.pop *= 1 - 0.004 * (1 - shield);
          n.econ.stability = Math.max(0, n.econ.stability - 6 * (1 - shield));
        }
      }
      this.event('world', undefined, text);
    }
    this.migrationDay();
    // climate: once a game year, warming from the world's coal and gas, then its effects
    if (day - g.lastClimateDay >= 365) {
      g.lastClimateDay = day;
      const live = [...this.nations.values()].filter((n) => !n.annexedBy);
      const burn = live.reduce((s, n) => s + usePerYear('coal', n.econ.gdp, n.econ.pop) + usePerYear('gas', n.econ.gdp, n.econ.pop) * 0.6
        + (this.extraUse(n).coal ?? 0) + (this.extraUse(n).gas ?? 0) * 0.6, 0);
      const start = COMMODITY_INFO.coal.worldUse + COMMODITY_INFO.gas.worldUse * 0.6;
      g.warming += 0.025 * (burn / start) * Math.max(0, 1 - g.warming / 5); // a quarter of a degree a decade at today's burning, levelling off
      const w = g.warming;
      // rising seas: the lowest coasts lose people
      if (w > 0.15) {
        for (const id of g.low) {
          const p = this.military.provinces.get(id);
          if (!p || !p.owner) continue;
          const lost = p.pop * Math.min(0.03, (w - 0.15) * 0.02);
          p.pop -= lost;
          const n = this.nations.get(p.owner);
          if (n) { const f = lost / Math.max(1, this.ownedPop.get(n.id) ?? 1); n.econ.pop *= 1 - f; n.econ.gdp *= 1 - f * 0.7; }
        }
        this.countOwnedPop();
      }
      // farmland moves poleward
      for (const n of live) {
        const provs = [...this.military.provinces.values()].filter((p) => p.owner === n.id);
        const hot = provs.filter((p) => ['savanna', 'desert_sand', 'desert_rock', 'shrubland', 'rainforest'].includes(p.terrain)).length;
        const cold = provs.filter((p) => ['boreal', 'tundra'].includes(p.terrain)).length;
        const shift = (cold - hot) / Math.max(1, provs.length);
        n.econ.capacity.food *= 1 + shift * w * 0.02;
      }
      if (w > 0.1) this.event('world', undefined, `Climate: the world is now ${w.toFixed(2)} °C warmer than in 2026${w > 0.15 ? '; low-lying coasts are flooding' : ''}.`);
    }
  }

  /** People flee occupied land to neighbours who will take them in. */
  private migrationDay() {
    for (const n of this.nations.values()) {
      if (n.annexedBy) continue;
      const loss = 1 - this.controlOf(n.id) + this.unrestLoss(n.id) * 0.5;
      if (loss <= 0.01) continue;
      const flow = n.econ.pop * loss * 0.0003; // people a day
      const hosts = (this.defs.get(n.id)?.neighbours ?? []).map((id) => this.nations.get(id)!)
        .filter((h) => h && !h.annexedBy && h.policy.openBorders !== false && !this.military.atWar(h.id, n.id) && !this.military.enemiesOf(n.id).includes(h.id));
      if (!hosts.length) continue;
      const weight = hosts.map((h) => h.econ.gdp / h.econ.pop);
      const total = weight.reduce((a, b) => a + b, 0);
      n.econ.pop -= flow;
      const out = this.migrants.get(n.id) ?? { in: 0, out: 0 };
      out.out = out.out * (1 - 1 / 365) + flow;
      this.migrants.set(n.id, out);
      hosts.forEach((h, i) => {
        const r = flow * weight[i] / total;
        const gdppc = h.econ.gdp / h.econ.pop;
        h.econ.pop += r;
        h.econ.gdp += r * gdppc * 0.25; // newcomers work, at first in lower-paid jobs
        h.econ.treasury -= r * 3e-6; // $3,000 per person to house and settle
        h.econ.stability = Math.max(0, h.econ.stability - (r / h.econ.pop) * 2000);
        const m = this.migrants.get(h.id) ?? { in: 0, out: 0 };
        m.in = m.in * (1 - 1 / 365) + r;
        this.migrants.set(h.id, m);
      });
    }
  }

  // ---- strategic warfare -----------------------------------------------------------
  maxGenerals(nation: number) {
    return Math.max(1, Math.floor(this.military.unitsOf(nation).filter((u) => UNIT_SPECS[u.type].domain === 'land').length / UNITS_PER_GENERAL));
  }

  /** A missile defense battery held by `defender` within range of province p. */
  shielded(defender: number, p: number) {
    const at = this.military.provinces.get(p)?.label;
    if (!at) return false;
    for (const [q] of this.military.buildings) {
      if (!this.military.built(q, 'missile_defense') || this.military.controller(q) !== defender) continue;
      if (distanceKm(this.military.provinces.get(q)!.label, at) <= MISSILE_SHIELD_KM) return true;
    }
    return false;
  }

  /** Big occupied provinces raise partisans for their rightful owner. */
  private insurgency() {
    const m = this.military;
    for (const [p, occ] of m.occupied) {
      const prov = m.provinces.get(p)!;
      const owner = prov.owner;
      if (!owner || prov.pop < 2e6 || !m.atWar(owner, occ)) continue;
      if (this.rand() >= (prov.pop / 1e7) / 60) continue;
      const garrison = m.unitsIn(p).filter((u) => u.nation === occ && UNIT_SPECS[u.type].domain === 'land');
      m.spawn(owner, 'infantry', p, garrison.length ? 35 : 55);
      this.event('war', owner, `Partisans rise in occupied ${prov.name ?? 'territory'} against the ${this.defs.get(occ)?.short}.`);
    }
  }

  /** Within missile range of any province this nation holds. */
  inStrikeRange(nation: number, p: number) {
    const at = this.military.provinces.get(p)?.label;
    if (!at) return false;
    for (const q of this.military.provinces.values()) {
      if (q.kind === 'land' && this.military.controller(q.id) === nation && distanceKm(q.label, at) <= MISSILE_RANGE) return true;
    }
    return false;
  }

  /** A nuclear strike: devastating for the target, and the world turns on the attacker. */
  private nuke(n: NationState, p: number, retaliation = false) {
    const m = this.military, prov = m.provinces.get(p)!;
    const owner = prov.owner, victim = m.controller(p);
    n.mil.warheads = Math.max(0, (n.mil.warheads ?? 1) - 1);
    for (const u of m.unitsIn(p)) m.units.delete(u.id);
    m.buildings.delete(p);
    const lost = prov.pop * 0.3;
    prov.pop -= lost;
    this.nuked.push(p);
    if (owner) {
      const o = this.nations.get(owner)!;
      const f = Math.min(0.9, lost / Math.max(1, this.ownedPop.get(owner) ?? 1));
      o.econ.pop *= 1 - f;
      o.econ.gdp *= 1 - f * 1.5;
      o.econ.stability = Math.max(0, o.econ.stability - 25);
      this.touch(o);
    }
    this.countOwnedPop();
    n.econ.stability = Math.max(0, n.econ.stability - 15);
    const A = this.defs.get(n.id)!.name;
    this.event('war', n.id, `NUCLEAR STRIKE: the ${A} destroys ${prov.name ?? 'a province'}${owner ? ` in the ${this.defs.get(owner)!.name}` : ''}. ${Math.round(lost / 1e5) / 10} million people are lost.`);
    // the world turns away: allies and trading partners abandon the attacker
    if (!retaliation) {
      for (const kind of ['alliance', 'trade'] as const) for (const x of this.diplomacy.partners(kind, n.id)) this.diplomacy.cancel(kind, n.id, x);
      this.event('diplomacy', n.id, `Every alliance and trade agreement of the ${A} is torn up in outrage.`);
    }
    this.warChanged();
    for (const x of this.nations.values()) this.pushUnits(x);
    this.touch(n);
    // a nuclear-armed AI victim answers in kind
    const v = victim ? this.nations.get(victim) : undefined;
    if (!retaliation && v && (v.controller === 'ai' || v.autopilot) && (v.mil.warheads ?? 0) > 0) {
      const cap = this.home(n.id);
      if (cap !== undefined) this.nuke(v, cap, true);
    }
  }

  /** A province's development: how urban it is, how rich its owner is per person, and what is built there. */
  devOf(p: { id: number; pop?: number; area?: number; city?: boolean; kind?: string; owner?: number }) {
    const e = p.owner !== undefined ? this.nations.get(p.owner)?.econ : undefined;
    const built = (this.military.buildings.get(p.id) ?? []).filter((b) => b.progress >= 1 && !MILITARY_WORKS.has(b.type)).length;
    return development({ ...p, gdppc: e && e.pop > 0 ? (e.gdp * 1e9) / e.pop : undefined, built });
  }

  /** A nation's average development, weighted by people (provinces it holds). */
  avgDevelopment(nation: number) {
    let w = 0, t = 0;
    for (const p of this.military.provinces.values()) {
      if (p.kind !== 'land' || p.owner !== nation || this.military.controller(p.id) !== nation) continue;
      const pop = Math.max(1, p.pop);
      w += pop; t += pop * this.devOf(p);
    }
    return w ? t / w : 30;
  }

  /** Construction advances daily; finished buildings take effect. */
  private constructionDay() {
    this.factories.clear();
    this.plants.clear();
    // roads: built a stretch at a time; a finished road speeds troops along it
    let roadDone = false;
    for (const r of this.military.roads) {
      if (r.progress >= 1) continue;
      r.progress = Math.min(1, r.progress + 1 / roadDays(r.path.length - 1));
      this.warDirty = true;
      if (r.progress >= 1) {
        roadDone = true;
        const owner = this.nations.get(r.owner);
        if (owner?.controller === 'human') this.event('politics', owner.id, `${this.defs.get(owner.id)!.short}: the road from ${this.military.provinces.get(r.path[0])?.name ?? 'a province'} to ${this.military.provinces.get(r.path[r.path.length - 1])?.name ?? 'a province'} is open.`);
      }
    }
    if (roadDone) this.military.indexRoads();
    for (const [p, list] of this.military.buildings) {
      const prov = this.military.provinces.get(p)!;
      for (const b of list) {
        const builder = prov.owner !== undefined ? this.nations.get(prov.owner) : undefined;
        // timber short: slower; quarries: faster; developed provinces (people, cities, roads) much faster
        const lumber = (1 - 0.6 * Math.min(1, builder?.econ.short.timber ?? 0)) * (1 + (builder ? this.specialties(builder.id).bonus.construct + this.effects(builder.id).construct : 0)) * buildSpeed(this.devOf(prov));
        if (b.progress < 1) {
          b.progress = Math.min(1, b.progress + lumber / BUILDINGS[b.type].days);
          if (b.progress >= 1) this.finished(prov.owner, p, b.type);
        }
        if (b.damaged) {
          const owner = prov.owner !== undefined ? this.nations.get(prov.owner) : undefined;
          // AI governments (and advisers) repair what storms broke, when they can afford it
          if (b.repair === undefined && owner && (owner.controller === 'ai' || owner.autopilot) && owner.econ.treasury > BUILDINGS[b.type].cost) {
            owner.econ.treasury -= BUILDINGS[b.type].cost * REPAIR_COST_SHARE;
            b.repair = 0;
          }
          if (b.repair !== undefined) {
            b.repair = Math.min(1, b.repair + lumber / Math.max(1, BUILDINGS[b.type].days * REPAIR_TIME_SHARE));
            if (b.repair >= 1) {
              b.damaged = undefined; b.repair = undefined;
              if (owner?.controller === 'human') this.event('politics', owner.id, `${this.defs.get(owner.id)!.short}: the ${BUILDINGS[b.type].name.toLowerCase()} in ${prov.name ?? 'a province'} is repaired.`);
              this.warDirty = true;
            }
          }
          continue; // out of action until repaired
        }
        if (b.progress >= 1 && b.type === 'factory' && prov.owner && this.military.controller(p) === prov.owner) {
          this.factories.set(prov.owner, (this.factories.get(prov.owner) ?? 0) + 1);
        }
        let share = POWER_SHARE[b.type];
        if (share && b.type === 'renewables' && prov.owner !== undefined && this.hasAccess(prov.owner, 'lithium')) share *= 1.5; // batteries store wind and sun
        if (b.progress >= 1 && share && prov.owner && this.military.controller(p) === prov.owner) {
          const t = this.plants.get(prov.owner) ?? { share: 0, thermal: 0, coal: 0, gas: 0 };
          t.share += share;
          const fuel = POWER_FUEL[b.type];
          if (fuel) { t.thermal += share; t[fuel] += share * (this.hasLaw(this.nations.get(prov.owner)!, 'green_energy') ? 0.85 : 1); }
          this.plants.set(prov.owner, t);
        }
      }
    }
    // geothermal springs add steady power on top of any stations
    for (const n of this.nations.values()) {
      const geo = this.specialties(n.id).bonus.power + this.effects(n.id).power; // geothermal springs and energy technology
      if (!geo) continue;
      const t = this.plants.get(n.id) ?? { share: 0, thermal: 0, coal: 0, gas: 0 };
      t.share += geo;
      this.plants.set(n.id, t);
    }
  }

  private finished(owner: number | undefined, p: number, type: BuildingType) {
    const n = owner ? this.nations.get(owner) : undefined;
    if (!n) return;
    if (type === 'mine') {
      // the nation's main raw material
      const main = COMMODITIES.reduce((a, c) => (n.econ.capacity[c] * this.market.prices[c] > n.econ.capacity[a] * this.market.prices[a] ? c : a));
      n.econ.capacity[main] *= 1.04;
    }
    if (n.controller === 'human') this.event('politics', n.id, `${this.defs.get(n.id)!.short}: ${BUILDINGS[type].name} completed in ${this.military.provinces.get(p)?.name ?? 'a province'}.`);
    this.warDirty = true;
  }

  // ---- politics and research ---------------------------------------------------------
  /** One game day: research progress, reforms ending, national events, unrest. */
  private politicsDay(day: number) {
    this.councilDay(day);
    this.spyDay(day);
    for (const n of this.nations.values()) {
      if (n.annexedBy) continue;
      n.econ.treasury += (n.econ.gdp * (this.specialties(n.id).bonus.treasury + this.effects(n.id).treasury)) / 365; // gold fields, gem mines, financial technology
      this.domesticDay(n, day);
      this.statecraftDay(n, day);
      const name = this.defs.get(n.id)!.name;
      const human = n.controller === 'human';
      const cur = n.tech.current;
      const rate = this.researchRate(n);
      if (!cur) n.econ.research = Math.min(this.techCost(6), n.econ.research + rate); // nothing under way: bank the points
      if (cur) {
        const t = TECH_BY_ID.get(cur)!;
        const fromBank = Math.min(n.econ.research, rate * 0.5);
        n.econ.research -= fromBank;
        const p = (n.tech.partial[cur] ?? 0) + rate + fromBank;
        const shared = this.diplomacy.partners('research', n.id).some((x) => this.nations.get(x)?.tech.done.includes(cur));
        if (p >= this.techCost(t.tier) * (shared ? 0.8 : 1)) {
          n.tech.done.push(cur);
          delete n.tech.partial[cur];
          n.tech.current = undefined;
          this.effectCache.delete(n.id);
          if (human) this.event('research', n.id, `${name}: researchers complete ${t.name} (${t.text}).`);
          // the next in the queue whose prerequisites are now known
          const queue = n.tech.queue ?? [];
          const known = new Set(n.tech.done);
          const next = queue.find((q) => { const x = TECH_BY_ID.get(q); return !!x && ready(x, known); });
          if (next) { n.tech.current = next; n.tech.queue = queue.filter((q) => q !== next); }
          else if (n.controller === 'ai' || n.autopilot) n.tech.current = this.brain.pickResearch(n);
          this.touch(n, human);
        } else n.tech.partial[cur] = p;
      } else if (n.controller === 'ai' || n.autopilot) n.tech.current = this.brain.pickResearch(n);
      // vassals pay tribute
      const lord = this.diplomacy.overlords.get(n.id);
      if (lord !== undefined) {
        const pay = n.econ.gdp * TRIBUTE_SHARE / 365;
        n.econ.treasury -= pay;
        const o = this.nations.get(lord);
        if (o) o.econ.treasury += pay;
      }
      // elections in democracies, every two game years
      if (n.gov.government === 'democracy' && !n.gov.reformUntil) {
        n.gov.nextElection ??= day + 365 + (n.id * 37) % 365;
        if (day >= n.gov.nextElection) {
          n.gov.nextElection = day + 730;
          const win = Math.min(0.95, Math.max(0.1, (n.econ.stability - 35) / 80 + ((n.pol?.support ?? 50) - 30) / 80));
          let won = this.rand() < win;
          if (n.parties) {
            // the governing parties keep their majority, or a new coalition takes over (and parliament turns on you for a while)
            this.pollDay(n);
            for (const x of n.parties) x.seats = x.poll;
            n.campaign = 0;
            won = n.parties.filter((x) => x.gov).reduce((t, x) => t + x.seats, 0) >= 0.5;
            if (!won) {
              this.formCoalition(n);
              // the new government undoes a law its voters dislike
              const lead = n.parties.filter((x) => x.gov).sort((a, b) => b.seats - a.seats)[0];
              const drop = n.pol?.laws.find((l) => (LAWS[l].lean[lead.base] ?? 0) < 0);
              if (drop && n.pol) { n.pol.laws = n.pol.laws.filter((l) => l !== drop); this.event('politics', n.id, `${name}: the new ${lead.name}-led government repeals ${LAWS[drop].name.toLowerCase()}.`); }
            }
          }
          if (won) {
            if (human) this.event('politics', n.id, `${name}: the government wins re-election.`);
          } else {
            n.gov.oppositionUntil = day + 180;
            this.effectCache.delete(n.id);
            this.event('politics', n.id, `${name}: the government loses the election. For six months parliament will block any new war.`);
          }
          this.touch(n, human);
        }
      }
      if (n.gov.reformUntil !== undefined && day >= n.gov.reformUntil) {
        n.gov.reformUntil = undefined;
        this.effectCache.delete(n.id);
        this.event('politics', n.id, `The ${name} completes its transition to ${GOVERNMENT_INFO[n.gov.government].name.toLowerCase()}.`);
        this.touch(n);
      }
      const e = n.econ;
      // unrest: a nation in turmoil can see its government overthrown
      if (e.stability < 25 && this.rand() < 1 / 120) {
        const next: Government = n.gov.government === 'junta' ? 'democracy' : e.budget.military >= 25 ? 'junta' : n.gov.government === 'democracy' ? 'autocracy' : 'democracy';
        n.gov = { government: next, reformedAt: day };
        e.stability = 45;
        e.treasury -= e.gdp * 0.02;
        this.effectCache.delete(n.id);
        this.event('politics', n.id, next === 'junta'
          ? `Coup in the ${name}: the army seizes power and declares a military junta.`
          : `Revolution in the ${name}: the old regime falls; a ${GOVERNMENT_INFO[next].name.toLowerCase()} takes over.`);
        this.touch(n);
        continue;
      }
      // national events, about one every three game months (players decide theirs: see statecraftDay)
      if (!human && this.rand() < 1 / 90) {
        const r = this.rand();
        let text: string;
        if (r < 0.2) { e.gdp *= 1.005; text = 'an investment boom lifts the economy'; }
        else if (r < 0.35) { e.stability -= 6; text = 'a general strike paralyses the country (−6 stability)'; }
        else if (r < 0.5) { e.gdp *= 0.993; e.stability -= 3; text = 'floods and storms damage cities and farmland'; }
        else if (r < 0.65) { e.stability -= n.gov.government === 'democracy' ? 7 : 4; text = 'a corruption scandal shakes the government'; }
        else if (r < 0.8 && cur) { n.tech.partial[cur] = (n.tech.partial[cur] ?? 0) + this.techCost(TECH_BY_ID.get(cur)!.tier) * 0.15; text = `a research breakthrough speeds up ${TECH_BY_ID.get(cur)!.name}`; }
        else if (r < 0.88 && e.capacity.food > 0) { e.capacity.food *= 0.94; e.stability -= 2; text = 'a severe drought withers the harvest (food output −6%)'; }
        else if (r < 0.94) { e.gdp *= 0.997; e.stability -= 2; text = 'a heatwave strains power grids and hospitals'; }
        else { e.stability += 4; text = 'a national celebration lifts the public mood (+4 stability)'; }
        e.stability = Math.min(100, Math.max(0, e.stability));
        if (human) { this.event('politics', n.id, `${name}: ${text}.`); this.touch(n, false); }
      }
    }
  }

  // ---- politics -------------------------------------------------------------------
  private initialPolitics(n: NationState): NonNullable<NationState['pol']> {
    const gov = n.gov.government;
    const laws: LawId[] = gov === 'democracy' ? ['press_freedom'] : gov === 'junta' ? ['censorship', 'conscription'] : gov === 'autocracy' ? ['censorship'] : ['research_grants'];
    return { capital: 40, support: 55, laws, claims: [], goodwill: 0 };
  }

  hasLaw(n: NationState, law: LawId) { return !!n.pol?.laws.includes(law); }

  legislature(n: NationState): Legislature { return LEGISLATURE[n.gov.government] ?? 'decree'; }

  /** Whether laws, wars and steep taxes need the legislature's consent right now. */
  needsVote(n: NationState) {
    const leg = this.legislature(n);
    return (leg === 'parliament' || leg === 'council') && !this.hasLaw(n, 'emergency_powers') && !n.gov.reformUntil;
  }

  /** A war on this nation is justified: a claim, or it is at war with one of our friends. */
  justified(a: number, b: number) {
    const n = this.nations.get(a);
    if (n?.pol?.claims.includes(b)) return true;
    return this.military.enemiesOf(b).some((e) => this.diplomacy.allied(a, e) || this.diplomacy.guarantees(a, e));
  }

  politicsView(n: NationState): PoliticsPrivate | undefined {
    const p = n.pol;
    if (!p) return undefined;
    return {
      capital: Math.round(p.capital * 10) / 10, gain: Math.round(this.capitalGain(n) * 100) / 100, legislature: this.legislature(n),
      support: Math.round(p.support), laws: p.laws, demand: p.demand, claims: p.claims.filter((c) => !this.nations.get(c)?.annexedBy),
      emergencyUntil: this.hasLaw(n, 'emergency_powers') ? 1 : undefined,
    };
  }

  /** Political capital earned each day: a stable, legitimate government earns more. */
  capitalGain(n: NationState) {
    return Math.max(0.05, 0.12 + n.econ.stability / 250 + Math.max(0, this.fit(n)) * 0.03 + (n.policy.focus === 'diplomacy' ? 0.05 : 0));
  }

  private passLaw(n: NationState, law: LawId, enact: boolean): Result {
    const pol = n.pol!, spec = LAWS[law], name = this.defs.get(n.id)!.name;
    const has = pol.laws.includes(law);
    if (enact === has) return fail('not_allowed', has ? 'That law is already in force.' : 'That law is not in force.');
    if (enact) {
      const clash = (spec.excludes ?? []).find((x) => pol.laws.includes(x));
      if (clash) return fail('not_allowed', `Repeal ${LAWS[clash].name} first.`);
    }
    const leg = this.legislature(n), vote = this.needsVote(n);
    const cost = Math.round(spec.cost * (enact ? 1 : 0.5) * (vote ? 1 : DECREE_DISCOUNT));
    if (pol.capital < cost) return fail('no_funds', `Needs ${cost} political capital (you have ${Math.floor(pol.capital)}).`);
    if (leg === 'junta' && (spec.lean.military ?? 0) * (enact ? 1 : -1) < 0 && (n.soc?.factions.military ?? 50) < 70) {
      return fail('not_allowed', 'The officers will not allow it: the military would need to be very content (70+).');
    }
    if (vote) {
      const yes = lawVote({ legislature: leg, support: pol.support, factions: n.soc?.factions ?? { military: 50, business: 50, public: 50 } }, law, !enact);
      if (yes < 50) {
        pol.capital -= cost * 0.3;
        this.touch(n, false);
        return fail('not_allowed', `${leg === 'parliament' ? 'Parliament' : 'The council'} votes it down, ${yes}% in favour. It cost ${Math.round(cost * 0.3)} capital to try.`);
      }
      if (n.controller === 'human') this.event('politics', n.id, `${name}: ${leg === 'parliament' ? 'parliament' : 'the council'} ${enact ? 'passes' : 'repeals'} ${spec.name.toLowerCase()} (${yes}% in favour).`);
    } else {
      // by decree: whoever dislikes it resents being overruled
      const pub = (spec.lean.public ?? 0) * (enact ? 1 : -1);
      if (pub < 0 && n.soc) { n.soc.factions.public = Math.max(0, n.soc.factions.public + pub * 6); n.econ.stability = Math.max(0, n.econ.stability + pub * 3); }
      if (n.controller === 'human') this.event('politics', n.id, `${name}: ${enact ? 'decrees' : 'revokes'} ${spec.name.toLowerCase()}.`);
    }
    pol.capital -= cost;
    pol.laws = enact ? [...pol.laws, law] : pol.laws.filter((x) => x !== law);
    pol.lastLaw = this.market.day;
    this.effectCache.delete(n.id);
    this.checkDemand(n);
    this.touch(n, false);
    return ok;
  }

  /** Capital, parliament's mood, law upkeep and tariffs, and what parliament asks for. */
  private domesticDay(n: NationState, day: number) {
    const pol = n.pol ??= this.initialPolitics(n);
    const e = n.econ, f = n.soc?.factions ?? { military: 50, business: 50, public: 50 };
    pol.capital = Math.min(MAX_CAPITAL, pol.capital + this.capitalGain(n));
    pol.goodwill *= 0.995;
    const leg = this.legislature(n);
    const target = leg === 'council'
      ? 0.55 * f.business + 0.3 * e.stability + e.growth * 400 + pol.goodwill
      : 0.4 * f.public + 0.3 * f.business + 0.15 * f.military + 0.25 * (e.stability - 50) + 12 + pol.goodwill
        - ((n.gov.oppositionUntil ?? -1) > day ? 20 : 0) - (this.military.enemiesOf(n.id).length && !this.military.wars.some((w) => w.b === n.id) ? 8 : 0);
    const seats = n.parties ? n.parties.filter((x) => x.gov).reduce((t, x) => t + x.seats, 0) : null;
    const goal = seats === null ? target : target * 0.5 + (seats * 100) * 0.5 + (seats >= 0.5 ? 5 : -10); // a majority behind you counts
    pol.support += (Math.max(0, Math.min(100, goal)) - pol.support) * 0.03;
    // a coalition partner walks out when the government loses its way
    if (n.parties && pol.support < 30 && this.rand() < 0.01) {
      const partners = n.parties.filter((x) => x.gov);
      if (partners.length > 1) { const x = partners[partners.length - 1]; x.gov = false; if (n.controller === 'human') this.event('politics', n.id, `${this.defs.get(n.id)!.name}: the ${x.name} quits the governing coalition.`); }
    }
    for (const l of pol.laws) if (LAWS[l].upkeep) e.treasury -= (e.gdp * LAWS[l].upkeep!) / 365;
    if (pol.laws.includes('tariffs')) {
      const imports = COMMODITIES.reduce((t, c) => t + Math.max(0, -e.trade[c]) * this.market.prices[c], 0);
      e.treasury += (imports * 0.02) / 365;
    }
    // memories fade; envoys work on their hosts
    if (n.mem) for (const k of Object.keys(n.mem)) { n.mem[k as never] *= 0.997; if (Math.abs(n.mem[k as never]) < 0.5) delete n.mem[k as never]; }
    for (const v of n.envoys ?? []) if (v.until > day) this.remember(v.target, n.id, 0.25);
    if (n.envoys?.some((v) => v.until <= day)) n.envoys = n.envoys.filter((v) => v.until > day);
    // AI governments pass laws they like now and then
    if (n.controller === 'ai' || n.autopilot) {
      if (day % 45 === n.id % 45) this.brain.pickLaw(n);
      if (pol.capital > 150 && e.stability < 80) this.submit(n.id, { kind: 'appeal' }, 'ai');
      return;
    }
    // what parliament (or the elites) want from a player's government
    if (pol.demand) { if (!this.checkDemand(n) && day >= pol.demand.until) this.demandOutcome(n, false); }
    else if (day >= (pol.nextDemand ??= day + 60 + (n.id % 60))) this.newDemand(n, day);
  }

  private newDemand(n: NationState, day: number) {
    const pol = n.pol!, e = n.econ, f = n.soc?.factions ?? { military: 50, business: 50, public: 50 };
    const leg = this.legislature(n);
    // under a parliament or council the legislature asks; otherwise the unhappiest group of the elite
    const by: Demand['by'] = leg === 'parliament' || leg === 'council' ? 'parliament' : (['military', 'business', 'public'] as const).reduce((a, b) => (f[b] < f[a] ? b : a));
    const atWar = this.military.enemiesOf(n.id).length > 0;
    const opts: [DemandKind, string, number | undefined][] = [];
    if (by === 'parliament' || by === 'public') {
      if (e.budget.welfare < 60) opts.push(['welfare', `Raise welfare spending to ${e.budget.welfare + 5}% of the budget`, e.budget.welfare + 5]);
      if (atWar) opts.push(['peace', 'Make peace in every war', undefined]);
      if (n.policy.tax > LIMITS.taxMin + 3) opts.push(['lower_tax', `Cut taxes to ${n.policy.tax - 3}% or less`, n.policy.tax - 3]);
    }
    if (by === 'parliament' || by === 'business') {
      opts.push(['trade', 'Sign one more trade agreement', this.diplomacy.partners('trade', n.id).length + 1]);
      if (!pol.laws.includes('infrastructure_act')) opts.push(['infrastructure', 'Pass the Infrastructure act', undefined]);
      if (e.budget.research < 50) opts.push(['research', `Raise research spending to ${e.budget.research + 5}% of the budget`, e.budget.research + 5]);
    }
    if (by === 'military' || (by === 'parliament' && atWar)) {
      if (e.budget.military < 60) opts.push(['defence', `Raise defence spending to ${e.budget.military + 5}% of the budget`, e.budget.military + 5]);
    }
    if (!opts.length) { pol.nextDemand = day + 60; return; }
    const [kind, text, target] = opts[Math.floor(this.rand() * opts.length)];
    pol.demand = { kind, text, target, since: day, until: day + 90, by };
    this.event('politics', n.id, `${this.defs.get(n.id)!.name}: ${by === 'parliament' ? (leg === 'council' ? 'the council' : 'parliament') : `the ${by === 'public' ? 'public' : by}`} demands: ${text.toLowerCase()} (90 days).`);
    this.touch(n, false);
  }

  /** Whether the current demand is met; if so, the reward. */
  private checkDemand(n: NationState) {
    const d = n.pol?.demand;
    if (!d) return false;
    const e = n.econ;
    const met = d.kind === 'welfare' ? e.budget.welfare >= (d.target ?? 0) - 0.5
      : d.kind === 'research' ? e.budget.research >= (d.target ?? 0) - 0.5
      : d.kind === 'defence' ? e.budget.military >= (d.target ?? 0) - 0.5
      : d.kind === 'lower_tax' ? n.policy.tax <= (d.target ?? 0)
      : d.kind === 'peace' ? this.military.enemiesOf(n.id).length === 0
      : d.kind === 'trade' ? this.diplomacy.partners('trade', n.id).length >= (d.target ?? 0)
      : n.pol!.laws.includes('infrastructure_act');
    if (met) this.demandOutcome(n, true);
    return met;
  }

  private demandOutcome(n: NationState, met: boolean, refused = false) {
    const pol = n.pol!, d = pol.demand!, name = this.defs.get(n.id)!.name;
    const who = d.by === 'parliament' ? (this.legislature(n) === 'council' ? 'the council' : 'parliament') : `the ${d.by}`;
    if (met) {
      pol.goodwill += 15; pol.capital = Math.min(MAX_CAPITAL, pol.capital + 15);
      if (d.by !== 'parliament' && n.soc) n.soc.factions[d.by] = Math.min(100, n.soc.factions[d.by] + 12);
      this.event('politics', n.id, `${name}: ${who} is satisfied (${d.text.toLowerCase()}): +15 political capital and goodwill.`);
    } else {
      pol.goodwill -= refused ? 8 : 12;
      n.econ.stability = Math.max(0, n.econ.stability - (refused ? 2 : 3));
      if (d.by !== 'parliament' && n.soc) n.soc.factions[d.by] = Math.max(0, n.soc.factions[d.by] - 10);
      this.event('politics', n.id, `${name}: ${who} is ${refused ? 'rebuffed' : 'disappointed'} (${d.text.toLowerCase()}): support and stability fall.`);
    }
    pol.demand = undefined;
    pol.nextDemand = this.market.day + 75 + Math.floor(this.rand() * 60);
  }

  // ---- war score and peace conferences ---------------------------------------------
  /** Share of a nation's people living in a province. */
  popShare(nation: number, p: number) {
    return (this.military.provinces.get(p)?.pop ?? 0) / Math.max(1, this.ownedPop.get(nation) ?? 1);
  }

  /** War score of `me` against `foe`, -100..100: land held, battles won, units destroyed. */
  warScore(me: number, foe: number) {
    const m = this.military, w = m.warBetween(me, foe);
    if (!w) return 0;
    let mine = 0, theirs = 0;
    for (const [p, occ] of m.occupied) {
      const owner = m.provinces.get(p)?.owner;
      if (occ === me && owner === foe) theirs += this.popShare(foe, p);
      else if (occ === foe && owner === me) mine += this.popShare(me, p);
    }
    const i = w.a === me ? 0 : 1, j = 1 - i;
    const wins = (w.wins?.[i] ?? 0) - (w.wins?.[j] ?? 0), kills = (w.lost?.[j] ?? 0) - (w.lost?.[i] ?? 0);
    const score = (theirs - mine) * 130 + Math.max(-25, Math.min(25, wins * 2)) + Math.max(-25, Math.min(25, kills * 2));
    return Math.round(Math.max(-100, Math.min(100, score)));
  }

  treatyCostFor(winner: number, loser: number, t: PeaceTreaty) {
    const w = this.military.warBetween(winner, loser);
    return treatyCost(t, (p) => this.popShare(loser, p), w && w.a === winner ? w.goal : undefined);
  }

  private applyTreaty(winner: NationState, loser: NationState, t: PeaceTreaty) {
    const A = this.defs.get(winner.id)!.name, B = this.defs.get(loser.id)!.name, day = this.market.day;
    const provs = t.provinces.filter((p) => this.military.provinces.get(p)?.owner === loser.id);
    this.military.makePeace(winner.id, loser.id, (x) => this.home(x));
    if (provs.length) {
      for (const p of provs) this.diplomacy.formerOwner.set(p, loser.id);
      this.transfer(provs, loser, winner);
      for (const p of provs) this.diplomacy.unrest.set(p, Math.max(this.diplomacy.unrest.get(p) ?? 0, 40));
      if (this.provincesHeld(loser.id) === 0) this.annex(loser, winner.id);
    }
    if (t.reparations > 0) loser.repay = [...(loser.repay ?? []), { to: winner.id, share: t.reparations, until: day + REPARATION_YEARS * 365 }];
    if (t.demilitarize) {
      const border = [...this.military.provinces.values()].filter((p) => p.kind === 'land' && p.owner === loser.id && p.adj.some((q) => this.military.provinces.get(q)?.owner === winner.id)).map((p) => p.id);
      loser.mil.demil = { by: winner.id, until: day + DEMIL_YEARS * 365, provinces: border };
      for (const p of border) if (this.military.built(p, 'fort')) this.military.destroyBuilding(p);
      for (const x of this.nations.values()) if (x.id !== loser.id) this.remember(x.id, loser.id, -5); // humiliated
    }
    if (t.regime && !loser.annexedBy) {
      loser.gov = { government: t.regime, reformUntil: day + 60, reformedAt: day };
      if (loser.pol) loser.pol.laws = [];
      loser.parties = undefined;
      this.effectCache.delete(loser.id);
    }
    if (t.puppet && !loser.annexedBy) {
      this.diplomacy.overlords.set(loser.id, winner.id);
      this.diplomacy.leaveBloc(loser.id);
      for (const x of this.diplomacy.partners('alliance', loser.id)) this.diplomacy.cancel('alliance', loser.id, x);
    }
    this.remember(loser.id, winner.id, -20);
    this.event('peace', winner.id, `The ${A} and the ${B} sign a peace treaty: ${treatyText({ ...t, provinces: provs })}.`);
  }

  // ---- equipment ---------------------------------------------------------------------
  /** Kit made each game day: state arsenals (from the defence budget) and factories (with metals and power). */
  equipmentRate(n: NationState) {
    const e = n.econ;
    const metals = 1 - 0.6 * Math.min(1, e.short.metals), power = 1 - (e.blackout ?? 0);
    return (this.defenceIncome(n) / 365) * 5 * metals + Math.min(MAX_FACTORIES, this.factories.get(n.id) ?? 0) * 1.5 * metals * power;
  }

  /** The interest rate on a nation's debt: higher with more debt and more turmoil. */
  interestRate(n: NationState) {
    const debt = Math.max(0, -n.econ.treasury / n.econ.gdp);
    return Math.min(0.15, Math.max(0.015, 0.02 + debt * 0.05 + Math.max(0, 50 - n.econ.stability) * 0.0006));
  }

  // ---- events, parties, espionage, reparations, separatism ---------------------------
  /** Single-player advisers act once a game week in the areas the player gave them, and say what they did. */
  private advisersDay(n: NationState, day: number) {
    if (!this.opts.singlePlayer || !n.advisers?.length || n.controller !== 'human' || n.autopilot) return;
    const areas = new Set<string>(n.advisers);
    const did: string[] = [];
    if (areas.has('decisions') && n.event && day - n.event.day >= 3) {
      const key = n.event.key, i = this.aiChoice(n, key);
      this.resolveEvent(n, i);
      did.push(`answered "${EVENTS[key].title}": ${EVENTS[key].options[i].text.toLowerCase()}`);
    }
    if (day % 7 !== n.id % 7) { if (did.length) this.logAdvisers(n, day, did); return; }
    for (const o of this.brain.adviserOrders(n, areas)) {
      if (!this.submit(n.id, o, 'human').ok) continue;
      did.push(o.kind === 'budget' ? 'rebalanced the budget' : o.kind === 'policy' ? `set taxes to ${o.policy.tax}%`
        : o.kind === 'build' ? `began a ${BUILDINGS[o.building].name.toLowerCase()} in ${this.military.provinces.get(o.province)?.name ?? 'a province'}`
        : o.kind === 'recruit' ? `ordered a ${UNIT_SPECS[o.unit].name.toLowerCase()}`
        : o.kind === 'research' ? `started research on ${TECH_BY_ID.get(o.tech)?.name}` : o.kind === 'research_queue' ? `queued ${TECH_BY_ID.get(o.tech)?.name}`
        : o.kind === 'propose' ? `proposed ${dealText(o.deal)} to the ${this.defs.get(o.target)?.name}`
        : o.kind === 'counter_intel' ? `set counter-intelligence to level ${o.level}` : o.kind === 'network' ? `${o.build ? 'began recruiting agents in' : 'stopped recruiting in'} the ${this.defs.get(o.target)?.name}` : o.kind);
    }
    if (areas.has('laws') && day % 28 === n.id % 28) { const l = this.brain.pickLaw(n, 'human'); if (l) did.push(l); }
    if (did.length) this.logAdvisers(n, day, did);
  }

  private logAdvisers(n: NationState, day: number, did: string[]) {
    const date = new Date(this.worldStart + day * DAY).toISOString().slice(0, 10);
    n.adviserLog = [...did.map((d) => `${date}: ${d}`), ...(n.adviserLog ?? [])].slice(0, 40);
    this.touch(n, false);
  }

  private statecraftDay(n: NationState, day: number) {
    const human = n.controller === 'human' && !n.autopilot;
    this.advisersDay(n, day);
    // reparations
    if (n.repay?.length) {
      n.repay = n.repay.filter((r) => r.until > day && !this.nations.get(r.to)?.annexedBy);
      for (const r of n.repay) {
        const pay = (n.econ.gdp * r.share) / 365;
        n.econ.treasury -= pay;
        const to = this.nations.get(r.to);
        if (to) to.econ.treasury += pay;
      }
    }
    // parties
    if ((this.legislature(n) === 'parliament' || this.legislature(n) === 'council') && !n.gov.reformUntil) {
      if (!n.parties) this.initParties(n);
      if (day % 7 === n.id % 7) this.pollDay(n);
    } else if (n.parties) n.parties = undefined;
    // agent networks abroad, and counter-intelligence at home
    if (n.spy) {
      for (const t of n.spy.building) {
        if (n.mil.funds < NETWORK_COST) break;
        n.mil.funds -= NETWORK_COST;
        n.spy.nets[t] = Math.min(100, (n.spy.nets[t] ?? 0) + NETWORK_GROWTH);
      }
      for (const [k, v] of Object.entries(n.spy.nets)) {
        const t = this.nations.get(Number(k));
        if (!t || t.annexedBy) { delete n.spy.nets[k as never]; continue; }
        const next = v - (n.spy.building.includes(Number(k)) ? 0 : 0.05) - (t.spy?.counter ?? 0) * 0.25;
        if (next <= 0) delete n.spy.nets[k as never]; else n.spy.nets[k as never] = next;
      }
      if (n.spy.counter) n.econ.treasury -= (n.econ.gdp * COUNTER_INTEL_COST * n.spy.counter) / 365;
    }
    // decisions
    if (n.event && day - n.event.day >= EVENT_DAYS) this.resolveEvent(n, 0);
    const chained = Object.entries(n.flags ?? {}).find(([, at]) => at <= day);
    if (chained && !n.event) { delete n.flags![chained[0]]; this.raiseEvent(n, chained[0] as EventKey, day); }
    if (!n.event && day >= (n.nextEvent ??= day + 30 + (n.id % 40))) {
      n.nextEvent = day + (human ? 45 : 90) + Math.floor(this.rand() * 45);
      const key = this.pickEvent(n, day);
      if (key) this.raiseEvent(n, key, day);
    }
  }

  private raiseEvent(n: NationState, key: EventKey, day: number, about?: number) {
    if (n.controller === 'ai' || n.autopilot) { n.event = { key, day, about }; this.resolveEvent(n, this.aiChoice(n, key)); return; }
    n.event = { key, day, about };
    this.event('politics', n.id, `${this.defs.get(n.id)!.name}: ${EVENTS[key].title.toLowerCase()}. A decision is needed.`);
    this.touch(n, false);
  }

  /** Which event fits this nation now (null: nothing happens). */
  private pickEvent(n: NationState, day: number): EventKey | null {
    const e = n.econ, f = n.soc?.factions ?? { military: 50, business: 50, public: 50 };
    const pool: EventKey[] = ['strike', 'scandal', 'boom', 'drought', 'breakthrough', 'investment'];
    if (this.specialties(n.id).own.gold) pool.push('gold_rush', 'gold_rush');
    if ((e.capacity.oil ?? 0) > 0 && this.rand() < 0.5) pool.push('oil_find');
    if (e.short.food > 0.08) pool.push('famine', 'famine', 'famine');
    if ((n.gov.government === 'junta' || n.gov.government === 'autocracy') && (f.military < 40 || e.stability < 40)) pool.push('coup_plot', 'coup_plot');
    if (f.public < 35) pool.push('protests', 'protests');
    if (this.defs.get(n.id)?.neighbours.some((x) => this.military.enemiesOf(x).length)) pool.push('refugees');
    if (n.parties && n.gov.nextElection !== undefined && n.gov.nextElection - day < CAMPAIGN_DAYS && n.gov.nextElection - day > 10) pool.push('campaign', 'campaign');
    if ([...this.military.buildings.entries()].some(([p, list]) => this.military.provinces.get(p)?.owner === n.id && list.some((b) => b.damaged))) pool.push('storm_damage');
    if (!this.diplomacy.partners('trade', n.id).length) pool.splice(pool.indexOf('investment'), 1);
    return pool[Math.floor(this.rand() * pool.length)] ?? null;
  }

  private aiChoice(n: NationState, key: EventKey) {
    const p = n.personality;
    const pref: Partial<Record<EventKey, number>> = {
      strike: p === 'expansionist' ? 1 : p === 'idealist' ? 0 : 2, scandal: 0, boom: p === 'trader' ? 0 : 1, drought: 0, refugees: p === 'idealist' ? 0 : 1,
      breakthrough: 0, gold_rush: 0, boomtown: 1, oil_find: 0, famine: 1, coup_plot: 1, protests: p === 'idealist' ? 0 : 2, campaign: 2, investment: p === 'turtle' ? 1 : 0, storm_damage: 0, spy_caught: 0,
    };
    return pref[key] ?? 0;
  }

  /** Apply the chosen answer to the nation's pending event. */
  private resolveEvent(n: NationState, i: number) {
    const ev = n.event!;
    n.event = undefined;
    const e = n.econ, gdp = e.gdp, day = this.market.day, pol = n.pol!, f = n.soc?.factions;
    const fac = (k: 'military' | 'business' | 'public', v: number) => { if (f) f[k] = Math.max(0, Math.min(100, f[k] + v)); };
    const stab = (v: number) => { e.stability = Math.max(0, Math.min(100, e.stability + v)); };
    const k = `${ev.key}:${i}`;
    switch (k) {
      case 'strike:0': e.treasury -= gdp * 0.003; stab(5); fac('public', 8); fac('business', -6); break;
      case 'strike:1': stab(-4); fac('public', -12); fac('military', 5); break;
      case 'strike:2': n.flags = { ...n.flags, slump: day + 365 }; e.gdp *= 0.997; stab(1); break;
      case 'scandal:0': pol.capital = Math.max(0, pol.capital - 20); stab(2); break;
      case 'scandal:1': if (this.rand() < 0.5) { stab(-8); pol.support -= 10; } break;
      case 'scandal:2': pol.support -= 8; fac('public', -5); pol.capital += 10; break;
      case 'boom:0': e.gdp *= 1.006; stab(-2); break;
      case 'boom:1': e.treasury += gdp * 0.005; fac('business', -5); break;
      case 'drought:0': e.treasury -= gdp * 0.003; break;
      case 'drought:1': e.capacity.food *= 0.94; stab(-2); break;
      case 'refugees:0': e.pop *= 1.004; stab(-2); for (const x of this.defs.get(n.id)?.neighbours ?? []) this.remember(x, n.id, 5); break;
      case 'refugees:1': stab(1); n.policy.openBorders = false; for (const x of this.defs.get(n.id)?.neighbours ?? []) this.remember(x, n.id, -5); break;
      case 'breakthrough:0': if (n.tech.current) n.tech.partial[n.tech.current] = (n.tech.partial[n.tech.current] ?? 0) + 500; else e.research += 500; break;
      case 'breakthrough:1': e.treasury += gdp * 0.0025; break;
      case 'gold_rush:0': e.treasury += gdp * 0.004; n.flags = { ...n.flags, boomtown: day + 60 }; break;
      case 'gold_rush:1': e.treasury += gdp * 0.002; fac('business', -5); break;
      case 'boomtown:0': stab(-2); break;
      case 'boomtown:1': e.treasury -= gdp * 0.0015; stab(3); break;
      case 'oil_find:0': e.treasury -= gdp * 0.002; e.capacity.oil *= 1.12; break;
      case 'oil_find:1': e.treasury += gdp * 0.0025; e.capacity.oil *= 1.04; break;
      case 'famine:0': e.treasury -= gdp * 0.004; stab(3); break;
      case 'famine:1': if (!pol.laws.includes('rationing')) pol.laws = [...pol.laws, 'rationing']; stab(-2); this.effectCache.delete(n.id); break;
      case 'famine:2': {
        stab(-3);
        for (const x of this.diplomacy.partners('trade', n.id)) { const t = this.nations.get(x); if (t && this.opinion(x, n.id).total > 0) { const g = t.econ.gdp * 0.0005; t.econ.treasury -= g; e.treasury += g; e.stock.food += e.capacity.food * 0.02; } }
        break;
      }
      case 'coup_plot:0': fac('military', -15); stab(3); n.flags = { ...n.flags, purge: day + 120 }; break;
      case 'coup_plot:1': e.treasury -= gdp * 0.003; fac('military', 15); break;
      case 'coup_plot:2': if (this.rand() < 0.35) { e.stability = 20; fac('military', -30); } break; // the politics day may then see a coup
      case 'protests:0': pol.capital = Math.max(0, pol.capital - 15); fac('public', 10); stab(2); break;
      case 'protests:1': stab(2); fac('public', -10); if (n.soc) n.soc.ideology.liberty = Math.max(-1, n.soc.ideology.liberty - 0.05); break;
      case 'protests:2': stab(-3); break;
      case 'campaign:0': n.campaign = (n.campaign ?? 0) + 0.05; pol.demand = { kind: 'lower_tax', text: `Cut taxes to ${Math.max(LIMITS.taxMin, n.policy.tax - 3)}% or less`, target: Math.max(LIMITS.taxMin, n.policy.tax - 3), since: day, until: day + 180, by: 'parliament' }; break;
      case 'campaign:1': n.campaign = (n.campaign ?? 0) + 0.04; pol.demand = { kind: 'welfare', text: `Raise welfare spending to ${e.budget.welfare + 5}% of the budget`, target: e.budget.welfare + 5, since: day, until: day + 180, by: 'parliament' }; break;
      case 'campaign:2': n.campaign = (n.campaign ?? 0) + (e.stability > 60 ? 0.04 : -0.03); break;
      case 'investment:0': {
        e.gdp *= 1.004;
        const partner = this.diplomacy.partners('trade', n.id)[0];
        if (partner !== undefined) this.remember(partner, n.id, 8);
        if (n.soc) n.soc.ideology.openness = Math.min(1, n.soc.ideology.openness + 0.04);
        break;
      }
      case 'investment:1': fac('business', -5); stab(1); break;
      case 'storm_damage:0':
        for (const [p, list] of this.military.buildings) {
          if (this.military.provinces.get(p)?.owner !== n.id) continue;
          for (const b of list) if (b.damaged) { e.treasury -= BUILDINGS[b.type].cost * REPAIR_COST_SHARE; b.damaged = undefined; b.repair = undefined; }
        }
        this.warDirty = true;
        break;
      case 'spy_caught:0': if (ev.about !== undefined) { this.remember(ev.about, n.id, -25); const t = this.nations.get(ev.about); if (t?.spy) delete t.spy.nets[n.id]; } break;
      case 'spy_caught:1': if (ev.about !== undefined) { n.intel = { ...(n.intel ?? {}), [ev.about]: day + 60 }; const t = this.nations.get(ev.about); if (t?.spy?.nets[n.id]) t.spy.nets[n.id] *= 0.5; } break;
    }
    if (n.controller === 'human') this.event('politics', n.id, `${this.defs.get(n.id)!.name}: ${EVENTS[ev.key].title.toLowerCase()}: ${EVENTS[ev.key].options[i].text.toLowerCase()}.`);
    this.effectCache.delete(n.id);
    this.touch(n, false);
  }

  /** Four parties, picked by the nation's id, the governing coalition the closest to the government. */
  private initParties(n: NationState) {
    const pool = [...PARTY_POOL];
    const picked: typeof PARTY_POOL = [];
    let h = n.id * 2654435761 >>> 0;
    while (picked.length < PARTIES_PER_NATION && pool.length) { h = (Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0); picked.push(pool.splice(h % pool.length, 1)[0]); }
    n.parties = picked.map((p) => ({ ...p, seats: 0.25, poll: 0.25, gov: false }));
    this.pollDay(n);
    for (const x of n.parties) x.seats = x.poll;
    this.formCoalition(n);
  }

  /** The governing coalition: the party closest to the government's stance, then its nearest partners until a majority. */
  private formCoalition(n: NationState) {
    const ps = n.parties!, gov = GOV_LIBERTY[n.gov.government] ?? 0.5;
    for (const x of ps) x.gov = false;
    const lead = [...ps].sort((a, b) => b.seats - a.seats - (Math.abs(a.liberty - gov) - Math.abs(b.liberty - gov)) * 0.3)[0];
    lead.gov = true;
    let seats = lead.seats;
    const rest = ps.filter((x) => !x.gov).sort((a, b) => (Math.abs(a.liberty - lead.liberty) + Math.abs(a.openness - lead.openness)) - (Math.abs(b.liberty - lead.liberty) + Math.abs(b.openness - lead.openness)));
    for (const x of rest) { if (seats >= 0.5) break; x.gov = true; seats += x.seats; }
  }

  /** Polls: closeness to what the people believe, how each party's group feels, and the government's record. */
  private pollDay(n: NationState) {
    const ps = n.parties!, ide = n.soc?.ideology ?? { liberty: 0, openness: 0 }, f = n.soc?.factions ?? { military: 50, business: 50, public: 50 }, e = n.econ;
    const record = (e.stability - 55) / 120 + e.growth * 3 + (n.pol?.goodwill ?? 0) / 150 + (n.campaign ?? 0);
    const appeal = ps.map((x) => Math.max(0.05, 1 - Math.abs(x.liberty - ide.liberty) * 0.7 - Math.abs(x.openness - ide.openness) * 0.45 + (f[x.base] - 50) / 120 + (x.gov ? record : -record * 0.4)) ** 2);
    const total = appeal.reduce((t, v) => t + v, 0);
    ps.forEach((x, i) => { x.poll = Math.round((appeal[i] / total) * 1000) / 1000; });
  }

  // ---- relations ------------------------------------------------------------------
  /** Remember something one nation did to another (adds up, within ±100, and fades). */
  remember(of: number, about: number, v: number) {
    const n = this.nations.get(of);
    if (!n || of === about) return;
    n.mem ??= {};
    n.mem[about] = Math.max(-100, Math.min(100, (n.mem[about] ?? 0) + v));
  }

  /** What `of` thinks of `about`, and why. */
  opinion(of: number, about: number): Opinion {
    const a = this.nations.get(of), b = this.nations.get(about);
    const parts: [string, number][] = [];
    if (!a || !b) return { total: 0, parts };
    const d = this.diplomacy, m = this.military, add = (why: string, v: number) => { if (Math.round(v)) parts.push([why, Math.round(v)]); };
    if (a.soc && b.soc) { const gap = ideologyGap(a.soc.ideology, b.soc.ideology); add(gap < 0.75 ? 'Similar beliefs' : 'Different beliefs', 15 - gap * 20); }
    if (a.gov.government === b.gov.government) add('Same form of government', 5);
    for (const k of PACTS) {
      if (k === 'guarantee') { if (d.guarantees(about, of)) add('Guarantees our independence', PACT_INFO[k].opinion); }
      else if (d.has(k, of, about)) add(PACT_INFO[k].name, PACT_INFO[k].opinion);
    }
    const bloc = d.blocOf(of);
    if (bloc && bloc.members.includes(about)) add(`Fellow member of ${bloc.name}`, 15);
    if (d.overlords.get(of) === about) add('Our overlord', -15);
    if (d.contractsOf(of).some((c) => c.seller === about || c.buyer === about)) add('Supply contract', 5);
    if (m.atWar(of, about)) add('At war with us', -80);
    if (d.embargoed(about, of)) add('Embargoes us', -25);
    const foes = m.enemiesOf(of);
    if (foes.length && m.enemiesOf(about).some((x) => foes.includes(x))) add('A common enemy', 20);
    if (m.enemiesOf(about).some((x) => x !== of && (d.allied(of, x) || d.has('trade', of, x)))) add('At war with our friends', -25);
    if (this.defs.get(of)?.neighbours.includes(about) && !d.has('nap', of, about) && !d.allied(of, about)) add('Border tensions', -5);
    if (b.pol?.claims.includes(of)) add('Claims our land', -25);
    if (this.powerOf(about) > 0.15 && this.powerOf(about) > this.powerOf(of) * 3 && !d.allied(of, about)) add('Fears their power', -10);
    if (b.pol?.laws.includes('free_trade') && d.has('trade', of, about)) add('Their free trade', 5);
    if (b.pol?.laws.includes('tariffs') && d.has('trade', of, about)) add('Their tariffs', -6);
    if (b.policy.focus === 'diplomacy') add('Their diplomatic focus', 10);
    if ((b.envoys ?? []).some((v) => v.target === of && v.until > this.market.day)) add('Their envoy at our court', 10);
    if (b.soc?.propaganda.mode === 'abroad' && b.soc.propaganda.target === of) add('Their propaganda against us', -15);
    const mem = a.mem?.[about];
    if (mem) add(mem > 0 ? 'Good deeds remembered' : 'Wrongs remembered', mem);
    const total = Math.max(-100, Math.min(100, parts.reduce((t, [, v]) => t + v, 0)));
    return { total, parts };
  }

  /** Supply contracts: the seller ships its share each day from stock, the buyer pays the agreed price. */
  private contractsDay() {
    const d = this.diplomacy, day = this.market.day;
    const before = d.contracts.length;
    d.contracts = d.contracts.filter((c) => c.until > day && !this.nations.get(c.seller)?.annexedBy && !this.nations.get(c.buyer)?.annexedBy);
    if (d.contracts.length < before) this.warDirty = true;
    for (const c of d.contracts) {
      const s = this.nations.get(c.seller)!, b = this.nations.get(c.buyer)!;
      const q = Math.min(c.amount / 365, s.econ.stock[c.good]);
      const pay = Math.min(q * c.price, Math.max(0, b.econ.treasury + b.econ.gdp * 0.6));
      const got = c.price > 0 ? pay / c.price : q;
      s.econ.stock[c.good] -= got;
      b.econ.stock[c.good] += got;
      b.econ.treasury -= pay;
      s.econ.treasury += pay;
    }
  }

  /** A refused demand: the demander gains a claim, and the refuser remembers being threatened. */
  private refused(from: NationState, to: NationState) {
    if (from.pol && !from.pol.claims.includes(to.id)) from.pol.claims.push(to.id);
    this.remember(to.id, from.id, -10);
    this.event('diplomacy', from.id, `The ${this.defs.get(to.id)!.name} refuses the demands of the ${this.defs.get(from.id)!.name}, who now claims a just cause against it.`);
    this.touch(from, false);
  }

  // ---- diplomacy -----------------------------------------------------------------
  /** Why a deal between two nations cannot be made right now, or null if it can. */
  dealProblem(a: number, b: number, deal: Deal): string | null {
    const na = this.nations.get(a), nb = this.nations.get(b);
    if (!na || !nb || na.annexedBy || nb.annexedBy) return 'That nation no longer exists.';
    const d = this.diplomacy, name = this.defs.get(b)!.short;
    if (deal.kind === 'truce') {
      const w = this.military.warBetween(a, b);
      if (!w) return `You are not at war with the ${name}.`;
      if (this.military.inTruce(w)) return 'A truce already holds.';
      return TRUCE_DAYS.includes(deal.days) ? null : 'Choose 30, 90 or 180 days.';
    }
    if (deal.kind === 'peace') {
      if (!this.military.warBetween(a, b)) return `You are not at war with the ${name}.`;
      if (deal.terms === 'treaty' && deal.treaty) {
        const t = deal.treaty;
        if (t.provinces.some((p) => this.military.provinces.get(p)?.owner !== b)) return 'Only their own provinces can be ceded.';
        if (t.provinces.includes(this.defs.get(b)!.capital) && !t.puppet && t.provinces.length < this.provincesHeld(b)) return 'Their capital goes last: take it only with everything else.';
        if (t.reparations < 0 || t.reparations > MAX_REPARATIONS) return `Reparations are at most ${MAX_REPARATIONS * 100}% of GDP a year.`;
      }
      return null;
    }
    if (deal.kind === 'bloc') {
      const bloc = d.blocOf(a);
      if (!bloc || bloc.leader !== a) return 'Only a bloc leader can invite members.';
      if (bloc.members.length >= MAX_BLOC) return `${bloc.name} is full.`;
      if (d.blocOf(b)) return `The ${name} is already in a bloc.`;
      if (this.military.atWar(a, b)) return `You are at war with the ${name}.`;
      return null;
    }
    if (this.military.warBetween(a, b)) return `You are at war with the ${name}. Make peace first.`;
    if (deal.kind === 'gift') return deal.amount > 0 && na.econ.treasury >= deal.amount ? null : 'You cannot afford that gift.';
    if (deal.kind === 'demand') {
      if (deal.province !== undefined) {
        const p = this.military.provinces.get(deal.province);
        if (!p || p.owner !== b) return `That province is not the ${name}'s.`;
        if (this.defs.get(b)?.capital === deal.province || this.home(b) === deal.province) return 'No nation hands over its capital.';
        if (!p.adj.some((q) => this.military.provinces.get(q)?.owner === a)) return 'You can only demand a province on your border.';
        return null;
      }
      return deal.tribute && deal.tribute > 0 && deal.tribute <= nb.econ.gdp * 0.05 ? null : 'Tribute must be at most 5% of their GDP.';
    }
    if (deal.kind === 'contract') {
      if (!COMMODITIES.includes(deal.good) || !(deal.amount > 0) || !CONTRACT_YEARS.includes(deal.years)) return 'Choose a good, an amount and a length.';
      if (d.contractsOf(a).length >= MAX_CONTRACTS) return `You already have ${MAX_CONTRACTS} supply contracts.`;
      if (d.contractsOf(b).length >= MAX_CONTRACTS) return `The ${name} has no room for another contract.`;
      return null;
    }
    const kind = deal.kind as Pact;
    if (kind === 'guarantee' ? d.guarantees(a, b) : d.has(kind, a, b)) return `You already have that treaty with the ${name}.`;
    const max = PACT_INFO[kind].max;
    if (d.count(kind, a) >= max) return `You already have ${max} of those (${PACT_INFO[kind].name.toLowerCase()}).`;
    if (kind !== 'guarantee' && d.count(kind, b) >= max) return `The ${name} cannot take on another ${dealText(deal)}.`;
    if (deal.kind === 'alliance' && this.military.enemiesOf(b).some((e) => this.diplomacy.has('alliance', a, e))) {
      return `The ${name} is at war with one of your allies.`;
    }
    return null;
  }

  /** Put a deal into effect. `from` proposed it, `to` accepted. */
  private conclude(from: NationState, to: NationState, deal: Deal) {
    const A = this.defs.get(from.id)!.name, B = this.defs.get(to.id)!.name;
    if (deal.kind === 'peace' && deal.terms === 'treaty' && deal.treaty) {
      this.applyTreaty(from, to, deal.treaty);
      this.warChanged();
      for (const x of [from, to]) { this.touch(x); this.pushUnits(x); }
      return;
    }
    if (deal.kind === 'peace') {
      const ceded = deal.terms === 'cede' ? this.cede(from.id, to.id) : 0;
      this.military.makePeace(from.id, to.id, (x) => this.home(x));
      if (deal.terms === 'puppet' && !to.annexedBy) {
        this.diplomacy.overlords.set(to.id, from.id);
        this.diplomacy.leaveBloc(to.id);
        for (const x of this.diplomacy.partners('alliance', to.id)) this.diplomacy.cancel('alliance', to.id, x);
        this.event('peace', from.id, `The ${B} submits to the ${A} and becomes its vassal.`);
        this.warChanged();
        for (const x of [from, to]) { this.touch(x); this.pushUnits(x); }
        return;
      }
      this.event('peace', from.id, ceded
        ? `The ${A} and the ${B} make peace. The ${B} cedes ${ceded} province${ceded > 1 ? 's' : ''}.`
        : `The ${A} and the ${B} make peace. Occupied land is returned.`);
      if (to.annexedBy) this.event('peace', from.id, `The ${B} has ceased to exist; its last lands pass to the ${A}.`);
    } else if (deal.kind === 'bloc') {
      const bloc = this.diplomacy.blocOf(from.id)!;
      bloc.members.push(to.id);
      this.event('diplomacy', from.id, `The ${B} joins ${bloc.name}.`);
    } else if (deal.kind === 'truce') {
      const w = this.military.warBetween(from.id, to.id)!;
      w.truceUntil = this.gameNow() + deal.days * DAY;
      for (const u of this.military.units.values()) if ((u.nation === from.id || u.nation === to.id) && u.next !== undefined) { u.path = []; u.next = undefined; } // advances stop
      this.event('peace', from.id, `The ${A} and the ${B} agree a ${deal.days}-day truce. The lines hold where they stand.`);
    } else if (deal.kind === 'gift') {
      from.econ.treasury -= deal.amount;
      to.econ.treasury += deal.amount;
      this.remember(to.id, from.id, Math.min(40, 6 + 30 * deal.amount / Math.max(1, to.econ.gdp * 0.01)));
      this.event('diplomacy', from.id, `The ${A} sends the ${B} a gift of $${deal.amount}bn.`);
    } else if (deal.kind === 'demand') {
      this.remember(to.id, from.id, -10);
      if (deal.province !== undefined) {
        this.transfer([deal.province], to, from);
        this.event('diplomacy', from.id, `Under pressure, the ${B} hands ${this.military.provinces.get(deal.province)?.name ?? 'a province'} to the ${A}.`);
      } else {
        to.econ.treasury -= deal.tribute!;
        from.econ.treasury += deal.tribute!;
        this.event('diplomacy', from.id, `The ${B} pays the ${A} $${deal.tribute}bn in tribute.`);
      }
    } else if (deal.kind === 'contract') {
      const seller = deal.sell ? from.id : to.id, buyer = deal.sell ? to.id : from.id;
      const d = this.diplomacy;
      d.contracts.push({ id: d.nextId++, seller, buyer, good: deal.good, amount: deal.amount, price: this.market.prices[deal.good], until: this.market.day + deal.years * 365 });
      this.event('diplomacy', from.id, `The ${A} and the ${B} sign a ${deal.years}-year contract for ${COMMODITY_INFO[deal.good].name.toLowerCase()}.`);
    } else {
      this.diplomacy.sign(deal.kind, from.id, to.id, this.market.day);
      this.event('diplomacy', from.id, deal.kind === 'guarantee'
        ? `The ${A} guarantees the independence of the ${B}.`
        : `The ${A} and the ${B} sign ${deal.kind === 'alliance' ? 'a defensive alliance' : deal.kind === 'trade' ? 'a trade agreement' : `a ${PACT_INFO[deal.kind].name.toLowerCase()}`}.`);
    }
    this.warChanged();
    for (const x of [from, to]) { this.touch(x, false); this.pushUnits(x); }
  }

  /** The winner keeps the loser's provinces it occupies, with their people and output. Returns how many. */
  private cede(winner: number, loser: number) {
    const m = this.military, lose = this.nations.get(loser)!, win = this.nations.get(winner)!;
    const taken = [...m.occupied].filter(([p, occ]) => occ === winner && m.provinces.get(p)!.owner === loser).map(([p]) => p);
    if (!taken.length) return 0;
    this.transfer(taken, lose, win);
    for (const p of taken) { this.diplomacy.unrest.set(p, 60); this.diplomacy.formerOwner.set(p, loser); }
    if (win.controller === 'human' && win.userId) this.achievements.award(win.userId, 'first_victory');
    if (![...m.provinces.values()].some((p) => p.kind === 'land' && p.owner === loser)) this.annex(lose, win.id);
    return taken.length;
  }

  /** Provinces change hands with their people and output. */
  private transfer(provs: number[], from: NationState, to: NationState) {
    const m = this.military;
    const pop = provs.reduce((s, p) => s + m.provinces.get(p)!.pop, 0);
    const f = Math.min(1, pop / Math.max(1, this.ownedPop.get(from.id) ?? 0));
    for (const p of provs) {
      m.provinces.get(p)!.owner = to.id;
      m.occupied.delete(p);
      this.diplomacy.owners.set(p, to.id);
    }
    const a = from.econ, b = to.econ;
    b.gdp += a.gdp * f; b.pop += a.pop * f;
    a.gdp *= 1 - f; a.pop *= 1 - f;
    for (const c of COMMODITIES) { b.capacity[c] += a.capacity[c] * f; a.capacity[c] *= 1 - f; }
    this.countOwnedPop();
  }

  /** Share of a nation's people lost to unrest in conquered provinces (half the unrest counts against control). */
  unrestLoss(nation: number) {
    let lost = 0;
    for (const [p, u] of this.diplomacy.unrest) {
      const prov = this.military.provinces.get(p);
      if (prov?.owner === nation) lost += prov.pop * u / 200;
    }
    for (const p of this.nations.get(nation)?.autonomy ?? []) { const prov = this.military.provinces.get(p); if (prov?.owner === nation) lost += prov.pop * 0.25; }
    return lost / Math.max(1, this.ownedPop.get(nation) ?? 1);
  }

  /** How much of the world market is closed to a nation by embargoes (weighted by the embargoing economies). */
  embargoPressure(nation: number) {
    const from = this.diplomacy.embargoes.filter((e) => e.to === nation).map((e) => e.from);
    if (!from.length) return 0;
    const world = [...this.nations.values()].reduce((s, n) => s + (n.annexedBy ? 0 : n.econ.gdp), 0);
    const closed = from.reduce((s, id) => s + (this.nations.get(id)?.econ.gdp ?? 0), 0);
    return Math.min(0.6, 1.5 * closed / Math.max(1, world));
  }

  /** Conquered land settles down slowly; garrisons and welfare help. Unrest can boil over. */
  private unrestDay() {
    const m = this.military;
    for (const [p, u] of [...this.diplomacy.unrest]) {
      const prov = m.provinces.get(p)!, owner = prov.owner!;
      const n = this.nations.get(owner);
      if (!n || n.annexedBy) { this.diplomacy.unrest.delete(p); continue; }
      const garrison = m.unitsIn(p).filter((x) => x.nation === owner && UNIT_SPECS[x.type].domain === 'land');
      const autonomous = !!n.autonomy?.includes(p);
      const next = u - 0.25 - (garrison.length ? 0.6 : 0) - Math.max(0, n.econ.budget.welfare - 35) * 0.02 - (autonomous ? 0.75 : 0);
      if (next <= 0) { this.diplomacy.unrest.delete(p); this.diplomacy.formerOwner.delete(p); continue; }
      this.diplomacy.unrest.set(p, next);
      if (autonomous || this.rand() >= next / 100 / 40) continue;
      const where = prov.name ?? 'a province';
      if (garrison.length) {
        for (const x of garrison) x.strength = Math.max(10, x.strength - 15);
        this.event('war', owner, `Uprising in ${where}: the ${this.defs.get(owner)!.short} garrison puts it down at a cost.`);
        this.diplomacy.unrest.set(p, Math.max(0, next - 20));
        continue;
      }
      const back = this.nations.get(this.diplomacy.formerOwner.get(p) ?? -1);
      if (back && !back.annexedBy && !this.military.atWar(owner, back.id)) {
        this.transfer([p], n, back);
        this.diplomacy.unrest.delete(p);
        this.diplomacy.formerOwner.delete(p);
        this.event('war', owner, `Revolt in ${where}: the province throws off ${this.defs.get(owner)!.short} rule and returns to the ${this.defs.get(back.id)!.name}.`);
        this.warChanged();
        this.touch(n);
        this.touch(back);
      } else if ((!back || back.annexedBy) && next > 60 && prov.pop > 2e5) {
        // nobody to go back to: the separatists declare their own nation, with any restless neighbours
        const with_ = [p, ...prov.adj.filter((q) => m.provinces.get(q)?.owner === owner && (this.diplomacy.unrest.get(q) ?? 0) > 40)].slice(0, 3);
        for (const q of with_) { this.diplomacy.unrest.delete(q); this.diplomacy.formerOwner.delete(q); }
        this.createNation(n, with_, 'revolt');
        this.event('war', owner, `Separatists in ${where} declare independence from the ${this.defs.get(owner)!.name}!`);
      } else {
        n.econ.stability = Math.max(0, n.econ.stability - 3);
        this.event('war', owner, `Riots in ${where} against ${this.defs.get(owner)!.short} rule.`);
      }
    }
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
  if (x.kind === 'alliance' || x.kind === 'trade' || x.kind === 'bloc' || x.kind === 'nap' || x.kind === 'access' || x.kind === 'research' || x.kind === 'guarantee') return { kind: x.kind };
  if (x.kind === 'truce') { const days = Number(x.days); return TRUCE_DAYS.includes(days) ? { kind: 'truce', days } : null; }
  if (x.kind === 'peace' && x.terms === 'treaty') {
    const t = x.treaty as PeaceTreaty | undefined;
    if (!t || typeof t !== 'object') return null;
    const provinces = Array.isArray(t.provinces) ? [...new Set(t.provinces.filter((p) => Number.isInteger(p)))].slice(0, 60) : [];
    const reparations = typeof t.reparations === 'number' && Number.isFinite(t.reparations) ? Math.round(Math.max(0, t.reparations) * 1000) / 1000 : 0;
    const regime = t.regime && GOVERNMENTS.includes(t.regime) ? t.regime : undefined;
    return { kind: 'peace', terms: 'treaty', treaty: { provinces, reparations, demilitarize: !!t.demilitarize, regime, puppet: !!t.puppet } };
  }
  if (x.kind === 'peace') return { kind: 'peace', terms: x.terms === 'cede' || x.terms === 'puppet' ? x.terms : 'white' };
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  if (x.kind === 'gift') { const a = Math.round(num(x.amount) * 10) / 10; return a > 0 ? { kind: 'gift', amount: a } : null; }
  if (x.kind === 'contract') {
    const amount = num(x.amount), years = num(x.years);
    return COMMODITIES.includes(x.good) && amount > 0 ? { kind: 'contract', good: x.good, amount, years, sell: !!x.sell } : null;
  }
  if (x.kind === 'demand') {
    if (x.province !== undefined) return Number.isInteger(x.province) ? { kind: 'demand', province: x.province } : null;
    const t = Math.round(num(x.tribute) * 10) / 10;
    return t > 0 ? { kind: 'demand', tribute: t } : null;
  }
  return null;
}

/** Governments the world starts with, by the AI's character. */
function startingGovernment(p: Personality, id: number): Government {
  if (p === 'expansionist') return id % 2 ? 'junta' : 'autocracy';
  if (p === 'turtle' || p === 'opportunist') return id % 3 ? 'autocracy' : 'democracy';
  if (p === 'idealist') return id % 3 ? 'democracy' : 'technocracy';
  return id % 4 ? 'democracy' : 'technocracy';
}

const FIRST = ['Ari', 'Bela', 'Cato', 'Dara', 'Emil', 'Faro', 'Gida', 'Hale', 'Ines', 'Joru', 'Kaya', 'Lev', 'Mira', 'Nico', 'Oren', 'Pia', 'Rasa', 'Soren', 'Tala', 'Vik'];
const LAST = ['Adler', 'Brann', 'Corvo', 'Dahl', 'Esker', 'Falk', 'Grane', 'Hollis', 'Iver', 'Juno', 'Kessler', 'Lund', 'Marek', 'Novak', 'Orlov', 'Petra', 'Quint', 'Rhee', 'Sato', 'Varga'];
function generalName(rand: () => number) {
  return `Gen. ${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`;
}

function hslHex(h: number, s: number, l: number) {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (k: number) => { const t = (k + h / 30) % 12; return Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(t - 3, 9 - t, 1)))).toString(16).padStart(2, '0'); };
  return `#${f(0)}${f(8)}${f(4)}`;
}
