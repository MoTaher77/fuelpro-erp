/* Browser harness for the local editions: the same UI + core in-process, with SQLite compiled to WebAssembly (sql.js)
   standing in for Tauri's rusqlite / the Capacitor plugin. Used only by tests/e2e-local.ts. */
import { openBridge, type SqliteBridge } from '@fuelpro/db/browser';
import { localBackend } from '@fuelpro/local';
import { mount } from '@fuelpro/ui';

async function open() {
    // sql.js is loaded by a classic <script> (its emscripten loader does not survive ESM bundling)
  const init = (window as unknown as { initSqlJs: typeof import('sql.js').default }).initSqlJs;
  const SQL = await init({ locateFile: () => 'sql-wasm.wasm' });
  const db = new SQL.Database();
  const bridge: SqliteBridge = {
    async exec(sql, params, reader) {
      await new Promise((r) => setTimeout(r, 0));
      const st = db.prepare(sql);
      try {
        st.bind(params as never);
        const rows: Record<string, unknown>[] = [];
        while (st.step()) rows.push(st.getAsObject() as Record<string, unknown>);
        if (reader) return { rows, changes: 0, lastId: 0 };
        const lastId = Number(db.exec('select last_insert_rowid()')[0].values[0][0]);
        return { rows: [], changes: db.getRowsModified(), lastId };
      } finally { st.free(); }
    }
  };
  (window as unknown as { __db: unknown }).__db = db;
  return openBridge(bridge);
}
mount(document.getElementById('app')!, localBackend(open, 'desktop'));
