// Diplomacy shared by server and client: treaties, proposals and peace terms.

/** Standing agreements between two nations. */
export type Pact = 'alliance' | 'trade';
export const PACTS: Pact[] = ['alliance', 'trade'];

/**
 * Peace terms. 'white': everyone goes home. 'cede': the proposer keeps the
 * other side's provinces it occupies; its own occupied land is returned.
 */
export type PeaceTerms = 'white' | 'cede' | 'puppet'; // puppet: the loser becomes the winner's vassal

export type Deal = { kind: 'alliance' } | { kind: 'trade' } | { kind: 'peace'; terms: PeaceTerms } | { kind: 'bloc' };
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

export const DEAL_NAMES: Record<DealKind, string> = { alliance: 'alliance', trade: 'trade agreement', peace: 'peace', bloc: 'bloc membership' };

export function dealText(d: Deal) {
  if (d.kind !== 'peace') return DEAL_NAMES[d.kind];
  return d.terms === 'cede' ? 'peace with territory ceded' : d.terms === 'puppet' ? 'peace as a vassal state' : 'white peace';
}

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
export type SpyMission = 'steal' | 'sabotage' | 'recon' | 'unrest' | 'cyber_grid' | 'cyber_heist';
export const SPY_MISSIONS: Record<SpyMission, { name: string; text: string }> = {
  steal: { name: 'Steal technology', text: 'Gain 40% of a technology they have and you lack' },
  sabotage: { name: 'Sabotage', text: 'Destroy a building or a share of their munitions' },
  recon: { name: 'Reconnaissance', text: 'See all their forces for 30 game days' },
  unrest: { name: 'Stir unrest', text: '−6 stability for them' },
  cyber_grid: { name: 'Cyberattack: power grid', text: 'Knock out 15% of their grid (needs Digital government)' },
  cyber_heist: { name: 'Cyberattack: treasury', text: 'Siphon off 1.5% of their reserves (needs Digital government)' },
};
export const SPY_COST = 2; // $bn of military funds
export const SPY_DAYS = 5;
export const MAX_SPY_OPS = 3;

/** Vassals pay their overlord a share of their GDP each year. */
export const TRIBUTE_SHARE = 0.02;
