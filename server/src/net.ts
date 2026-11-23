// WebSocket hub: authenticates connections, rate-limits them, turns client
// messages into world calls, and fans world changes out to clients.
import type { IncomingMessage, Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type {
  ClockInfo, ChatLine, ClientMsg, EconomyUpdate, ErrorCode, NationPrivate, NationPublic, ServerMsg, WarState, WorldEvent,
} from '../../shared/protocol.ts';
import type { UnitView } from '../../shared/military.ts';
import type { Accounts, User } from './auth.ts';
import type { World, WorldListener } from './world.ts';

interface Conn {
  user: User | null;
  tokens: number; // rate-limit bucket
  last: number;
  lastChat: number;
  alive: boolean;
}

const BUCKET = 20; // burst
const REFILL_PER_SEC = 6;
const CHAT_GAP_MS = 1200;
const HELLO_TIMEOUT_MS = 5000;

export class Hub implements WorldListener {
  private wss: WebSocketServer;
  private conns = new Map<WebSocket, Conn>();
  private byUser = new Map<number, Set<WebSocket>>();
  private closing = false;

  constructor(server: Server, private world: World, private accounts: Accounts, private allowedOrigins: string[]) {
    this.wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
    this.wss.on('connection', (ws, req) => this.onConnection(ws, req));
    world.listener = this;
    setInterval(() => this.heartbeat(), 30_000).unref();
  }

  get onlineCount() {
    return this.byUser.size;
  }

  // ---- world -> clients --------------------------------------------------------
  nation(n: NationPublic) {
    this.broadcast({ t: 'nation', nation: n });
  }

  mine(userId: number, n: NationPrivate | null) {
    this.toUser(userId, { t: 'mine', nation: n });
    const conns = this.byUser.get(userId);
    const user = conns && [...conns].map((c) => this.conns.get(c)?.user).find(Boolean);
    if (user) this.toUser(userId, { t: 'you', you: { ...user, nation: n ? n.id : null } });
  }

  event(e: WorldEvent) {
    this.broadcast({ t: 'event', event: e });
  }

  chat(line: ChatLine) {
    if (!line.channel || line.channel === 'world') return this.broadcast({ t: 'chat', line });
    for (const u of this.world.audience(line)) this.toUser(u, { t: 'chat', line });
  }

  units(userId: number, units: UnitView[]) {
    this.toUser(userId, { t: 'units', units });
  }

  clock(c: ClockInfo) {
    this.broadcast({ t: 'clock', clock: c });
  }

  war(state: WarState) {
    this.broadcast({ t: 'war', war: state });
  }

  economy(update: EconomyUpdate) {
    this.broadcast({ t: 'economy', economy: update });
  }

  // ---- connections -----------------------------------------------------------------
  private onConnection(ws: WebSocket, req: IncomingMessage) {
    const origin = req.headers.origin;
    if (this.allowedOrigins.length && (!origin || !this.allowedOrigins.includes(origin))) {
      ws.close(1008, 'origin not allowed');
      return;
    }
    const conn: Conn = { user: null, tokens: BUCKET, last: Date.now(), lastChat: 0, alive: true };
    this.conns.set(ws, conn);
    const timer = setTimeout(() => { if (!conn.user) ws.close(4001, 'no hello'); }, HELLO_TIMEOUT_MS);
    ws.on('pong', () => { conn.alive = true; });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      if (!this.allow(conn)) return this.error(ws, 'rate_limited', 'Too many messages. Slow down.');
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return this.error(ws, 'bad_request', 'Messages must be JSON.');
      }
      this.onMessage(ws, conn, msg);
    });
    ws.on('close', () => {
      clearTimeout(timer);
      this.conns.delete(ws);
      if (!conn.user || this.closing) return;
      const set = this.byUser.get(conn.user.id);
      set?.delete(ws);
      if (set && set.size === 0) {
        this.byUser.delete(conn.user.id);
        this.world.setPresence(conn.user.id, false);
        this.accounts.touch(conn.user.id);
        this.broadcast({ t: 'online', count: this.onlineCount });
      }
    });
  }

  private onMessage(ws: WebSocket, conn: Conn, msg: ClientMsg) {
    if (!msg || typeof msg !== 'object') return;
    if (!conn.user) {
      if (msg.t !== 'hello') return this.error(ws, 'auth', 'Say hello first.');
      const user = this.accounts.userForToken(msg.token);
      if (!user) {
        this.error(ws, 'auth', 'Your session has expired. Log in again.');
        ws.close(4003, 'auth');
        return;
      }
      conn.user = user;
      let set = this.byUser.get(user.id);
      const first = !set;
      if (!set) this.byUser.set(user.id, (set = new Set()));
      set.add(ws);
      if (first) this.world.setPresence(user.id, true);
      const mine = this.world.nationOf(user.id);
      const { events, chat } = this.world.recent(user.id);
      this.send(ws, {
        t: 'welcome',
        you: { ...user, nation: mine?.id ?? null, admin: this.accounts.isAdmin(user.name) || undefined, achievements: this.accounts.achievements(user.id) as never },
        clock: { ...this.world.clock, serverNow: Date.now() },
        nations: this.world.allPublic(),
        mine: mine ? this.world.privateView(mine) : null,
        events, chat,
        online: this.onlineCount,
        economy: this.world.economyUpdate(),
        war: this.world.warState(),
        units: this.world.unitsFor(user.id),
      });
      if (first) this.broadcast({ t: 'online', count: this.onlineCount });
      return;
    }
    const user = conn.user;
    switch (msg.t) {
      case 'ping':
        return this.send(ws, { t: 'pong', at: Number(msg.at) || 0, serverNow: Date.now() });
      case 'claim':
        return this.reply(ws, this.world.claim(user, Number(msg.nation)));
      case 'found':
        return this.reply(ws, this.world.found(user, Number(msg.province)));
      case 'release':
        return this.reply(ws, this.world.release(user.id));
      case 'order': {
        const n = this.world.nationOf(user.id);
        if (!n) return this.error(ws, 'not_ruling', 'Claim a nation first.');
        return this.reply(ws, this.world.submit(n.id, msg.order, 'human'));
      }
      case 'chat': {
        const now = Date.now();
        if (now - conn.lastChat < CHAT_GAP_MS) return this.error(ws, 'rate_limited', 'Wait a moment before sending again.');
        if (this.accounts.isMuted(user.id)) return this.error(ws, 'not_allowed', 'A moderator has muted you.');
        conn.lastChat = now;
        return this.reply(ws, this.world.chat(user, msg.text, msg.channel, msg.to));
      }
      default:
        return this.error(ws, 'bad_request', 'Unknown message.');
    }
  }

  private allow(conn: Conn) {
    const now = Date.now();
    conn.tokens = Math.min(BUCKET, conn.tokens + ((now - conn.last) / 1000) * REFILL_PER_SEC);
    conn.last = now;
    if (conn.tokens < 1) return false;
    conn.tokens -= 1;
    return true;
  }

  private heartbeat() {
    for (const [ws, conn] of this.conns) {
      if (!conn.alive) {
        ws.terminate();
        continue;
      }
      conn.alive = false;
      ws.ping();
    }
  }

  private reply(ws: WebSocket, r: { ok: true } | { ok: false; code: ErrorCode; message: string }) {
    if (!r.ok) this.error(ws, r.code, r.message);
  }

  private error(ws: WebSocket, code: ErrorCode, message: string) {
    this.send(ws, { t: 'error', code, message });
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  /** Disconnect every session of a user (banned, renamed, password changed). */
  kick(userId: number, reason: string) {
    for (const ws of this.byUser.get(userId) ?? []) {
      this.error(ws, 'auth', reason);
      ws.close(4003, 'auth');
    }
  }

  private toUser(userId: number, msg: ServerMsg) {
    const set = this.byUser.get(userId);
    if (!set) return;
    const data = JSON.stringify(msg);
    for (const ws of set) if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }

  private broadcast(msg: ServerMsg) {
    const data = JSON.stringify(msg);
    for (const [ws, conn] of this.conns) {
      if (conn.user && ws.readyState === WebSocket.OPEN) ws.send(data);
    }
  }

  close() {
    this.closing = true;
    for (const ws of this.conns.keys()) ws.terminate();
    this.wss.close();
  }
}
