// Storage. SQLite (built into Node) keeps development free of extra services;
// the queries are plain SQL so moving to PostgreSQL later is mechanical.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type DB = DatabaseSync;

export function openDb(file: string): DB {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    pragma journal_mode = wal;
    pragma synchronous = normal;
    pragma foreign_keys = on;
    create table if not exists users (
      id integer primary key,
      name text not null unique collate nocase,
      pass text,
      guest integer not null default 0,
      created integer not null,
      last_seen integer
    );
    create table if not exists sessions (
      token text primary key,          -- sha256 of the token, never the token itself
      user_id integer not null references users(id) on delete cascade,
      expires integer not null
    );
    create table if not exists meta (key text primary key, value text not null);
    create table if not exists nations (id integer primary key, state text not null);
    create table if not exists events (
      id integer primary key, at integer not null, kind text not null, nation integer, text text not null
    );
    create table if not exists chat (
      id integer primary key, at integer not null, user_id integer, name text not null,
      nation integer, text text not null
    );
    create table if not exists seasons (number integer primary key, ended_at integer not null, standings text not null);
    create table if not exists snapshots (day integer primary key, data text not null);
  `);
  // columns added after the first release
  const cols = (db.prepare('pragma table_info(chat)').all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes('channel')) db.exec("alter table chat add column channel text not null default 'world'");
  if (!cols.includes('to_nation')) db.exec('alter table chat add column to_nation integer');
  const ucols = (db.prepare('pragma table_info(users)').all() as { name: string }[]).map((c) => c.name);
  for (const [col, def] of [['banned', 'integer not null default 0'], ['muted', 'integer not null default 0'], ['recovery', 'text'],
    ['failed', 'integer not null default 0'], ['locked_until', 'integer not null default 0']]) {
    if (!ucols.includes(col)) db.exec(`alter table users add column ${col} ${def}`);
  }
  db.exec(`create table if not exists reports (
    id integer primary key, at integer not null, reporter integer not null, target text not null, text text not null,
    reason text not null, handled integer not null default 0
  )`);
  return db;
}

export function getMeta(db: DB, key: string): string | undefined {
  const row = db.prepare('select value from meta where key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setMeta(db: DB, key: string, value: string) {
  db.prepare('insert into meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value')
    .run(key, value);
}

export function transaction<T>(db: DB, fn: () => T): T {
  db.exec('begin');
  try {
    const out = fn();
    db.exec('commit');
    return out;
  } catch (e) {
    db.exec('rollback');
    throw e;
  }
}
