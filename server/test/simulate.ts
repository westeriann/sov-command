// Fast-forward the real world with every nation under AI control and report.
//   npx tsx test/simulate.ts [years]
import { resolve } from 'node:path';
import { COMMODITIES, COMMODITY_INFO } from '../../shared/economy.ts';
import { DAY } from '../../shared/clock.ts';
import { openDb } from '../src/db.ts';
import { loadNationDefs, World } from '../src/world.ts';

const years = Number(process.argv[2] ?? 2);
const { seed, nations, provinces } = loadNationDefs(resolve('../client/public/world'));
const w = new World(openDb(':memory:'), seed, nations, {
  speed: 24, startGame: Date.UTC(2026, 0, 1), aiBudgetPerTick: 1000, autopilotAfterMs: DAY, releaseAfterMs: 14 * DAY,
}, provinces);
const all = () => [...w.nations.values()].filter((n) => !n.annexedBy).map((n) => n.econ);

function report(label: string) {
  const e = all();
  const gdp = e.reduce((a, x) => a + x.gdp, 0);
  const pop = e.reduce((a, x) => a + x.pop, 0);
  const pcs = e.map((x) => (x.gdp * 1e9) / x.pop).sort((a, b) => a - b);
  const stab = e.map((x) => x.stability).sort((a, b) => a - b);
  const short = e.filter((x) => x.shortage > 0.05).length;
  const debt = e.filter((x) => x.treasury < 0).length;
  const mid = Math.floor(pcs.length / 2);
  const prices = COMMODITIES.map((c) => `${c} ${(w.market.prices[c] / COMMODITY_INFO[c].basePrice).toFixed(2)}x`).join(', ');
  console.log(`${label}: GDP $${(gdp / 1000).toFixed(1)}T, pop ${(pop / 1e9).toFixed(2)}bn, per person $${Math.round(pcs[0])} / $${Math.round(pcs[mid])} / $${Math.round(pcs[pcs.length - 1])}`);
  console.log(`   stability min ${stab[0].toFixed(0)} median ${stab[mid].toFixed(0)} max ${stab[stab.length - 1].toFixed(0)}; ${short} nations short of goods; ${debt} in debt`);
  console.log(`   prices vs start: ${prices}`);
  { const live = [...w.nations.values()].filter((n) => !n.annexedBy && !n.born);
    const done = live.map((n) => n.tech.done.length).sort((x, y) => x - y);
    const rates = live.map((n) => w.researchRate(n)).sort((x, y) => x - y);
    console.log(`   research: techs known min ${done[0]} median ${done[Math.floor(done.length / 2)]} max ${done[done.length - 1]} (of 13); ${live.filter((n) => !n.tech.current).length} idle; points/day median ${rates[Math.floor(rates.length / 2)].toFixed(1)}`); }
  const m = w.military;
  const by = (d: string) => [...m.units.values()].filter((u) => ['infantry','mechanized','armored'].includes(u.type) === (d === 'land') && (d === 'land' || (d === 'sea') === ['destroyers','submarines','carrier'].includes(u.type))).length;
  console.log(`   forces: ${by('land')} land, ${by('sea')} naval, ${by('air')} air; ${m.wars.length} wars now; ${m.occupied.size} provinces occupied`);
  const d = w.diplomacy; console.log(`   diplomacy: ${d.treaties.filter((t) => t.kind === 'alliance').length} alliances, ${d.treaties.filter((t) => t.kind === 'trade').length} trade deals, ${d.owners.size} provinces changed hands, ${[...w.nations.values()].filter((n) => n.annexedBy).length} nations annexed; ${[...w.nations.values()].filter((n) => n.born && !n.annexedBy).length} new nations from civil wars`);
  console.log(`   sea and sky: ${w.lanes.length} shipping lanes (${w.lanes.filter((l) => l.raided).length} raided), ${w.storms.length} storms active`);
  { const g = w.globe; const refugees = [...w.nations.values()].reduce((s, n) => s + (w.privateView(n).econ?.migration?.refugeesIn ?? 0), 0);
    console.log(`   world: ${g.warming.toFixed(2)} °C warmer; event now: ${g.event?.kind ?? 'none'}; refugees taken in over the last year: ${(refugees / 1e6).toFixed(2)} m`); }
  { const live = [...w.nations.values()].filter((n) => !n.annexedBy);
    const dark = live.filter((n) => (n.econ.blackout ?? 0) > 0.01);
    const plants = [...w.military.buildings.values()].flat().filter((b) => ['coal_plant', 'gas_plant', 'nuclear_plant', 'renewables'].includes(b.type) && b.progress >= 1).length;
    const oil = live.reduce((s, n) => s + (w.extraUse(n).oil ?? 0), 0);
    console.log(`   energy: ${dark.length} nations with blackouts (worst ${Math.round(Math.max(0, ...live.map((n) => n.econ.blackout ?? 0)) * 100)}%); ${plants} power stations; armies burn ${oil.toFixed(2)}bn bbl oil a year; ${live.filter((n) => n.econ.short.oil > 0.05).length} short of oil, ${live.filter((n) => n.econ.short.metals > 0.05).length} short of metals`); }
  console.log(`   blocs: ${d.blocs.map((b) => `${b.name} (${b.members.length})`).join(', ') || 'none'}; council: ${d.council.length} resolutions (${d.council.filter((r) => r.result === 'passed').length} passed); vassals: ${d.overlords.size}; embargoes: ${d.embargoes.length}; spy reports: ${[...w.nations.values()].reduce((s, n) => s + (n.reports?.length ?? 0), 0)}`);
  const govs: Record<string, number> = {}; let techs = 0; for (const n of w.nations.values()) { if (n.annexedBy) continue; govs[n.gov.government] = (govs[n.gov.government] ?? 0) + 1; techs += n.tech.done.length; }
  console.log(`   politics: ${JSON.stringify(govs)}; ${(techs / w.nations.size).toFixed(1)} techs per nation; ${[...w.military.buildings.values()].flat().filter((b) => b.progress >= 1).length} buildings; ${[...w.nations.values()].filter((n) => (n.mil.warheads ?? 0) > 0).length} nuclear powers; ${[...w.military.units.values()].filter((u) => u.general).length} generals`);
}

report('day 0');
const t0 = Date.now();
const realPerDay = 3_600_000; // at 24x, a game day is a real hour
let ms = 0;
for (let y = 1; y <= years; y++) {
  const start = performance.now();
  for (let d = 0; d < 365; d++) {
    for (let k = 0; k < 4; k++) w.tick(t0 + ((y - 1) * 365 + d) * realPerDay + k * (realPerDay / 4) + 1000);
  }
  ms += performance.now() - start;
  report(`year ${y}`);
}
console.log(`simulated ${years * 365} game days in ${(ms / 1000).toFixed(1)} s (${(ms / (years * 365)).toFixed(2)} ms per game day, AI included)`);
