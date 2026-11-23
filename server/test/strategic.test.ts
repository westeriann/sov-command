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
const seed = { pop: 4e7, coastal: 0.5, farm: 50, raw: { food: 2, oil: 1, gas: 1, coal: 1, metals: 1, rare_earths: 0.2, timber: 1 } };
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
  // warheads need uranium: give nation 1 a uranium province
  const owned = [...w.military.provinces.values()].find((p) => p.owner === 1)!;
  w.specialty.set(owned.id, 'uranium');
  (w as unknown as { specialtyCache: Map<number, unknown> }).specialtyCache.clear();
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

test('the wider world: border policy; global events hit nations by their circumstances', () => {
  const w = setup();
  w.submit(1, { kind: 'war', target: 2 }, 'human');
  // the border policy is a player's choice
  assert.equal(w.submit(2, { kind: 'borders', open: false }, 'human').ok, true);
  assert.equal(w.nations.get(2)!.policy.openBorders, false);
  // global events: a crash hurts the indebted more
  const a = w.nations.get(1)!, b = w.nations.get(2)!;
  a.econ.treasury = -a.econ.gdp; b.econ.treasury = b.econ.gdp * 0.1;
  w.globe.event = { kind: 'crash', until: w.market.day + 100, text: '' };
  assert.ok(w.eventGrowth(a) < w.eventGrowth(b), 'debt makes a crash worse');
  w.globe.event = { kind: 'pandemic', until: w.market.day + 100, text: '' };
  a.econ.budget.welfare = 50; b.econ.budget.welfare = 20;
  assert.ok(w.eventGrowth(a) > w.eventGrowth(b), 'welfare blunts a pandemic');
});

test('new forces: marines storm beaches, special forces stay hidden and supplied, bombers wreck industry, satellites see the enemy, missile defense', () => {
  const w = setup();
  w.submit(1, { kind: 'war', target: 2 }, 'human');
  // beachhead: troops fresh from the sea fight weaker than marines
  const strike = (type: 'infantry' | 'marines') => {
    const v = setup();
    v.submit(1, { kind: 'war', target: 2 }, 'human');
    v.military.now = 10 * 86_400_000;
    const a = v.military.spawn(1, type, 5); a.landedAt = v.military.now - 86_400_000;
    const d = v.military.spawn(2, 'infantry', 5);
    v.military.fight(() => true, () => undefined, []);
    return 100 - d.strength;
  };
  assert.ok(strike('marines') > strike('infantry') * 1.2, 'marines hit harder on the beach');
  // special forces: always supplied, invisible to the enemy unless it shares the province
  const sf = w.military.spawn(1, 'special_forces', 7);
  w.military.updateSupply((n) => w.home(n));
  assert.equal(sf.supplied, true);
  assert.ok(!w.military.viewFor(2).some((v) => v.id === sf.id), 'hidden');
  w.military.units.delete(sf.id); // (it would otherwise see its neighbours)
  // research gates
  assert.equal(w.submit(1, { kind: 'recruit', unit: 'bombers' }, 'human').ok, false);
  w.nations.get(1)!.tech.done.push('stealth', 'orbital_recon');
  assert.equal(w.submit(1, { kind: 'recruit', unit: 'bombers' }, 'human').ok, true);
  // satellites reveal enemy forces anywhere
  const far = w.military.spawn(2, 'armored', 8);
  assert.ok(!w.military.viewFor(1).some((v) => v.id === far.id), 'unseen before');
  assert.equal(w.submit(1, { kind: 'satellite' }, 'human').ok, true);
  assert.ok(w.military.viewFor(1).some((v) => v.id === far.id), 'seen from orbit');
  // missile defense covers its neighbourhood
  w.military.buildings.set(7, [{ type: 'missile_defense', progress: 1 }]);
  assert.equal(w.shielded(2, 8), true);
  assert.equal(w.shielded(2, 1), false);
});

test('society: a government must suit its people; factions judge the budget; civil wars and revolts create new nations', () => {
  const w = setup();
  const n = w.nations.get(1)!;
  n.soc!.ideology.liberty = 0.9;
  n.gov.government = 'democracy';
  const happy = w.fit(n);
  n.gov.government = 'junta';
  assert.ok(w.fit(n) < happy - 8, 'liberals under a junta are unstable');
  // factions follow the budget
  n.econ.budget.military = 60;
  for (let i = 0; i < 200; i++) (w as unknown as { societyDay: () => void }).societyDay();
  assert.ok(n.soc!.factions.military > 70, 'the military likes a big budget');
  // civil war: the far provinces break away, with their armies, at war with the old nation
  const u = w.military.spawn(1, 'infantry', 4);
  (w as unknown as { civilWar: (x: unknown) => void }).civilWar(n);
  const rebel = [...w.nations.values()].find((x) => x.born);
  assert.ok(rebel, 'a new nation exists');
  assert.equal(w.military.atWar(rebel!.id, 1), true);
  assert.equal(u.nation, rebel!.id, 'troops in the breakaway land changed sides');
  assert.ok(w.publicView(rebel!).def?.name, 'clients learn its name and colour');
  // a player without a nation leads a revolt in a restless AI province
  const w2 = setup();
  w2.release(2);
  w2.nations.get(2)!.econ.stability = 30;
  const r = w2.found({ id: 9, name: 'rebel', guest: false }, 6);
  assert.equal(r.ok, true);
  const mine = w2.nationOf(9)!;
  assert.ok(mine.born && w2.military.atWar(mine.id, 2));
  assert.equal(w2.military.provinces.get(6)!.owner, mine.id);
});

test('storms ground aircraft and batter ships; weather is shared with players', () => {
  const w = setup();
  w.submit(1, { kind: 'war', target: 2 }, 'human');
  const ship = w.military.spawn(1, 'destroyers', 9);
  (w as unknown as { storms: unknown[] }).storms = [{ lon: -1, lat: 0, r: 300, vlon: 0, vlat: 0, until: w.market.day + 50 }];
  (w as unknown as { weatherDay: () => void }).weatherDay();
  assert.ok(w.warState().storms.length >= 1);
  w.military.fight(() => true, () => undefined, []);
  assert.ok(ship.strength < 100, 'the storm batters the ship');
  // a strike wing under the storm cannot fly
  const v = setup();
  v.submit(1, { kind: 'war', target: 2 }, 'human');
  v.military.storm = (p) => p === 1;
  const wing = v.military.spawn(1, 'strike', 1);
  wing.mission = { kind: 'bomb', target: 6 };
  v.military.buildings.set(6, [{ type: 'factory', progress: 1 }]);
  const gdp = v.nations.get(2)!.econ.gdp;
  for (let i = 0; i < 5; i++) v.military.fight(() => true, () => undefined, []);
  assert.equal(v.nations.get(2)!.econ.gdp, gdp, 'grounded: no bombing');
});

test('weather seasons: winter slows armies and wears down invaders in cold lands; harvests follow the year', async () => {
  const { seasonAt, seasonSlow, HARVEST } = await import('../../shared/seasons.ts');
  const jan = Date.UTC(2027, 0, 15), jul = Date.UTC(2027, 6, 15);
  assert.equal(seasonAt(jan, 50), 'winter');
  assert.equal(seasonAt(jan, -50), 'summer', 'opposite in the south');
  assert.equal(seasonAt(jan, 5), null, 'no seasons in the tropics');
  assert.equal(seasonSlow(jan, 'grassland', 50), 1.5);
  assert.equal(seasonSlow(jul, 'grassland', 50), 1);
  assert.ok(HARVEST.autumn > HARVEST.winter);
  // a cold-land strip: invaders freeze in winter, defenders at home do not
  const cold = (): Province[] => provinces().map((p) => ({ ...p, label: [p.label[0], 55] as [number, number] }));
  const w = new World(openDb(':memory:'), 1, defs, opts, cold());
  w.military.units.clear();
  w.submit(1, { kind: 'war', target: 2 }, 'ai');
  w.military.now = jan;
  const invader = w.military.spawn(1, 'infantry', 7), home = w.military.spawn(2, 'infantry', 8);
  w.military.fight(() => true, () => undefined, []);
  assert.ok(invader.strength < 100, 'the invader loses strength');
  assert.equal(home.strength, 100, 'the defender at home does not');
});
