// HTTP API: accounts and a public world summary. Game traffic uses /ws.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthResponse } from '../../shared/protocol.ts';
import { AuthError, type Accounts, type User } from './auth.ts';
import type { World } from './world.ts';

const MAX_BODY = 8 * 1024;
const AUTH_PER_MINUTE = 12;

function json(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(data);
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new AuthError('Request too large.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const v = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
        resolve(v && typeof v === 'object' ? v : {});
      } catch {
        reject(new AuthError('Body must be JSON.'));
      }
    });
    req.on('error', reject);
  });
}

export function apiHandler(accounts: Accounts, world: World, onlineCount: () => number) {
  const hits = new Map<string, { n: number; reset: number }>();
  const limited = (ip: string) => {
    const now = Date.now();
    const h = hits.get(ip);
    if (!h || h.reset < now) {
      hits.set(ip, { n: 1, reset: now + 60_000 });
      return false;
    }
    return ++h.n > AUTH_PER_MINUTE;
  };
  setInterval(() => {
    const now = Date.now();
    for (const [ip, h] of hits) if (h.reset < now) hits.delete(ip);
  }, 60_000).unref();

  const session = (user: User): AuthResponse => ({
    token: accounts.createSession(user.id),
    you: { ...user, nation: world.nationOf(user.id)?.id ?? null },
  });

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/api/world') {
        res.setHeader('access-control-allow-origin', '*'); // the lobby on other worlds' sites reads this
        return json(res, 200, {
          name: process.env.WORLD_NAME ?? 'Earth Prime',
          clock: { ...world.clock, serverNow: Date.now() },
          nations: world.nations.size,
          players: world.humanCount(),
          online: onlineCount(),
          season: { number: world.season.number, endsAt: world.season.endsAt },
          day: world.market.day,
        });
      }
      if (req.method === 'GET' && url.pathname === '/api/history') {
        return json(res, 200, { events: world.history(Number(url.searchParams.get('nation'))) });
      }
      if (req.method === 'GET' && url.pathname === '/api/replay') {
        return json(res, 200, { frames: world.replay() });
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        const ip = req.socket.remoteAddress ?? '?';
        const route = url.pathname.slice(5);
        if (['register', 'login', 'guest'].includes(route) && limited(ip)) {
          return json(res, 429, { error: 'Too many attempts. Try again in a minute.' });
        }
        const body = await readBody(req);
        if (route === 'register') return json(res, 200, session(accounts.register(String(body.name ?? ''), String(body.password ?? ''))));
        if (route === 'login') return json(res, 200, session(accounts.login(String(body.name ?? ''), String(body.password ?? ''))));
        if (route === 'guest') return json(res, 200, session(accounts.guest()));
        if (route === 'logout') {
          const token = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
          if (token) accounts.logout(token);
          return json(res, 200, { ok: true });
        }
      }
      return json(res, 404, { error: 'Not found.' });
    } catch (e) {
      if (e instanceof AuthError) return json(res, 400, { error: e.message });
      console.error(e);
      return json(res, 500, { error: 'Server error.' });
    }
  };
}
