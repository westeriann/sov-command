// Treaties and proposals between nations. Pure bookkeeping: the World applies
// the effects (call to arms, ceded land, trade growth) when deals are made.
import { PROPOSAL_DAYS, pair, type Bloc, type Contract, type DealKind, type Pact, type Proposal, type Resolution, type Treaty } from '../../shared/diplomacy.ts';

export interface DiplomacyState {
  treaties: Treaty[];
  proposals: Proposal[];
  owners: Record<number, number>; // province -> nation, for land that changed hands by treaty
  embargoes?: { from: number; to: number }[];
  unrest?: Record<number, number>;
  formerOwner?: Record<number, number>;
  blocs?: Bloc[];
  council?: Resolution[];
  overlords?: Record<number, number>;
  nextId?: number;
  contracts?: Contract[];
}

export class Diplomacy {
  treaties: Treaty[] = [];
  proposals: Proposal[] = [];
  owners = new Map<number, number>();
  embargoes: { from: number; to: number }[] = [];
  unrest = new Map<number, number>(); // province -> 0..100
  formerOwner = new Map<number, number>(); // province -> nation it was taken from
  blocs: Bloc[] = [];
  council: Resolution[] = [];
  overlords = new Map<number, number>(); // vassal -> overlord
  nextId = 1;
  contracts: Contract[] = [];

  constructor(state: DiplomacyState | null) {
    if (!state) return;
    this.treaties = state.treaties ?? [];
    this.proposals = state.proposals ?? [];
    this.owners = new Map(Object.entries(state.owners ?? {}).map(([p, n]) => [Number(p), n]));
    this.embargoes = state.embargoes ?? [];
    this.unrest = new Map(Object.entries(state.unrest ?? {}).map(([p, n]) => [Number(p), n]));
    this.formerOwner = new Map(Object.entries(state.formerOwner ?? {}).map(([p, n]) => [Number(p), n]));
    this.blocs = state.blocs ?? [];
    this.council = state.council ?? [];
    this.overlords = new Map(Object.entries(state.overlords ?? {}).map(([v, o]) => [Number(v), o]));
    this.nextId = state.nextId ?? 1;
    this.contracts = state.contracts ?? [];
  }

  serialize(): DiplomacyState {
    return {
      treaties: this.treaties, proposals: this.proposals, owners: Object.fromEntries(this.owners), embargoes: this.embargoes,
      unrest: Object.fromEntries(this.unrest), formerOwner: Object.fromEntries(this.formerOwner),
      blocs: this.blocs, council: this.council, overlords: Object.fromEntries(this.overlords), nextId: this.nextId, contracts: this.contracts,
    };
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

  /** Whether `a` guarantees `b`'s independence (guarantees run one way). */
  guarantees(a: number, b: number) {
    return this.treaties.some((t) => t.kind === 'guarantee' && t.a === a && t.b === b);
  }

  guarantorsOf(n: number) {
    return this.treaties.filter((t) => t.kind === 'guarantee' && t.b === n).map((t) => t.a);
  }

  /** How many treaties of a kind count against a nation's limit (for guarantees: those it gives). */
  count(kind: Pact, n: number) {
    return kind === 'guarantee' ? this.treaties.filter((t) => t.kind === kind && t.a === n).length : this.partners(kind, n).length;
  }

  contractsOf(n: number) {
    return this.contracts.filter((c) => c.seller === n || c.buyer === n);
  }

  /** War ends every agreement between two nations. */
  sever(a: number, b: number) {
    this.treaties = this.treaties.filter((t) => !pair(t, a, b));
    this.contracts = this.contracts.filter((c) => !pair({ a: c.seller, b: c.buyer }, a, b));
  }

  /** Drop everything involving a nation (it was annexed). */
  forget(n: number) {
    this.treaties = this.treaties.filter((t) => t.a !== n && t.b !== n);
    this.contracts = this.contracts.filter((c) => c.seller !== n && c.buyer !== n);
    this.embargoes = this.embargoes.filter((e) => e.from !== n && e.to !== n);
    this.leaveBloc(n);
    this.overlords.delete(n);
    for (const [v, o] of [...this.overlords]) if (o === n) this.overlords.delete(v);
    this.proposals = this.proposals.filter((p) => p.from !== n && p.to !== n);
  }

  /** Lapse old proposals; returns whether any lapsed. */
  expire(day: number) {
    const before = this.proposals.length;
    this.proposals = this.proposals.filter((p) => day - p.day <= PROPOSAL_DAYS);
    return this.proposals.length < before;
  }

  blocOf(n: number) {
    return this.blocs.find((b) => b.members.includes(n));
  }

  leaveBloc(n: number) {
    const b = this.blocOf(n);
    if (!b) return undefined;
    b.members = b.members.filter((x) => x !== n);
    if (!b.members.length) this.blocs = this.blocs.filter((x) => x !== b);
    else if (b.leader === n) b.leader = b.members[0];
    return b;
  }

  vassalsOf(n: number) {
    return [...this.overlords].filter(([, o]) => o === n).map(([v]) => v);
  }

  /** Allied in any way: an alliance treaty, the same bloc, or vassal and overlord. */
  allied(a: number, b: number) {
    if (a === b) return false;
    if (this.has('alliance', a, b) || this.overlords.get(a) === b || this.overlords.get(b) === a) return true;
    const bloc = this.blocOf(a);
    return !!bloc && bloc.members.includes(b);
  }

  /** Everyone bound to defend this nation. */
  allies(n: number) {
    const out = new Set(this.partners('alliance', n));
    for (const m of this.blocOf(n)?.members ?? []) if (m !== n) out.add(m);
    for (const v of this.vassalsOf(n)) out.add(v);
    const o = this.overlords.get(n);
    if (o !== undefined) out.add(o);
    return [...out];
  }

  embargoed(from: number, to: number) {
    return this.embargoes.some((e) => e.from === from && e.to === to);
  }

  incoming(n: number) {
    return this.proposals.filter((p) => p.to === n);
  }

  outgoing(n: number) {
    return this.proposals.filter((p) => p.from === n);
  }
}
