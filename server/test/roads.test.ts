import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDb } from '../src/db.ts';
import type { Province } from '../src/military.ts';
import { World, type NationDef } from '../src/world.ts';
import { ROAD, roadCost, roadDays } from '../../shared/roads.ts';

// A strip of 6 provinces: nation 1 owns 1-3, nation 2 owns 4-6.
const provinces = (): Province[] => Array.from({ length: 6 }, (_, i) => ({
  id: i + 1, kind: 'land' as const, label: [i * 3, 0] as [number, number], terrain: 'grassland',
  adj: [i, i + 2].filter((x) => x >= 1 && x <= 6), owner: i < 3 ? 1 : 2, pop: 1e7, name: `P${i + 1}`,
}));
const seed = { pop: 3e7, coastal: 0, farm: 50, raw: { food: 2, oil: 1, gas: 1, coal: 1, metals: 1, rare_earths: 0.2, timber: 1 } };
const defs: NationDef[] = [
  { id: 1, name: 'Republic of A', short: 'A', capital: 1, neighbours: [2], provinces: 3, pop: 3e7, area: 1e5, seed },
  { id: 2, name: 'Kingdom of B', short: 'B', capital: 6, neighbours: [1], provinces: 3, pop: 3e7, area: 1e5, seed },
];
const SPEED = 8640;
const opts = { speed: SPEED, startGame: Date.UTC(2026, 6, 1), aiBudgetPerTick: 0, autopilotAfterMs: 1e12, releaseAfterMs: 1e12 };
const realPerDay = 86_400_000 / SPEED;
const pts = (ids: number[]) => ids.map((i) => [(i - 1) * 3, 0] as [number, number]);

function setup() {
  const w = new World(openDb(':memory:'), 1, defs, opts, provinces());
  w.military.units.clear();
  w.claim({ id: 1, name: 'alice', guest: false }, 1);
  for (const n of w.nations.values()) n.econ.treasury = 500;
  return w;
}

test('roads: only across your own neighbouring provinces, paid up front, built over days', () => {
  const w = setup();
  assert.equal(w.submit(1, { kind: 'road', path: [1, 2, 3, 4], pts: pts([1, 2, 3, 4]) }, 'human').ok, false, 'not into foreign land');
  assert.equal(w.submit(1, { kind: 'road', path: [1, 3], pts: pts([1, 3]) }, 'human').ok, false, 'stretches join neighbours');
  assert.equal(w.submit(1, { kind: 'road', path: [1], pts: pts([1]) }, 'human').ok, false, 'needs two provinces');
  const before = w.nations.get(1)!.econ.treasury;
  assert.equal(w.submit(1, { kind: 'road', path: [1, 2, 3], pts: pts([1, 2, 3]) }, 'human').ok, true);
  assert.ok(Math.abs(before - w.nations.get(1)!.econ.treasury - roadCost(2)) < 1e-9, 'paid for');
  assert.equal(w.submit(1, { kind: 'road', path: [1, 2, 3], pts: pts([1, 2, 3]) }, 'human').ok, true, 'a second, under way, is allowed');
  assert.equal(w.warState().roads?.length, 2, 'roads are public');
  assert.equal(w.military.hasRoad(1, 2), false, 'not open yet');
  w.tick(Date.now() + realPerDay * (roadDays(2) + 2));
  assert.equal(w.military.hasRoad(1, 2) && w.military.hasRoad(2, 3), true, 'open once built');
  assert.equal(w.submit(1, { kind: 'road', path: [1, 2], pts: pts([1, 2]) }, 'human').ok, false, 'no road on top of a road');
  assert.equal(ROAD.speed < 1, true);
});

test('troops move faster along a finished road', () => {
  const legTime = (road: boolean) => {
    const w = setup();
    if (road) { w.military.roads.push({ id: 1, owner: 1, path: [1, 2], pts: pts([1, 2]), progress: 1 }); w.military.indexRoads(); }
    const u = w.military.spawn(1, 'infantry', 1);
    const now = Date.now();
    w.military.move(1, [u.id], 2, now);
    return u.legEnd! - u.legStart!;
  };
  const off = legTime(false), on = legTime(true);
  assert.ok(on < off * 0.7, `road leg ${on} vs ${off}`);
});

test('roads always meet: they end at province anchors and pass through the anchor where they share a province', () => {
  const w = setup();
  // a freehand road that stops short of the province centres
  assert.equal(w.submit(1, { kind: 'road', path: [1, 2], pts: [[0.6, 0.4], [2.4, -0.3]] }, 'human').ok, true);
  const a = w.military.roads[0];
  assert.deepEqual(a.pts[0], [0, 0], 'starts at its first province');
  assert.deepEqual(a.pts[a.pts.length - 1], [3, 0], 'ends at its last province');
  // a second road from province 2 onward meets the first at province 2's anchor
  assert.equal(w.submit(1, { kind: 'road', path: [2, 3], pts: [[3.5, 0.5], [5.5, 0.2]] }, 'human').ok, true);
  const b = w.military.roads[1];
  assert.deepEqual(b.pts[0], [3, 0], 'the new road starts where the old one ends');
  assert.ok(a.pts.some((q) => q[0] === 3 && q[1] === 0) && b.pts.some((q) => q[0] === 3 && q[1] === 0), 'both pass through the junction');
});
