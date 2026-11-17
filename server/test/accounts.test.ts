import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { Accounts } from '../src/auth.ts';
import { openDb } from '../src/db.ts';
import { backupDb } from '../src/index.ts';

test('recovery codes reset a lost password, once', () => {
  const a = new Accounts(openDb(':memory:'), []);
  const u = a.register('Commander', 'first-password');
  assert.match(u.recovery!, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.throws(() => a.recover('Commander', 'AAAA-BBBB-CCCC', 'new-password-1'), /do not match/);
  const back = a.recover('Commander', u.recovery!.toLowerCase(), 'new-password-1');
  assert.ok(back.recovery && back.recovery !== u.recovery, 'a fresh code replaces the used one');
  assert.throws(() => a.recover('Commander', u.recovery!, 'another-pass'), /do not match/, 'the old code no longer works');
  assert.equal(a.login('Commander', 'new-password-1').id, u.id);
});

test('repeated wrong passwords lock the account for a while', () => {
  const a = new Accounts(openDb(':memory:'), []);
  a.register('Target', 'right-password');
  for (let i = 0; i < 8; i++) assert.throws(() => a.login('Target', 'guess' + i), /Wrong name or password/);
  assert.throws(() => a.login('Target', 'right-password'), /Too many failed attempts/, 'even the right password waits');
  assert.throws(() => a.login('Nobody', 'x'), /Wrong name or password/, 'unknown names fail the same way');
});

test('changing a password signs out every session', () => {
  const a = new Accounts(openDb(':memory:'), []);
  const u = a.register('Mover', 'old-password');
  const token = a.createSession(u.id);
  assert.throws(() => a.changePassword(u.id, 'wrong', 'new-password'), /current password is wrong/);
  a.changePassword(u.id, 'old-password', 'new-password');
  assert.equal(a.userForToken(token), null);
  assert.equal(a.login('Mover', 'new-password').id, u.id);
});

test('moderation: admins, bans, mutes, renames and reports', () => {
  const a = new Accounts(openDb(':memory:'), ['Boss']);
  const boss = a.register('Boss', 'boss-password');
  const troll = a.register('Troll', 'troll-password');
  assert.equal(a.isAdmin('boss'), true);
  assert.equal(a.isAdmin('Troll'), false);
  const token = a.createSession(troll.id);
  a.report(boss.id, 'Troll', 'rude words', 'abuse');
  assert.equal(a.reports()[0].target, 'Troll');
  a.setFlag(troll.id, 'muted', true);
  assert.equal(a.isMuted(troll.id), true);
  a.setFlag(troll.id, 'banned', true);
  assert.equal(a.userForToken(token), null, 'banned: sessions end');
  assert.throws(() => a.login('Troll', 'troll-password'), /banned/);
  a.setFlag(troll.id, 'banned', false);
  a.rename(troll.id, 'Reformed');
  assert.equal(a.login('Reformed', 'troll-password').id, troll.id);
  a.resolveReport(a.reports()[0].id);
  assert.equal(a.reports().length, 0);
});

test('backups are complete copies and old ones are pruned', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sov-backup-'));
  const file = join(dir, 'world.db');
  const db = openDb(file);
  new Accounts(db, []).register('Saved', 'saved-password');
  let last: string | null = null;
  for (let i = 0; i < 4; i++) last = backupDb(db, file, 2);
  const copy = new DatabaseSync(last!);
  assert.equal((copy.prepare('select name from users').get() as { name: string }).name, 'Saved');
  copy.close();
  assert.equal(readdirSync(join(dir, 'backups')).length, 2, 'only the newest two are kept');
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
