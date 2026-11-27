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

test('producers: a farm needs farmland, takes goods from stock (buying what is short), and grows food once built', () => {
  const w = setup();
  const n = w.nations.get(1)!;
  const p1 = w.military.provinces.get(1)!, p2 = w.military.provinces.get(2)!;
  p1.res = { farmland: 70 }; p2.res = { timber: 40 };
  assert.equal(w.submit(1, { kind: 'build', province: 2, building: 'farm' }, 'human').ok, false, 'no farmland, no farm');
  n.econ.stock.timber = 1000; n.econ.stock.metals = 0;
  const cash = n.econ.treasury, timber = n.econ.stock.timber;
  assert.equal(w.submit(1, { kind: 'build', province: 1, building: 'farm' }, 'human').ok, true);
  assert.ok(n.econ.stock.timber < timber, 'timber taken from stock');
  assert.ok(cash - n.econ.treasury > 2, 'the money, and the metals it lacked bought abroad');
  const b = w.military.buildings.get(1)!.find((x) => x.type === 'farm')!;
  b.progress = 1;
  w.tick(Date.now() + realPerDay * 2);
  assert.ok((n.econ.built?.food ?? 0) > 0, 'the farm grows food for the nation');
});

test('trade routes: by sea where they can, by caravan over foreign land for a fee, through a canal for free', async () => {
  const { tradeRoute, CARAVAN_FEE } = await import('../../shared/trade-route.ts');
  // sea 10 | land 1 (nation A) - land 2 (nation C) - land 3 (nation C) - land 4 (nation B) | sea 11
  const P = new Map<number, { id: number; kind: 'land' | 'sea'; adj: number[]; owner?: number; label: [number, number] }>([
    [10, { id: 10, kind: 'sea', adj: [1], label: [0, 0] }],
    [1, { id: 1, kind: 'land', adj: [10, 2], owner: 1, label: [1, 0] }],
    [2, { id: 2, kind: 'land', adj: [1, 3], owner: 3, label: [2, 0] }],
    [3, { id: 3, kind: 'land', adj: [2, 4], owner: 3, label: [3, 0] }],
    [4, { id: 4, kind: 'land', adj: [3, 11], owner: 2, label: [4, 0] }],
    [11, { id: 11, kind: 'sea', adj: [4], label: [5, 0] }],
  ]);
  const canals = new Set<number>();
  const world = { get: (id: number) => P.get(id), start: (n: number) => (n === 1 ? 10 : 11), canal: (id: number) => canals.has(id), closed: () => false };
  const r = tradeRoute(world, 1, 2)!;
  assert.deepEqual(r.caravan, [2, 3], 'the land between goes by caravan');
  assert.ok(Math.abs(r.fee - 2 * CARAVAN_FEE) < 1e-9);
  canals.add(2); canals.add(3);
  const c = tradeRoute(world, 1, 2)!;
  assert.equal(c.fee, 0, 'canals let ships through');
  assert.deepEqual(c.canals, [2, 3]);
  assert.equal(tradeRoute({ ...world, canal: () => false, closed: (o: number) => o === 3 }, 1, 2), null, 'land of a nation at war is closed');
});
