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
import { MAX_ALLIANCES, MAX_BLOC, MAX_TRADE_DEALS, SPY_COST, type Deal, type Resolution, type SpyMission } from '../../shared/diplomacy.ts';
import { COMMODITIES } from '../../shared/economy.ts';
import { LAWS, type LawId } from '../../shared/politics.ts';

/** The laws each character of government reaches for, most wanted first. */
const LAW_TASTE: Record<Personality, LawId[]> = {
  expansionist: ['conscription', 'strategic_reserves', 'censorship', 'tariffs', 'infrastructure_act'],
  trader: ['free_trade', 'infrastructure_act', 'research_grants', 'press_freedom', 'green_energy'],
  turtle: ['strategic_reserves', 'conscription', 'tariffs', 'infrastructure_act', 'rationing'],
  opportunist: ['infrastructure_act', 'free_trade', 'research_grants', 'strategic_reserves'],
  idealist: ['press_freedom', 'research_grants', 'green_energy', 'free_trade', 'infrastructure_act'],
};
import { TECHS, prerequisite, type Branch, type TechId } from '../../shared/research.ts';
import { BUILDINGS, type BuildingType } from '../../shared/buildings.ts';
import { ideologyGap } from '../../shared/society.ts';
import { MISSILE_COST, STRIKERS, WARHEAD_COST } from '../../shared/military.ts';

const RESEARCH_ORDER: Record<Personality, Branch[]> = {
  expansionist: ['land', 'sea_air', 'economy', 'society'],
  trader: ['economy', 'society', 'sea_air', 'land'],
  turtle: ['land', 'society', 'economy', 'sea_air'],
  opportunist: ['economy', 'land', 'sea_air', 'society'],
  idealist: ['society', 'economy', 'sea_air', 'land'],
};

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
  expansionist: { military: 40, infrastructure: 22, welfare: 22, research: 16 },
  trader: { military: 10, infrastructure: 37, welfare: 32, research: 21 },
  turtle: { military: 30, infrastructure: 22, welfare: 32, research: 16 },
  opportunist: { military: 25, infrastructure: 27, welfare: 27, research: 21 },
  idealist: { military: 8, infrastructure: 22, welfare: 39, research: 31 },
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
      const aggressive = n.personality === 'expansionist' || n.personality === 'opportunist';
      if (gain > 0.35 && aggressive && days > 30) orders.push({ kind: 'propose', target: foe, deal: { kind: 'peace', terms: 'puppet' } });
      else if (gain > 0.08 && gain > loss + 0.05 && days > 20) orders.push({ kind: 'propose', target: foe, deal: { kind: 'peace', terms: 'cede' } });
      else if ((loss >= gain && days > 30) || days > 150 || control < 0.7) orders.push({ kind: 'peace', target: foe });
    }
    if (!enemies.length) orders.push(...this.diplomacyOrders(n));
    orders.push(...this.strategicOrders(n, enemies.length > 0));
    orders.push(...this.covertOrders(n, enemies));
    // keep the people on side: campaign at home when restless
    const fit = w.fit(n);
    const want = n.econ.stability < 45 || fit < -4 ? 'home' : 'off';
    if (n.soc && n.soc.propaganda.mode !== want && n.soc.propaganda.mode !== 'abroad') orders.push({ kind: 'propaganda', mode: want });
    const wantOpen = (n.personality === 'idealist' || n.personality === 'trader') ? n.econ.stability > 35 : n.econ.stability > 65 && n.personality !== 'expansionist';
    if ((n.policy.openBorders !== false) !== wantOpen) orders.push({ kind: 'borders', open: wantOpen });
    for (const foe of enemies) if (!w.diplomacy.embargoed(me, foe) && this.random() < 0.3) orders.push({ kind: 'embargo', target: foe, on: true });
    for (const e of w.diplomacy.embargoes) if (e.from === me && !enemies.includes(e.to) && this.random() < 0.1) orders.push({ kind: 'embargo', target: e.to, on: false });

    // rare wars of choice against clearly weaker neighbours (about one somewhere per game year)
    if (!enemies.length && aggressive && this.random() < (p === 'expansionist' ? 0.012 : 0.006)) {
      const targets = (w.defs.get(me)?.neighbours ?? [])
        .map((id) => w.nations.get(id))
        .filter((t): t is NationState => !!t && !t.annexedBy && !w.diplomacy.has('alliance', me, t.id))
        .filter((t) => !w.diplomacy.has('nap', me, t.id) || (p === 'expansionist' && this.random() < 0.2))
        .filter((t) => w.opinion(me, t.id).total < 10 || w.justified(me, t.id))
        .filter((t) => !w.publicView(t).nuclear || (n.mil.warheads ?? 0) > 0) // nuclear deterrence
        // count the target's allies too, if they border us or the target (others can hardly reach the front)
        .filter((t) => {
          const near = new Set([...(w.defs.get(me)?.neighbours ?? []), ...(w.defs.get(t.id)?.neighbours ?? [])]);
          const allies = w.diplomacy.partners('alliance', t.id).filter((id) => near.has(id));
          return [t.id, ...allies].reduce((s, id) => s + (w.publicView(w.nations.get(id)!).army ?? 0), 0) < units.length * 0.7;
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
    if (!front.length) {
      // no land front: land on the weakest enemy coast if our fleet can cover the crossing
      orders.push(...this.amphibious(n, enemies, units, enemyPower));
      return orders;
    }
    const stacks = new Map<number, number[]>();
    for (const u of units) {
      if (u.next !== undefined || u.fighting) continue;
      stacks.set(u.province, [...(stacks.get(u.province) ?? []), u.id]);
    }
    // a planned offensive: pick a valuable, weakly held target, mass on the border facing it, then strike
    const power = (ids: number[]) => ids.reduce((s, id) => { const u = m.units.get(id)!; return s + (u.strength / 100) * UNIT_SPECS[u.type].attack; }, 0);
    let plan = this.plans.get(me);
    if (plan && (!isEnemyLand(plan.target) || !front.includes(plan.staging) || w.market.day - plan.since > 60)) plan = undefined;
    if (!plan) {
      let best: { target: number; staging: number; score: number } | undefined;
      for (const f of front) {
        for (const q of m.provinces.get(f)!.adj) {
          const tp = m.provinces.get(q);
          if (!tp || tp.kind !== 'land' || !isEnemyLand(q)) continue;
          const capital = [...w.defs.values()].some((d) => d.capital === q) ? 2 : 1;
          const score = (tp.pop / 1e6 + 1) * capital / (1 + (enemyPower.get(q) ?? 0));
          if (!best || score > best.score) best = { target: q, staging: f, score };
        }
      }
      if (best) { plan = { target: best.target, staging: best.staging, since: w.market.day }; this.plans.set(me, plan); }
    }
    if (plan) {
      const atStaging = stacks.get(plan.staging) ?? [];
      const defence = enemyPower.get(plan.target) ?? 0;
      if (atStaging.length && power(atStaging) >= 1.6 * defence + 0.5) {
        orders.push({ kind: 'move', units: atStaging.length > 1 ? atStaging.slice(1) : atStaging, to: plan.target });
        this.plans.delete(me);
      } else {
        // gather: everything not guarding another front province heads for the staging area
        for (const [prov, ids] of stacks) {
          if (prov === plan.staging) continue;
          const spare = front.includes(prov) ? ids.slice(1) : ids;
          if (spare.length) orders.push({ kind: 'move', units: spare.slice(0, 12), to: plan.staging });
        }
      }
    }

    // air: fighters cover the front, strike wings back the main thrust (rebasing forward if out of range)
    const battle = [...m.battles].find((b) => front.includes(b) || isEnemyLand(b));
    const hot = battle ?? front[Math.floor(front.length / 2)];
    // generals for the biggest front stacks
    const free = w.maxGenerals(me) - units.filter((u) => u.general).length;
    if (free > 0 && n.mil.funds > 3) {
      const best = [...stacks].filter(([p]) => front.includes(p)).sort((a, b) => b[1].length - a[1].length)[0];
      const pick = best?.[1].map((id) => m.units.get(id)!).find((u) => !u.general);
      if (pick && !best![1].some((id) => m.units.get(id)?.general)) orders.push({ kind: 'general', unit: pick.id });
    }
    // a satellite to watch the enemy, and knock out theirs
    if (n.tech.done.includes('orbital_recon') && !(n.mil.satellites ?? 0) && n.mil.funds > 25) orders.push({ kind: 'satellite' });
    const watcher = enemies.find((e) => (w.publicView(w.nations.get(e)!).satellites ?? 0) > 0);
    if (watcher !== undefined && n.tech.done.includes('hypersonics') && n.mil.funds > 15) orders.push({ kind: 'asat', target: watcher });
    // missiles at the main enemy position
    if (n.tech.done.includes('hypersonics') && n.mil.funds > MISSILE_COST * 6 && isEnemyLand(hot)) orders.push({ kind: 'missile', province: hot });
    for (const wing of all.filter((u) => domainOf(u.type) === 'air' && u.next === undefined)) {
      // with no battle to support, strike wings bomb enemy industry in range
      if (STRIKERS.includes(wing.type) && (!battle || wing.type === 'bombers')) {
        const target = [...m.buildings.keys()].find((q) => isEnemyLand(q) && distanceKm(m.provinces.get(wing.province)!.label, m.provinces.get(q)!.label) <= m.rangeOf(wing));
        if (target !== undefined) { if (wing.mission?.target !== target) orders.push({ kind: 'mission', units: [wing.id], mission: { kind: 'bomb', target } }); continue; }
      }
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
        // raid their trade: a warship anywhere on a shipping lane cuts that deal, or blockade the coast
        const lane = w.lanes.find((l) => enemies.includes(l.a) || enemies.includes(l.b));
        const zone = lane && this.random() < 0.5 ? lane.path[Math.floor(lane.path.length / 2)] : coast?.adj.find((q) => m.provinces.get(q)?.kind === 'sea');
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
    const gap = n.soc && them.soc ? ideologyGap(n.soc.ideology, them.soc.ideology) : 0;
    const op = w.opinion(me, from).total;
    const friendly = (them.policy.focus === 'diplomacy' ? 0.2 : 0) + 0.15 - gap * 0.12 + op * 0.004; // like-minded, well-liked nations are trusted
    const dominant = w.powerOf(from) > 0.15 && w.powerOf(from) > w.powerOf(me) * 3 ? 0.35 : 0; // wary of a power that could swallow us
    if (deal.kind === 'gift') return true;
    if (deal.kind === 'nap') return op >= -15 || w.powerOf(from) > w.powerOf(me) * 1.5;
    if (deal.kind === 'access') return op >= 25 && !w.military.enemiesOf(from).some((x) => w.diplomacy.has('trade', me, x));
    if (deal.kind === 'research') return op >= 5 && (them.tech.done.length >= n.tech.done.length * 0.5);
    if (deal.kind === 'guarantee') return op >= -25 && !(p === 'expansionist' && w.powerOf(me) > w.powerOf(from));
    if (deal.kind === 'contract') {
      const e = n.econ, g = deal.good, yearly = deal.amount;
      const surplus = e.trade[g]; // exported last year: what we can spare
      if (deal.sell) return op >= -30 && (e.short[g] > 0.01 || e.stock[g] < yearly * 0.2); // they sell to us: welcome if we need it
      return op >= -20 && (surplus > yearly * 0.8 || e.stock[g] > yearly); // we sell: only from what we can spare
    }
    if (deal.kind === 'demand') {
      // yield only to overwhelming power, with no strong friend to call on
      const mine = w.powerOf(me) + w.diplomacy.allies(me).reduce((t, x) => t + w.powerOf(x), 0) + w.diplomacy.guarantorsOf(me).reduce((t, x) => t + w.powerOf(x), 0);
      return w.powerOf(from) > mine * 4 && op > -60;
    }
    if (deal.kind === 'trade') return TRADE_WILL[p] + friendly - dominant >= 0.5;
    if (deal.kind === 'alliance' || deal.kind === 'bloc') {
      const m = w.military;
      const myEnemies = m.enemiesOf(me), theirEnemies = m.enemiesOf(from);
      const shared = myEnemies.some((e) => theirEnemies.includes(e)) ? 0.35 : 0;
      const trades = w.diplomacy.has('trade', me, from) ? 0.1 : 0;
      const strong = (w.publicView(them).army ?? 0) >= m.unitsOf(me).length * 0.5 ? 0.1 : 0;
      const neighbour = w.defs.get(me)?.neighbours.includes(from) ? 0.05 : 0;
      // balance of power: nations next to the strongest power band together
      const leader = [...w.nations.values()].reduce((a, b) => (w.powerOf(b.id) > w.powerOf(a.id) ? b : a)).id;
      const nearLeader = (x: number) => !!w.defs.get(leader)?.neighbours.includes(x);
      const balance = w.powerOf(leader) > 0.12 && leader !== from && leader !== me && nearLeader(me) && nearLeader(from) ? 0.3 : 0;
      return ALLY_WILL[p] + friendly + shared + trades + strong + neighbour + balance - dominant + (deal.kind === 'bloc' ? 0.1 : 0) >= 0.5;
    }
    // peace: weigh what each side holds of the other's people
    const days = this.warDays(me, from);
    const loss = 1 - w.controlOf(me), gain = 1 - w.controlOf(from);
    if (deal.terms === 'white') return loss >= gain - 0.02 || days > 120 || (days > 40 && gain < 0.1);
    if (deal.terms === 'puppet') return w.controlOf(me) < 0.45 || (loss > gain + 0.25 && days > 60) || days > 300;
    return w.controlOf(me) < 0.6 || (loss > gain + 0.1 && days > 30) || days > 240;
  }

  /** Peacetime diplomacy: trade with neighbours, and an ally or two. */
  private diplomacyOrders(n: NationState): Order[] {
    const w = this.world, d = w.diplomacy, me = n.id, p = n.personality;
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
    // non-aggression with neighbours we get along with, research with friends, guarantees for small friends
    if (this.random() < 0.03 && p !== 'expansionist') {
      const t = neighbours.find((x) => !d.has('nap', me, x) && !w.nations.get(x)?.annexedBy && w.opinion(me, x).total > -10 && !w.dealProblem(me, x, { kind: 'nap' }));
      if (t !== undefined) orders.push({ kind: 'propose', target: t, deal: { kind: 'nap' } });
    }
    if (this.random() < 0.02) {
      const t = d.partners('trade', me).find((x) => !d.has('research', me, x) && w.opinion(me, x).total > 10 && !w.dealProblem(me, x, { kind: 'research' }));
      if (t !== undefined) orders.push({ kind: 'propose', target: t, deal: { kind: 'research' } });
    }
    if (this.random() < 0.01 && (p === 'idealist' || p === 'turtle') && w.powerOf(me) > 0.03) {
      const t = neighbours.find((x) => w.powerOf(x) < w.powerOf(me) * 0.3 && w.opinion(me, x).total > 20 && !w.dealProblem(me, x, { kind: 'guarantee' }));
      if (t !== undefined) orders.push({ kind: 'propose', target: t, deal: { kind: 'guarantee' } });
    }
    // short of something: a contract with the trade partner (or neighbour) that makes most of it
    const short = COMMODITIES.find((c) => n.econ.short[c] > 0.05 || -n.econ.trade[c] > n.econ.capacity[c] * 0.4); // short, or living on imports
    if (short && this.random() < 0.05 && d.contractsOf(me).length < 3) {
      const pool = [...d.partners('trade', me), ...neighbours].filter((x) => !w.nations.get(x)?.annexedBy && !w.military.atWar(me, x));
      const seller = pool.sort((a, b) => (w.nations.get(b)!.econ.capacity[short] - w.nations.get(a)!.econ.capacity[short]))[0];
      const yearly = Math.round(n.econ.capacity[short] * 0.1 * 100) / 100 || 1;
      if (seller !== undefined) orders.push({ kind: 'propose', target: seller, deal: { kind: 'contract', good: short, amount: yearly, years: 2, sell: false } });
    }
    // envoys to sour neighbours, gifts from rich idealists and traders, demands and denunciations from expansionists
    if (n.policy.focus === 'diplomacy' && this.random() < 0.05) {
      const t = neighbours.find((x) => w.opinion(x, me).total < 0 && !(n.envoys ?? []).some((v) => v.target === x && v.until > w.market.day));
      if (t !== undefined) orders.push({ kind: 'envoy', target: t });
    }
    if ((p === 'idealist' || p === 'trader') && n.econ.treasury > n.econ.gdp * 0.1 && this.random() < 0.01) {
      const t = neighbours.find((x) => w.opinion(x, me).total < 10);
      if (t !== undefined) orders.push({ kind: 'propose', target: t, deal: { kind: 'gift', amount: Math.round(n.econ.gdp * 0.002 * 10) / 10 || 0.5 } });
    }
    if (p === 'expansionist' && this.random() < 0.02) {
      const t = neighbours.find((x) => w.powerOf(x) * 2.5 < w.powerOf(me) && !d.allied(me, x) && !(n.pol?.claims ?? []).includes(x));
      if (t !== undefined) {
        const prov = [...w.military.provinces.values()].find((q) => q.owner === t && q.kind === 'land' && q.adj.some((a) => w.military.provinces.get(a)?.owner === me) && !w.dealProblem(me, t, { kind: 'demand', province: q.id }));
        orders.push(prov ? { kind: 'propose', target: t, deal: { kind: 'demand', province: prov.id } } : { kind: 'denounce', target: t });
      }
    }
    return orders;
  }

  /** Pass a law this government likes, if it has the capital (and the votes). */
  pickLaw(n: NationState) {
    const pol = n.pol;
    if (!pol) return;
    const want = LAW_TASTE[n.personality].filter((l) => !pol.laws.includes(l) && !(LAWS[l].excludes ?? []).some((x) => pol.laws.includes(x)));
    if (n.econ.shortage > 0.08 && !pol.laws.includes('rationing')) want.unshift('rationing');
    if (n.econ.treasury < -n.econ.gdp * 0.4 && !pol.laws.includes('austerity')) want.unshift('austerity');
    if (pol.laws.includes('austerity') && n.econ.treasury > 0) { this.world.submit(n.id, { kind: 'law', law: 'austerity', enact: false }, 'ai'); return; }
    const law = want.find((l) => LAWS[l].cost <= pol.capital);
    if (law && pol.laws.length < 6) this.world.submit(n.id, { kind: 'law', law, enact: true }, 'ai');
  }

  private plans = new Map<number, { target: number; staging: number; since: number }>();

  /** Troops by sea, when the enemy cannot be reached by land. */
  private amphibious(n: NationState, enemies: number[], units: { id: number; province: number; next?: number; fighting?: boolean; strength: number; type: UnitType }[], enemyPower: Map<number, number>): Order[] {
    const w = this.world, m = w.military, me = n.id;
    if (this.random() > 0.3) return [];
    const seen = m.visibleProvinces(me);
    const fleet = m.unitsOf(me).filter((u) => domainOf(u.type) === 'sea').reduce((s, u) => s + UNIT_SPECS[u.type].attack * u.strength / 100, 0);
    const theirFleet = [...m.units.values()].filter((u) => enemies.includes(u.nation) && domainOf(u.type) === 'sea' && seen.has(u.province))
      .reduce((s, u) => s + UNIT_SPECS[u.type].defense * u.strength / 100, 0);
    if (fleet < theirFleet * 1.2 + 2) return [];
    const coasts = [...m.provinces.values()].filter((p) => p.kind === 'land' && enemies.includes(m.controller(p.id) ?? -1) && p.adj.some((q) => m.provinces.get(q)?.kind === 'sea'));
    const target = coasts.sort((a, b) => (enemyPower.get(a.id) ?? 0) - (enemyPower.get(b.id) ?? 0))[0];
    const idle = units.filter((u) => u.next === undefined && !u.fighting);
    const force = idle.slice(0, Math.ceil(idle.length * 0.6)).map((u) => u.id);
    return target && force.length >= 3 ? [{ kind: 'move', units: force, to: target.id }] : [];
  }

  /** Next technology: cheapest tier first, this personality's favourite branches first within a tier. */
  pickResearch(n: NationState): TechId | undefined {
    const order = RESEARCH_ORDER[n.personality];
    const open = TECHS.filter((t) => !n.tech.done.includes(t.id) && (!prerequisite(t) || n.tech.done.includes(prerequisite(t)!.id)));
    open.sort((a, b) => a.tier * 4 + order.indexOf(a.branch) - (b.tier * 4 + order.indexOf(b.branch)));
    return open[0]?.id;
  }

  /** How this government votes in the world council (undefined: abstain). */
  vote(n: NationState, r: Resolution): boolean | undefined {
    const w = this.world, d = w.diplomacy, m = w.military, me = n.id;
    if (r.target === me || r.target2 === me) return false;
    const friend = (x: number) => d.allied(me, x) || d.has('trade', me, x);
    if (r.kind === 'ceasefire') {
      if (m.atWar(me, r.target) || (r.target2 !== undefined && m.atWar(me, r.target2))) return false;
      return n.personality === 'expansionist' ? undefined : true;
    }
    if (friend(r.target)) return false;
    if (m.atWar(me, r.target) || d.allied(me, r.by)) return true;
    // aggressors draw condemnation: nations that started a war now under way
    const aggressor = m.wars.some((x) => x.a === r.target);
    if (aggressor) return n.personality !== 'expansionist';
    return n.personality === 'idealist' ? false : undefined;
  }

  /** Blocs, council motions and spies. */
  private covertOrders(n: NationState, enemies: number[]): Order[] {
    const w = this.world, d = w.diplomacy, me = n.id, orders: Order[] = [];
    const bloc = d.blocOf(me);
    // big, outward-looking powers found blocs and invite their friends
    if (!bloc && (n.personality === 'expansionist' || n.personality === 'turtle') && n.econ.gdp > 1500 && this.random() < 0.01) {
      orders.push({ kind: 'bloc_create', name: `${w.defs.get(me)!.short} ${['Pact', 'Union', 'Accord', 'League', 'Compact'][me % 5]}` });
    } else if (bloc?.leader === me && bloc.members.length < MAX_BLOC && this.random() < 0.08) {
      const pick = d.allies(me).concat(d.partners('trade', me)).find((x) => !d.blocOf(x) && !d.pending(me, x, 'bloc'));
      if (pick !== undefined) orders.push({ kind: 'propose', target: pick, deal: { kind: 'bloc' } });
    }
    // sanction a dominant power that keeps expanding
    if (this.random() < 0.02) {
      const leader = [...w.nations.values()].reduce((a, b) => (w.powerOf(b.id) > w.powerOf(a.id) ? b : a));
      if (leader.id !== me && w.powerOf(leader.id) > 0.15 && w.military.enemiesOf(leader.id).length && !d.allied(me, leader.id)) {
        orders.push({ kind: 'resolution', resolution: 'sanction', target: leader.id });
      }
    }
    // condemn those who attacked our friends
    if (this.random() < 0.03) {
      const villain = w.military.wars.find((x) => d.allied(me, x.b) && !d.allied(me, x.a))?.a;
      if (villain !== undefined) orders.push({ kind: 'resolution', resolution: this.random() < 0.5 ? 'condemn' : 'sanction', target: villain });
    }
    // spies: scout and sabotage enemies; steal from the advanced in peacetime
    if (n.mil.funds > SPY_COST * 4 && (n.spyOps?.length ?? 0) < 2) {
      const r = this.random();
      if (enemies.length && r < 0.3) {
        const mission: SpyMission = r < 0.15 ? 'recon' : 'sabotage';
        orders.push({ kind: 'spy', target: enemies[0], mission });
      } else if (!enemies.length && r < 0.04) {
        const ahead = [...w.nations.values()].filter((x) => !x.annexedBy && x.id !== me && (w.publicView(x).techs ?? 0) > n.tech.done.length);
        if (ahead.length) orders.push({ kind: 'spy', target: ahead[Math.floor(this.random() * ahead.length)].id, mission: 'steal' });
      }
    }
    return orders;
  }

  /** Construction and the nuclear question. */
  private strategicOrders(n: NationState, atWar: boolean): Order[] {
    const w = this.world, m = w.military, me = n.id, orders: Order[] = [];
    if (n.tech.done.includes('nuclear') && (n.personality === 'expansionist' || n.personality === 'turtle')
      && (n.mil.warheads ?? 0) < 2 && n.mil.funds > WARHEAD_COST * 1.5) orders.push({ kind: 'warhead' });
    // power first: build a station when blackouts loom
    const energy = w.energyStats(n);
    if (energy.supply < energy.demand * 1.03 && n.econ.treasury > -n.econ.gdp * 0.2) {
      const home = [...w.military.provinces.values()].find((p) => p.kind === 'land' && p.owner === me && w.military.controller(p.id) === me
        && !(['coal_plant', 'gas_plant', 'nuclear_plant', 'renewables'] as BuildingType[]).every((t) => w.military.buildings.get(p.id)?.some((b) => b.type === t)));
      if (home) {
        const has = (t: BuildingType) => !!w.military.buildings.get(home.id)?.some((b) => b.type === t);
        const cap = n.econ.capacity;
        const prefer: BuildingType[] = n.econ.gdp > 2000 ? ['nuclear_plant'] : [];
        prefer.push(cap.coal >= cap.gas ? 'coal_plant' : 'gas_plant', cap.coal >= cap.gas ? 'gas_plant' : 'coal_plant', 'renewables', 'nuclear_plant');
        const pick = prefer.find((t) => !has(t));
        if (pick) { orders.push({ kind: 'build', province: home.id, building: pick }); return orders; }
      }
    }
    if (n.econ.treasury < n.econ.gdp * 0.05 || this.random() > 0.15) return orders;
    const own = [...m.provinces.values()].filter((p) => p.kind === 'land' && p.owner === me && m.controller(p.id) === me);
    if (!own.length) return orders;
    // a modest building programme: grows with the economy, not without limit
    const count = own.reduce((s, p) => s + (m.buildings.get(p.id)?.length ?? 0), 0);
    if (count >= 4 + Math.floor(Math.sqrt(n.econ.gdp / 20))) return orders;
    const has = (p: number, t: BuildingType) => !!m.buildings.get(p)?.some((b) => b.type === t);
    const cap = w.defs.get(me)!.capital;
    const border = own.filter((p) => p.adj.some((q) => m.provinces.get(q)?.kind === 'land' && m.provinces.get(q)!.owner !== me));
    const coastal = own.filter((p) => p.adj.some((q) => m.provinces.get(q)?.kind === 'sea'));
    const r = this.random();
    let pick: [number, BuildingType] | undefined;
    if (atWar || (r < 0.3 && n.personality !== 'trader')) {
      const p = border.sort((a, b) => b.pop - a.pop).find((x) => !has(x.id, 'fort'));
      if (p) pick = [p.id, 'fort'];
    }
    if (!pick && r < 0.45 && !has(cap, 'air_defense') && own.some((p) => p.id === cap)) pick = [cap, 'air_defense'];
    if (!pick && r < 0.55 && coastal.length) { const p = coastal.find((x) => !has(x.id, 'port')); if (p) pick = [p.id, 'port']; }
    if (!pick && r < 0.65) { const p = own.sort((a, b) => b.pop - a.pop).find((x) => !has(x.id, 'mine')); if (p) pick = [p.id, 'mine']; }
    if (!pick) { const p = own.sort((a, b) => b.pop - a.pop).find((x) => !has(x.id, 'factory')); if (p) pick = [p.id, 'factory']; }
    if (pick && BUILDINGS[pick[1]]) orders.push({ kind: 'build', province: pick[0], building: pick[1] });
    return orders;
  }

  /** What to build next: mostly land, a quarter air, some ships if we have a coast. */
  private pickRecruit(n: NationState, all: { type: UnitType }[], r: number): UnitType {
    const count = (d: string) => all.filter((u) => domainOf(u.type) === d).length;
    const coastal = this.world.homeFor(n.id, 'destroyers') !== undefined;
    const aggressive = n.personality === 'expansionist' || n.personality === 'opportunist';
    if (count('air') < all.length * 0.25) {
      if (n.tech.done.includes('drones') && r < 0.3) return 'drones';
      if (n.tech.done.includes('stealth') && r > 0.9 && n.mil.funds > 30) return 'bombers';
      return r < 0.5 ? 'fighters' : 'strike';
    }
    if (coastal && r < 0.06) return 'marines';
    if (r > 0.96) return 'special_forces';
    if (coastal && count('sea') < all.length * 0.15) return r < 0.6 ? 'destroyers' : r < 0.9 ? 'submarines' : 'carrier';
    return r < (aggressive ? 0.2 : 0.1) ? 'armored' : r < (aggressive ? 0.45 : 0.3) ? 'mechanized' : 'infantry';
  }
}
