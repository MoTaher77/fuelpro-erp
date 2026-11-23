'use strict';
/* PostgreSQL worker (Phase 2). Runs the async `pg` driver in a worker thread so the main thread can call it synchronously:
   the main thread posts a request on a MessagePort and sleeps on Atomics.wait; the worker answers on the same port and wakes it.
   The existing FuelPro code is synchronous end to end (one request = one uninterrupted transaction), and this keeps that behaviour. */
const { workerData } = require('node:worker_threads');
const { Client, types } = require('pg');

/* SQLite-compatible values: 64-bit integers and numerics as numbers (a value beyond 2^53 stays a string), booleans as 1/0 */
types.setTypeParser(20, (s) => { const n = Number(s); return Number.isSafeInteger(n) ? n : s; });
types.setTypeParser(1700, (s) => Number(s));
types.setTypeParser(16, (s) => (s === 't' ? 1 : 0));

const { ctl, port, config } = workerData;
let client = null;
const wake = () => { Atomics.store(ctl, 0, 1); Atomics.notify(ctl, 0); };
const err = (e) => ({ ok: false, error: { message: String(e && e.message || e), code: e && e.code, detail: e && e.detail, constraint: e && e.constraint, table: e && e.table, column: e && e.column } });

port.on('message', async (req) => {
  let res;
  try {
    if (req.op === 'connect') { client = new Client(config); await client.connect(); res = { ok: true }; }
    else if (req.op === 'exec') { const r = await client.query(req.sql); const last = Array.isArray(r) ? r[r.length - 1] : r; res = { ok: true, rows: last.rows || [], rowCount: last.rowCount || 0, command: last.command }; }
    else if (req.op === 'query') { const r = await client.query({ text: req.sql, values: req.params }); res = { ok: true, rows: r.rows, rowCount: r.rowCount, command: r.command }; }
    else if (req.op === 'end') { await client.end(); res = { ok: true }; }
    else res = err('unknown operation ' + req.op);
  } catch (e) { res = err(e); }
  port.postMessage(res); wake();
});
