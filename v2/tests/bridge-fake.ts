/* What the desktop (Rust/rusqlite) and phone (Capacitor) bridges do, played by node:sqlite with an async hop per
   statement — so the local editions' driver path (BridgeDialect: mutex, BEGIN IMMEDIATE, RETURNING) runs in CI. */
import { createRequire } from 'node:module';
import type { SQLInputValue } from 'node:sqlite';
import type { SqliteBridge } from '@fuelpro/db';
const require = createRequire(import.meta.url);
export function nodeBridge(file = ':memory:'): SqliteBridge {
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const raw = new DatabaseSync(file);
  return {
    async exec(sql, params, reader) {
      await new Promise((r) => setImmediate(r));          // an IPC round trip
      const st = raw.prepare(sql), p = params as SQLInputValue[];
      if (reader) return { rows: st.all(...p) as Record<string, unknown>[], changes: 0, lastId: 0 };
      const r = st.run(...p);
      return { rows: [], changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
    },
    async close() { raw.close(); }
  };
}
