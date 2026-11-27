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
  return {
    close: () => raw.close(),
    prepare(sqlText: string): SqliteStatement {
      const st = raw.prepare(sqlText);
      const reader = st.columns().length > 0;
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
  return { db, dialect: 'sqlite', clock: opts.clock || systemClock, close: () => db.destroy() };
}
