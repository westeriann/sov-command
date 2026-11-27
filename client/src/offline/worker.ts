// The single-player world: the same simulation the server runs, inside a Web
// Worker. It answers the game interface exactly as the server would, saves to
// the browser's IndexedDB, and pauses the clock while the tab is closed.
import type { ChatChannel, ClientMsg, ServerMsg } from '../../../shared/protocol';
import { getMeta, setMeta } from '../../../server/src/schema';
import { World, nationDefsFrom } from '../../../server/src/world';
import { MemoryDB } from './memdb';
import { normalizeSettings, type NewGame } from '../../../shared/settings';
import { migrate } from '../../../server/src/schema';

const ME = { id: 1, name: 'Commander', guest: false };
const BASE_SPEED = 8640; // 1x: a game day every 10 real seconds, as online
const DEFAULT_X = 5; // single-player starts at 5x: a game day every 2 seconds
let world: World;
let db: MemoryDB;
let paused: number | null = null; // game ms the clock stopped at (the main menu is open)
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
async function store(bytes: string | null, key = 'world') {
  try {
    const d = await idb();
    await new Promise<void>((res) => {
      const tx = d.transaction('saves', 'readwrite');
      if (bytes) tx.objectStore('saves').put(bytes, key); else tx.objectStore('saves').delete(key);
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
  } catch { /* storage blocked: the game still runs, it just won't be saved */ }
}
async function get(key: string): Promise<string | undefined> {
  try {
    const d = await idb();
    return await new Promise((res) => {
      const q = d.transaction('saves').objectStore('saves').get(key);
      q.onsuccess = () => res(typeof q.result === 'string' ? q.result : undefined);
      q.onerror = () => res(undefined);
    });
  } catch { return undefined; }
}
async function keys(): Promise<string[]> {
  try {
    const d = await idb();
    return await new Promise((res) => {
      const q = d.transaction('saves').objectStore('saves').getAllKeys();
      q.onsuccess = () => res((q.result as IDBValidKey[]).map(String));
      q.onerror = () => res([]);
    });
  } catch { return []; }
}

/** Save slots: a copy of the world under a name, with a line describing it. */
async function slots() {
  const out: { name: string; info: string }[] = [];
  for (const k of await keys()) if (k.startsWith('meta:')) out.push({ name: k.slice(5), info: (await get(k)) ?? '' });
  return out.sort((a, b) => b.info.localeCompare(a.info));
}
const ironman = () => !!world && getMeta(db, 'ironman') === '1';
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
  // where every province sits, folded into one number: any change to the map's shapes changes it
  const shape = (raw.provinces as { label: [number, number] }[]).reduce((h, p) => (Math.imul(h, 31) + Math.round(p.label[0] * 100) * 7 + Math.round(p.label[1] * 100)) >>> 0, 7);
  const stamp = `${raw.seed}:${raw.provinces.length}:${raw.nations.length}:${shape}`;
  let saved = await load();
  restarted = false;
  if (saved && JSON.parse(saved).meta?.mapStamp !== stamp) { saved = undefined; restarted = true; }
  db = new MemoryDB(saved);
  migrate(db);
  setMeta(db, 'mapStamp', stamp);
  // a new game from the create-game screen: its choices apply to the world about to be made
  let next: NewGame | undefined;
  try { next = JSON.parse((await get('new-game')) ?? 'null') ?? undefined; } catch { next = undefined; }
  if (next) await store(null, 'new-game');
  if ((await get('ironman-next')) === '1') { setMeta(db, 'ironman', '1'); await store(null, 'ironman-next'); } // older builds' new game
  if (next?.ironman) setMeta(db, 'ironman', '1');
  // the world waits while the tab is closed: pick the clock up where it stopped
  const clock = getMeta(db, 'clock');
  const last = getMeta(db, 'lastGame');
  if (clock && last) {
    setMeta(db, 'clock', JSON.stringify({ openedReal: Date.now(), openedGame: Number(last), speed: JSON.parse(clock).speed }));
  }
  const startX = Math.max(1, Math.min(20, Math.round(Number(next?.speed) || DEFAULT_X)));
  const speed = clock ? JSON.parse(clock).speed : BASE_SPEED * startX;
  world = new World(db, seed, nations, {
    speed, startGame: Date.UTC(2026, 0, 1), aiBudgetPerTick: 150,
    autopilotAfterMs: 1e15, releaseAfterMs: 1e15, seasonMs: 28 * 86_400_000, singlePlayer: true,
    settings: normalizeSettings(next),
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
  // chosen on the create-game screen: lead it from the first moment
  if (next?.nation !== undefined && !world.nationOf(ME.id)) world.claim(ME, Number(next.nation));
  setInterval(() => { if (paused !== null) return; try { world.tick(); } catch (e) { console.error('tick failed', e); } }, 1000);
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
        clock: { ...world.clock, serverNow: Date.now() }, settings: world.settings, nations: world.allPublic(), mine: mine ? world.privateView(mine) : null,
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
    if (paused !== null) { (world as unknown as { clock: object }).clock = { openedReal: Date.now(), openedGame: paused, speed: BASE_SPEED * x }; return; }
    world.setSpeed(BASE_SPEED * x);
    post({ t: 'clock', clock: { ...world.clock, serverNow: Date.now() } });
  }
  else if (d.t === 'pause' && world) {
    // the main menu stops the world; on return the clock picks up where it stopped
    if (d.on && paused === null) {
      paused = world.gameNow();
      void save();
      post({ t: 'clock', clock: { openedReal: Date.now(), openedGame: paused, speed: 0, serverNow: Date.now() } });
    } else if (!d.on && paused !== null) {
      (world as unknown as { clock: object }).clock = { openedReal: Date.now(), openedGame: paused, speed: world.clock.speed };
      paused = null;
      post({ t: 'clock', clock: { ...world.clock, serverNow: Date.now() } });
    }
  }
  else if (d.t === 'reset') void store(null).then(() => store(JSON.stringify(d.game ?? {}), 'new-game')).then(() => postMessage({ t: 'reset-done' }));
  else if (d.t === 'slots') void slots().then((list) => postMessage({ t: 'slots', list, ironman: ironman() }));
  else if (d.t === 'save-slot' && world) {
    if (ironman()) { postMessage({ t: 'slots', list: [], ironman: true, error: 'Ironman games keep a single autosave.' }); return; }
    const name = String(d.name ?? '').trim().slice(0, 40) || 'Quick save';
    void save().then(async () => {
      await store(db.dump(), `slot:${name}`);
      const mine = world.nationOf(ME.id);
      const date = new Date(world.gameNow()).toISOString().slice(0, 10);
      await store(`${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${date} · ${mine ? world.defs.get(mine.id)?.name ?? '' : 'no nation'}`, `meta:${name}`);
      postMessage({ t: 'slots', list: await slots(), ironman: false, saved: name });
    });
  }
  else if (d.t === 'load-slot') {
    if (ironman()) { postMessage({ t: 'slots', list: [], ironman: true, error: 'Ironman games cannot load other saves.' }); return; }
    void get(`slot:${d.name}`).then(async (bytes) => { if (!bytes) return; await store(bytes); postMessage({ t: 'reset-done' }); });
  }
  else if (d.t === 'delete-slot') void store(null, `slot:${d.name}`).then(() => store(null, `meta:${d.name}`)).then(async () => postMessage({ t: 'slots', list: await slots(), ironman: ironman() }));
};
