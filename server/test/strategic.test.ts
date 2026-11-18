import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDb } from '../src/db.ts';
import type { Province } from '../src/military.ts';
import { World, type NationDef } from '../src/world.ts';

// A strip of 8 provinces: nation 1 owns 1-4, nation 2 owns 5-8. Province 1 has a coast (sea zone 9).
const provinces = (): Province[] => [
  ...Array.from({ length: 8 }, (_, i) => ({
    id: i + 1, kind: 'land' as const, label: [i, 0] as [number, number], terrain: 'grassland',
    adj: [...[i, i + 2].filter((x) => x >= 1 && x <= 8), ...(i === 0 ? [9] : [])], owner: i < 4 ? 1 : 2, pop: 1e7, name: `P${i + 1}`,
  })),
  { id: 9, kind: 'sea' as const, label: [-1, 0] as [number, number], terrain: 'ocean', adj: [1], pop: 0, name: 'Sea' },
];
const seed = { pop: 4e7, coastal: 0.5, farm: 50, raw: { food: 2, oil: 1, gas: 1, coal: 1, metals: 1, rare_earths: 0.2 } };
const defs: NationDef[] = [
  { id: 1, name: 'Republic of A', short: 'A', capital: 1, neighbours: [2], provinces: 4, pop: 4e7, area: 1e5, seed },
  { id: 2, name: 'Kingdom of B', short: 'B', capital: 8, neighbours: [1], provinces: 4, pop: 4e7, area: 1e5, seed },
];
const SPEED = 8640;
const opts = { speed: SPEED, startGame: Date.UTC(2026, 0, 1), aiBudgetPerTick: 0, autopilotAfterMs: 1e12, releaseAfterMs: 1e12 };
const realPerDay = 86_400_000 / SPEED;

function setup() {
  const w = new World(openDb(':memory:'), 1, defs, opts, provinces());
  w.military.units.clear();
  w.claim({ id: 1, name: 'alice', guest: false }, 1);
  w.claim({ id: 2, name: 'bob', guest: false }, 2);
  for (const n of w.nations.values()) { n.mil.funds = 200; n.econ.treasury = 500; }
  return w;
}

test('buildings take game days, and forts make defenders much harder to beat', () => {
  const w = setup();
  assert.equal(w.submit(1, { kind: 'build', province: 5, building: 'fort' }, 'human').ok, false, 'not in foreign land');
  assert.equal(w.submit(1, { kind: 'build', province: 2, building: 'port' }, 'human').ok, false, 'a port needs a coast');
  assert.equal(w.submit(2, { kind: 'build', province: 5, building: 'fort' }, 'human').ok, true);
  assert.equal(w.military.built(5, 'fort'), false, 'under construction');
  for (let d = 30; d <= 60; d += 30) w.tick(Date.now() + realPerDay * d);
  assert.equal(w.military.built(5, 'fort'), true, 'finished after 40 days');
  assert.ok(w.warState().buildings[5].length === 1, 'buildings are public');
  // same armies, with and without the fort
  const losses = (fort: boolean) => {
    const v = setup();
    if (fort) v.military.buildings.set(5, [{ type: 'fort', progress: 1 }]);
    v.submit(1, { kind: 'war', target: 2 }, 'human');
    const a = v.military.spawn(1, 'armored', 5), d = v.military.spawn(2, 'infantry', 5);
    v.military.fight(() => true, () => undefined, []);
    return (100 - a.strength) / Math.max(0.1, 100 - d.strength);
  };
  assert.ok(losses(true) > losses(false) * 1.2, 'attackers lose relatively more against a fort');
});

test('units cut off from supply weaken; generals gain skill in battle', () => {
  const w = setup();
  w.submit(1, { kind: 'war', target: 2 }, 'human');
  const deep = w.military.spawn(1, 'infantry', 7); // two provinces behind enemy lines
  w.military.updateSupply((n) => w.home(n));
  assert.equal(deep.supplied, false);
  assert.ok(deep.strength < 100, 'worn down');
  const near = w.military.spawn(1, 'infantry', 5); // at the front, next to our land
  w.military.updateSupply((n) => w.home(n));
  assert.equal(near.supplied, true);

  const u = w.military.spawn(1, 'armored', 4);
  assert.equal(w.submit(1, { kind: 'general', unit: u.id }, 'human').ok, true);
  assert.equal(w.submit(1, { kind: 'general', unit: u.id }, 'human').ok, false, 'one per unit');
  u.general!.xp = 99;
  w.military.spawn(2, 'infantry', 4);
  w.military.fight(() => true, () => undefined, []);
  assert.equal(u.general!.skill, 2, 'promoted after battle');
});

test('missiles need research, war and range; nuclear strikes devastate and isolate the attacker', () => {
  const w = setup();
  const a = w.nations.get(1)!;
  assert.equal(w.submit(1, { kind: 'missile', province: 6 }, 'human').ok, false, 'no research yet');
  a.tech.done.push('hypersonics', 'nuclear');
  assert.equal(w.submit(1, { kind: 'missile', province: 6 }, 'human').ok, false, 'not at war');
  w.submit(1, { kind: 'war', target: 2 }, 'human');
  const target = w.military.spawn(2, 'infantry', 6);
  assert.equal(w.submit(1, { kind: 'missile', province: 6 }, 'human').ok, true);
  assert.ok(target.strength <= 85, 'the salvo hit');
  assert.equal(w.submit(1, { kind: 'missile', province: 6 }, 'human').ok, false, 'one salvo a day');

  assert.equal(w.submit(1, { kind: 'nuke', province: 7 }, 'human').ok, false, 'no warheads');
  assert.equal(w.submit(1, { kind: 'warhead' }, 'human').ok, true);
  assert.equal(w.publicView(a).nuclear, true, 'nuclear status is public');
  const gdp = w.nations.get(2)!.econ.gdp;
  w.military.spawn(2, 'armored', 7);
  assert.equal(w.submit(1, { kind: 'nuke', province: 7 }, 'human').ok, true);
  assert.equal(w.military.unitsIn(7).length, 0, 'everything there is destroyed');
  assert.ok(w.nations.get(2)!.econ.gdp < gdp * 0.95, 'the economy is crippled');
  assert.deepEqual(w.warState().nuked, [7]);
  assert.equal(a.mil.warheads, 0);
});

test('strike wings bomb enemy industry', () => {
  const w = setup();
  w.submit(1, { kind: 'war', target: 2 }, 'human');
  w.military.buildings.set(6, [{ type: 'factory', progress: 1 }, { type: 'mine', progress: 1 }]);
  const gdp = w.nations.get(2)!.econ.gdp;
  for (let i = 0; i < 6; i++) {
    const s = w.military.spawn(1, 'strike', 4);
    s.mission = { kind: 'bomb', target: 6 };
  }
  for (let d = 0; d < 10; d++) w.military.fight(() => true, () => undefined, []);
  assert.ok(w.nations.get(2)!.econ.gdp < gdp, 'bombing costs the target output');
  assert.ok((w.military.buildings.get(6)?.length ?? 0) < 2, 'and destroys buildings over time');
});

test('rally points send newly built land units toward the front', () => {
  const w = setup();
  assert.equal(w.submit(1, { kind: 'rally', province: 5 }, 'human').ok, false, 'only in land you hold');
  assert.equal(w.submit(1, { kind: 'rally', province: 4 }, 'human').ok, true);
  const n = w.nations.get(1)!;
  n.mil.queue = [{ type: 'infantry', progress: 0.99 }];
  w.tick(Date.now() + realPerDay * 2);
  const fresh = w.military.unitsOf(1).find((u) => u.type === 'infantry')!;
  assert.ok(fresh.next !== undefined || fresh.province === 4, 'it marches to the rally point');
  assert.equal(w.privateView(n).mil!.rally, 4);
});

test('electricity: a growing economy outgrows its grid; power stations and fuel keep the lights on', () => {
  const w = setup();
  const n = w.nations.get(1)!;
  n.econ.grid = n.econ.gdp * 0.8; // a grid that fell behind
  w.tick(Date.now() + realPerDay * 2);
  assert.ok((n.econ.blackout ?? 0) > 0.1, 'blackouts');
  const before = n.econ.growth;
  w.military.buildings.set(2, [{ type: 'nuclear_plant', progress: 1 }, { type: 'coal_plant', progress: 1 }, { type: 'gas_plant', progress: 1 }, { type: 'renewables', progress: 1 }]);
  w.tick(Date.now() + realPerDay * 4);
  assert.ok((n.econ.blackout ?? 0) < 0.05, 'stations close the gap');
  assert.ok(n.econ.growth > before, 'and growth recovers');
  assert.ok((w.extraUse(n).coal ?? 0) > 0, 'the coal station burns coal');
  // an oil shortage weakens the armed forces
  const full = w.effects(1).landAttack;
  n.econ.short.oil = 1;
  (w as unknown as { effectCache: Map<number, unknown> }).effectCache.clear();
  assert.ok(w.effects(1).landAttack < full - 0.3);
});
