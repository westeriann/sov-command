// Accounts and sessions. Passwords are scrypt-hashed with a per-user salt;
// session tokens are random and stored only as a SHA-256 hash.
import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { LIMITS } from '../../shared/protocol.ts';
import type { DB } from './db.ts';

export interface User {
  id: number;
  name: string;
  guest: boolean;
  recovery?: string; // a fresh recovery code, returned once
}

export interface UserRow { id: number; name: string; guest: boolean; created: number; banned: boolean; muted: boolean }
export interface Report { id: number; at: number; reporter: string; target: string; text: string; reason: string }

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
const LOCK_AFTER = 8; // failed logins before an account locks for a while
const LOCK_MS = 15 * 60_000;
// checked against when the name does not exist, so timing does not reveal which names do
const DUMMY_HASH = hashPassword('timing-only-not-a-password');

/** A recovery code like K7QX-2M9D-WP4R: the only way back in if the password is lost. */
function recoveryCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(12);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}
const normCode = (c: string) => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export class Accounts {
  private admins: Set<string>;

  constructor(private db: DB, admins: string[] = (process.env.ADMIN_USERS ?? '').split(',')) {
    this.admins = new Set(admins.map((a) => a.trim().toLowerCase()).filter(Boolean));
  }

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
    const recovery = recoveryCode();
    const r = this.db.prepare('insert into users (name, pass, guest, created, recovery) values (?, ?, 0, ?, ?)')
      .run(name, hashPassword(password), Date.now(), sha256(normCode(recovery)));
    return { id: Number(r.lastInsertRowid), name, guest: false, recovery };
  }

  login(name: string, password: string): User {
    const row = this.db.prepare('select id, name, pass, guest, banned, failed, locked_until from users where name = ?').get(String(name)) as
      | { id: number; name: string; pass: string | null; guest: number; banned: number; failed: number; locked_until: number }
      | undefined;
    const now = Date.now();
    if (row && row.locked_until > now) {
      checkPassword(String(password), DUMMY_HASH);
      throw new AuthError(`Too many failed attempts. Try again in ${Math.ceil((row.locked_until - now) / 60_000)} minutes.`);
    }
    const good = checkPassword(String(password), row?.pass ?? DUMMY_HASH) && !!row?.pass;
    if (!row || !good) {
      if (row) {
        const failed = row.failed + 1;
        this.db.prepare('update users set failed = ?, locked_until = ? where id = ?')
          .run(failed >= LOCK_AFTER ? 0 : failed, failed >= LOCK_AFTER ? now + LOCK_MS : 0, row.id);
      }
      throw new AuthError('Wrong name or password.');
    }
    if (row.banned) throw new AuthError('This account has been banned.');
    if (row.failed) this.db.prepare('update users set failed = 0 where id = ?').run(row.id);
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
      'select u.id, u.name, u.guest from sessions s join users u on u.id = s.user_id where s.token = ? and s.expires > ? and u.banned = 0',
    ).get(sha256(token), Date.now()) as { id: number; name: string; guest: number } | undefined;
    return row ? { id: row.id, name: row.name, guest: !!row.guest } : null;
  }

  /** Change a password: every other session is signed out. */
  changePassword(userId: number, oldPassword: string, newPassword: string) {
    const row = this.db.prepare('select pass from users where id = ?').get(userId) as { pass: string | null } | undefined;
    if (!row?.pass || !checkPassword(String(oldPassword), row.pass)) throw new AuthError('Your current password is wrong.');
    if (typeof newPassword !== 'string' || newPassword.length < LIMITS.passwordMin) throw new AuthError(`Passwords need at least ${LIMITS.passwordMin} characters.`);
    this.db.prepare('update users set pass = ? where id = ?').run(hashPassword(newPassword), userId);
    this.db.prepare('delete from sessions where user_id = ?').run(userId);
  }

  /** Lost password: the recovery code sets a new one, and a new code replaces the old. */
  recover(name: string, code: string, newPassword: string): User {
    const row = this.db.prepare('select id, name, recovery, banned from users where name = ? and guest = 0').get(String(name)) as
      | { id: number; name: string; recovery: string | null; banned: number } | undefined;
    const given = sha256(normCode(code));
    if (!row?.recovery || !timingSafeEqual(Buffer.from(given), Buffer.from(row.recovery))) throw new AuthError('That name and recovery code do not match.');
    if (row.banned) throw new AuthError('This account has been banned.');
    if (typeof newPassword !== 'string' || newPassword.length < LIMITS.passwordMin) throw new AuthError(`Passwords need at least ${LIMITS.passwordMin} characters.`);
    const recovery = recoveryCode();
    this.db.prepare('update users set pass = ?, recovery = ?, failed = 0, locked_until = 0 where id = ?')
      .run(hashPassword(newPassword), sha256(normCode(recovery)), row.id);
    this.db.prepare('delete from sessions where user_id = ?').run(row.id);
    return { id: row.id, name: row.name, guest: false, recovery };
  }

  // ---- moderation ------------------------------------------------------------------
  isAdmin(name: string) {
    return this.admins.has(name.toLowerCase());
  }

  isMuted(userId: number) {
    return !!(this.db.prepare('select muted from users where id = ?').get(userId) as { muted: number } | undefined)?.muted;
  }

  users(search = ''): UserRow[] {
    return (this.db.prepare('select id, name, guest, created, banned, muted from users where name like ? order by id desc limit 200')
      .all(`%${search.replace(/[%_]/g, '')}%`) as { id: number; name: string; guest: number; created: number; banned: number; muted: number }[])
      .map((r) => ({ ...r, guest: !!r.guest, banned: !!r.banned, muted: !!r.muted }));
  }

  userById(id: number): User | null {
    const r = this.db.prepare('select id, name, guest from users where id = ?').get(id) as { id: number; name: string; guest: number } | undefined;
    return r ? { id: r.id, name: r.name, guest: !!r.guest } : null;
  }

  setFlag(userId: number, flag: 'banned' | 'muted', on: boolean) {
    this.db.prepare(`update users set ${flag === 'banned' ? 'banned' : 'muted'} = ? where id = ?`).run(on ? 1 : 0, userId);
    if (flag === 'banned' && on) this.db.prepare('delete from sessions where user_id = ?').run(userId);
  }

  rename(userId: number, name: string) {
    if (!NAME_RE.test(name)) throw new AuthError(`Names are ${LIMITS.nameMin}–${LIMITS.nameMax} letters, digits or underscores.`);
    if (this.db.prepare('select 1 from users where name = ? and id != ?').get(name, userId)) throw new AuthError('That name is taken.');
    this.db.prepare('update users set name = ? where id = ?').run(name, userId);
  }

  report(reporter: number, target: string, text: string, reason: string) {
    this.db.prepare('insert into reports (at, reporter, target, text, reason) values (?, ?, ?, ?, ?)')
      .run(Date.now(), reporter, String(target).slice(0, 40), String(text).slice(0, 300), String(reason).slice(0, 200));
  }

  reports(): Report[] {
    return this.db.prepare(`select r.id, r.at, u.name as reporter, r.target, r.text, r.reason from reports r
      left join users u on u.id = r.reporter where r.handled = 0 order by r.id desc limit 100`).all() as unknown as Report[];
  }

  resolveReport(id: number) {
    this.db.prepare('update reports set handled = 1 where id = ?').run(id);
  }

  logout(token: string) {
    this.db.prepare('delete from sessions where token = ?').run(sha256(token));
  }

  touch(userId: number) {
    this.db.prepare('update users set last_seen = ? where id = ?').run(Date.now(), userId);
  }
}
