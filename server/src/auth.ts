// Accounts and sessions. Passwords are scrypt-hashed with a per-user salt;
// session tokens are random and stored only as a SHA-256 hash.
import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { LIMITS } from '../../shared/protocol.ts';
import type { DB } from './db.ts';

export interface User {
  id: number;
  name: string;
  guest: boolean;
}

const SESSION_DAYS = 30;
const NAME_RE = new RegExp(`^[A-Za-z0-9_]{${LIMITS.nameMin},${LIMITS.nameMax}}$`);

export class AuthError extends Error {}

function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

function checkPassword(password: string, stored: string) {
  const [scheme, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(key, expected);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export class Accounts {
  constructor(private db: DB) {}

  register(name: string, password: string): User {
    if (typeof name !== 'string' || !NAME_RE.test(name)) {
      throw new AuthError(`Names are ${LIMITS.nameMin}–${LIMITS.nameMax} letters, digits or underscores.`);
    }
    if (typeof password !== 'string' || password.length < LIMITS.passwordMin) {
      throw new AuthError(`Passwords need at least ${LIMITS.passwordMin} characters.`);
    }
    if (/^guest\d+$/i.test(name)) throw new AuthError('Names starting with "Guest" are reserved.');
    const taken = this.db.prepare('select 1 from users where name = ?').get(name);
    if (taken) throw new AuthError('That name is taken.');
    const r = this.db.prepare('insert into users (name, pass, guest, created) values (?, ?, 0, ?)')
      .run(name, hashPassword(password), Date.now());
    return { id: Number(r.lastInsertRowid), name, guest: false };
  }

  login(name: string, password: string): User {
    const row = this.db.prepare('select id, name, pass, guest from users where name = ?').get(String(name)) as
      | { id: number; name: string; pass: string | null; guest: number }
      | undefined;
    if (!row || !row.pass || !checkPassword(String(password), row.pass)) {
      throw new AuthError('Wrong name or password.');
    }
    return { id: row.id, name: row.name, guest: !!row.guest };
  }

  guest(): User {
    for (let i = 0; i < 20; i++) {
      const name = `Guest${randomInt(1000, 99999)}`;
      if (this.db.prepare('select 1 from users where name = ?').get(name)) continue;
      const r = this.db.prepare('insert into users (name, pass, guest, created) values (?, null, 1, ?)')
        .run(name, Date.now());
      return { id: Number(r.lastInsertRowid), name, guest: true };
    }
    throw new AuthError('Could not create a guest account. Try again.');
  }

  createSession(userId: number): string {
    const token = randomBytes(32).toString('base64url');
    this.db.prepare('insert into sessions (token, user_id, expires) values (?, ?, ?)')
      .run(sha256(token), userId, Date.now() + SESSION_DAYS * 86_400_000);
    return token;
  }

  userForToken(token: unknown): User | null {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    const row = this.db.prepare(
      'select u.id, u.name, u.guest from sessions s join users u on u.id = s.user_id where s.token = ? and s.expires > ?',
    ).get(sha256(token), Date.now()) as { id: number; name: string; guest: number } | undefined;
    return row ? { id: row.id, name: row.name, guest: !!row.guest } : null;
  }

  logout(token: string) {
    this.db.prepare('delete from sessions where token = ?').run(sha256(token));
  }

  touch(userId: number) {
    this.db.prepare('update users set last_seen = ? where id = ?').run(Date.now(), userId);
  }
}
