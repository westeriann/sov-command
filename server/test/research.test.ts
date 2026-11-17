import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TIER_COST } from '../../shared/research.ts';
import { openDb } from '../src/db.ts';
import type { Province } from '../src/military.ts';
import { World, type NationDef } from '../src/world.ts';

const provinces: Province[] = Array.from({ length: 4 }, (_, i) => ({
  id: i + 1, kind: 'land' as const, label: [i, 0] as [number, number], terrain: 'grassland',
  adj: [i, i + 2].filter((x) => x >= 1 && x <= 4), owner: i < 2 ? 1 : 2, pop: 1e7, name: `P${i + 1}`,
}));
const seed = { pop: 2e7, coastal: 0.5, farm: 50, raw: { food: 2, oil: 1, gas: 1, coal: 1, metals: 1, rare_earths: 0.2 } };
const defs: NationDef[] = [1, 2].map((id) => ({
  id, name: `Nation ${id}`, short: `N${id}`, capital: id * 2 - 1, neighbours: [3 - id], provinces: 2, pop: 2e7, area: 1e5, seed,
}));
const SPEED = 8640;
const opts = { speed: SPEED, startGame: Date.UTC(2026, 0, 1), aiBudgetPerTick: 0, autopilotAfterMs: 1e12, releaseAfterMs: 1e12 };
const realPerDay = 86_400_000 / SPEED;

function setup() {
  const w = new World(openDb(':memory:'), 1, defs, opts, provinces);
  w.claim({ id: 1, name: 'alice', guest: false }, 1);
  return w;
}

test('research follows the tree, takes game days, and its bonus applies', () => {
  const w = setup();
  const n = w.nations.get(1)!;
  assert.equal(w.submit(1, { kind: 'research', tech: 'logistics_ai' }, 'human').ok, false, 'tier 2 needs tier 1 first');
  assert.equal(w.submit(1, { kind: 'research', tech: 'drones' }, 'human').ok, true);
  const rate = w.researchRate(n);
  assert.ok(rate > 15 && rate < 60, `about 30 points a day at the default budget (${rate.toFixed(1)})`);
  const before = w.effects(1).landAttack;
  const days = Math.ceil(TIER_COST[1] / rate) + 2;
  // the world catches up at most 60 days per tick, so step through
  for (let d = 30; d < days + 30; d += 30) w.tick(Date.now() + realPerDay * Math.min(d, days));
  assert.ok(n.tech.done.includes('drones'), `done after ~${days} days`);
  assert.ok(w.effects(1).landAttack > before, 'land attack bonus applies');
  assert.equal(w.privateView(n).research!.done.includes('drones'), true, 'the player sees it');
});

test('changing government takes a month of turmoil and can only happen once a year', () => {
  const w = setup();
  const n = w.nations.get(1)!;
  const target = n.gov.government === 'technocracy' ? 'democracy' : 'technocracy';
  const calm = w.effects(1).stability;
  assert.equal(w.submit(1, { kind: 'government', government: target }, 'human').ok, true);
  assert.equal(n.gov.government, target);
  assert.ok(w.effects(1).stability < calm - 5, 'reform costs stability');
  assert.equal(w.submit(1, { kind: 'government', government: 'junta' }, 'human').ok, false, 'one reform at a time');
  w.tick(Date.now() + realPerDay * 32);
  assert.equal(n.gov.reformUntil, undefined, 'the reform is over');
  assert.equal(w.submit(1, { kind: 'government', government: 'junta' }, 'human').ok, false, 'not again within a year');
});

test('AI nations pick research on their own', () => {
  const w = setup();
  w.tick(Date.now() + realPerDay * 2);
  assert.ok(w.nations.get(2)!.tech.current, 'the AI chose something to research');
  assert.equal(w.nations.get(1)!.tech.current, undefined, 'players choose for themselves');
});
