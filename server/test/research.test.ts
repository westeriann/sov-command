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

test('seasons: scores build up daily; the season ends into the hall of fame', () => {
  const w = setup();
  w.tick(Date.now() + realPerDay * 10);
  const info = w.seasonInfo();
  assert.equal(info.number, 1);
  assert.equal(info.leaders.length, 2);
  assert.ok(info.leaders[0].score > 0 && info.leaders[0].power > 0);
  w.endSeason('test');
  const next = w.seasonInfo();
  assert.equal(next.number, 2, 'a new season starts');
  assert.equal(next.leaders.length, 0, 'scores reset');
  assert.equal(next.hallOfFame[0].season, 1, 'the winner is remembered');
});

test('private chat: direct lines reach only the two nations; allied lines only allies', () => {
  const w = setup();
  w.claim({ id: 2, name: 'bob', guest: false }, 2);
  w.claim({ id: 3, name: 'eve', guest: false }, 3 as never); // no nation 3 in this world: eve watches
  assert.equal(w.chat({ id: 1, name: 'alice', guest: false }, 'hi bob', 'direct', 2).ok, true);
  const line = w.recent(1).chat.at(-1)!;
  assert.equal(line.channel, 'direct');
  assert.equal(w.canRead(line, 2), true);
  assert.equal(w.canRead(line, 3), false, 'others cannot read it');
  assert.equal(w.chat({ id: 1, name: 'alice', guest: false }, 'friends?', 'allies').ok, false, 'no allies yet');
});

test('players rename and recolour their nation, design a flag; names are unique and change once a day', () => {
  const w = setup();
  const flag = { pattern: 'tricolor_v' as const, colors: ['#112233', '#ffffff', '#cc0000'] as [string, string, string], emblem: 'star' as const };
  assert.equal(w.submit(1, { kind: 'customize', name: 'Nation 2', short: 'N9' }, 'human').ok, false, 'name taken');
  assert.equal(w.submit(1, { kind: 'customize', name: 'Free Republic', short: 'Free', color: '#3366aa', flag }, 'human').ok, true);
  const pub = w.publicView(w.nations.get(1)!);
  assert.equal(pub.name, 'Free Republic');
  assert.equal(pub.flag?.pattern, 'tricolor_v');
  assert.equal(w.defs.get(1)!.name, 'Free Republic', 'news uses the new name');
  assert.equal(w.submit(1, { kind: 'customize', name: 'Another Name' }, 'human').ok, false, 'once a day');
  assert.equal(w.submit(1, { kind: 'customize', flag: { ...flag, pattern: 'nope' } as never }, 'human').ok, false, 'bad flags are refused');
  assert.equal(w.submit(2, { kind: 'customize', name: 'Robot Land' }, 'ai').ok, false, 'the AI keeps the map names');
  w.release(1);
  assert.equal(w.defs.get(1)!.name, 'Nation 1', 'a released nation gets its own name back');
});

test('season missions: three goals per player; completing one pays points and cash; achievements unlock emblems', () => {
  const w = setup();
  const awarded: string[] = [];
  w.achievements = { list: () => awarded, award: (_u, k) => (awarded.includes(k) ? false : (awarded.push(k), true)) };
  w.tick(Date.now() + realPerDay * 2);
  const n = w.nations.get(1)!;
  assert.equal(n.missions?.length, 3);
  const goal = n.missions![0];
  goal.target = 0; // make it already met
  const score = w.season.scores[1] ?? 0, cash = n.econ.treasury;
  w.tick(Date.now() + realPerDay * 4);
  assert.equal(goal.done, true);
  assert.ok((w.season.scores[1] ?? 0) > score + 1, 'points');
  assert.ok(n.econ.treasury > cash, 'cash');
  const eagle = { pattern: 'solid' as const, colors: ['#000000', '#ffffff', '#ffd700'] as [string, string, string], emblem: 'eagle' as const };
  assert.equal(w.submit(1, { kind: 'customize', flag: eagle }, 'human').ok, false, 'the eagle is earned by winning a season');
  awarded.push('champion');
  assert.equal(w.submit(1, { kind: 'customize', flag: eagle }, 'human').ok, true);
});

test('a research queue starts the next technology when one finishes, once its prerequisite is known', async () => {
  const { World } = await import('../src/world.ts');
  const { openDb } = await import('../src/db.ts');
  const { DAY } = await import('../../shared/clock.ts');
  const provinces = [1, 2].map((id) => ({ id, kind: 'land' as const, label: [id, 0] as [number, number], terrain: 'grassland', adj: [3 - id], owner: id, pop: 1e7, name: `P${id}` }));
  const seed = { pop: 4e7, coastal: 0.5, farm: 50, raw: { food: 2, oil: 1, gas: 1, coal: 1, metals: 1, rare_earths: 0.2 } };
  const w = new World(openDb(':memory:'), 1, [
    { id: 1, name: 'A', short: 'A', capital: 1, neighbours: [2], provinces: 1, pop: 4e7, area: 1e5, seed },
    { id: 2, name: 'B', short: 'B', capital: 2, neighbours: [1], provinces: 1, pop: 4e7, area: 1e5, seed },
  ], { speed: 8640, startGame: Date.UTC(2026, 0, 1), aiBudgetPerTick: 0, autopilotAfterMs: 1e12, releaseAfterMs: 1e12 }, provinces);
  w.claim({ id: 1, name: 'alice', guest: false }, 1);
  assert.equal(w.submit(1, { kind: 'research_queue', tech: 'automation' }, 'human').ok, true, 'empty: starts at once');
  assert.equal(w.submit(1, { kind: 'research_queue', tech: 'logistics_ai' }, 'human').ok, true, 'its follow-up can be lined up');
  assert.equal(w.submit(1, { kind: 'research_queue', tech: 'fusion_grid' }, 'human').ok, true);
  assert.equal(w.submit(1, { kind: 'research_queue', tech: 'stealth' }, 'human').ok, false, 'not without its prerequisite');
  const n = w.nations.get(1)!;
  assert.equal(n.tech.current, 'automation');
  assert.deepEqual(n.tech.queue, ['logistics_ai', 'fusion_grid']);
  w.submit(1, { kind: 'research_queue', tech: 'logistics_ai', remove: true }, 'human');
  assert.deepEqual(n.tech.queue, [], 'removing one drops what depended on it');
  w.submit(1, { kind: 'research_queue', tech: 'logistics_ai' }, 'human');
  for (let d = 1; d <= 400 && !n.tech.done.includes('automation'); d++) w.tick(Date.now() + (DAY / 8640) * d);
  assert.ok(n.tech.done.includes('automation'));
  assert.equal(n.tech.current, 'logistics_ai', 'the queue moved on by itself');
});
