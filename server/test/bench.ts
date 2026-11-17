// How long a world tick takes as nation counts grow (AI-heavy worst case).
//   npx tsx test/bench.ts
import { DAY, HOUR } from '../../shared/clock.ts';
import { openDb } from '../src/db.ts';
import { World, type NationDef } from '../src/world.ts';

for (const count of [150, 1000, 5000]) {
  const defs: NationDef[] = Array.from({ length: count }, (_, i) => ({
    id: i + 1, name: `Nation ${i + 1}`, short: `N${i + 1}`, capital: i, provinces: 20, pop: 1e7, area: 1e5,
    neighbours: [((i + 1) % count) + 1, ((i + count - 1) % count) + 1, ((i + 7) % count) + 1],
    seed: { pop: 1e7, coastal: (i % 10) / 10, farm: 30 + (i % 40), raw: { food: 1 + (i % 5), oil: i % 9 === 0 ? 4 : 0, gas: i % 4, coal: i % 3, metals: 1, rare_earths: i % 17 === 0 ? 1 : 0 } },
  }));
  const world = new World(openDb(':memory:'), 1, defs, {
    speed: 24, startGame: Date.UTC(2026, 0, 1), aiBudgetPerTick: 50, autopilotAfterMs: DAY, releaseAfterMs: 14 * DAY,
  });
  const start = Date.now();
  const times: number[] = [];
  // one real hour of ticks = one game day: every AI nation decides once
  for (let s = 1; s <= 3600; s++) {
    const t0 = performance.now();
    world.tick(start + s * 1000);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const p = (q: number) => times[Math.floor(q * (times.length - 1))].toFixed(2);
  console.log(`${String(count).padStart(5)} nations: tick median ${p(0.5)} ms, p99 ${p(0.99)} ms, max ${p(1)} ms`);
}
void HOUR;
