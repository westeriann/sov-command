// Messages between browser and world server, shared by both sides.
//
// Every nation has a controller: a human player or the server's AI. Both send
// the same orders through the same validation, and both only see what their
// nation is allowed to see. Nothing in this file may depend on Node or the DOM.

import type { Budget, EconomyPrivate, EconomyPublic, MarketSnapshot } from './economy';
import type { MilitaryPrivate, Mission, UnitType, UnitView, War } from './military';
import type { Deal, DealKind, Pact, Proposal, Treaty } from './diplomacy';

export type Focus = 'economy' | 'military' | 'research' | 'diplomacy';
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
}

/** What only the nation's own player may know. */
export interface NationPrivate extends NationPublic {
  tax: number;
  claimedAt?: number; // real ms
  econ?: EconomyPrivate;
  mil?: MilitaryPrivate;
  diplo?: { incoming: Proposal[]; outgoing: Proposal[] };
}

/** Front lines and wars are public knowledge. */
export interface WarState {
  wars: War[];
  occupied: Record<number, number>; // province id -> occupying nation
  battles: number[]; // provinces with fighting today
  treaties: Treaty[];
  owners: Record<number, number>; // province id -> nation, where land changed hands by treaty
}

/** Daily economy broadcast: world market plus every nation's public figures. */
export interface EconomyUpdate {
  market: MarketSnapshot;
  nations: EconomyPublic[];
}

/** Lets the client run the world clock locally between messages. */
export interface ClockInfo {
  openedReal: number; // real ms when the world opened
  openedGame: number; // game ms at that moment
  speed: number; // game seconds per real second
  serverNow: number; // server's real ms when this was sent
}

export type EventKind = 'claim' | 'release' | 'autopilot' | 'policy' | 'world' | 'war' | 'peace' | 'diplomacy';

export interface WorldEvent {
  at: number; // game ms
  kind: EventKind;
  nation?: number;
  text: string;
}

export interface ChatLine {
  at: number; // real ms
  from: string;
  nation?: number;
  text: string;
}

export interface Me {
  id: number;
  name: string;
  guest: boolean;
  nation: number | null;
}

export type Order =
  | { kind: 'policy'; policy: Partial<Policy> }
  | { kind: 'autopilot'; on: boolean }
  | { kind: 'budget'; budget: Partial<Budget> }
  | { kind: 'recruit'; unit: UnitType }
  | { kind: 'move'; units: number[]; to: number }
  | { kind: 'halt'; units: number[] }
  | { kind: 'mission'; units: number[]; mission: Mission | null }
  | { kind: 'war'; target: number }
  | { kind: 'peace'; target: number } // offer white peace, or accept theirs
  | { kind: 'propose'; target: number; deal: Deal }
  | { kind: 'answer'; from: number; deal: DealKind; accept: boolean }
  | { kind: 'cancel'; target: number; pact: Pact };

export type ClientMsg =
  | { t: 'hello'; token: string }
  | { t: 'claim'; nation: number }
  | { t: 'release' }
  | { t: 'order'; order: Order }
  | { t: 'chat'; text: string }
  | { t: 'ping'; at: number };

export type ServerMsg =
  | {
      t: 'welcome';
      you: Me;
      clock: ClockInfo;
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
  | { t: 'pong'; at: number; serverNow: number };

export type ErrorCode =
  | 'auth' | 'bad_request' | 'rate_limited' | 'taken' | 'already_ruling' | 'not_ruling' | 'not_found'
  | 'no_route' | 'not_allowed' | 'no_funds';

/** Account endpoints (HTTP JSON). */
export interface AuthRequest { name: string; password: string }
export interface AuthResponse { token: string; you: Me }
export interface ApiError { error: string }
