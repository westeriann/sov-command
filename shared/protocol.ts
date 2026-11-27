import type { RoadState } from './roads';
// Messages between browser and world server, shared by both sides.
//
// Every nation has a controller: a human player or the server's AI. Both send
// the same orders through the same validation, and both only see what their
// nation is allowed to see. Nothing in this file may depend on Node or the DOM.

import type { Budget, EconomyPrivate, EconomyPublic, MarketSnapshot } from './economy';
import type { MilitaryPrivate, Mission, UnitType, UnitView, War } from './military';
import type { Bloc, Contract, Deal, DealKind, Opinion, Pact, Proposal, Resolution, ResolutionKind, SpyMission, Treaty } from './diplomacy';
import type { LawId, PoliticsPrivate } from './politics';
import type { EventKey, PendingEvent } from './events';
import type { Party } from './parties';
import type { WarGoal } from './military';
import type { Government, ResearchPrivate, TechId } from './research';
import type { GameSettings } from './settings';
import type { BuildingState, BuildingType } from './buildings';
import type { Specialty } from './specialties';
import type { FlagSpec } from './flags';
import type { AchievementKey, SeasonMission } from './goals';
import type { Ideology, PropagandaMode, SocietyPrivate } from './society';

export type Focus = 'economy' | 'military' | 'research' | 'diplomacy';
/** What single-player advisers may handle for you. */
export type AdviserArea = 'budget' | 'build' | 'research' | 'recruit' | 'trade' | 'laws' | 'decisions' | 'espionage';
export const ADVISER_AREAS: [AdviserArea, string, string][] = [
  ['budget', 'Budget and taxes', 'Keep the books near balance and the budget suited to the times'],
  ['build', 'Construction', 'Power stations before blackouts, then factories, mines and defences'],
  ['research', 'Research', 'Keep something researched and the queue filled'],
  ['recruit', 'Recruitment', 'Keep the forces at the size the defence budget pays for'],
  ['trade', 'Trade and treaties', 'Trade deals, non-aggression pacts, research cooperation and supply contracts'],
  ['laws', 'Laws', 'Pass laws that suit the government, when capital allows'],
  ['decisions', 'Decisions', 'Answer events after three days if you have not'],
  ['espionage', 'Espionage', 'Counter-intelligence and agent networks in rivals'],
];
export type Personality = 'expansionist' | 'trader' | 'turtle' | 'opportunist' | 'idealist';

export const FOCI: Focus[] = ['economy', 'military', 'research', 'diplomacy'];
export const PERSONALITIES: Personality[] = ['expansionist', 'trader', 'turtle', 'opportunist', 'idealist'];

export const LIMITS = {
  taxMin: 10,
  taxMax: 45,
  chatLength: 280,
  nameMin: 3,
  nameMax: 20,
  passwordMin: 8,
} as const;

/** National policy. Stage 3's economy turns these into money and output. */
export interface Policy {
  focus: Focus;
  tax: number; // percent of GDP, LIMITS.taxMin..taxMax
  openBorders?: boolean; // take in refugees (default yes)
}

/** What is happening to the whole world. */
export type GlobalEventKind = 'crash' | 'pandemic' | 'oil_shock' | 'tech_boom';
export interface WorldState {
  warming: number; // °C above the start
  event?: { kind: GlobalEventKind; until: number; text: string }; // until: game day
}

/** What every player may know about a nation. */
export interface NationPublic {
  id: number;
  controller: 'ai' | 'human';
  player?: string; // display name, human nations only
  online?: boolean; // human nations only
  autopilot?: boolean; // human nation currently governed by the AI
  personality?: Personality; // AI nations only
  focus: Focus;
  army?: number; // intelligence estimate: divisions, rounded to the nearest 5
  annexedBy?: number; // the nation no longer exists; its land belongs to this one
  government?: Government;
  techs?: number; // technologies researched
  nuclear?: boolean; // holds nuclear warheads
  satellites?: number; // in orbit (launches are seen by everyone)
  ideology?: Ideology; // public opinion is no secret
  parties?: { name: string; colour: string; seats: number; gov: boolean; liberty: number }[]; // parliament's make-up is public
  // nations born in revolts and civil wars: what the map file cannot know
  def?: { name: string; short: string; color: string; capital: number; label: number };
  // a player's own name, colour and flag for the nation (absent: the map's defaults)
  name?: string;
  short?: string;
  color?: string;
  flag?: FlagSpec;
}

/** What only the nation's own player may know. */
export interface NationPrivate extends NationPublic {
  tax: number;
  claimedAt?: number; // real ms
  econ?: EconomyPrivate;
  mil?: MilitaryPrivate;
  diplo?: { incoming: Proposal[]; outgoing: Proposal[] };
  research?: ResearchPrivate;
  /** specialties held (provinces of each) and luxuries reaching us through trade partners */
  specialties?: { own: Partial<Record<Specialty, number>>; shared: Specialty[] };
  reports?: string[]; // intelligence reports, newest first
  spyOps?: number; // operations under way
  openBorders?: boolean;
  missions?: SeasonMission[]; // this season's goals
  society?: SocietyPrivate;
  politics?: PoliticsPrivate;
  relations?: Record<number, Opinion>; // what each nation thinks of us, and why
  contracts?: Contract[];
  envoys?: { target: number; until: number }[];
  event?: PendingEvent; // a decision waiting for us
  parties?: Party[]; // parliament's parties (democracies and technocracies)
  election?: number; // game day of the next election
  campaigned?: boolean; // a campaign push is under way
  spy?: { nets: Record<number, number>; building: number[]; counter: number; foreign: number }; // our networks abroad; counter-intelligence level; how much foreign networks hold here (0..100)
  warScores?: Record<number, number>; // war score against each enemy (-100..100)
  reparations?: { to: number; share: number; until: number }[]; // what we pay (to: payee) or receive (share < 0)
  demil?: { by: number; until: number; provinces: number[] };
  rate?: number; // interest rate on our debt, a year
  autonomy?: number[]; // provinces we have granted autonomy
  pause?: { votes: number; needed: number; mine: boolean; paused: boolean }; // the pause vote of a shared world
  advisers?: { areas: AdviserArea[]; log: string[]; available: boolean }; // single player
}

/** Front lines and wars are public knowledge. */
export interface WarState {
  wars: War[];
  occupied: Record<number, number>; // province id -> occupying nation
  battles: number[]; // provinces with fighting today
  treaties: Treaty[];
  owners: Record<number, number>; // province id -> nation, where land changed hands by treaty
  buildings: Record<number, BuildingState[]>; // province id -> buildings (finished and under way)
  nuked: number[]; // provinces struck by nuclear weapons
  roads?: RoadState[]; // roads built and under way
  embargoes: { from: number; to: number }[];
  unrest: Record<number, number>; // province id -> unrest 0..100 in recently conquered land
  blocs: Bloc[];
  council: Resolution[]; // open resolutions and the most recent results
  vassals: Record<number, number>; // vassal -> overlord
  // r in km: aircraft grounded, ships battered. Hurricanes (rare, warm seas only) have a category 1-5,
  // a name, and a heading (degrees/day) the map uses to turn and draw them
  storms: { lon: number; lat: number; r: number; kind?: 'storm' | 'hurricane'; cat?: number; name?: string; vlon?: number; vlat?: number }[];
  lanes: { a: number; b: number; path: number[]; raided: boolean }[]; // sea routes of trade agreements
}

/** Daily economy broadcast: world market plus every nation's public figures. */
export interface EconomyUpdate {
  market: MarketSnapshot;
  nations: EconomyPublic[];
  season?: SeasonInfo;
  world?: WorldState;
}

/** Lets the client run the world clock locally between messages. */
export interface ClockInfo {
  openedReal: number; // real ms when the world opened
  openedGame: number; // game ms at that moment
  speed: number; // game seconds per real second
  serverNow: number; // server's real ms when this was sent
}

export type EventKind = 'claim' | 'release' | 'autopilot' | 'policy' | 'world' | 'war' | 'peace' | 'diplomacy' | 'politics' | 'research';

export interface WorldEvent {
  at: number; // game ms
  kind: EventKind;
  nation?: number;
  text: string;
}

export type ChatChannel = 'world' | 'allies' | 'direct';
export interface ChatLine {
  at: number; // real ms
  from: string;
  nation?: number;
  text: string;
  channel?: ChatChannel; // world when absent
  to?: number; // direct messages: the nation addressed
}

/** Seasons: scores build up every game day; the leader when the season ends wins it. */
export interface SeasonInfo {
  number: number;
  startedAt: number; // real ms
  endsAt: number; // real ms
  leaders: { nation: number; score: number; power: number; badges?: number }[]; // top 20; power = share of world strength now; badges: the leader's achievements
  history: { d: number; s: Record<number, number>; p?: Record<number, number> }[]; // the leaders' scores (s) and share of world power in % (p), every other day
  hallOfFame: { season: number; endedAt: number; nation: number; name: string; player?: string; score: number }[];
}

export interface Me {
  id: number;
  name: string;
  guest: boolean;
  nation: number | null;
  admin?: boolean; // may use the moderation tools
  achievements?: AchievementKey[];
}

export type Order =
  | { kind: 'policy'; policy: Partial<Policy> }
  | { kind: 'autopilot'; on: boolean }
  | { kind: 'budget'; budget: Partial<Budget> }
  | { kind: 'recruit'; unit: UnitType }
  | { kind: 'move'; units: number[]; to: number }
  | { kind: 'halt'; units: number[] }
  | { kind: 'mission'; units: number[]; mission: Mission | null }
  | { kind: 'war'; target: number; goal?: WarGoal }
  | { kind: 'peace'; target: number } // offer white peace, or accept theirs
  | { kind: 'propose'; target: number; deal: Deal }
  | { kind: 'answer'; from: number; deal: DealKind; accept: boolean }
  | { kind: 'cancel'; target: number; pact: Pact }
  | { kind: 'research'; tech: TechId }
  | { kind: 'research_queue'; tech: TechId; remove?: boolean } // line up (or take out) a technology after the current one
  | { kind: 'build'; province: number; building: BuildingType }
  | { kind: 'road'; path: number[]; pts: [number, number][] }
  | { kind: 'repair'; province: number; building: BuildingType } // fix a building a hurricane damaged
  | { kind: 'general'; unit: number }
  | { kind: 'missile'; province: number }
  | { kind: 'warhead' }
  | { kind: 'embargo'; target: number; on: boolean }
  | { kind: 'bloc_create'; name: string }
  | { kind: 'bloc_leave' }
  | { kind: 'resolution'; resolution: ResolutionKind; target: number; target2?: number }
  | { kind: 'vote'; id: number; yes: boolean }
  | { kind: 'spy'; target: number; mission: SpyMission }
  | { kind: 'release'; target: number } // free a vassal
  | { kind: 'rally'; province: number | null } // new land units march here
  | { kind: 'borders'; open: boolean }
  | { kind: 'satellite' }
  | { kind: 'propaganda'; mode: PropagandaMode; target?: number }
  | { kind: 'asat'; target: number }
  | { kind: 'customize'; name?: string; short?: string; color?: string; flag?: FlagSpec }
  | { kind: 'nuke'; province: number }
  | { kind: 'government'; government: Government }
  | { kind: 'law'; law: LawId; enact: boolean } // pass or repeal
  | { kind: 'dismiss_demand' } // refuse what parliament (or the elites) ask
  | { kind: 'denounce'; target: number }
  | { kind: 'envoy'; target: number } // a diplomatic mission to improve relations
  | { kind: 'end_contract'; id: number }
  | { kind: 'appeal' } // a national appeal: spend political capital for stability
  | { kind: 'choose'; event: EventKey; option: number }
  | { kind: 'campaign' }
  | { kind: 'coalition'; party: string; join: boolean }
  | { kind: 'autonomy'; province: number }
  | { kind: 'network'; target: number; build: boolean }
  | { kind: 'counter_intel'; level: number }
  | { kind: 'pause_vote'; on: boolean }
  | { kind: 'advisers'; areas: AdviserArea[] }; // single player: what the advisers may handle // shared worlds pause when every player online agrees

export type ClientMsg =
  | { t: 'hello'; token: string }
  | { t: 'claim'; nation: number }
  | { t: 'found'; province: number } // lead a revolt and found a new nation
  | { t: 'release' }
  | { t: 'order'; order: Order }
  | { t: 'chat'; text: string; channel?: ChatChannel; to?: number }
  | { t: 'ping'; at: number };

export type ServerMsg =
  | {
      t: 'welcome';
      you: Me;
      clock: ClockInfo;
      settings?: GameSettings; // the map and mode the world was made with
      nations: NationPublic[];
      mine: NationPrivate | null;
      events: WorldEvent[];
      chat: ChatLine[];
      online: number;
      economy: EconomyUpdate;
      war: WarState;
      units: UnitView[];
    }
  | { t: 'units'; units: UnitView[] } // everything your nation can see right now
  | { t: 'war'; war: WarState }
  | { t: 'you'; you: Me }
  | { t: 'nation'; nation: NationPublic }
  | { t: 'mine'; nation: NationPrivate | null }
  | { t: 'event'; event: WorldEvent }
  | { t: 'chat'; line: ChatLine }
  | { t: 'online'; count: number }
  | { t: 'economy'; economy: EconomyUpdate }
  | { t: 'error'; code: ErrorCode; message: string }
  | { t: 'pong'; at: number; serverNow: number }
  | { t: 'clock'; clock: ClockInfo }; // the game speed changed

export type ErrorCode =
  | 'auth' | 'bad_request' | 'rate_limited' | 'taken' | 'already_ruling' | 'not_ruling' | 'not_found'
  | 'no_route' | 'not_allowed' | 'no_funds';

/** Account endpoints (HTTP JSON). */
export interface AuthRequest { name: string; password: string }
export interface AuthResponse { token: string; you: Me; recovery?: string } // recovery: shown once, after registering or recovering
export interface ApiError { error: string }
