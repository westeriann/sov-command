import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DAY } from '../../shared/clock.ts';
import { UNIT_SPECS } from '../../shared/military.ts';
import { openDb } from '../src/db.ts';
import type { Province } from '../src/military.ts';
import { World, type NationDef } from '../src/world.ts';

// A strip of 9 provinces: nation 1 owns 1-3, nation 2 owns 4-6, nation 3 owns 7-9.
const provinces = (): Province[] => Array.from({ length: 9 }, (_, i) => ({
  id: i + 1, kind: 'land' as const, label: [i, 0] as [number, number], terrain: 'grassland',
  adj: [i, i + 2].filter((x) => x >= 1 && x <= 9), owner: Math.floor(i / 3) + 1, pop: 1e7, name: `P${i + 1}`,
}));
const seed = { pop: 3e7, coastal: 0.5, farm: 50, raw: { food: 2, oil: 1, gas: 1, coal: 1, metals: 1, rare_earths: 0.2, timber: 1 } };
const defs: NationDef[] = [1, 2, 3].map((id) => ({
  id, name: `Nation ${id}`, short: `N${id}`, capital: id * 3 - 1, neighbours: [id - 1, id + 1].filter((x) => x >= 1 && x <= 3),
  provinces: 3, pop: 3e7, area: 1e5, seed,
}));
const opts = { speed: 8640, startGame: Date.UTC(2026, 0, 1), aiBudgetPerTick: 0, autopilotAfterMs: 1e12, releaseAfterMs: 1e12 };

function setup(humans = [1, 2, 3]) {
  const w = new World(openDb(':memory:'), 1, defs, opts, provinces());
  w.military.units.clear();
  for (const id of humans) w.claim({ id, name: `p${id}`, guest: false }, id);
  for (const n of w.nations.values()) { n.pol!.support = 90; n.event = undefined; n.nextEvent = 1e9; }
  return w;
}

test('war score counts occupied people; the peace conference pays for terms with it', () => {
  const w = setup();
  assert.equal(w.submit(1, { kind: 'war', target: 2, goal: 'conquest' }, 'human').ok, true);
  assert.equal(w.military.warBetween(1, 2)?.goal, 'conquest');
  w.military.occupied.set(4, 1);
  const score = w.warScore(1, 2);
  assert.ok(score > 30, `holding a third of their people scores well (${score})`);
  assert.equal(w.warScore(2, 1), -score, 'and the loser sees the mirror image');
  // a province costs half with a conquest goal
  const t = { provinces: [4], reparations: 0, demilitarize: false };
  const withGoal = w.treatyCostFor(1, 2, t);
  w.military.warBetween(1, 2)!.goal = undefined;
  assert.ok(w.treatyCostFor(1, 2, t) > withGoal);
  w.military.warBetween(1, 2)!.goal = 'conquest';
  w.submit(1, { kind: 'propose', target: 2, deal: { kind: 'peace', terms: 'treaty', treaty: { provinces: [4], reparations: 0.01, demilitarize: true } } }, 'human');
  assert.equal(w.submit(2, { kind: 'answer', from: 1, deal: 'peace', accept: true }, 'human').ok, true);
  assert.equal(w.military.atWar(1, 2), false, 'peace');
  assert.equal(w.military.provinces.get(4)!.owner, 1, 'the province changes hands');
  assert.equal(w.nations.get(2)!.repay?.[0].to, 1, 'reparations are owed');
  assert.ok(w.nations.get(2)!.mil.demil?.provinces.includes(5), 'their new border is demilitarised');
  assert.equal(w.military.canEnter(2, 5), false, 'and closed to their troops');
  const before = w.nations.get(1)!.econ.treasury;
  (w as unknown as { statecraftDay(n: unknown, d: number): void }).statecraftDay(w.nations.get(2)!, w.market.day + 1);
  assert.ok(w.nations.get(1)!.econ.treasury > before, 'reparations arrive daily');
});

test('units need equipment: production stalls without it', () => {
  const w = setup();
  const n = w.nations.get(1)!;
  n.mil.funds = 100;
  n.mil.equipment = 0;
  n.pol!.laws = [];
  w.submit(1, { kind: 'policy', policy: { focus: 'economy' } }, 'human');
  assert.equal(w.submit(1, { kind: 'recruit', unit: 'armored' }, 'human').ok, true);
  w.military.logistics(1, n.mil, 0, 1e6, () => 2, 0, 0);
  assert.equal(n.mil.queue[0].progress, 0, 'no kit, no progress');
  w.military.logistics(1, n.mil, 0, 1e6, () => 2, 0, 50);
  assert.ok(n.mil.queue[0].progress > 0, 'with kit it moves');
  assert.ok(w.equipmentRate(n) > 0, 'arsenals make kit from the defence budget');
  assert.ok(UNIT_SPECS.armored.cost * 10 > UNIT_SPECS.infantry.cost * 10, 'armour costs more kit');
});

test('supply reaches a few provinces beyond your land, further with a depot', () => {
  const w = setup();
  w.submit(1, { kind: 'war', target: 2 }, 'human');
  w.submit(1, { kind: 'war', target: 3 }, 'human');
  for (const p of [4, 5, 6, 7, 8]) w.military.occupied.set(p, 1);
  const u = w.military.spawn(1, 'infantry', 8);
  w.military.updateSupply((x) => w.home(x));
  assert.equal(u.supplied, false, 'five provinces beyond our border is too far');
  w.military.buildings.set(6, [{ type: 'depot', progress: 1 }]);
  w.military.updateSupply((x) => w.home(x));
  assert.equal(u.supplied, true, 'a depot carries supply forward');
});

test('decisions: an event waits for an answer, applies it, and the first option is taken if ignored', () => {
  const w = setup();
  const n = w.nations.get(1)!;
  n.event = { key: 'boom', day: w.market.day };
  const gdp = n.econ.gdp;
  assert.equal(w.privateView(n).event?.key, 'boom', 'the player sees it');
  assert.equal(w.submit(1, { kind: 'choose', event: 'boom', option: 0 }, 'human').ok, true);
  assert.ok(n.econ.gdp > gdp, 'letting the boom run grows the economy');
  assert.equal(n.event, undefined);
  n.event = { key: 'drought', day: w.market.day - 40 };
  const cash = n.econ.treasury;
  (w as unknown as { statecraftDay(n: unknown, d: number): void }).statecraftDay(n, w.market.day);
  assert.equal(n.event, undefined, 'timed out');
  assert.ok(n.econ.treasury < cash, 'the first option (buy food abroad) was taken');
});

test('parties: polls, a coalition, and an election that can bring in a new government', () => {
  const w = setup();
  const n = w.nations.get(1)!;
  n.gov.government = 'democracy';
  (w as unknown as { statecraftDay(n: unknown, d: number): void }).statecraftDay(n, w.market.day);
  assert.equal(n.parties?.length, 4);
  const gov = n.parties!.filter((x) => x.gov).reduce((t, x) => t + x.seats, 0);
  assert.ok(gov >= 0.5, 'the government starts with a majority');
  const out = n.parties!.find((x) => !x.gov);
  if (out) {
    n.pol!.capital = 100;
    const r = w.submit(1, { kind: 'coalition', party: out.name, join: true }, 'human');
    assert.ok(r.ok || /too far apart/.test(r.ok ? '' : r.message), 'invite, unless they are too far apart');
  }
  // an election the governing parties lose
  for (const x of n.parties!) x.gov = false;
  n.parties![0].gov = true;
  n.parties![0].poll = 0.05;
  n.econ.stability = 5;
  n.gov.nextElection = w.market.day;
  (w as unknown as { rand: () => number }).rand = () => 0.5;
  (w as unknown as { politicsDay(d: number): void }).politicsDay(w.market.day);
  assert.ok((n.gov.oppositionUntil ?? 0) > w.market.day, 'the government lost');
  assert.ok(n.parties!.filter((x) => x.gov).reduce((t, x) => t + x.seats, 0) >= 0.5, 'a new coalition with a majority took over');
});

test('espionage: missions need a network; counter-intelligence wears foreign networks down', () => {
  const w = setup();
  const a = w.nations.get(1)!, b = w.nations.get(2)!;
  a.mil.funds = 50;
  assert.equal(w.submit(1, { kind: 'spy', target: 2, mission: 'recon' }, 'human').ok, false);
  assert.equal(w.submit(1, { kind: 'network', target: 2, build: true }, 'human').ok, true);
  const day = (n: typeof a) => (w as unknown as { statecraftDay(n: unknown, d: number): void }).statecraftDay(n, w.market.day);
  for (let i = 0; i < 15; i++) day(a);
  assert.ok((a.spy!.nets[2] ?? 0) >= 10, 'recruiting builds the network');
  assert.equal(w.submit(1, { kind: 'spy', target: 2, mission: 'recon' }, 'human').ok, true);
  assert.equal(w.submit(1, { kind: 'network', target: 2, build: false }, 'human').ok, true);
  w.submit(2, { kind: 'counter_intel', level: 3 }, 'human');
  const net = a.spy!.nets[2];
  day(a);
  assert.ok((a.spy!.nets[2] ?? 0) < net - 0.5, 'their counter-intelligence eats into it');
  assert.ok(b.spy!.counter === 3);
});

test('autonomy calms a restless province; separatists break away when their old nation is gone', () => {
  const w = setup();
  w.diplomacy.unrest.set(3, 80);
  w.diplomacy.formerOwner.set(3, 99); // a nation that no longer exists
  w.nations.get(1)!.pol!.capital = 50;
  assert.equal(w.submit(1, { kind: 'autonomy', province: 3 }, 'human').ok, true);
  assert.equal(w.diplomacy.unrest.get(3), 40, 'unrest halves');
  assert.ok(w.unrestLoss(1) > 0, 'an autonomous province keeps part of its output');
  // without autonomy, a separatist revolt founds a new nation
  const v = setup();
  v.diplomacy.unrest.set(1, 90);
  v.diplomacy.formerOwner.set(1, 99);
  (v as unknown as { rand: () => number }).rand = () => 0;
  const before = v.nations.size;
  (v as unknown as { unrestDay(): void }).unrestDay();
  assert.equal(v.nations.size, before + 1, 'a new nation is born');
});

test('a shared world pauses when every leader online votes for it', () => {
  const w = setup([1, 2]);
  w.setPresence(1, true);
  w.setPresence(2, true);
  const t0 = w.gameNow();
  w.submit(1, { kind: 'pause_vote', on: true }, 'human');
  assert.equal(w.pauseState(1).paused, false, 'one vote is not enough');
  w.submit(2, { kind: 'pause_vote', on: true }, 'human');
  assert.equal(w.pauseState(1).paused, true);
  assert.equal(w.gameNow(Date.now() + 60_000), w.gameNow(), 'the clock stands still');
  w.submit(2, { kind: 'pause_vote', on: false }, 'human');
  assert.equal(w.pauseState(1).paused, false, 'any leader can end it');
  assert.ok(w.gameNow(Date.now() + DAY) > t0);
});

test('a truce stops the fighting where the lines stand, then the war resumes', () => {
  const w = setup();
  w.submit(1, { kind: 'war', target: 2 }, 'human');
  w.military.occupied.set(4, 1);
  w.submit(1, { kind: 'propose', target: 2, deal: { kind: 'truce', days: 30 } }, 'human');
  assert.equal(w.submit(2, { kind: 'answer', from: 1, deal: 'truce', accept: true }, 'human').ok, true);
  w.military.now = w.gameNow();
  assert.equal(w.military.atWar(1, 2), false, 'no fighting during the truce');
  assert.ok(w.military.warBetween(1, 2), 'but the war is not over');
  assert.equal(w.military.occupied.get(4), 1, 'the lines hold');
  assert.equal(w.military.canEnter(1, 5), false, 'no advancing');
  assert.equal(w.submit(1, { kind: 'war', target: 2 }, 'human').ok, false, 'no second declaration');
  // peace can still be made during a truce
  assert.equal(w.dealProblem(1, 2, { kind: 'peace', terms: 'white' }), null);
  w.military.now = w.gameNow() + 31 * DAY;
  assert.equal(w.military.atWar(1, 2), true, 'when it runs out, the war resumes');
});

test('single-player advisers act in the areas they are given, and log it', () => {
  const sp = new World(openDb(':memory:'), 1, defs, { ...opts, singlePlayer: true }, provinces());
  sp.claim({ id: 1, name: 'p1', guest: false }, 1);
  const n = sp.nations.get(1)!;
  n.tech.current = undefined;
  assert.equal(sp.submit(1, { kind: 'advisers', areas: ['research', 'decisions'] }, 'human').ok, true);
  n.event = { key: 'boom', day: sp.market.day - 5 };
  (sp as unknown as { advisersDay(n: unknown, d: number): void }).advisersDay(n, n.id % 7);
  assert.equal(n.event, undefined, 'the decision was answered');
  assert.ok(n.tech.current, 'research was started');
  assert.ok((n.adviserLog ?? []).length >= 2, 'and both were logged');
  // shared worlds keep the away-from-keyboard autopilot instead
  const mp = setup();
  assert.equal(mp.submit(1, { kind: 'advisers', areas: ['research'] }, 'human').ok, false);
});
