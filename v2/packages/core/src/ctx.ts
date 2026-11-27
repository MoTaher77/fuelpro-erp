/* The core's only view of the outside world. Each run mode builds one Ctx:
   server = PostgreSQL (or SQLite during the transition), desktop = SQLite file via Tauri, phone = SQLite via Capacitor.
   Nothing in the core imports node:*, the DOM or a driver. */
import type { Kysely, Transaction } from 'kysely';
import type { DB } from './schema.ts';

export type Dialect = 'sqlite' | 'postgres';
export type Q = Kysely<DB> | Transaction<DB>;
export interface Clock { now(): string; today(tz: string): string }
export interface Ctx { db: Kysely<DB>; dialect: Dialect; clock: Clock }
/** The signed-in user as the core needs it. Authentication itself is a run-mode concern (ADR-37). */
export interface User { id: number; org_id: number; role: string }

/** UTC "YYYY-MM-DD HH:MM:SS", the same text SQLite's datetime('now') writes in v1. */
export const systemClock: Clock = {
  now: () => new Date().toISOString().replace('T', ' ').slice(0, 19),
  today: (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
};
export const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const validTz = (tz: string) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };

/** One business operation = one transaction (document + stock move + journal + audit). Reuses an outer transaction. */
export async function tx<T>(ctx: Ctx, fn: (q: Transaction<DB>) => Promise<T>): Promise<T> {
  return ctx.db.transaction().execute(fn);
}
/** Row lock for read-modify-write on PostgreSQL (pumps, tanks, shifts). SQLite already serialises writers. */
export function lock<QB extends { forUpdate(): QB }>(ctx: Ctx, qb: QB): QB { return ctx.dialect === 'postgres' ? qb.forUpdate() : qb; }
