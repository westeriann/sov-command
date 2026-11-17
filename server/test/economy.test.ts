import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMODITIES, type Commodity } from '../../shared/economy.ts';
import { DAY, HOUR } from '../../shared/clock.ts';
import { openDb } from '../src/db.ts';
import { initEconomies, initMarket, runDay, usePerYear, WORLD_GDP_START, type EconSeed } from '../src/economy.ts';
import { World, type NationDef } from '../src/world.ts';

function rng(seed: number) {
  let a = seed;
  return () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function seeds(count = 40) {
  const r = rng(7);
  const m = new Map<number, EconSeed>();
  for (let i = 1; i <= count; i++) {
    const raw = Object.fromEntries(COMMODITIES.map((c) => [c, r() < 0.4 ? r() * 5 : 0])) as Record<Commodity, number>;
    raw.food += 0.5;
    m.set(i, { pop: 2e8 * r() + 1e6, raw, coastal: r(), farm: r() * 100 });
  }
  return m;
}

test('day one matches real-world totals', () => {
  const econ = initEconomies(seeds(), rng(1));
  const gdp = [...econ.values()].reduce((a, e) => a + e.gdp, 0);
  assert.ok(Math.abs(gdp - WORLD_GDP_START) / WORLD_GDP_START < 0.05, `world GDP ${gdp}`);
  for (const c of COMMODITIES) {
    const prod = [...econ.values()].reduce((a, e) => a + e.capacity[c], 0);
    const use = [...econ.values()].reduce((a, e) => a + usePerYear(c, e.gdp, e.pop), 0);
    assert.ok(prod >= use, `${c}: world produces at least what it uses`);
  }
});

test('a simulated year stays sane, and trade balances', () => {
  const econ = initEconomies(seeds(), rng(2));
  const market = initMarket();
  const inputs = [...econ.values()].map((e) => ({ econ: e, tax: 25, focus: 'economy' as const }));
  const gdp0 = inputs.reduce((a, n) => a + n.econ.gdp, 0);
  for (let d = 1; d <= 365; d++) {
    runDay(inputs, market, d);
    for (const c of COMMODITIES) {
      const exports = inputs.reduce((a, n) => a + Math.max(0, n.econ.trade[c]), 0);
      const imports = inputs.reduce((a, n) => a + Math.max(0, -n.econ.trade[c]), 0);
      assert.ok(Math.abs(exports - imports) < 1e-6 * Math.max(1, exports), `${c} day ${d}: exports ${exports} = imports ${imports}`);
    }
  }
  const gdp1 = inputs.reduce((a, n) => a + n.econ.gdp, 0);
  const growth = gdp1 / gdp0 - 1;
  assert.ok(growth > 0.005 && growth < 0.06, `world growth ${(growth * 100).toFixed(2)}%`);
  for (const n of inputs) {
    const e = n.econ;
    for (const v of [e.gdp, e.pop, e.treasury, e.stability, e.infra, ...Object.values(e.stock)]) assert.ok(Number.isFinite(v));
    assert.ok(e.stability >= 0 && e.stability <= 100);
    assert.equal(e.history.length, 52, 'one chart point per game week');
  }
  for (const c of COMMODITIES) assert.ok(market.prices[c] > 0);
});

test('policy matters: high taxes cost stability and growth, welfare buys stability', () => {
  const s = new Map([[1, seeds(1).get(1)!], [2, seeds(1).get(1)!]]);
  const econ = initEconomies(s, rng(3));
  const [a, b] = [econ.get(1)!, econ.get(2)!];
  Object.assign(b, structuredClone(a));
  b.budget = { military: 10, infrastructure: 25, welfare: 55, research: 10 };
  const market = initMarket();
  const inputs = [{ econ: a, tax: 42, focus: 'economy' as const }, { econ: b, tax: 18, focus: 'economy' as const }];
  for (let d = 1; d <= 200; d++) runDay(inputs, market, d);
  assert.ok(b.stability > a.stability + 10, `stability ${b.stability} vs ${a.stability}`);
  assert.ok(b.growth > a.growth, 'lower tax grows faster');
});

const defs: NationDef[] = [...seeds(6)].map(([id, seed]) => ({
  id, name: `Nation ${id}`, short: `N${id}`, capital: id, neighbours: [((id % 6) + 1)], provinces: 10,
  pop: seed.pop, area: 1e5, seed,
}));
const opts = { speed: 24, startGame: Date.UTC(2026, 0, 1), aiBudgetPerTick: 100, autopilotAfterMs: DAY, releaseAfterMs: 14 * DAY };

test('the world runs economy days as game time passes and catches up after downtime', () => {
  const w = new World(openDb(':memory:'), 1, defs, opts);
  const day0 = w.market.day;
  w.tick(Date.now() + 3 * HOUR + 1000); // 3 real hours at 24x = 3 game days
  assert.equal(w.market.day, day0 + 3);
  w.tick(Date.now() + 200 * HOUR);       // long downtime: capped catch-up
  assert.ok(w.market.day <= w.dayIndex(Date.now() + 200 * HOUR));
  assert.ok(w.market.day > day0 + 3, 'caught up some of the missed days');
});

test('budget orders are normalised for players; AI rebalances when unrest grows', () => {
  const w = new World(openDb(':memory:'), 1, defs, opts);
  w.claim({ id: 9, name: 'p', guest: false }, 1);
  assert.equal(w.submit(1, { kind: 'budget', budget: { military: 200, welfare: 10 } }, 'human').ok, true);
  const b = w.nations.get(1)!.econ.budget;
  assert.equal(b.military + b.infrastructure + b.welfare + b.research, 100);
  assert.ok(b.military <= 70, 'no share above 70%');

  const ai = w.nations.get(2)!;
  ai.econ.stability = 20;
  const before = ai.econ.budget.welfare;
  w.tick(Date.now() + (8 * DAY) / 24 + 1000); // AI reviews weekly
  assert.ok(ai.econ.budget.welfare > before, `AI raised welfare (${before} -> ${ai.econ.budget.welfare})`);
});

test('private economy stays private', () => {
  const w = new World(openDb(':memory:'), 1, defs, opts);
  const n = w.nations.get(3)!;
  const pub = w.publicView(n) as unknown as Record<string, unknown>;
  assert.equal(pub.econ, undefined);
  assert.ok(w.privateView(n).econ?.treasury !== undefined);
  const update = w.economyUpdate();
  assert.equal(update.nations.length, 6);
  assert.equal((update.nations[0] as unknown as Record<string, unknown>).treasury, undefined, 'public figures exclude the treasury');
});
