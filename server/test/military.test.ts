import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DAY } from '../../shared/clock.ts';
import { findRoute, legDays, UNIT_SPECS } from '../../shared/military.ts';
import { openDb } from '../src/db.ts';
import type { Province } from '../src/military.ts';
import { World, type NationDef } from '../src/world.ts';

// A strip of 8 provinces, 1° (~111 km) apart: nation 1 owns 1-4, nation 2 owns 5-8. Province 3 is mountains.
const provinces: Province[] = Array.from({ length: 8 }, (_, i) => ({
  id: i + 1, kind: 'land' as const, label: [i, 0] as [number, number], terrain: i === 2 ? 'mountain_wet' : 'grassland',
  adj: [i, i + 2].filter((x) => x >= 1 && x <= 8), owner: i < 4 ? 1 : 2, pop: 1e7, name: `P${i + 1}`,
}));
const seed = { pop: 4e7, coastal: 0.5, farm: 50, raw: { food: 2, oil: 1, gas: 1, coal: 1, metals: 1, rare_earths: 0.2 } };
const defs: NationDef[] = [
  { id: 1, name: 'Republic of A', short: 'A', capital: 1, neighbours: [2], provinces: 4, pop: 4e7, area: 1e5, seed },
  { id: 2, name: 'Kingdom of B', short: 'B', capital: 8, neighbours: [1], provinces: 4, pop: 4e7, area: 1e5, seed },
];
const SPEED = 8640; // a game day every 10 real seconds
const opts = { speed: SPEED, startGame: Date.UTC(2026, 0, 1), aiBudgetPerTick: 0, autopilotAfterMs: 1e12, releaseAfterMs: 1e12 };
const realPerDay = DAY / SPEED;

function setup() {
  const w = new World(openDb(':memory:'), 1, defs, opts, provinces);
  w.military.units.clear();
  w.claim({ id: 1, name: 'alice', guest: false }, 1);
  w.claim({ id: 2, name: 'bob', guest: false }, 2);
  return w;
}

test('routes take game days from distance, unit speed and terrain', () => {
  const map = new Map(provinces.map((p) => [p.id, p]));
  const flat = legDays(map.get(1)!, map.get(2)!, 'infantry');
  const hills = legDays(map.get(2)!, map.get(3)!, 'infantry');
  assert.ok(Math.abs(flat - 111 / UNIT_SPECS.infantry.speed) < 0.1, `~3.7 days on open ground, got ${flat}`);
  assert.ok(hills > flat * 2, 'mountains are much slower');
  assert.ok(legDays(map.get(1)!, map.get(2)!, 'armored') < flat, 'armor is faster');
  const r = findRoute(map, 1, 4, 'infantry', () => true)!;
  assert.deepEqual(r.path, [2, 3, 4]);
});

test('units cannot cross a border without war; with war they move, arrive on time, and occupy', () => {
  const w = setup();
  const u = w.military.spawn(1, 'armored', 4);
  assert.equal(w.submit(1, { kind: 'move', units: [u.id], to: 5 }, 'human').ok, false, 'peace: border closed');
  assert.equal(w.submit(1, { kind: 'war', target: 2 }, 'human').ok, true);
  assert.equal(w.submit(1, { kind: 'move', units: [u.id], to: 5 }, 'human').ok, true);
  const leg = (u.legEnd! - u.legStart!) / DAY;
  assert.ok(leg > 1.5 && leg < 3, `armor crosses one province in ~2 game days (${leg.toFixed(2)})`);
  w.tick(Date.now() + realPerDay * 1);
  assert.equal(u.province, 4, 'still on the way after one day');
  w.tick(Date.now() + realPerDay * 3);
  assert.equal(u.province, 5, 'arrived');
  assert.equal(w.military.controller(5), 1, 'empty enemy province is occupied');
  assert.ok(w.controlOf(2) < 1, 'the owner lost control of part of its population');
});

test('battles: the stronger side wins and takes the province; the weaker side retreats or is destroyed', () => {
  const w = setup();
  w.submit(1, { kind: 'war', target: 2 }, 'human');
  const attackers = [w.military.spawn(1, 'armored', 4), w.military.spawn(1, 'armored', 4), w.military.spawn(1, 'mechanized', 4)];
  const defender = w.military.spawn(2, 'infantry', 5, 60);
  w.submit(1, { kind: 'move', units: attackers.map((a) => a.id), to: 5 }, 'human');
  let t = Date.now();
  for (let d = 0; d < 20; d++) { t += realPerDay; w.tick(t); }
  assert.ok(!w.military.units.has(defender.id) || w.military.units.get(defender.id)!.province !== 5, 'defender gone from the province');
  assert.equal(w.military.controller(5), 1, 'attacker controls the province');
  assert.ok(attackers.every((a) => w.military.units.has(a.id)), 'the stronger side survives');
});

test('peace needs both sides and returns occupied land', () => {
  const w = setup();
  w.submit(1, { kind: 'war', target: 2 }, 'human');
  w.military.occupied.set(5, 1);
  assert.equal(w.submit(1, { kind: 'peace', target: 2 }, 'human').ok, true);
  assert.ok(w.military.atWar(1, 2), 'one offer is not enough');
  w.submit(2, { kind: 'peace', target: 1 }, 'human');
  assert.equal(w.military.atWar(1, 2), false);
  assert.equal(w.military.controller(5), 2, 'occupied province returned');
});

test('fog of war: you see your neighbourhood, not distant armies', () => {
  const w = setup();
  w.military.spawn(2, 'infantry', 5);
  w.military.spawn(2, 'armored', 8);
  const seen = w.military.viewFor(1).filter((u) => u.nation === 2);
  assert.equal(seen.length, 1, 'only the unit next to our border is visible');
  assert.equal(seen[0].path, undefined, 'enemy routes are never shown');
});

test('production builds units over game days, paid from the defence budget', () => {
  const w = setup();
  const n = w.nations.get(1)!;
  n.mil.funds = 50;
  assert.equal(w.submit(1, { kind: 'recruit', unit: 'infantry' }, 'human').ok, true);
  let t = Date.now();
  for (let d = 0; d < UNIT_SPECS.infantry.days - 2; d++) { t += realPerDay; w.tick(t); }
  assert.equal(w.military.unitsOf(1).length, 0, 'not ready yet');
  for (let d = 0; d < 4; d++) { t += realPerDay; w.tick(t); }
  assert.equal(w.military.unitsOf(1).length, 1, 'ready after its build time');
  assert.equal(n.mil.queue.length, 0, 'queue emptied');
});
