// Diplomacy shared by server and client: treaties, proposals and peace terms.
import type { Commodity } from './economy';
import { treatyText, type PeaceTreaty } from './peace';

/**
 * Standing agreements between two nations. A guarantee runs one way: `a`
 * guarantees `b`'s independence and joins any war declared on it.
 */
export type Pact = 'alliance' | 'trade' | 'nap' | 'access' | 'research' | 'guarantee';
export const PACTS: Pact[] = ['alliance', 'trade', 'nap', 'access', 'research', 'guarantee'];
export const PACT_INFO: Record<Pact, { name: string; text: string; max: number; opinion: number }> = {
  alliance: { name: 'Defensive alliance', text: 'each joins any war declared on the other; troops may cross each other\'s land', max: 4, opinion: 20 },
  trade: { name: 'Trade agreement', text: '+0.15% growth each, cheaper trade, a shipping lane, and luxuries shared', max: 6, opinion: 12 },
  nap: { name: 'Non-aggression pact', text: 'neither may attack the other; breaking it is a betrayal the world remembers', max: 8, opinion: 10 },
  access: { name: 'Military access', text: 'troops may cross and supply through each other\'s land', max: 6, opinion: 5 },
  research: { name: 'Research cooperation', text: 'each researches 5% faster; technologies one knows cost the other 20% less', max: 3, opinion: 8 },
  guarantee: { name: 'Guarantee of independence', text: 'the guarantor joins any war declared on the guaranteed nation', max: 4, opinion: 15 },
};
/** Fixed deliveries of a good at an agreed price, outside the market (embargoes and blockades do not stop them). */
export interface Contract { id: number; seller: number; buyer: number; good: Commodity; amount: number; price: number; until: number }
export const MAX_CONTRACTS = 6;
export const CONTRACT_YEARS = [1, 2, 5];
/** Envoys spend a season improving relations. */
export const ENVOY_COST = 0.5; // $bn
export const ENVOY_DAYS = 90;
export const MAX_ENVOYS = 2;
/** Truces freeze a war where the lines stand: no battles, no advances, until they run out. */
export const TRUCE_DAYS = [30, 90, 180];

/**
 * Peace terms. 'white': everyone goes home. 'cede': the proposer keeps the
 * other side's provinces it occupies; its own occupied land is returned.
 */
export type PeaceTerms = 'white' | 'cede' | 'puppet' | 'treaty'; // puppet: the loser becomes the winner's vassal; treaty: terms chosen at a peace conference

export type Deal =
  | { kind: 'alliance' } | { kind: 'trade' } | { kind: 'nap' } | { kind: 'access' } | { kind: 'research' } | { kind: 'guarantee' }
  | { kind: 'peace'; terms: PeaceTerms; treaty?: PeaceTreaty } | { kind: 'bloc' }
  | { kind: 'contract'; good: Commodity; amount: number; years: number; sell: boolean } // sell: the proposer delivers
  | { kind: 'gift'; amount: number } // $bn, always welcome
  | { kind: 'truce'; days: number } // at war: stop fighting where the lines stand, for a while
  | { kind: 'demand'; province?: number; tribute?: number }; // hand over a province, or pay $bn; refusing gives a claim
export type DealKind = Deal['kind'];

export interface Treaty {
  kind: Pact;
  a: number;
  b: number;
  since: number; // game day index
}

export interface Proposal {
  from: number;
  to: number;
  deal: Deal;
  day: number; // game day index it was made
}

/** Limits that keep the web of treaties readable and the bonuses bounded. */
export const MAX_ALLIANCES = 4;
export const MAX_TRADE_DEALS = 6;
/** Unanswered proposals lapse after this many game days. */
export const PROPOSAL_DAYS = 30;
/** Each trade deal adds this to annual GDP growth, and makes world-market trade a little cheaper. */
export const TRADE_DEAL_GROWTH = 0.0015;

export const DEAL_NAMES: Record<DealKind, string> = {
  alliance: 'alliance', trade: 'trade agreement', peace: 'peace', bloc: 'bloc membership', nap: 'non-aggression pact', access: 'military access',
  research: 'research cooperation', guarantee: 'guarantee of independence', contract: 'supply contract', gift: 'gift', demand: 'demand', truce: 'truce',
};

export function dealText(d: Deal) {
  if (d.kind === 'peace') return d.terms === 'treaty' && d.treaty ? `peace: ${treatyText(d.treaty)}` : d.terms === 'cede' ? 'peace with territory ceded' : d.terms === 'puppet' ? 'peace as a vassal state' : 'white peace';
  if (d.kind === 'contract') return `${d.years}-year contract to ${d.sell ? 'sell' : 'buy'} ${d.good.replace('_', ' ')}`;
  if (d.kind === 'gift') return `a gift of $${d.amount}bn`;
  if (d.kind === 'truce') return `a ${d.days}-day truce`;
  if (d.kind === 'demand') return d.province !== undefined ? 'a demand for a province' : `a demand for $${d.tribute}bn in tribute`;
  return DEAL_NAMES[d.kind];
}

/**
 * What one nation thinks of another, -100..100, and why: shown to players and
 * used by AI governments to answer proposals.
 */
export interface Opinion { total: number; parts: [string, number][] }
export const OPINION_WORDS: [number, string][] = [[60, 'Devoted'], [30, 'Friendly'], [10, 'Cordial'], [-10, 'Neutral'], [-30, 'Cool'], [-60, 'Hostile'], [-101, 'Bitter enemies']];
export const opinionWord = (v: number) => OPINION_WORDS.find(([t]) => v >= t)![1];

export const pair = (t: { a: number; b: number }, x: number, y: number) => (t.a === x && t.b === y) || (t.a === y && t.b === x);

/** A named coalition: every member defends every other, and all may cross each other's land. */
export interface Bloc { id: number; name: string; leader: number; members: number[]; since: number }
export const MAX_BLOC = 12;

/** The world council: any nation may table a resolution; every nation votes for 7 game days. */
export type ResolutionKind = 'sanction' | 'condemn' | 'ceasefire';
export const RESOLUTION_TEXT: Record<ResolutionKind, string> = {
  sanction: 'sanctions: every nation voting yes embargoes',
  condemn: 'condemnation (−10 stability) of',
  ceasefire: 'a ceasefire (white peace) between',
};
export interface Resolution {
  id: number; kind: ResolutionKind; target: number; target2?: number; by: number; day: number;
  yes: number[]; no: number[]; result?: 'passed' | 'failed';
}
export const VOTE_DAYS = 7;
export const MAX_OPEN_RESOLUTIONS = 4;

/** Covert operations. */
export type SpyMission = 'steal' | 'sabotage' | 'recon' | 'unrest' | 'cyber_grid' | 'cyber_heist' | 'blueprints' | 'rig_election' | 'back_coup';
/** need: the agent network strength (0..100) the mission requires in the target nation. */
export const SPY_MISSIONS: Record<SpyMission, { name: string; text: string; need: number }> = {
  recon: { name: 'Reconnaissance', text: 'See all their forces for 30 game days', need: 10 },
  unrest: { name: 'Stir unrest', text: '−6 stability for them', need: 20 },
  steal: { name: 'Steal technology', text: 'Gain 40% of a technology they have and you lack', need: 30 },
  sabotage: { name: 'Sabotage', text: 'Destroy a building or a share of their munitions', need: 30 },
  blueprints: { name: 'Steal blueprints', text: 'Their arms designs: 150 equipment, and your next unit builds 30% faster', need: 40 },
  cyber_grid: { name: 'Cyberattack: power grid', text: 'Knock out 15% of their grid (needs Digital government)', need: 40 },
  cyber_heist: { name: 'Cyberattack: treasury', text: 'Siphon off 1.5% of their reserves (needs Digital government)', need: 40 },
  rig_election: { name: 'Rig their politics', text: 'Their parliament turns on its government (−20 support); in an election year it may fall', need: 55 },
  back_coup: { name: 'Back a coup', text: 'Arm their unhappy officers: if their stability is below 45 the government may fall to a junta', need: 70 },
};
/** Agent networks: built up day by day, worn down by the target's counter-intelligence. */
export const NETWORK_GROWTH = 0.8; // points a game day while building
export const NETWORK_COST = 0.02; // $bn of military funds a day while building
export const MAX_NETWORKS = 4; // built up at the same time
export const COUNTER_INTEL_COST = 0.0005; // share of GDP a year per level (0..3)
export const SPY_COST = 2; // $bn of military funds
export const SPY_DAYS = 5;
export const MAX_SPY_OPS = 3;

/** Vassals pay their overlord a share of their GDP each year. */
export const TRIBUTE_SHARE = 0.02;
