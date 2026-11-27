import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DAY } from '../../shared/clock.ts';
import { openDb } from '../src/db.ts';
import type { Province } from '../src/military.ts';
import { World, type NationDef } from '../src/world.ts';

// A strip of 9 provinces: nation 1 owns 1-3, nation 2 owns 4-6, nation 3 owns 7-9.
const provinces = (): Province[] => Array.from({ length: 9 }, (_, i) => ({
  id: i + 1, kind: 'land' as const, label: [i, 0] as [number, number], terrain: 'grassland',
  adj: [i, i + 2].filter((x) => x >= 1 && x <= 9), owner: Math.floor(i / 3) + 1, pop: 1e7, name: `P${i + 1}`,
}));
const seed = { pop: 3e7, coastal: 0.5, farm: 50, raw: { food: 2, oil: 1, gas: 1, coal: 1, metals: 1, rare_earths: 0.2, timber: 1 } };
const defs: NationDef[] = [1, 2, 3].map((id) => ({
  id, name: `Nation ${id}`, short: `N${id}`, capital: id * 3 - 1, neighbours: [id - 1, id + 1].filter((x) => x >= 1 && x <= 3),
  provinces: 3, pop: 3e7, area: 1e5, seed,
}));
const opts = { speed: 8640, startGame: Date.UTC(2026, 0, 1), aiBudgetPerTick: 0, autopilotAfterMs: 1e12, releaseAfterMs: 1e12 };

function setup(humans = [1, 2, 3]) {
  const w = new World(openDb(':memory:'), 1, defs, opts, provinces());
  w.military.units.clear();
  for (const id of humans) w.claim({ id, name: `p${id}`, guest: false }, id);
  return w;
}

test('a democracy passes laws through parliament; an autocracy by decree, cheaper', () => {
  const w = setup();
  const a = w.nations.get(1)!, b = w.nations.get(2)!;
  a.gov.government = 'democracy'; b.gov.government = 'autocracy';
  a.pol = { capital: 100, support: 70, laws: [], claims: [], goodwill: 0 };
  b.pol = { capital: 100, support: 70, laws: [], claims: [], goodwill: 0 };
  assert.equal(w.submit(1, { kind: 'law', law: 'research_grants', enact: true }, 'human').ok, true);
  assert.equal(a.pol.capital, 75, 'full price through parliament');
  assert.ok(w.effects(1).research >= 0.15, 'the law takes effect');
  assert.equal(w.submit(2, { kind: 'law', law: 'research_grants', enact: true }, 'human').ok, true);
  assert.ok(b.pol.capital > 80, 'a decree costs less');
  // a parliament that has turned against the government votes laws down
  a.pol.support = 20;
  const r = w.submit(1, { kind: 'law', law: 'conscription', enact: true }, 'human');
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.message, /votes it down/);
  assert.ok(!a.pol.laws.includes('conscription'));
  // laws that exclude each other
  a.pol.support = 90;
  assert.equal(w.submit(1, { kind: 'law', law: 'press_freedom', enact: true }, 'human').ok, true);
  assert.equal(w.submit(1, { kind: 'law', law: 'censorship', enact: true }, 'human').ok, false);
});

test('parliament must back a war of choice; a claim or emergency powers lower the bar', () => {
  const w = setup();
  const a = w.nations.get(1)!;
  a.gov.government = 'democracy';
  a.pol = { capital: 200, support: 30, laws: [], claims: [], goodwill: 0 };
  assert.equal(w.submit(1, { kind: 'war', target: 2 }, 'human').ok, false, 'no war without parliament');
  a.pol.claims = [2];
  assert.equal(w.submit(1, { kind: 'war', target: 2 }, 'human').ok, true, 'a justified war needs less support');
  assert.equal(a.pol.claims.includes(2), false, 'the claim is used up');
  // taxes above the limit also need parliament
  a.pol.support = 30;
  assert.equal(w.submit(1, { kind: 'policy', policy: { tax: 40 } }, 'human').ok, false);
  assert.equal(w.submit(1, { kind: 'law', law: 'emergency_powers', enact: true }, 'human').ok, false, 'parliament will not grant them at 30%');
  a.pol.support = 80;
  assert.equal(w.submit(1, { kind: 'law', law: 'emergency_powers', enact: true }, 'human').ok, true);
  a.pol.support = 10;
  assert.equal(w.submit(1, { kind: 'policy', policy: { tax: 40 } }, 'human').ok, true, 'emergency powers bypass parliament');
});

test('parliament makes demands; meeting them earns capital and goodwill, ignoring them costs', () => {
  const w = setup();
  const a = w.nations.get(1)!;
  a.gov.government = 'democracy';
  a.pol = { capital: 0, support: 50, laws: [], claims: [], goodwill: 0, nextDemand: 0 };
  let t = Date.now();
  for (let d = 0; d < 3; d++) { t += DAY / 8640; w.tick(t); }
  const dem = a.pol.demand;
  assert.ok(dem, 'a demand arrives');
  assert.equal(w.privateView(a).politics?.demand?.kind, dem.kind, 'the player sees it');
  const before = a.pol.capital;
  // meet it, whatever it was
  if (dem.kind === 'welfare') w.submit(1, { kind: 'budget', budget: { welfare: dem.target! + 2 } }, 'human');
  else if (dem.kind === 'research') w.submit(1, { kind: 'budget', budget: { research: dem.target! + 2 } }, 'human');
  else if (dem.kind === 'defence') w.submit(1, { kind: 'budget', budget: { military: dem.target! + 2 } }, 'human');
  else if (dem.kind === 'lower_tax') w.submit(1, { kind: 'policy', policy: { tax: dem.target! } }, 'human');
  else if (dem.kind === 'trade') { w.submit(1, { kind: 'propose', target: 2, deal: { kind: 'trade' } }, 'human'); w.submit(2, { kind: 'answer', from: 1, deal: 'trade', accept: true }, 'human'); }
  else if (dem.kind === 'infrastructure') { a.pol.capital = 100; w.submit(1, { kind: 'law', law: 'infrastructure_act', enact: true }, 'human'); }
  t += DAY / 8640; w.tick(t);
  assert.equal(a.pol.demand, undefined, 'met');
  assert.ok(a.pol.goodwill > 10, 'parliament is grateful');
  assert.ok(a.pol.capital > before, 'and the government gains capital');
  // a refused demand costs goodwill
  a.pol.demand = { kind: 'peace', text: 'Make peace', since: 0, until: 999, by: 'parliament' };
  const g = a.pol.goodwill;
  assert.equal(w.submit(1, { kind: 'dismiss_demand' }, 'human').ok, true);
  assert.ok(a.pol.goodwill < g);
});

test('opinion follows treaties and deeds; gifts help, war and broken pacts are remembered', () => {
  const w = setup();
  const base = w.opinion(2, 1).total;
  w.submit(1, { kind: 'propose', target: 2, deal: { kind: 'gift', amount: 5 } }, 'human');
  assert.ok(w.opinion(2, 1).total > base, 'a gift is welcome, and needs no answer');
  w.submit(1, { kind: 'propose', target: 2, deal: { kind: 'nap' } }, 'human');
  w.submit(2, { kind: 'answer', from: 1, deal: 'nap', accept: true }, 'human');
  assert.equal(w.diplomacy.has('nap', 1, 2), true);
  assert.ok(w.opinion(2, 1).parts.some(([why]) => why === 'Non-aggression pact'));
  const third = w.opinion(3, 1).total;
  w.nations.get(1)!.pol!.support = 90;
  assert.equal(w.submit(1, { kind: 'war', target: 2 }, 'human').ok, true);
  assert.equal(w.diplomacy.has('nap', 1, 2), false, 'war ends every treaty between them');
  assert.ok(w.opinion(2, 1).total <= -100 + 20, 'the betrayed never forget');
  assert.ok(w.opinion(3, 1).total < third - 20, 'and the world takes note');
});

test('guarantors join a war on the nation they guarantee; military access lets troops pass', () => {
  const w = setup();
  w.submit(3, { kind: 'propose', target: 2, deal: { kind: 'guarantee' } }, 'human');
  w.submit(2, { kind: 'answer', from: 3, deal: 'guarantee', accept: true }, 'human');
  assert.equal(w.diplomacy.guarantees(3, 2), true);
  w.nations.get(1)!.pol!.support = 90;
  w.submit(1, { kind: 'war', target: 2 }, 'human');
  assert.equal(w.military.atWar(3, 1), true, 'the guarantor keeps its word');
  const v = setup();
  v.submit(1, { kind: 'propose', target: 2, deal: { kind: 'access' } }, 'human');
  v.submit(2, { kind: 'answer', from: 1, deal: 'access', accept: true }, 'human');
  assert.equal(v.military.canEnter(1, 5), true, 'access opens their land');
});

test('supply contracts ship goods daily at the agreed price; refused demands give a claim', () => {
  const w = setup();
  const a = w.nations.get(1)!, b = w.nations.get(2)!;
  b.econ.stock.oil = 100;
  w.submit(1, { kind: 'propose', target: 2, deal: { kind: 'contract', good: 'oil', amount: 36.5, years: 1, sell: false } }, 'human');
  w.submit(2, { kind: 'answer', from: 1, deal: 'contract', accept: true }, 'human');
  const c = w.diplomacy.contracts[0];
  assert.ok(c && c.buyer === 1 && c.seller === 2);
  const cash = b.econ.treasury;
  (w as unknown as { contractsDay(): void }).contractsDay();
  assert.ok(Math.abs(b.econ.stock.oil - 99.9) < 1e-6, 'a tenth a day leaves the seller');
  assert.ok(b.econ.treasury > cash, 'and is paid for');
  // a demand refused
  w.submit(1, { kind: 'propose', target: 2, deal: { kind: 'demand', province: 4 } }, 'human');
  w.submit(2, { kind: 'answer', from: 1, deal: 'demand', accept: false }, 'human');
  assert.deepEqual(a.pol!.claims, [2], 'a claim on them');
  assert.equal(w.justified(1, 2), true);
  // a demand accepted hands the province over
  w.submit(1, { kind: 'propose', target: 2, deal: { kind: 'demand', province: 4 } }, 'human');
  w.submit(2, { kind: 'answer', from: 1, deal: 'demand', accept: true }, 'human');
  assert.equal(w.military.provinces.get(4)!.owner, 1);
});

test('a one-time sale ships the goods at once at the world price', () => {
  const w = setup();
  const a = w.nations.get(1)!, b = w.nations.get(2)!;
  a.econ.stock.food = 50; b.econ.stock.food = 0;
  const price = w.market.prices.food, cashA = a.econ.treasury, cashB = b.econ.treasury;
  assert.equal(w.submit(1, { kind: 'propose', target: 2, deal: { kind: 'sale', good: 'food', amount: 80, sell: true } }, 'human').ok, false, 'not more than you hold');
  assert.equal(w.submit(1, { kind: 'propose', target: 2, deal: { kind: 'sale', good: 'food', amount: 20, sell: true } }, 'human').ok, true);
  w.submit(2, { kind: 'answer', from: 1, deal: 'sale', accept: true }, 'human');
  assert.ok(Math.abs(a.econ.stock.food - 30) < 1e-9 && Math.abs(b.econ.stock.food - 20) < 1e-9, 'the shipment moves');
  assert.ok(Math.abs(a.econ.treasury - cashA - 20 * price) < 1e-9 && Math.abs(cashB - b.econ.treasury - 20 * price) < 1e-9, 'paid at the world price');
});

test('the three pillars: below 50 costs stability, 75 helps; all three below 25 topples the government', async () => {
  const { pillarStability } = await import('../../shared/society.ts');
  assert.equal(pillarStability(80), 3);
  assert.equal(pillarStability(60), 0);
  assert.ok(pillarStability(40) < 0 && pillarStability(40) > pillarStability(30), 'the lower, the worse');
  assert.equal(pillarStability(10), -8);
  const w = setup([1]);
  const n = w.nations.get(1)!;
  n.gov.government = 'autocracy';
  const before = n.gov.government;
  const rand = (w as unknown as { rand: () => number }).rand;
  (w as unknown as { rand: () => number }).rand = () => 0; // every chance comes up
  n.soc!.factions = { military: 10, business: 10, public: 10 };
  (w as unknown as { pillarsDay(n: unknown): void }).pillarsDay(n);
  assert.notEqual(n.gov.government, before, 'the government falls without a fight');
  assert.ok(n.soc!.factions.public >= 40, 'and the pillars reset');
  // one angry pillar: the army takes power
  n.gov.government = 'democracy';
  n.soc!.factions = { military: 10, business: 60, public: 60 };
  (w as unknown as { pillarsDay(n: unknown): void }).pillarsDay(n);
  assert.equal(n.gov.government, 'junta', 'a coup');
  (w as unknown as { rand: () => number }).rand = rand;
});
