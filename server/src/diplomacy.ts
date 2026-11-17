// Treaties and proposals between nations. Pure bookkeeping: the World applies
// the effects (call to arms, ceded land, trade growth) when deals are made.
import { PROPOSAL_DAYS, pair, type DealKind, type Pact, type Proposal, type Treaty } from '../../shared/diplomacy.ts';

export interface DiplomacyState {
  treaties: Treaty[];
  proposals: Proposal[];
  owners: Record<number, number>; // province -> nation, for land that changed hands by treaty
}

export class Diplomacy {
  treaties: Treaty[] = [];
  proposals: Proposal[] = [];
  owners = new Map<number, number>();

  constructor(state: DiplomacyState | null) {
    if (!state) return;
    this.treaties = state.treaties ?? [];
    this.proposals = state.proposals ?? [];
    this.owners = new Map(Object.entries(state.owners ?? {}).map(([p, n]) => [Number(p), n]));
  }

  serialize(): DiplomacyState {
    return { treaties: this.treaties, proposals: this.proposals, owners: Object.fromEntries(this.owners) };
  }

  has(kind: Pact, a: number, b: number) {
    return a !== b && this.treaties.some((t) => t.kind === kind && pair(t, a, b));
  }

  partners(kind: Pact, n: number) {
    return this.treaties.filter((t) => t.kind === kind && (t.a === n || t.b === n)).map((t) => (t.a === n ? t.b : t.a));
  }

  sign(kind: Pact, a: number, b: number, day: number) {
    if (this.has(kind, a, b)) return false;
    this.treaties.push({ kind, a, b, since: day });
    return true;
  }

  /** End a treaty; returns whether there was one. */
  cancel(kind: Pact, a: number, b: number) {
    const before = this.treaties.length;
    this.treaties = this.treaties.filter((t) => !(t.kind === kind && pair(t, a, b)));
    return this.treaties.length < before;
  }

  pending(from: number, to: number, kind: DealKind) {
    return this.proposals.find((p) => p.from === from && p.to === to && p.deal.kind === kind);
  }

  /** Store a proposal, replacing an earlier one of the same kind between the same two nations. */
  propose(p: Proposal) {
    this.withdraw(p.from, p.to, p.deal.kind);
    this.proposals.push(p);
  }

  withdraw(from: number, to: number, kind?: DealKind) {
    this.proposals = this.proposals.filter((p) => !(p.from === from && p.to === to && (!kind || p.deal.kind === kind)));
  }

  /** Drop everything involving a nation (it was annexed). */
  forget(n: number) {
    this.treaties = this.treaties.filter((t) => t.a !== n && t.b !== n);
    this.proposals = this.proposals.filter((p) => p.from !== n && p.to !== n);
  }

  /** Lapse old proposals; returns whether any lapsed. */
  expire(day: number) {
    const before = this.proposals.length;
    this.proposals = this.proposals.filter((p) => day - p.day <= PROPOSAL_DAYS);
    return this.proposals.length < before;
  }

  incoming(n: number) {
    return this.proposals.filter((p) => p.to === n);
  }

  outgoing(n: number) {
    return this.proposals.filter((p) => p.from === n);
  }
}
