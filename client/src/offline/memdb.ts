// A tiny in-memory stand-in for the server's SQLite, for the single-player
// build. The world code only ever runs a handful of fixed queries; each one is
// answered here directly, and the whole store saves as one JSON document.
import type { DB } from '../../../server/src/schema';

interface Tables {
  meta: Record<string, string>;
  nations: Record<string, string>;
  events: { id: number; at: number; kind: string; nation: number | null; text: string }[];
  chat: { id: number; at: number; user_id: number | null; name: string; nation: number | null; text: string; channel: string; to_nation: number | null }[];
  seasons: Record<string, { ended_at: number; standings: string }>;
  snapshots: Record<string, string>;
  achievements: Record<string, number>; // "user:key" -> at
  nextId: number;
}

const KEEP_EVENTS = 4000;
const KEEP_CHAT = 500;
const norm = (sql: string) => sql.replace(/\s+/g, ' ').trim().toLowerCase();

export class MemoryDB implements DB {
  private t: Tables;

  constructor(saved?: string) {
    const blank: Tables = { meta: {}, nations: {}, events: [], chat: [], seasons: {}, snapshots: {}, achievements: {}, nextId: 1 };
    this.t = saved ? { ...blank, ...JSON.parse(saved) } : blank;
  }

  /** Everything, for saving. */
  dump() { return JSON.stringify(this.t); }

  exec(_sql: string) { /* schema, migrations and transactions need nothing in memory */ }
  close() {}

  prepare(sql: string) {
    const q = norm(sql), t = this.t;
    const done = (changes = 1, id = 0) => ({ changes, lastInsertRowid: id });
    const fail = () => { throw new Error(`Single-player build: unsupported query: ${q}`); };
    const desc = <T extends { id: number }>(rows: T[], n: number) => rows.slice(-n).reverse();
    return {
      run: (...p: unknown[]) => {
        if (q.startsWith('insert into meta')) { t.meta[String(p[0])] = String(p[1]); return done(); }
        if (q.startsWith('insert into nations')) { t.nations[String(p[0])] = String(p[1]); return done(); }
        if (q.startsWith('insert into events')) {
          const id = t.nextId++;
          t.events.push({ id, at: Number(p[0]), kind: String(p[1]), nation: (p[2] as number) ?? null, text: String(p[3]) });
          if (t.events.length > KEEP_EVENTS * 1.2) t.events.splice(0, t.events.length - KEEP_EVENTS);
          return done(1, id);
        }
        if (q.startsWith('insert into chat')) {
          const id = t.nextId++;
          t.chat.push({ id, at: Number(p[0]), user_id: (p[1] as number) ?? null, name: String(p[2]), nation: (p[3] as number) ?? null, text: String(p[4]), channel: String(p[5] ?? 'world'), to_nation: (p[6] as number) ?? null });
          if (t.chat.length > KEEP_CHAT * 1.2) t.chat.splice(0, t.chat.length - KEEP_CHAT);
          return done(1, id);
        }
        if (q.startsWith('insert or replace into seasons')) { t.seasons[String(p[0])] = { ended_at: Number(p[1]), standings: String(p[2]) }; return done(); }
        if (q.startsWith('insert or replace into snapshots')) { t.snapshots[String(p[0])] = String(p[1]); return done(); }
        if (q.startsWith('insert or ignore into achievements')) {
          const k = `${p[0]}:${p[1]}`;
          if (t.achievements[k]) return done(0);
          t.achievements[k] = Number(p[2]);
          return done();
        }
        return fail();
      },
      get: (...p: unknown[]) => {
        if (q.startsWith('select value from meta')) { const v = t.meta[String(p[0])]; return v === undefined ? undefined : { value: v }; }
        return fail();
      },
      all: (...p: unknown[]) => {
        if (q.startsWith('pragma table_info')) return [];
        if (q === 'select state from nations') return Object.values(t.nations).map((state) => ({ state }));
        if (q.startsWith('select at, kind, nation, text from events')) return desc(t.events, 60);
        if (q.startsWith('select at, kind, text from events where nation')) {
          const needle = String(p[1]).replace(/%/g, '');
          return desc(t.events.filter((e) => e.nation === p[0] || e.text.includes(needle)), 80);
        }
        if (q.startsWith('select at, name, nation, text from chat')) return desc(t.chat, 60);
        if (q.startsWith('select number, ended_at, standings from seasons')) {
          return Object.entries(t.seasons).map(([n, s]) => ({ number: Number(n), ...s })).sort((a, b) => b.number - a.number).slice(0, 10);
        }
        if (q.startsWith('select day, data from snapshots')) {
          return Object.entries(t.snapshots).map(([d, data]) => ({ day: Number(d), data })).sort((a, b) => b.day - a.day).slice(0, 520);
        }
        if (q.startsWith('select key from achievements')) {
          return Object.keys(t.achievements).filter((k) => k.startsWith(`${p[0]}:`)).map((k) => ({ key: k.split(':')[1] }));
        }
        return fail();
      },
    };
  }
}
