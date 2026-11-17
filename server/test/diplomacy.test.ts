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
const seed = { pop: 3e7, coastal: 0.5, farm: 50, raw: { food: 2, oil: 1, gas: 1, coal: 1, metals: 1, rare_earths: 0.2 } };
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
