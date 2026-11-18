// The single-player world: the same simulation the server runs, inside a Web
// Worker. It answers the game interface exactly as the server would, saves to
// the browser's IndexedDB, and pauses the clock while the tab is closed.
import type { ChatChannel, ClientMsg, ServerMsg } from '../../../shared/protocol';
import { getMeta, setMeta } from '../../../server/src/schema';
import { World, nationDefsFrom } from '../../../server/src/world';
import { MemoryDB } from './memdb';
import { migrate } from '../../../server/src/schema';

const ME = { id: 1, name: 'Commander', guest: false };
const BASE_SPEED = 8640; // 1x: a game day every 10 real seconds, as online
const DEFAULT_X = 5; // single-player starts at 5x: a game day every 2 seconds
let world: World;
let db: MemoryDB;
let restarted = false; // the saved game was from an older map

const post = (msg: ServerMsg) => postMessage({ t: 'msg', msg });

// ---- saving ----------------------------------------------------------------------
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open('sovereign-command', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('saves');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function load(): Promise<string | undefined> {
  try {
    const d = await idb();
    return await new Promise((res) => {
      const q = d.transaction('saves').objectStore('saves').get('world');
      q.onsuccess = () => res(typeof q.result === 'string' ? q.result : undefined);
      q.onerror = () => res(undefined);
    });
  } catch { return undefined; }
}
async function store(bytes: string | null) {
  try {
    const d = await idb();
    await new Promise<void>((res) => {
      const tx = d.transaction('saves', 'readwrite');
      if (bytes) tx.objectStore('saves').put(bytes, 'world'); else tx.objectStore('saves').delete('world');
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
  } catch { /* storage blocked: the game still runs, it just won't be saved */ }
}
async function save() {
  if (!world) return;
  world.persistAll();
  setMeta(db, 'lastGame', String(world.gameNow()));
  await store(db.dump());
}

// ---- start -------------------------------------------------------------------------
async function start(base: string) {
  const raw = await (await fetch(`${base}world/provinces.json`)).json();
  const { seed, nations, provinces } = nationDefsFrom(raw);
  // a save made on a different map (the planet was regenerated) cannot continue: start fresh
  const stamp = `${raw.seed}:${raw.provinces.length}:${raw.nations.length}`;
  let saved = await load();
  restarted = false;
  if (saved && JSON.parse(saved).meta?.mapStamp !== stamp) { saved = undefined; restarted = true; }
  db = new MemoryDB(saved);
  migrate(db);
  setMeta(db, 'mapStamp', stamp);
  // the world waits while the tab is closed: pick the clock up where it stopped
  const clock = getMeta(db, 'clock');
  const last = getMeta(db, 'lastGame');
  if (clock && last) {
    setMeta(db, 'clock', JSON.stringify({ openedReal: Date.now(), openedGame: Number(last), speed: JSON.parse(clock).speed }));
  }
  const speed = clock ? JSON.parse(clock).speed : BASE_SPEED * DEFAULT_X;
  world = new World(db, seed, nations, {
    speed, startGame: Date.UTC(2026, 0, 1), aiBudgetPerTick: 150,
    autopilotAfterMs: 1e15, releaseAfterMs: 1e15, seasonMs: 28 * 86_400_000,
  }, provinces);
  world.achievements = {
    list: (u) => (db.prepare('select key from achievements where user_id = ?').all(u) as { key: string }[]).map((r) => r.key),
    award: (u, k) => Number(db.prepare('insert or ignore into achievements (user_id, key, at) values (?, ?, ?)').run(u, k, Date.now()).changes) > 0,
  };
  world.listener = {
    nation: (nation) => post({ t: 'nation', nation }),
    mine: (userId, nation) => {
      if (userId !== ME.id) return;
      post({ t: 'mine', nation });
      post({ t: 'you', you: { ...ME, nation: nation ? nation.id : null } });
    },
    event: (event) => post({ t: 'event', event }),
    chat: (line) => post({ t: 'chat', line }),
    economy: (economy) => post({ t: 'economy', economy }),
    units: (userId, units) => { if (userId === ME.id) post({ t: 'units', units }); },
    war: (war) => post({ t: 'war', war }),
  };
  world.setPresence(ME.id, true);
  setInterval(() => { try { world.tick(); } catch (e) { console.error('tick failed', e); } }, 1000);
  setInterval(() => void save(), 20_000);
  postMessage({ t: 'ready' });
}

// ---- messages from the game interface ----------------------------------------------------
function reply(r: { ok: true } | { ok: false; code: string; message: string }) {
  if (!r.ok) post({ t: 'error', code: r.code as never, message: r.message });
}

function handle(msg: ClientMsg) {
  switch (msg.t) {
    case 'hello': {
      const mine = world.nationOf(ME.id);
      const { events, chat } = world.recent(ME.id);
      post({
        t: 'welcome', you: { ...ME, nation: mine?.id ?? null, achievements: world.achievements.list(ME.id) as never },
        clock: { ...world.clock, serverNow: Date.now() }, nations: world.allPublic(), mine: mine ? world.privateView(mine) : null,
        events, chat, online: 1, economy: world.economyUpdate(), war: world.warState(), units: world.unitsFor(ME.id),
      });
      if (restarted) { restarted = false; post({ t: 'error', code: 'not_allowed', message: 'The map has been updated, so a new world has started. Your earlier game could not carry over.' }); }
      return;
    }
    case 'claim': return reply(world.claim(ME, Number(msg.nation)));
    case 'found': return reply(world.found(ME, Number(msg.province)));
    case 'release': return reply(world.release(ME.id));
    case 'order': {
      const n = world.nationOf(ME.id);
      if (!n) return post({ t: 'error', code: 'not_ruling', message: 'Take command of a nation first.' });
      return reply(world.submit(n.id, msg.order, 'human'));
    }
    case 'chat': return reply(world.chat(ME, msg.text, msg.channel as ChatChannel, msg.to));
    case 'ping': return post({ t: 'pong', at: msg.at, serverNow: Date.now() });
  }
}

/** The few HTTP endpoints the interface reads. */
function api(path: string): { status: number; body: unknown } {
  const url = new URL(path, 'http://local');
  const p = url.pathname.replace(/^.*\/api\//, '/api/');
  if (p === '/api/health') return { status: 200, body: { ok: true } };
  if (p === '/api/history') return { status: 200, body: { events: world.history(Number(url.searchParams.get('nation'))) } };
  if (p === '/api/stats') return { status: 200, body: { series: world.stats(String(url.searchParams.get('nations') ?? '').split(',').map(Number).filter((x) => x > 0)) } };
  if (p === '/api/replay') return { status: 200, body: { frames: world.replay() } };
  if (p === '/api/world') return { status: 200, body: { name: 'Single-player world', nations: world.nations.size, players: 1, online: 1, season: { number: world.season.number, endsAt: world.season.endsAt }, day: world.market.day } };
  if (p === '/api/report') return { status: 200, body: { ok: true } };
  return { status: 404, body: { error: 'Not available in single-player.' } };
}

onmessage = (e: MessageEvent) => {
  const d = e.data;
  if (d.t === 'start') void start(d.base);
  else if (d.t === 'msg' && world) handle(d.msg as ClientMsg);
  else if (d.t === 'api') postMessage({ t: 'api', id: d.id, ...(world ? api(d.path) : { status: 503, body: { error: 'Starting up.' } }) });
  else if (d.t === 'save') void save();
  else if (d.t === 'speed' && world) {
    const x = Math.max(1, Math.min(20, Number(d.x) || 1));
    world.setSpeed(BASE_SPEED * x);
    post({ t: 'clock', clock: { ...world.clock, serverNow: Date.now() } });
  }
  else if (d.t === 'reset') void store(null).then(() => postMessage({ t: 'reset-done' }));
};
