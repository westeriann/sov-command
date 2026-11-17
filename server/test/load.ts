// Load test: a private world server with many bot players connected at once.
//
//   npx tsx test/load.ts [bots=300] [seconds=60]
//
// Bots log in, claim every free nation (the rest watch), and send orders every
// few seconds like busy players: recruiting, moving troops, taxes, research,
// diplomacy, chat. Reports server tick times, traffic and memory.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { WebSocket } from 'ws';
import { TECHS } from '../../shared/research.ts';
import { start } from '../src/index.ts';

const BOTS = Number(process.argv[2] ?? 300);
const SECONDS = Number(process.argv[3] ?? 60);
const dir = mkdtempSync(join(tmpdir(), 'sov-load-'));
const app = start({
  port: 0, worldDir: resolve('../client/public/world'), dbFile: join(dir, 'w.db'), speed: 8640,
  aiBudgetPerTick: 25, autopilotAfterMs: 3_600_000, releaseAfterMs: 86_400_000, allowedOrigins: [],
});
const port = await app.ready;

// time every tick of the real loop
const ticks: number[] = [];
const tick = app.world.tick.bind(app.world);
app.world.tick = (now?: number) => { const t = performance.now(); tick(now); ticks.push(performance.now() - t); };

let bytes = 0, messages = 0;
const refusals = new Map<string, number>();
const nationIds = [...app.world.nations.keys()];
const bots: { ws: WebSocket; nation: number | null; province?: number }[] = [];
const rand = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];

for (let i = 0; i < BOTS; i++) {
  const user = app.accounts.guest();
  const token = app.accounts.createSession(user.id);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const bot = { ws, nation: null as number | null };
  ws.on('open', () => {
    ws.send(JSON.stringify({ t: 'hello', token }));
    if (i < nationIds.length) setTimeout(() => ws.send(JSON.stringify({ t: 'claim', nation: nationIds[i] })), 200);
  });
  ws.on('message', (d) => {
    bytes += (d as Buffer).length;
    messages++;
    const m = JSON.parse(String(d));
    if (m.t === 'mine' && m.nation) bot.nation = m.nation.id;
    if (m.t === 'error') refusals.set(`${m.code}: ${m.message.replace(/\d+/g, 'N').replace(/the [A-Z]\w+/g, 'the X')}`, (refusals.get(`${m.code}: ${m.message.replace(/\d+/g, 'N').replace(/the [A-Z]\w+/g, 'the X')}`) ?? 0) + 1);
  });
  bots.push(bot);
  if (i % 50 === 49) await new Promise((r) => setTimeout(r, 100)); // don't open every socket in the same instant
}

const provinces = [...app.world.military.provinces.values()].filter((p) => p.kind === 'land');
const busy = setInterval(() => {
  for (const b of bots) {
    if (b.ws.readyState !== WebSocket.OPEN || Math.random() > 0.35) continue; // each bot acts every ~3 s
    const send = (order: unknown) => b.ws.send(JSON.stringify({ t: 'order', order }));
    if (!b.nation) { if (Math.random() < 0.02) b.ws.send(JSON.stringify({ t: 'chat', text: 'watching the world' })); continue; }
    const units = app.world.military.unitsOf(b.nation);
    const r = Math.random();
    if (r < 0.25) send({ kind: 'recruit', unit: rand(['infantry', 'armored', 'fighters', 'destroyers']) });
    else if (r < 0.55 && units.length) {
      const own = provinces.filter((p) => p.owner === b.nation);
      if (own.length) send({ kind: 'move', units: [rand(units).id], to: rand(own).id });
    } else if (r < 0.65) send({ kind: 'policy', policy: { tax: 18 + Math.floor(Math.random() * 15) } });
    else if (r < 0.75) send({ kind: 'research', tech: rand(TECHS.filter((t) => t.tier === 1)).id });
    else if (r < 0.85) send({ kind: 'propose', target: rand(nationIds), deal: { kind: 'trade' } });
    else if (r < 0.9) send({ kind: 'budget', budget: { military: 20 + Math.floor(Math.random() * 15) } });
    else if (r < 0.92) b.ws.send(JSON.stringify({ t: 'chat', text: 'hello world' }));
  }
}, 1000);

await new Promise((r) => setTimeout(r, SECONDS * 1000));
clearInterval(busy);
const s = [...ticks].sort((a, b) => a - b);
const pct = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))]?.toFixed(1);
const playing = bots.filter((b) => b.nation).length;
console.log(`${BOTS} bots (${playing} leading nations, ${BOTS - playing} watching) for ${SECONDS} s`);
console.log(`tick: median ${pct(0.5)} ms, p95 ${pct(0.95)} ms, max ${pct(1)} ms (budget 1000 ms)`);
console.log(`traffic out: ${(bytes / SECONDS / 1024).toFixed(0)} KB/s total, ${(bytes / SECONDS / BOTS / 1024).toFixed(1)} KB/s per player; ${(messages / SECONDS).toFixed(0)} messages/s`);
console.log(`server memory: ${(process.memoryUsage().rss / 1e6).toFixed(0)} MB (includes the bots)`);
console.log('orders refused (normal game rules):', [...refusals].sort((a, b) => b[1] - a[1]).map(([k, v]) => `\n  ${v} × ${k}`).join(''));
for (const b of bots) b.ws.close();
await app.stop();
rmSync(dir, { recursive: true, force: true });
process.exit(0);
