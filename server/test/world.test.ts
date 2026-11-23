import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DAY, HOUR } from '../../shared/clock.ts';
import { openDb } from '../src/db.ts';
import { World, type NationDef } from '../src/world.ts';

const defs: NationDef[] = [1, 2, 3, 4].map((id) => ({
  id, name: `Republic of N${id}`, short: `N${id}`, capital: id * 10,
  neighbours: [1, 2, 3, 4].filter((x) => x !== id), provinces: 5, pop: 1e6, area: 1e5,
  seed: { pop: 1e6, coastal: 0.5, farm: 40, raw: { food: 2, oil: id === 1 ? 5 : 0.1, gas: 1, coal: 1, metals: 1, rare_earths: id === 2 ? 1 : 0, timber: 1 } },
}));
const alice = { id: 1, name: 'alice', guest: false };
const bob = { id: 2, name: 'bob', guest: false };

function makeWorld(opts: Partial<ConstructorParameters<typeof World>[3]> = {}) {
  return new World(openDb(':memory:'), 300, defs, {
    speed: 24, startGame: Date.UTC(2026, 0, 1), aiBudgetPerTick: 100,
    autopilotAfterMs: HOUR, releaseAfterMs: 10 * HOUR, ...opts,
  });
}

test('every nation starts under AI control with a personality and policy', () => {
  const w = makeWorld();
  assert.equal(w.nations.size, 4);
  for (const n of w.nations.values()) {
    assert.equal(n.controller, 'ai');
    assert.ok(n.personality);
    assert.ok(n.policy.tax >= 10 && n.policy.tax <= 45);
  }
});

test('claiming: one nation per player, one player per nation', () => {
  const w = makeWorld();
  assert.deepEqual(w.claim(alice, 1), { ok: true });
  assert.equal(w.claim(alice, 2).ok, false, 'a player cannot hold two nations');
  const taken = w.claim(bob, 1);
  assert.equal(taken.ok, false);
  assert.equal(!taken.ok && taken.code, 'taken');
  assert.equal(w.nationOf(alice.id)?.id, 1);
  assert.deepEqual(w.release(alice.id), { ok: true });
  assert.equal(w.nations.get(1)!.controller, 'ai');
  assert.equal(w.claim(bob, 1).ok, true, 'released nations can be claimed again');
});

test('orders are validated the same way for players and AI', () => {
  const w = makeWorld();
  w.claim(alice, 1);
  assert.equal(w.submit(1, { kind: 'policy', policy: { focus: 'research', tax: 99 } }, 'human').ok, true);
  assert.equal(w.nations.get(1)!.policy.tax, 45, 'tax is clamped');
  assert.equal(w.submit(1, { kind: 'policy', policy: { focus: 'piracy' as never } }, 'human').ok, false);
  assert.equal(w.submit(1, { kind: 'policy', policy: { tax: 20 } }, 'ai').ok, false, 'AI cannot override a present player');
  assert.equal(w.submit(2, { kind: 'policy', policy: { tax: 20 } }, 'ai').ok, true);
});

test('AI nations make decisions over time, within the per-tick budget', () => {
  const w = makeWorld({ aiBudgetPerTick: 2 });
  const start = Date.now();
  const before = [...w.nations.values()].map((n) => n.nextThink);
  w.tick(start + (8 * DAY) / 24);              // eight game days later: every AI is due its weekly review
  const moved = [...w.nations.values()].filter((n, i) => n.nextThink !== before[i]).length;
  assert.equal(moved, 2, 'only the budgeted number of AI nations think in one tick');
  w.tick(start + (8 * DAY) / 24 + 1000);
  const moved2 = [...w.nations.values()].filter((n, i) => n.nextThink !== before[i]).length;
  assert.equal(moved2, 4, 'the rest think on the following tick');
});

test('AI only reads public information about other nations', () => {
  const w = makeWorld();
  w.claim(alice, 2);
  const seen: string[] = [];
  const original = w.publicView.bind(w);
  w.publicView = (n) => { seen.push(`public:${n.id}`); return original(n); };
  w.tick(Date.now() + DAY);
  assert.ok(seen.length > 0, 'AI looked at neighbours through public views');
});

test('absent players get an AI caretaker, then lose the nation; returning ends autopilot', () => {
  const w = makeWorld();
  w.claim(alice, 1);
  w.setPresence(alice.id, true);
  w.setPresence(alice.id, false);
  const t0 = Date.now();
  w.tick(t0 + 2 * HOUR);
  assert.equal(w.nations.get(1)!.autopilot, true, 'autopilot after an hour away');
  w.setPresence(alice.id, true);
  assert.equal(w.nations.get(1)!.autopilot, false, 'returning player takes back control');
  w.setPresence(alice.id, false);
  w.tick(t0 + 11 * HOUR);
  assert.equal(w.nations.get(1)!.controller, 'ai', 'nation returns to the AI after the release limit');
  assert.equal(w.nationOf(alice.id), null);
});

test('state survives a restart', () => {
  const db = openDb(':memory:');
  const opts = { speed: 24, startGame: Date.UTC(2026, 0, 1), aiBudgetPerTick: 10, autopilotAfterMs: HOUR, releaseAfterMs: DAY };
  const w1 = new World(db, 300, defs, opts);
  w1.claim(alice, 3);
  w1.submit(3, { kind: 'policy', policy: { focus: 'diplomacy', tax: 33 } }, 'human');
  w1.persist();
  const w2 = new World(db, 300, defs, opts);
  assert.equal(w2.nationOf(alice.id)?.id, 3);
  assert.deepEqual(w2.nations.get(3)!.policy, { focus: 'diplomacy', tax: 33 });
  assert.deepEqual(w2.clock, w1.clock, 'the world clock is not reset');
  assert.throws(() => new World(db, 999, defs, opts), /seed/);
});
