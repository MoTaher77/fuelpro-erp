'use strict';
/* node:sqlite's DatabaseSync API on top of sql.js (SQLite compiled to JavaScript), for the FuelPro Artifact edition.
   Only the surface src/ uses: new DatabaseSync(path), exec, prepare().run/get/all, close.
   The database bytes come from G.__FP_DB_BYTES (a saved snapshot or the demo seed); the path is ignored.
   Statements are cached per SQL text and freed on close, because src/ calls prepare() on every request. */
(function (G) {
  function makeSqlite(SQL) {
    const conv = (v) => v === undefined ? null : typeof v === 'bigint' ? Number(v) : typeof v === 'boolean' ? (v ? 1 : 0) : v;
    function params(a) {
      if (a.length === 1 && a[0] && typeof a[0] === 'object' && !Array.isArray(a[0]) && !(a[0] instanceof Uint8Array)) {
        const o = {}; for (const [k, v] of Object.entries(a[0])) { if (/^[:@$]/.test(k)) o[k] = conv(v); else { o[':' + k] = o['@' + k] = o['$' + k] = conv(v); } } return o;
      }
      return a.map(conv);
    }
    class StatementSync {
      constructor(d, sql) { this.d = d; this.sql = sql; }
      _s(a) { const s = this.d._stmt(this.sql); s.reset(); if (a.length) s.bind(params(a)); return s; }
      run(...a) { const s = this._s(a); try { s.step(); } finally { s.reset(); }
        const db = this.d.db; return { changes: db.getRowsModified(), lastInsertRowid: db.exec('SELECT last_insert_rowid()')[0].values[0][0] }; }
      get(...a) { const s = this._s(a); try { return s.step() ? s.getAsObject() : undefined; } finally { s.reset(); } }
      all(...a) { const s = this._s(a), out = []; try { while (s.step()) out.push(s.getAsObject()); } finally { s.reset(); } return out; }
    }
    class DatabaseSync {
      constructor() { const b = G.__FP_DB_BYTES; this.db = b ? new SQL.Database(b) : new SQL.Database(); this.cache = new Map(); G.__FP_DB = this; }
      _stmt(sql) { let s = this.cache.get(sql); if (!s) { s = this.db.prepare(sql); this.cache.set(sql, s); } return s; }
      exec(sql) {
        /* WAL and busy timeouts mean nothing for a single in-page connection; the rest runs as written */
        sql = String(sql).replace(/PRAGMA\s+journal_mode\s*=\s*\w+\s*;?/ig, '').replace(/PRAGMA\s+busy_timeout\s*=\s*\d+\s*;?/ig, '').replace(/PRAGMA\s+synchronous\s*=\s*\w+\s*;?/ig, '');
        if (sql.trim()) this.db.exec(sql);
      }
      prepare(sql) { this._stmt(sql); return new StatementSync(this, sql); }
      /** the database file as it is now (consistent between transactions) */
      bytes() { return this.db.export ? this._export() : null; }
      _export() { for (const s of this.cache.values()) s.free(); this.cache.clear(); const b = this.db.export(); this.db.exec('PRAGMA foreign_keys=ON'); return b; }
      close() { for (const s of this.cache.values()) s.free(); this.cache.clear(); this.db.close(); }
      get isOpen() { return true; }
    }
    return { DatabaseSync, StatementSync };
  }
  G.FP_makeSqlite = makeSqlite;
})(typeof globalThis !== 'undefined' ? globalThis : window);
