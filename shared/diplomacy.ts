// Diplomacy shared by server and client: treaties, proposals and peace terms.

/** Standing agreements between two nations. */
export type Pact = 'alliance' | 'trade';
export const PACTS: Pact[] = ['alliance', 'trade'];

/**
 * Peace terms. 'white': everyone goes home. 'cede': the proposer keeps the
 * other side's provinces it occupies; its own occupied land is returned.
 */
export type PeaceTerms = 'white' | 'cede';

export type Deal = { kind: 'alliance' } | { kind: 'trade' } | { kind: 'peace'; terms: PeaceTerms };
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

export const DEAL_NAMES: Record<DealKind, string> = { alliance: 'alliance', trade: 'trade agreement', peace: 'peace' };

export function dealText(d: Deal) {
  if (d.kind !== 'peace') return DEAL_NAMES[d.kind];
  return d.terms === 'cede' ? 'peace with territory ceded' : 'white peace';
}

export const pair = (t: { a: number; b: number }, x: number, y: number) => (t.a === x && t.b === y) || (t.a === y && t.b === x);
