/* Phone (Capacitor + @capacitor-community/sqlite): a native SQLite database in the app's private storage.
   The plugin object is passed in so this file has no hard dependency on the plugin package. */
import type { SqliteBridge } from './sqlite-async.ts';
interface CapDb {
  query(statement: string, values?: unknown[]): Promise<{ values?: Record<string, unknown>[] }>;
  run(statement: string, values?: unknown[], transaction?: boolean, returnMode?: string): Promise<{ changes?: { changes?: number; lastId?: number; values?: Record<string, unknown>[] } }>;
  close(): Promise<void>;
}
export function capacitorBridge(db: CapDb): SqliteBridge {
  return {
    async exec(sql, params, reader) {
      if (/^\s*(begin|commit|rollback|savepoint|release)\b/i.test(sql)) { await db.run(sql, [], false); return { rows: [], changes: 0, lastId: 0 }; }
      if (reader && /^\s*(select|with|pragma)\b/i.test(sql)) { const r = await db.query(sql, params); return { rows: r.values || [], changes: 0, lastId: 0 }; }
      // writes (and INSERT … RETURNING) — the plugin's own transaction is off: the core opens and commits its own
      const r = await db.run(sql, params, false, reader ? 'all' : 'no');
      const c = r.changes || {};
      return { rows: c.values || [], changes: c.changes || 0, lastId: c.lastId || 0 };
    },
    close: () => db.close()
  };
}
