import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DAY } from '../../shared/clock.ts';
import { legDays } from '../../shared/military.ts';
import { openDb } from '../src/db.ts';
import type { Province } from '../src/military.ts';
import { World, type NationDef } from '../src/world.ts';

// Land strip 1-8 (nation 1 owns 1-4, nation 2 owns 5-8) with two sea zones: 9 off province 2, 10 off province 7.
const land: Province[] = Array.from({ length: 8 }, (_, i) => ({
  id: i + 1, kind: 'land' as const, label: [i, 0] as [number, number], terrain: 'grassland',
  adj: [i, i + 2].filter((x) => x >= 1 && x <= 8), owner: i < 4 ? 1 : 2, pop: 1e7, name: `P${i + 1}`,
}));
land[1].adj.push(9);
land[6].adj.push(10);
const sea: Province[] = [
  { id: 9, kind: 'sea', label: [1, -1.5], terrain: 'ocean', adj: [2, 10], pop: 0 },
  { id: 10, kind: 'sea', label: [6, -1.5], terrain: 'ocean', adj: [9, 7], pop: 0 },
];
const provinces = [...land, ...sea];
const seed = { pop: 4e7, coastal: 0.5, farm: 50, raw: { food: 2, oil: 1, gas: 1, coal: 1, metals: 1, rare_earths: 0.2 } };
const defs: NationDef[] = [
  { id: 1, name: 'Republic of A', short: 'A', capital: 1, neighbours: [2], provinces: 4, pop: 4e7, area: 1e5, seed },
  { id: 2, name: 'Kingdom of B', short: 'B', capital: 8, neighbours: [1], provinces: 4, pop: 4e7, area: 1e5, seed },
];
const SPEED = 8640;
const realPerDay = DAY / SPEED;

function setup() {
  const w = new World(openDb(':memory:'), 1, defs, { speed: SPEED, startGame: Date.UTC(2026, 0, 1), aiBudgetPerTick: 0, autopilotAfterMs: 1e12, releaseAfterMs: 1e12 }, provinces);
  w.military.units.clear();
  w.claim({ id: 1, name: 'alice', guest: false }, 1);
  w.claim({ id: 2, name: 'bob', guest: false }, 2);
  return w;
}
function days(w: World, n: number) {
  let t = Date.now();
  for (let d = 0; d < n; d++) { t += realPerDay; w.tick(t); }
}

test('fleets sail only at sea; ships appear off the coast', () => {
  const w = setup();
  assert.equal(w.homeFor(1, 'destroyers'), 9, 'new ships appear in the sea zone off our coast');
  const d = w.military.spawn(1, 'destroyers', 9);
  assert.equal(w.submit(1, { kind: 'move', units: [d.id], to: 3 }, 'human').ok, false, 'ships cannot sail onto land');
  assert.equal(w.submit(1, { kind: 'move', units: [d.id], to: 10 }, 'human').ok, true);
  days(w, 2);
  assert.equal(d.province, 10);
});

test('troops cross the sea by transport, slowly, and suffer if enemy warships catch them', () => {
  const map = new Map(provinces.map((p) => [p.id, p]));
  assert.ok(legDays(map.get(2)!, map.get(9)!, 'infantry') >= 1, 'embarking costs a day');
  const w = setup();
  w.submit(1, { kind: 'war', target: 2 }, 'human');
  const troops = w.military.spawn(1, 'infantry', 9);
  w.military.spawn(2, 'destroyers', 9);
  w.military.spawn(2, 'destroyers', 9);
  days(w, 3);
  assert.ok(!w.military.units.has(troops.id) || troops.strength < 30, 'transports were mauled');
});

test('sea battles: destroyers hunt submarines', () => {
  const w = setup();
  w.submit(1, { kind: 'war', target: 2 }, 'human');
  const subs = [w.military.spawn(2, 'submarines', 10), w.military.spawn(2, 'submarines', 10)];
  const dd = [w.military.spawn(1, 'destroyers', 9), w.military.spawn(1, 'destroyers', 9), w.military.spawn(1, 'destroyers', 9)];
  w.submit(1, { kind: 'move', units: dd.map((u) => u.id), to: 10 }, 'human');
  days(w, 12);
  assert.ok(subs.every((s) => !w.military.units.has(s.id) || s.province !== 10), 'submarines sunk or driven off');
  assert.ok(dd.some((s) => w.military.units.has(s.id)), 'destroyers survive');
});

test('air missions need the target within combat radius; strike support wins battles', () => {
  const w = setup();
  w.submit(1, { kind: 'war', target: 2 }, 'human');
  const near = w.military.spawn(1, 'strike', 4);
  const far = w.military.spawn(1, 'fighters', 1);
  far.province = 1;
  w.military.provinces.get(1)!.label = [-20, 0]; // move province 1 far away for this check
  assert.equal(w.submit(1, { kind: 'mission', units: [far.id], mission: { kind: 'patrol', target: 5 } }, 'human').ok, false, 'out of range');
  w.military.provinces.get(1)!.label = [0, 0];
  for (let i = 0; i < 5; i++) w.military.spawn(1, 'strike', 4);
  const wings = w.military.unitsOf(1).filter((u) => u.type === 'strike').map((u) => u.id);
  assert.equal(w.submit(1, { kind: 'mission', units: wings, mission: { kind: 'support', target: 5 } }, 'human').ok, true);
  // even ground forces; the air support should decide it
  const att = [w.military.spawn(1, 'infantry', 4), w.military.spawn(1, 'infantry', 4)];
  const def = [w.military.spawn(2, 'infantry', 5), w.military.spawn(2, 'infantry', 5)];
  w.submit(1, { kind: 'move', units: att.map((u) => u.id), to: 5 }, 'human');
  days(w, 25);
  assert.equal(w.military.controller(5), 1, 'with air support the attackers take the province');
  assert.ok(def.every((u) => !w.military.units.has(u.id) || u.province !== 5));
  void near;
});

test('blockades: enemy warships off an undefended coast cut trade; our own ships lift it', () => {
  const w = setup();
  w.submit(1, { kind: 'war', target: 2 }, 'human');
  w.military.spawn(2, 'destroyers', 9);
  assert.ok(w.military.blockade(1) > 0, 'coast blockaded');
  w.military.spawn(1, 'destroyers', 9);
  assert.equal(w.military.blockade(1), 0, 'contested waters are not a blockade');
});

test('submarines stay hidden unless our ships share their zone', () => {
  const w = setup();
  w.military.spawn(2, 'submarines', 9);
  assert.equal(w.military.viewFor(1).filter((u) => u.type === 'submarines').length, 0);
  w.military.spawn(1, 'destroyers', 9);
  assert.equal(w.military.viewFor(1).filter((u) => u.type === 'submarines').length, 1);
});
