/* PostgreSQL 16 for the server edition (ADR-31/32). `pg` is loaded only here, only when a PostgreSQL URL is used. */
import { Kysely, PostgresDialect } from 'kysely';
import { createRequire } from 'node:module';
import type { Ctx, DB } from '@fuelpro/core';
import { systemClock, type Clock } from '@fuelpro/core';
import { migrate } from './migrate.ts';

const require = createRequire(import.meta.url);
/** BIGINT and SUM() results arrive as text; the core works in safe JS integers and refuses anything larger. */
function safeInt(v: string): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error('Integer outside the safe range: ' + v);
  return n;
}
export async function openPostgres(url: string, opts: { clock?: Clock; migrate?: boolean; max?: number } = {}): Promise<Ctx & { close(): Promise<void> }> {
  const pg = require('pg') as typeof import('pg');
  pg.types.setTypeParser(20, safeInt);      // int8
  pg.types.setTypeParser(1700, safeInt);    // numeric (SUM of bigint) — the ledger only ever sums integers
  const pool = new pg.Pool({ connectionString: url, max: opts.max ?? 20 });
  pool.on('error', (e) => { console.error('[db] idle PostgreSQL connection lost:', e.message); });   // the pool replaces it; never crash the server
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  if (opts.migrate !== false) await migrate(db, 'postgres');
  return { db, dialect: 'postgres', clock: opts.clock || systemClock, close: () => db.destroy() };
}
