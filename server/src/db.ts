// Storage. SQLite (built into Node) keeps development free of extra services;
// the queries are plain SQL so moving to PostgreSQL later is mechanical.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type { DB } from './schema.ts';
export { getMeta, setMeta, transaction } from './schema.ts';
import { migrate, type DB } from './schema.ts';

export function openDb(file: string): DB {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('pragma journal_mode = wal; pragma synchronous = normal;');
  migrate(db as unknown as DB);
  return db as unknown as DB;
}
