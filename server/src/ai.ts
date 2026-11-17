// AI controllers. Each nation not run by a player, and each player nation on
// autopilot, gets a decision about once a game day. Decisions are spread over
// time and capped per tick by the world, so cost stays flat as worlds grow.
//
// The AI reads only what a player in that nation could read: its own private
// state and other nations' public views. It acts only through World.submit().
// Today it sets national policy; each later stage adds a module here
// (budget, production, army, diplomacy) behind the same think() call.
import { BUDGET_KEYS, normalizeBudget, type Budget } from '../../shared/economy.ts';
import { FOCI, LIMITS, PERSONALITIES, type Focus, type Order, type Personality, type Policy } from '../../shared/protocol.ts';
import { UNIT_SPECS, distanceKm, domainOf, type UnitType } from '../../shared/military.ts';
import type { NationState, World } from './world.ts';
import { MAX_ALLIANCES, MAX_TRADE_DEALS, type Deal } from '../../shared/diplomacy.ts';

const BASE: Record<Personality, Record<Focus, number>> = {
  expansionist: { economy: 0.30, military: 0.50, research: 0.10, diplomacy: 0.10 },
  trader: { economy: 0.55, military: 0.10, research: 0.10, diplomacy: 0.25 },
  turtle: { economy: 0.35, military: 0.35, research: 0.20, diplomacy: 0.10 },
  opportunist: { economy: 0.40, military: 0.25, research: 0.15, diplomacy: 0.20 },
  idealist: { economy: 0.20, military: 0.05, research: 0.40, diplomacy: 0.35 },
};
const TAX: Record<Personality, number> = { expansionist: 32, trader: 21, turtle: 28, opportunist: 26, idealist: 24 };
// how readily each personality signs treaties (0..1; 0.5 or more accepts)
const TRADE_WILL: Record<Personality, number> = { expansionist: 0.35, trader: 0.9, turtle: 0.6, opportunist: 0.55, idealist: 0.75 };
const ALLY_WILL: Record<Personality, number> = { expansionist: 0.2, trader: 0.35, turtle: 0.45, opportunist: 0.3, idealist: 0.45 };
// how strongly a player-run neighbour pushes each personality towards defence
const WARINESS: Record<Personality, number> = { expansionist: 0.05, trader: 0.03, turtle: 0.12, opportunist: 0.15, idealist: 0.02 };
const SWITCH_MARGIN = 0.12; // hysteresis: avoid flip-flopping between foci
const BUDGETS: Record<Personality, Budget> = {
  expansionist: { military: 40, infrastructure: 25, welfare: 25, research: 10 },
  trader: { military: 10, infrastructure: 40, welfare: 35, research: 15 },
  turtle: { military: 30, infrastructure: 25, welfare: 35, research: 10 },
  opportunist: { military: 25, infrastructure: 30, welfare: 30, research: 15 },
  idealist: { military: 8, infrastructure: 25, welfare: 42, research: 25 },
};
const BUDGET_STEP = 4; // only rebalance when a share is this far off

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function personalityFor(seed: number, nationId: number): Personality {
  const r = mulberry32(seed * 1000 + nationId * 7 + 13)();
  return PERSONALITIES[Math.floor(r * PERSONALITIES.length)];
}

export class AiBrain {
  random: () => number;

  constructor(seed: number, private world: World) {
    this.random = mulberry32(seed + 4242);
  }

  initialPolicy(p: Personality): Policy {
    const w = BASE[p];
    const focus = FOCI.reduce((a, b) => (w[b] > w[a] ? b : a));
    return { focus, tax: TAX[p] };
  }

  initialBudget(p: Personality): Budget {
    return { ...BUDGETS[p] };
  }

  /** What the nation's government decides today. */
  think(n: NationState): Order[] {
    const def = this.world.defs.get(n.id);
    if (!def) return [];
    const p = n.personality;

    // read the neighbourhood through public views only
    let players = 0, armed = 0;
    for (const id of def.neighbours) {
      const other = this.world.nations.get(id);
      if (!other) continue;
      const view = this.world.publicView(other);
      if (view.controller === 'human') players++;
      if (view.focus === 'military') armed++;
    }

    const score = { ...BASE[p] };
    score.military += WARINESS[p] * players + 0.06 * armed;
    if (p === 'idealist') score.diplomacy += 0.08 * players;
    if (p === 'trader' && armed === 0) score.economy += 0.1;
    for (const f of FOCI) score[f] += (this.random() - 0.5) * 0.16;

    const best = FOCI.reduce((a, b) => (score[b] > score[a] ? b : a));
    const policy: Partial<Policy> = {};
    if (best !== n.policy.focus && score[best] - score[n.policy.focus] > SWITCH_MARGIN) policy.focus = best;

    // economy: read our own books (private to us) and steer tax and budget
    const e = n.econ;
    const focusNow = policy.focus ?? n.policy.focus;
    const debt = Math.max(0, -e.treasury / e.gdp);
    let target = TAX[p] + (focusNow === 'military' ? 4 : 0) + Math.round((this.random() - 0.5) * 3);
    if (debt > 0.3) target += 3;
    if (e.stability < 40) target -= 3;
    if (e.treasury > 0.3 * e.gdp) target -= 2;
    const step = Math.max(-2, Math.min(2, target - n.policy.tax));
    const tax = Math.min(LIMITS.taxMax, Math.max(LIMITS.taxMin, n.policy.tax + step));
    if (tax !== n.policy.tax) policy.tax = tax;

    const want = { ...BUDGETS[p] };
    if (focusNow === 'military') { want.military += 8; want.welfare -= 4; want.infrastructure -= 4; }
    want.military += 3 * players;
    if (e.stability < 45) { want.welfare += 10; want.military -= 5; want.infrastructure -= 5; }
    if (e.shortage > 0.05) { want.infrastructure += 8; want.research -= 4; want.military -= 4; }
    const budget = normalizeBudget(want, e.budget);
    const orders: Order[] = [];
    if (Object.keys(policy).length) orders.push({ kind: 'policy', policy });
    if (BUDGET_KEYS.some((k) => Math.abs(budget[k] - e.budget[k]) >= BUDGET_STEP)) orders.push({ kind: 'budget', budget });
    return [...orders, ...this.militaryOrders(n)];
  }

  /** Recruiting, war and peace, and moving troops. Uses only what fog of war shows us. */
  private militaryOrders(n: NationState): Order[] {
    const w = this.world, m = w.military, me = n.id, p = n.personality;
    const orders: Order[] = [];
    const all = m.unitsOf(me);
    const units = all.filter((u) => domainOf(u.type) === 'land');
    const aggressive = p === 'expansionist' || p === 'opportunist';

    // keep an army sized to the budget
    const desired = Math.max(2, Math.min(60, Math.round(w.defenceIncome(n) / 3.5)));
    if (all.length + n.mil.queue.length < desired && n.mil.funds > 1 && n.mil.queue.length < 3 && w.manpower(n) > 20_000) {
      const r = this.random();
      orders.push({ kind: 'recruit', unit: this.pickRecruit(n, all, r) });
    }

    const enemies = m.enemiesOf(me);
    const control = w.controlOf(me);
    // answer proposals waiting for us (players' offers; other AIs get answers at once)
    for (const prop of w.diplomacy.incoming(me)) {
      orders.push({ kind: 'answer', from: prop.from, deal: prop.deal.kind, accept: this.answer(n, prop.from, prop.deal) });
    }
    for (const foe of enemies) {
      const days = this.warDays(me, foe);
      const gain = 1 - w.controlOf(foe), loss = 1 - control;
      if (w.diplomacy.pending(me, foe, 'peace')) continue;
      if (gain > 0.08 && gain > loss + 0.05 && days > 20) orders.push({ kind: 'propose', target: foe, deal: { kind: 'peace', terms: 'cede' } });
      else if ((loss >= gain && days > 30) || days > 150 || control < 0.7) orders.push({ kind: 'peace', target: foe });
    }
    if (!enemies.length) orders.push(...this.diplomacyOrders(n));

    // rare wars of choice against clearly weaker neighbours (about one somewhere per game year)
    if (!enemies.length && aggressive && this.random() < (p === 'expansionist' ? 0.006 : 0.003)) {
      const targets = (w.defs.get(me)?.neighbours ?? [])
        .map((id) => w.nations.get(id))
        .filter((t): t is NationState => !!t && !t.annexedBy && !w.diplomacy.has('alliance', me, t.id))
        // count the target's allies too, if they border us or the target (others can hardly reach the front)
        .filter((t) => {
          const near = new Set([...(w.defs.get(me)?.neighbours ?? []), ...(w.defs.get(t.id)?.neighbours ?? [])]);
          const allies = w.diplomacy.partners('alliance', t.id).filter((id) => near.has(id));
          return [t.id, ...allies].reduce((s, id) => s + (w.publicView(w.nations.get(id)!).army ?? 0), 0) < units.length * 0.6;
        })
        .filter((t) => !(t.controller === 'human' && Date.now() - (t.claimedAt ?? 0) < 2 * 3_600_000));
      if (targets.length) orders.push({ kind: 'war', target: targets[Math.floor(this.random() * targets.length)].id });
    }
    if (!enemies.length) return orders;

    // at war: hold the front and strike where we are clearly stronger
    const seen = m.visibleProvinces(me);
    const enemyPower = new Map<number, number>();
    for (const u of m.units.values()) {
      if (enemies.includes(u.nation) && seen.has(u.province)) {
        enemyPower.set(u.province, (enemyPower.get(u.province) ?? 0) + (u.strength / 100) * UNIT_SPECS[u.type].defense);
      }
    }
    const isEnemyLand = (q: number) => enemies.includes(m.controller(q) ?? -1);
    const front: number[] = [];
    for (const prov of m.provinces.values()) {
      if (prov.kind === 'land' && m.controller(prov.id) === me && prov.adj.some(isEnemyLand)) front.push(prov.id);
    }
    if (!front.length) return orders;
    const stacks = new Map<number, number[]>();
    for (const u of units) {
      if (u.next !== undefined || u.fighting) continue;
      stacks.set(u.province, [...(stacks.get(u.province) ?? []), u.id]);
    }
    for (const [prov, ids] of stacks) {
      if (!front.includes(prov)) continue;
      const atk = ids.reduce((s, id) => { const u = m.units.get(id)!; return s + (u.strength / 100) * UNIT_SPECS[u.type].attack; }, 0);
      const targets = m.provinces.get(prov)!.adj.filter((q) => isEnemyLand(q) && m.provinces.get(q)?.kind === 'land');
      const weakest = targets.sort((a, b) => (enemyPower.get(a) ?? 0) - (enemyPower.get(b) ?? 0))[0];
      if (weakest !== undefined && atk >= 1.4 * (enemyPower.get(weakest) ?? 0) + 0.5) {
        orders.push({ kind: 'move', units: ids.length > 1 ? ids.slice(1) : ids, to: weakest }); // leave a guard behind
      }
    }
    const rear = units.filter((u) => u.next === undefined && !u.fighting && !front.includes(u.province)).slice(0, 10);
    for (const u of rear) orders.push({ kind: 'move', units: [u.id], to: front[u.id % front.length] });

    // air: fighters cover the front, strike wings back the main thrust (rebasing forward if out of range)
    const hot = [...m.battles].find((b) => front.includes(b) || isEnemyLand(b)) ?? front[Math.floor(front.length / 2)];
    for (const wing of all.filter((u) => domainOf(u.type) === 'air' && u.next === undefined)) {
      const kind = wing.type === 'fighters' ? 'patrol' : 'support';
      if (wing.mission?.target === hot && wing.mission.kind === kind) continue;
      const reach = distanceKm(m.provinces.get(wing.province)!.label, m.provinces.get(hot)!.label) <= UNIT_SPECS[wing.type].range!;
      if (reach) orders.push({ kind: 'mission', units: [wing.id], mission: { kind, target: hot } });
      else orders.push({ kind: 'move', units: [wing.id], to: front[0] }); // rebase toward the front
    }

    // navy: blockade the enemy coast unless their visible fleet is stronger than ours
    const fleet = all.filter((u) => domainOf(u.type) === 'sea' && u.next === undefined && !u.fighting);
    if (fleet.length) {
      const ours = fleet.reduce((s, u) => s + (u.strength / 100) * UNIT_SPECS[u.type].attack, 0);
      const theirs = [...m.units.values()].filter((u) => enemies.includes(u.nation) && domainOf(u.type) === 'sea' && seen.has(u.province))
        .reduce((s, u) => s + (u.strength / 100) * UNIT_SPECS[u.type].defense, 0);
      if (ours > theirs * 1.2) {
        const coast = [...m.provinces.values()].find((prov) => prov.kind === 'land' && enemies.includes(prov.owner ?? -1)
          && prov.adj.some((q) => m.provinces.get(q)?.kind === 'sea'));
        const zone = coast?.adj.find((q) => m.provinces.get(q)?.kind === 'sea');
        if (zone !== undefined && !fleet.every((u) => u.province === zone)) orders.push({ kind: 'move', units: fleet.map((u) => u.id), to: zone });
      }
    }
    return orders;
  }

  private warDays(a: number, b: number) {
    const m = this.world.military;
    const war = m.wars.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
    return war ? this.world.market.day - war.since : 0;
  }

  /**
   * Whether this nation accepts a deal from another. Deterministic for the same
   * situation, so asking again does not reroll the answer.
   */
  answer(n: NationState, from: number, deal: Deal): boolean {
    const w = this.world, me = n.id, p = n.personality;
    const them = w.nations.get(from);
    if (!them || w.dealProblem(from, me, deal)) return false;
    const friendly = them.policy.focus === 'diplomacy' ? 0.2 : 0;
    if (deal.kind === 'trade') return TRADE_WILL[p] + friendly >= 0.5;
    if (deal.kind === 'alliance') {
      const m = w.military;
      const myEnemies = m.enemiesOf(me), theirEnemies = m.enemiesOf(from);
      const shared = myEnemies.some((e) => theirEnemies.includes(e)) ? 0.35 : 0;
      const trades = w.diplomacy.has('trade', me, from) ? 0.1 : 0;
      const strong = (w.publicView(them).army ?? 0) >= m.unitsOf(me).length * 0.5 ? 0.1 : 0;
      const neighbour = w.defs.get(me)?.neighbours.includes(from) ? 0.05 : 0;
      return ALLY_WILL[p] + friendly + shared + trades + strong + neighbour >= 0.5;
    }
    // peace: weigh what each side holds of the other's people
    const days = this.warDays(me, from);
    const loss = 1 - w.controlOf(me), gain = 1 - w.controlOf(from);
    if (deal.terms === 'white') return loss >= gain - 0.02 || days > 120 || (days > 40 && gain < 0.1);
    return w.controlOf(me) < 0.6 || (loss > gain + 0.1 && days > 30) || days > 240;
  }

  /** Peacetime diplomacy: trade with neighbours, and an ally or two. */
  private diplomacyOrders(n: NationState): Order[] {
    const w = this.world, d = w.diplomacy, me = n.id;
    const neighbours = w.defs.get(me)?.neighbours ?? [];
    const orders: Order[] = [];
    const tradeGoal = n.personality === 'trader' ? MAX_TRADE_DEALS : n.personality === 'expansionist' ? 1 : 3;
    if (d.partners('trade', me).length < tradeGoal && this.random() < 0.35) {
      const pick = neighbours.filter((x) => !d.has('trade', me, x) && !d.pending(me, x, 'trade') && !w.nations.get(x)?.annexedBy);
      if (pick.length) orders.push({ kind: 'propose', target: pick[Math.floor(this.random() * pick.length)], deal: { kind: 'trade' } });
    }
    const allyGoal = n.personality === 'turtle' || n.personality === 'idealist' ? 2 : 1;
    if (d.partners('alliance', me).length < Math.min(allyGoal, MAX_ALLIANCES) && this.random() < 0.04) {
      // friends of friends: trading partners first, then neighbours
      const pool = [...d.partners('trade', me), ...neighbours]
        .filter((x) => !d.has('alliance', me, x) && !d.pending(me, x, 'alliance') && !w.nations.get(x)?.annexedBy);
      if (pool.length) orders.push({ kind: 'propose', target: pool[Math.floor(this.random() * pool.length)], deal: { kind: 'alliance' } });
    }
    return orders;
  }

  /** What to build next: mostly land, a quarter air, some ships if we have a coast. */
  private pickRecruit(n: NationState, all: { type: UnitType }[], r: number): UnitType {
    const count = (d: string) => all.filter((u) => domainOf(u.type) === d).length;
    const coastal = this.world.homeFor(n.id, 'destroyers') !== undefined;
    const aggressive = n.personality === 'expansionist' || n.personality === 'opportunist';
    if (count('air') < all.length * 0.25) return r < 0.5 ? 'fighters' : 'strike';
    if (coastal && count('sea') < all.length * 0.15) return r < 0.6 ? 'destroyers' : r < 0.9 ? 'submarines' : 'carrier';
    return r < (aggressive ? 0.2 : 0.1) ? 'armored' : r < (aggressive ? 0.45 : 0.3) ? 'mechanized' : 'infantry';
  }
}
