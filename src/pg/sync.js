'use strict';
/* PgSync: node:sqlite's DatabaseSync surface (exec / prepare().run|get|all) on PostgreSQL, blocking like SQLite does.
   Phase 2, stage A: the connection and statement layer. The schema port and the trigger port come in the next stages. */
const path = require('node:path');
const { Worker, MessageChannel, receiveMessageOnPort } = require('node:worker_threads');
const D = require('./dialect');

class PgSync {
  /** config: a connection string or a pg Client config object */
  constructor(config) {
    this.ctl = new Int32Array(new SharedArrayBuffer(8));
    const { port1, port2 } = new MessageChannel(); this.port = port1;
    this.worker = new Worker(path.join(__dirname, 'worker.js'), { workerData: { ctl: this.ctl, port: port2, config: typeof config === 'string' ? { connectionString: config } : config }, transferList: [port2] });
    this.worker.on('error', (e) => { this.dead = e; });
    this.call({ op: 'connect' });
    this.idTables = new Set(this.call({ op: 'exec', sql: "SELECT table_name FROM information_schema.columns WHERE table_schema = current_schema() AND column_name = 'id'" }).rows.map(r => r.table_name));
  }
  call(req) {
    if (this.dead) throw this.dead;
    Atomics.store(this.ctl, 0, 0); this.port.postMessage(req);
    while (Atomics.wait(this.ctl, 0, 0, 30000) === 'timed-out') { if (this.dead) throw this.dead; }
    const m = receiveMessageOnPort(this.port); const res = m && m.message;
    if (!res) throw new Error('PostgreSQL worker returned nothing');
    if (!res.ok) { const e = new Error(res.error.message); Object.assign(e, res.error); throw e; }
    return res;
  }
  exec(sql) { if (D.isNoop(sql)) return; const s = D.simple(sql); if (s.trim()) this.call({ op: 'exec', sql: s }); }
  prepare(sql) {
    const noop = D.isNoop(sql), t = D.translate(sql), table = D.insertTable(sql), self = this;
    const returning = () => table && !/\bRETURNING\b/i.test(t.sql) && self.idTables.has(table);
    const text = () => (returning() ? t.sql.replace(/\s*;?\s*$/, '') + ' RETURNING id' : t.sql);
    const run = (params) => { const r = self.call({ op: 'query', sql: text(), params }); return r; };
    return {
      run(...p) { if (noop) return { changes: 0, lastInsertRowid: 0 }; const r = run(p); return { changes: r.rowCount, lastInsertRowid: returning() && r.rows[0] ? r.rows[0].id : 0 }; },
      get(...p) { const r = run(p); return r.rows[0]; },
      all(...p) { return run(p).rows; }
    };
  }
  close() { try { this.call({ op: 'end' }); } finally { this.worker.terminate(); } }
}
module.exports = { PgSync };
