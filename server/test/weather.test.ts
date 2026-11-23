import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILDINGS, REPAIR_TIME_SHARE } from '../../shared/buildings.ts';
import { DAY } from '../../shared/clock.ts';
import { openDb } from '../src/db.ts';
import type { Province } from '../src/military.ts';
import { World, type NationDef } from '../src/world.ts';

// a coastal province (1) on a warm sea (2), and an inland neighbour (3)
const provinces: Province[] = [
  { id: 1, kind: 'land', label: [0, 15], terrain: 'grassland', adj: [2, 3], owner: 1, pop: 1e7, name: 'Coast' },
  { id: 2, kind: 'sea', label: [2, 15], terrain: 'ocean', adj: [1], owner: undefined, pop: 0, name: 'Warm Sea' },
  { id: 3, kind: 'land', label: [-3, 15], terrain: 'grassland', adj: [1], owner: 1, pop: 1e7, name: 'Inland' },
] as Province[];
const seed = { pop: 4e7, coastal: 0.5, farm: 50, raw: { food: 2, oil: 1, gas: 1, coal: 1, metals: 1, rare_earths: 0.2 } };
const defs: NationDef[] = [{ id: 1, name: 'Republic of A', short: 'A', capital: 3, neighbours: [], provinces: 2, pop: 2e7, area: 1e5, seed }];

test('a hurricane making landfall damages buildings, which work again only once repaired', () => {
  const w = new World(openDb(':memory:'), 1, defs, { speed: 8640, startGame: Date.UTC(2026, 0, 1), aiBudgetPerTick: 0, autopilotAfterMs: 1e12, releaseAfterMs: 1e12 }, provinces);
  w.claim({ id: 1, name: 'alice', guest: false }, 1);
  w.military.buildings.set(1, [{ type: 'factory', progress: 1 }, { type: 'port', progress: 1 }, { type: 'fort', progress: 1 }]);
  // a category 5 storm sitting on the coast, until something is damaged (8% x 5 = 40% per building)
  const world = w as unknown as { storms: World['storms']; hurricaneDay(h: World['storms'][number], day: number): void };
  let damaged = 0;
  for (let i = 0; i < 30 && !damaged; i++) {
    const h = { lon: 0, lat: 15, r: 400, vlon: 0, vlat: 0, until: 99, kind: 'hurricane' as const, cat: 5, name: 'Test', hit: [] };
    world.hurricaneDay(h, 1);
    damaged = (w.military.buildings.get(1) ?? []).filter((b) => b.damaged).length;
  }
  assert.ok(damaged > 0, 'landfall damaged something');
  const b = w.military.buildings.get(1)!.find((x) => x.damaged)!;
  assert.equal(w.military.built(1, b.type), false, 'a damaged building is out of action');
  const n = w.nations.get(1)!;
  n.econ.treasury = 100;
  assert.equal(w.submit(1, { kind: 'repair', province: 1, building: b.type }, 'human').ok, true);
  assert.ok(n.econ.treasury < 100, 'repairs cost money');
  const days = Math.ceil(BUILDINGS[b.type].days * REPAIR_TIME_SHARE) + 2;
  for (let d = 1; d <= days; d++) w.tick(Date.now() + (DAY / 8640) * d);
  assert.equal(b.damaged, undefined, 'repaired');
  assert.equal(w.military.built(1, b.type), true, 'and working again');
});

test('hurricanes are born only over warm tropical sea', () => {
  const w = new World(openDb(':memory:'), 1, defs, { speed: 8640, startGame: Date.UTC(2026, 7, 1), aiBudgetPerTick: 0, autopilotAfterMs: 1e12, releaseAfterMs: 1e12 }, provinces);
  for (let d = 1; d <= 400; d++) w.tick(Date.now() + (DAY / 8640) * d);
  const world = w as unknown as { hurricaneCount: number };
  assert.ok(world.hurricaneCount >= 1, 'a warm sea in season breeds hurricanes');
  const cold = new World(openDb(':memory:'), 1, defs, { speed: 8640, startGame: Date.UTC(2026, 7, 1), aiBudgetPerTick: 0, autopilotAfterMs: 1e12, releaseAfterMs: 1e12 },
    provinces.map((p) => ({ ...p, label: [p.label[0], 55] as [number, number] })));
  for (let d = 1; d <= 400; d++) cold.tick(Date.now() + (DAY / 8640) * d);
  assert.equal((cold as unknown as { hurricaneCount: number }).hurricaneCount, 0, 'never over cold water');
});
