// World server entry point. One process runs one world.
//
//   PORT=8787 WORLD_DIR=../client/public/world DB_FILE=data/world.db npm run dev
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { HOUR } from '../../shared/clock.ts';
import { Accounts } from './auth.ts';
import { openDb } from './db.ts';
import { apiHandler } from './http.ts';
import { Hub } from './net.ts';
import { loadNationDefs, World } from './world.ts';

const env = (k: string, d: string) => process.env[k] ?? d;
const config = {
  port: Number(env('PORT', '8787')),
  worldDir: resolve(env('WORLD_DIR', '../client/public/world')),
  dbFile: resolve(env('DB_FILE', 'data/world.db')),
  speed: Number(env('GAME_SPEED', '8640')), // 8640: one game day every 10 real seconds, a game year every real hour
  aiBudgetPerTick: Number(env('AI_BUDGET', '25')),
  autopilotAfterMs: Number(env('AUTOPILOT_AFTER_HOURS', '1')) * HOUR, // one game year
  releaseAfterMs: Number(env('RELEASE_AFTER_DAYS', '7')) * 24 * HOUR,
  allowedOrigins: env('ALLOWED_ORIGINS', '').split(',').map((s) => s.trim()).filter(Boolean),
};

export function start(cfg = config) {
  const db = openDb(cfg.dbFile);
  const { seed, nations, provinces } = loadNationDefs(cfg.worldDir);
  const world = new World(db, seed, nations, {
    speed: cfg.speed,
    startGame: Date.UTC(2026, 0, 1),
    aiBudgetPerTick: cfg.aiBudgetPerTick,
    autopilotAfterMs: cfg.autopilotAfterMs,
    releaseAfterMs: cfg.releaseAfterMs,
  }, provinces);
  const accounts = new Accounts(db);
  let hub: Hub | null = null;
  const api = apiHandler(accounts, world, () => hub?.onlineCount ?? 0);
  const server = createServer((req, res) => { void api(req, res); });
  hub = new Hub(server, world, accounts, cfg.allowedOrigins);

  // fixed one-second tick, corrected for drift
  let next = Date.now() + 1000;
  let timer: NodeJS.Timeout;
  const loop = () => {
    const t0 = Date.now();
    try {
      world.tick(t0);
    } catch (e) {
      console.error('tick failed', e);
    }
    const spent = Date.now() - t0;
    if (spent > 200) console.warn(`slow tick: ${spent} ms`);
    next += 1000;
    timer = setTimeout(loop, Math.max(0, next - Date.now()));
  };
  timer = setTimeout(loop, 1000);

  const ready = new Promise<number>((res) => server.listen(cfg.port, () => {
    const addr = server.address();
    res(typeof addr === 'object' && addr ? addr.port : cfg.port);
  }));

  const stop = () => new Promise<void>((res) => {
    clearTimeout(timer);
    world.persistAll();
    hub?.close();
    server.close(() => {
      db.close();
      res();
    });
  });
  return { world, accounts, server, ready, stop };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('index.ts')) {
  const app = start();
  app.ready.then((port) => {
    console.log(`world server on :${port} · ${app.world.nations.size} nations · seed map from ${config.worldDir}`);
  });
  const shutdown = () => {
    console.log('saving and shutting down');
    void app.stop().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
