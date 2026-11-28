/* Kysely dialect for SQLite engines reached asynchronously: the Tauri desktop bridge (Rust + rusqlite) and the
   Capacitor phone plugin. One connection, one statement at a time (a mutex), so BEGIN…COMMIT always runs on the
   same connection — the local editions keep "one operation = one transaction" exactly like the server. */
import {
  Kysely, SqliteAdapter, SqliteIntrospector, SqliteQueryCompiler, CompiledQuery,
  type DatabaseConnection, type Dialect, type Driver, type QueryResult, type DatabaseIntrospector, type DialectAdapter, type QueryCompiler
} from 'kysely';
import type { Clock, Ctx, DB } from '@fuelpro/core';
import { systemClock } from '@fuelpro/core';
import { migrate } from './migrate.ts';

export interface SqliteBridge {
  /** Run one statement. `reader` = the statement returns rows (SELECT, or INSERT/UPDATE … RETURNING). */
  exec(sql: string, params: unknown[], reader: boolean): Promise<{ rows: Record<string, unknown>[]; changes: number; lastId: number }>;
  close?(): Promise<void>;
}
const isReader = (s: string) => /^\s*(select|with|pragma)\b/i.test(s) || /\breturning\b/i.test(s);

class Mutex {
  #p: Promise<void> = Promise.resolve();
  lock(): Promise<() => void> { let rel!: () => void; const next = new Promise<void>((r) => { rel = r; }); const prev = this.#p; this.#p = prev.then(() => next); return prev.then(() => rel); }
}
class BridgeConnection implements DatabaseConnection {
  bridge: SqliteBridge;
  constructor(b: SqliteBridge) { this.bridge = b; }
  async executeQuery<R>(q: CompiledQuery): Promise<QueryResult<R>> {
    const params = q.parameters.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v));
    const r = await this.bridge.exec(q.sql, params, isReader(q.sql));
    return { rows: r.rows as R[], numAffectedRows: BigInt(r.changes || 0), insertId: r.lastId ? BigInt(r.lastId) : undefined };
  }
  // eslint-disable-next-line require-yield
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> { throw new Error('streaming is not used by the core'); }
}
class BridgeDriver implements Driver {
  conn: BridgeConnection; mutex = new Mutex(); release: (() => void) | null = null;
  constructor(b: SqliteBridge) { this.conn = new BridgeConnection(b); }
  async init() { await this.conn.bridge.exec('PRAGMA foreign_keys = ON', [], false); }
  async acquireConnection() { this.release = await this.mutex.lock(); return this.conn; }
  async beginTransaction(c: DatabaseConnection) { await c.executeQuery(CompiledQuery.raw('begin immediate')); }
  async commitTransaction(c: DatabaseConnection) { await c.executeQuery(CompiledQuery.raw('commit')); }
  async rollbackTransaction(c: DatabaseConnection) { await c.executeQuery(CompiledQuery.raw('rollback')); }
  async releaseConnection() { const r = this.release; this.release = null; r?.(); }
  async destroy() { await this.conn.bridge.close?.(); }
}
export class BridgeDialect implements Dialect {
  bridge: SqliteBridge;
  constructor(b: SqliteBridge) { this.bridge = b; }
  createDriver(): Driver { return new BridgeDriver(this.bridge); }
  createQueryCompiler(): QueryCompiler { return new SqliteQueryCompiler(); }
  createAdapter(): DialectAdapter { return new SqliteAdapter(); }
  createIntrospector(db: Kysely<any>): DatabaseIntrospector { return new SqliteIntrospector(db); }
}
export async function openBridge(bridge: SqliteBridge, opts: { clock?: Clock } = {}): Promise<Ctx & { close(): Promise<void> }> {
  const db = new Kysely<DB>({ dialect: new BridgeDialect(bridge) });
  await migrate(db, 'sqlite');
  try { await bridge.exec('PRAGMA optimize=0x10002', [], false); } catch { /* statistics are an optimisation only */ }
  return { db, dialect: 'sqlite', clock: opts.clock || systemClock, close: () => db.destroy() };
}
