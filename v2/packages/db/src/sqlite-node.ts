/* SQLite through Node's built-in node:sqlite (no native add-on to install). Used by the server during the
   transition, by tests, and as the reference engine for the local editions. */
import { Kysely, SqliteDialect, type SqliteDatabase, type SqliteStatement } from 'kysely';
import type { DatabaseSync as DatabaseSyncT, SQLInputValue } from 'node:sqlite';
import { createRequire } from 'node:module';
import type { Ctx, DB } from '@fuelpro/core';
import { systemClock, type Clock } from '@fuelpro/core';
import { migrate } from './migrate.ts';

const require = createRequire(import.meta.url);

export function wrapNodeSqlite(raw: DatabaseSyncT): SqliteDatabase {
  /* prepared statements are kept and reused (the core sends the same few hundred SQL texts over and over):
     preparing a joined report query costs about as much as running it. Bounded, oldest dropped first. */
  const cache = new Map<string, { st: ReturnType<DatabaseSyncT['prepare']>; reader: boolean }>();
  const get = (sqlText: string) => {
    let c = cache.get(sqlText);
    if (c) { cache.delete(sqlText); cache.set(sqlText, c); return c; }
    const st = raw.prepare(sqlText);
    c = { st, reader: st.columns().length > 0 };
    cache.set(sqlText, c);
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return c;
  };
  return {
    close: () => { cache.clear(); raw.close(); },
    prepare(sqlText: string): SqliteStatement {
      const { st, reader } = get(sqlText);
      const args = (p: ReadonlyArray<unknown>) => p as SQLInputValue[];
      return {
        reader,
        all: (p) => st.all(...args(p)),
        run: (p) => { const r = st.run(...args(p)); return { changes: r.changes, lastInsertRowid: r.lastInsertRowid }; },
        iterate: (p) => st.iterate(...args(p)) as IterableIterator<unknown>
      };
    }
  };
}
export async function openSqlite(file: string, opts: { clock?: Clock; migrate?: boolean } = {}): Promise<Ctx & { close(): Promise<void> }> {
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  if (file !== ':memory:') raw.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
  const db = new Kysely<DB>({ dialect: new SqliteDialect({ database: wrapNodeSqlite(raw) }) });
  if (opts.migrate !== false) await migrate(db, 'sqlite');
  // keep the planner's statistics fresh as the books grow (as v1 openDb does): without them SQLite may scan a whole
  // account's lines instead of using the station/date index — the cash ledger took 13.9 ms instead of 7.7
  try { raw.exec('PRAGMA optimize=0x10002'); } catch { /* statistics are an optimisation only */ }
  return { db, dialect: 'sqlite', clock: opts.clock || systemClock, close: () => db.destroy() };
}
