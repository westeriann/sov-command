// Restore the world from a backup. Stop the server first.
//
//   npm run restore                      list backups
//   npm run restore -- <backup file>     replace the live database with it
//
// The current database is kept as world.db.before-restore-<time> in case you
// need to go back.
import { copyFileSync, existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const dbFile = resolve(process.env.DB_FILE ?? 'data/world.db');
const dir = join(dirname(dbFile), 'backups');
const arg = process.argv[2];

if (!arg) {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.db')).sort() : [];
  console.log(files.length ? `Backups in ${dir} (newest last):\n${files.map((f) => `  ${f}`).join('\n')}` : `No backups in ${dir}.`);
  console.log('\nStop the server, then: npm run restore -- <file>');
  process.exit(0);
}

const src = existsSync(arg) ? resolve(arg) : join(dir, basename(arg));
if (!existsSync(src)) {
  console.error(`No such backup: ${arg}`);
  process.exit(1);
}
if (existsSync(dbFile)) {
  const keep = `${dbFile}.before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  renameSync(dbFile, keep);
  console.log(`Current database kept as ${keep}`);
}
for (const ext of ['-wal', '-shm']) rmSync(dbFile + ext, { force: true }); // stale write-ahead files belong to the old database
copyFileSync(src, dbFile);
console.log(`Restored ${src} -> ${dbFile}. Start the server again.`);
