// End to end: a real server on a random port, two players over WebSockets.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { WebSocket } from 'ws';
import type { AuthResponse, ServerMsg } from '../../shared/protocol.ts';
import { start } from '../src/index.ts';

const dir = mkdtempSync(join(tmpdir(), 'sc-test-'));
let app: ReturnType<typeof start>;
let base = '';

before(async () => {
  app = start({
    port: 0, worldDir: resolve('../client/public/world'), dbFile: join(dir, 'w.db'), speed: 24,
    aiBudgetPerTick: 25, autopilotAfterMs: 3_600_000, releaseAfterMs: 86_400_000, seasonMs: 28 * 86_400_000, allowedOrigins: [], backupHours: 0, backupKeep: 3, staticDir: '',
  });
  base = `http://127.0.0.1:${await app.ready}`;
});
after(async () => {
  await app.stop();
  rmSync(dir, { recursive: true, force: true });
});

async function post(path: string, body: unknown) {
  const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}

class Client {
  ws: WebSocket;
  inbox: ServerMsg[] = [];
  private waiters: [(m: ServerMsg) => boolean, (m: ServerMsg) => void][] = [];
  constructor(token: string) {
    this.ws = new WebSocket(base.replace('http', 'ws') + '/ws');
    this.ws.on('open', () => this.ws.send(JSON.stringify({ t: 'hello', token })));
    this.ws.on('message', (d) => {
      const m = JSON.parse(String(d)) as ServerMsg;
      this.inbox.push(m);
      this.waiters = this.waiters.filter(([pred, res]) => (pred(m) ? (res(m), false) : true));
    });
  }
  send(m: unknown) { this.ws.send(JSON.stringify(m)); }
  next<T extends ServerMsg['t']>(t: T, pred: (m: Extract<ServerMsg, { t: T }>) => boolean = () => true) {
    const found = this.inbox.find((m) => m.t === t && pred(m as never));
    if (found) {
      this.inbox.splice(this.inbox.indexOf(found), 1);
      return Promise.resolve(found as Extract<ServerMsg, { t: T }>);
    }
    return new Promise<Extract<ServerMsg, { t: T }>>((res, rej) => {
      const timer = setTimeout(() => rej(new Error(`timed out waiting for ${t}`)), 4000);
      this.waiters.push([(m) => m.t === t && pred(m as never), (m) => { clearTimeout(timer); res(m as never); }]);
    });
  }
  close() { this.ws.close(); }
}

test('accounts: register, reject duplicates and bad passwords, log in, guest', async () => {
  const r = await post('/api/register', { name: 'commander', password: 'correct horse' });
  assert.equal(r.status, 200);
  assert.ok((r.body as AuthResponse).token);
  assert.equal((await post('/api/register', { name: 'Commander', password: 'whatever123' })).status, 400);
  assert.equal((await post('/api/register', { name: 'shorty', password: 'short' })).status, 400);
  assert.equal((await post('/api/login', { name: 'commander', password: 'wrong password' })).status, 400);
  assert.equal((await post('/api/login', { name: 'commander', password: 'correct horse' })).status, 200);
  const g = await post('/api/guest', {});
  assert.match((g.body as AuthResponse).you.name, /^Guest\d+$/);
});

test('two players: claim, see each other, chat, and get told off for taking a claimed nation', async () => {
  const a = (await post('/api/register', { name: 'alice', password: 'alice-password' })).body as AuthResponse;
  const b = (await post('/api/register', { name: 'bob', password: 'bob-password' })).body as AuthResponse;
  const ca = new Client(a.token);
  const cb = new Client(b.token);
  const wa = await ca.next('welcome');
  await cb.next('welcome');
  assert.ok(wa.nations.length > 100, 'the full nation list arrives');
  assert.ok(wa.nations.every((n) => n.controller === 'ai'));
  assert.ok(wa.clock.speed > 0);

  const target = wa.nations[0].id;
  ca.send({ t: 'claim', nation: target });
  const mine = await ca.next('mine', (m) => m.nation !== null);
  assert.equal(mine.nation!.id, target);
  assert.equal(typeof mine.nation!.tax, 'number', 'owner sees private tax');
  const seenByBob = await cb.next('nation', (m) => m.nation.id === target && m.nation.controller === 'human');
  assert.equal(seenByBob.nation.player, 'alice');
  assert.equal((seenByBob.nation as { tax?: number }).tax, undefined, 'others do not see private data');

  cb.send({ t: 'claim', nation: target });
  const err = await cb.next('error');
  assert.equal(err.code, 'taken');

  ca.send({ t: 'order', order: { kind: 'policy', policy: { focus: 'research', tax: 30 } } });
  await cb.next('nation', (m) => m.nation.id === target && m.nation.focus === 'research');

  cb.send({ t: 'chat', text: 'hello <b>neighbour</b>' });
  const line = await ca.next('chat');
  assert.equal(line.line.from, 'bob');
  assert.equal(line.line.text, 'hello <b>neighbour</b>', 'stored as plain text; the client escapes it');

  ca.close();
  cb.close();
});

test('bad tokens are rejected and floods are rate limited', async () => {
  const bad = new Client('not-a-real-token-but-long-enough');
  const e = await bad.next('error');
  assert.equal(e.code, 'auth');

  const g = (await post('/api/guest', {})).body as AuthResponse;
  const c = new Client(g.token);
  await c.next('welcome');
  for (let i = 0; i < 40; i++) c.send({ t: 'ping', at: i });
  const limited = await c.next('error', (m) => m.code === 'rate_limited');
  assert.ok(limited);
  c.close();
});
