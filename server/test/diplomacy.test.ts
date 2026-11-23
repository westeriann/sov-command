import assert from 'node:assert/strict';
import { test } from 'node:test';
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
  return w;
}

test('treaties between players need both sides; either side can end them', () => {
  const w = setup();
  assert.equal(w.submit(1, { kind: 'propose', target: 2, deal: { kind: 'trade' } }, 'human').ok, true);
  assert.equal(w.diplomacy.has('trade', 1, 2), false, 'only proposed so far');
  assert.equal(w.privateView(w.nations.get(2)!).diplo!.incoming.length, 1, 'bob sees the proposal');
  assert.equal(w.submit(2, { kind: 'answer', from: 1, deal: 'trade', accept: true }, 'human').ok, true);
  assert.equal(w.diplomacy.has('trade', 1, 2), true);
  assert.equal(w.warState().treaties.length, 1, 'treaties are public');
  // proposing what the other side already offered accepts it
  w.submit(2, { kind: 'propose', target: 1, deal: { kind: 'alliance' } }, 'human');
  w.submit(1, { kind: 'propose', target: 2, deal: { kind: 'alliance' } }, 'human');
  assert.equal(w.diplomacy.has('alliance', 1, 2), true);
  assert.equal(w.submit(1, { kind: 'war', target: 2 }, 'human').ok, false, 'cannot attack an ally');
  assert.equal(w.submit(2, { kind: 'cancel', target: 1, pact: 'alliance' }, 'human').ok, true);
  assert.equal(w.submit(1, { kind: 'war', target: 2 }, 'human').ok, true);
  assert.equal(w.diplomacy.has('trade', 1, 2), false, 'war ends trade');
});

test('allies grant military access and defend each other', () => {
  const w = setup();
  w.submit(2, { kind: 'propose', target: 3, deal: { kind: 'alliance' } }, 'human');
  w.submit(3, { kind: 'answer', from: 2, deal: 'alliance', accept: true }, 'human');
  const u = w.military.spawn(3, 'infantry', 7);
  assert.equal(w.submit(3, { kind: 'move', units: [u.id], to: 5 }, 'human').ok, true, 'allied land is open');
  w.submit(1, { kind: 'war', target: 2 }, 'human');
  assert.equal(w.military.atWar(3, 1), true, 'the ally joins the defender');
  assert.equal(w.military.atWar(1, 2), true);
});

test('peace with ceded land moves provinces, people and output to the winner', () => {
  const w = setup();
  w.submit(1, { kind: 'war', target: 2 }, 'human');
  w.military.occupied.set(4, 1);
  const gdp1 = w.nations.get(1)!.econ.gdp, gdp2 = w.nations.get(2)!.econ.gdp;
  w.submit(1, { kind: 'propose', target: 2, deal: { kind: 'peace', terms: 'cede' } }, 'human');
  assert.equal(w.submit(2, { kind: 'answer', from: 1, deal: 'peace', accept: true }, 'human').ok, true);
  assert.equal(w.military.atWar(1, 2), false);
  assert.equal(w.military.provinces.get(4)!.owner, 1, 'province 4 now belongs to nation 1');
  assert.equal(w.warState().owners[4], 1, 'the new border is public');
  assert.equal(w.military.occupied.has(4), false);
  assert.ok(Math.abs(w.nations.get(2)!.econ.gdp - gdp2 * 2 / 3) < 1e-6, 'the loser keeps two thirds');
  assert.ok(Math.abs(w.nations.get(1)!.econ.gdp - (gdp1 + gdp2 / 3)) < 1e-6, 'the winner gains a third of it');
  assert.equal(w.controlOf(2), 1, 'what is left is fully controlled');
});

test('a nation that cedes its last land is annexed and its player released', () => {
  const w = setup();
  w.submit(1, { kind: 'war', target: 2 }, 'human');
  w.military.spawn(2, 'infantry', 6);
  for (const p of [4, 5, 6]) w.military.occupied.set(p, 1);
  w.submit(1, { kind: 'propose', target: 2, deal: { kind: 'peace', terms: 'cede' } }, 'human');
  w.submit(2, { kind: 'answer', from: 1, deal: 'peace', accept: true }, 'human');
  const n2 = w.nations.get(2)!;
  assert.equal(n2.annexedBy, 1);
  assert.equal(n2.controller, 'ai', 'the player was released');
  assert.equal(w.military.unitsOf(2).length, 0, 'its forces are gone');
  assert.equal(w.claim({ id: 9, name: 'late', guest: false }, 2).ok, false, 'cannot claim a nation that no longer exists');
  assert.ok(!w.economyUpdate().nations.some((e) => e.id === 2));
  w.tick(Date.now() + 30_000); // the economy keeps running without it
  assert.ok(Number.isFinite(w.nations.get(1)!.econ.gdp));
});

test('AI governments answer at once, by personality and situation', () => {
  const w = setup([1]);
  const n2 = w.nations.get(2)!;
  n2.personality = 'trader';
  assert.equal(w.submit(1, { kind: 'propose', target: 2, deal: { kind: 'trade' } }, 'human').ok, true);
  assert.equal(w.diplomacy.has('trade', 1, 2), true, 'a trader signs');
  const n3 = w.nations.get(3)!;
  n3.personality = 'expansionist';
  w.nations.get(1)!.policy.focus = 'economy';
  const r = w.submit(1, { kind: 'propose', target: 3, deal: { kind: 'trade' } }, 'human');
  assert.equal(r.ok, false, 'an expansionist turns down a nation that is not courting it');
  w.nations.get(1)!.policy.focus = 'diplomacy';
  assert.equal(w.submit(1, { kind: 'propose', target: 3, deal: { kind: 'trade' } }, 'human').ok, true, 'diplomatic focus wins it over');
  // the AI makes white peace when nothing is being won
  w.submit(1, { kind: 'war', target: 2 }, 'human');
  w.military.wars[0].since -= 200;
  assert.equal(w.submit(1, { kind: 'peace', target: 2 }, 'human').ok, true);
  assert.equal(w.military.atWar(1, 2), false);
});

test('embargoes close markets in proportion to the embargoing economies', () => {
  const w = setup();
  w.submit(1, { kind: 'propose', target: 2, deal: { kind: 'trade' } }, 'human');
  w.submit(2, { kind: 'answer', from: 1, deal: 'trade', accept: true }, 'human');
  assert.equal(w.embargoPressure(2), 0);
  assert.equal(w.submit(1, { kind: 'embargo', target: 2, on: true }, 'human').ok, true);
  assert.ok(w.embargoPressure(2) > 0.2, 'a third of the world economy closes its markets');
  assert.equal(w.diplomacy.has('trade', 1, 2), false, 'the trade agreement ends');
  assert.equal(w.warState().embargoes.length, 1);
  assert.equal(w.submit(1, { kind: 'embargo', target: 2, on: false }, 'human').ok, true);
  assert.equal(w.embargoPressure(2), 0);
});

test('conquered provinces are restless; unrest fades, faster with a garrison', () => {
  const w = setup();
  w.submit(1, { kind: 'war', target: 2 }, 'human');
  w.military.occupied.set(4, 1);
  w.military.occupied.set(5, 1);
  w.submit(1, { kind: 'propose', target: 2, deal: { kind: 'peace', terms: 'cede' } }, 'human');
  w.submit(2, { kind: 'answer', from: 1, deal: 'peace', accept: true }, 'human');
  assert.equal(w.warState().unrest[4], 60);
  assert.ok(w.unrestLoss(1) > 0, 'unrest costs the new owner some control');
  w.military.spawn(1, 'infantry', 4); // garrison in 4, none in 5
  (w as unknown as { rand: () => number }).rand = () => 0.99; // no revolts for this test
  for (let d = 0; d < 20; d++) (w as unknown as { unrestDay: () => void }).unrestDay();
  const u = w.warState().unrest;
  assert.ok(u[4] < u[5], 'the garrisoned province calms faster');
  // with no garrison a revolt hands the province back
  (w as unknown as { rand: () => number }).rand = () => 0;
  (w as unknown as { unrestDay: () => void }).unrestDay();
  assert.equal(w.military.provinces.get(5)!.owner, 2, 'province 5 returned to its former owner');
});

test('blocs: members defend each other; leaders invite; leaving works', () => {
  const w = setup();
  assert.equal(w.submit(2, { kind: 'bloc_create', name: 'Northern Accord' }, 'human').ok, true);
  w.submit(2, { kind: 'propose', target: 3, deal: { kind: 'bloc' } }, 'human');
  w.submit(3, { kind: 'answer', from: 2, deal: 'bloc', accept: true }, 'human');
  assert.deepEqual(w.diplomacy.blocOf(3)?.members, [2, 3]);
  assert.equal(w.diplomacy.allied(2, 3), true, 'bloc members are allies');
  w.submit(1, { kind: 'war', target: 2 }, 'human');
  assert.equal(w.military.atWar(3, 1), true, 'the bloc answers an attack on one of its members');
  assert.equal(w.submit(3, { kind: 'bloc_leave' }, 'human').ok, true);
  assert.equal(w.diplomacy.allied(2, 3), false);
});

test('world council: votes over 7 days decide sanctions and ceasefires', () => {
  const w = setup();
  w.submit(1, { kind: 'war', target: 2 }, 'human');
  assert.equal(w.submit(3, { kind: 'resolution', resolution: 'ceasefire', target: 1, target2: 2 }, 'human').ok, true);
  const r = w.diplomacy.council[0];
  assert.equal(w.submit(2, { kind: 'vote', id: r.id, yes: true }, 'human').ok, true);
  w.submit(1, { kind: 'vote', id: r.id, yes: false }, 'human');
  w.tick(Date.now() + 86_400_000 / 8640 * 8);
  assert.equal(r.result, 'passed', '2 to 1');
  assert.equal(w.military.atWar(1, 2), false, 'the ceasefire ends the war');
});

test('puppet states: the loser becomes a vassal that pays tribute and cannot start wars', () => {
  const w = setup();
  w.submit(1, { kind: 'war', target: 2 }, 'human');
  w.submit(1, { kind: 'propose', target: 2, deal: { kind: 'peace', terms: 'puppet' } }, 'human');
  w.submit(2, { kind: 'answer', from: 1, deal: 'peace', accept: true }, 'human');
  assert.equal(w.warState().vassals[2], 1);
  assert.equal(w.diplomacy.allied(1, 2), true);
  assert.equal(w.submit(2, { kind: 'war', target: 3 }, 'human').ok, false, 'vassals cannot start wars');
  const t = w.nations.get(1)!.econ.treasury;
  (w as unknown as { politicsDay: (d: number) => void }).politicsDay(w.market.day);
  assert.ok(w.nations.get(1)!.econ.treasury > t, 'tribute flows to the overlord');
  assert.equal(w.submit(2, { kind: 'war', target: 1 }, 'human').ok, true, 'but it may fight for independence');
  assert.equal(w.warState().vassals[2], undefined);
});

test('spies: operations take days and report back; elections can bind a democracy', () => {
  const w = setup();
  const a = w.nations.get(1)!, b = w.nations.get(2)!;
  a.mil.funds = 50;
  b.tech.done.push('automation');
  assert.equal(w.submit(1, { kind: 'spy', target: 2, mission: 'steal' }, 'human').ok, false, 'no agents there yet');
  a.spy = { nets: { 2: 40 }, building: [], counter: 0 };
  assert.equal(w.submit(1, { kind: 'spy', target: 2, mission: 'steal' }, 'human').ok, true);
  (w as unknown as { rand: () => number }).rand = () => 0.2; // success, not caught
  (w as unknown as { spyDay: (d: number) => void }).spyDay(w.market.day + 5);
  assert.ok((a.tech.partial.automation ?? 0) > 0, 'stolen research');
  assert.match(w.privateView(a).reports![0], /stole research/);
  // a democracy that loses an election cannot start a war for six months
  a.gov = { government: 'democracy', nextElection: w.market.day };
  a.econ.stability = 20;
  a.parties = undefined;
  (w as unknown as { rand: () => number }).rand = () => 0.99;
  (w as unknown as { politicsDay: (d: number) => void }).politicsDay(w.market.day);
  assert.ok((a.gov.oppositionUntil ?? 0) > w.market.day);
  assert.equal(w.submit(1, { kind: 'war', target: 2 }, 'human').ok, false);
});
