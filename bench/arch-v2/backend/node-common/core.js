'use strict';
// Shared data layer for the three Node stacks. DB=sqlite:<file> or DB=postgres://...
const LIST = 'SELECT id, station_id, pump_id, qty_ml, price_e4, amount, created_at FROM sales WHERE station_id=? ORDER BY id DESC LIMIT ?';
const DAY = 'SELECT COALESCE(SUM(amount),0) AS amount, COALESCE(SUM(qty_ml),0) AS qty_ml FROM sales WHERE station_id=? AND created_at>=? AND created_at<?';
const TB = 'SELECT COALESCE(SUM(l.debit),0) AS debit, COALESCE(SUM(l.credit),0) AS credit FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE j.station_id=?';
const ORG = 'SELECT org_id FROM stations WHERE id=?';
class HttpErr extends Error { constructor(s, m) { super(m); this.status = s; } }
function dayRange(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) throw new HttpErr(400, 'bad day');
  const t = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) / 1000; return [t, t + 86400];
}
function parseSale(b) {
  const ok = (v) => Number.isSafeInteger(v) && v > 0;
  if (!b || !ok(b.pump_id) || !ok(b.qty_ml) || !ok(b.price_e4)) throw new HttpErr(400, 'bad body');
  const amount = Math.floor(b.qty_ml * b.price_e4 / 10000); // integer minor units
  return { pump_id: b.pump_id, qty_ml: b.qty_ml, price_e4: b.price_e4, amount, cost: Math.floor(amount * 9 / 10) };
}
function orgOf(h) { const o = Number(h); if (!Number.isSafeInteger(o) || o <= 0) throw new HttpErr(401, 'X-Org'); return o; }

function sqlite(file) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; PRAGMA cache_size=-65536; PRAGMA temp_store=MEMORY; PRAGMA mmap_size=268435456; PRAGMA foreign_keys=ON');
  const q = { list: db.prepare(LIST), day: db.prepare(DAY), tb: db.prepare(TB), org: db.prepare(ORG),
    sale: db.prepare('INSERT INTO sales(station_id,pump_id,qty_ml,price_e4,amount,created_at) VALUES (?,?,?,?,?,?)'),
    move: db.prepare('INSERT INTO stock_moves(station_id,tank_id,qty_ml,ref_sale) VALUES (?,?,?,?)'),
    jr: db.prepare("INSERT INTO journals(station_id,source,ref) VALUES (?,'sale',?)"),
    jl: db.prepare('INSERT INTO journal_lines(journal_id,account_id,debit,credit) VALUES (?,?,?,?)'),
    au: db.prepare("INSERT INTO audit(org_id,action,ref) VALUES (?,'sale.create',?)") };
  const check = (org, sid) => { const r = q.org.get(sid); if (!r || r.org_id !== org) throw new HttpErr(404, 'not found'); };
  return {
    list(org, sid, limit) { check(org, sid); return q.list.all(sid, limit); },
    summary(org, sid, day) { check(org, sid); const [a, b] = dayRange(day); const d = q.day.get(sid, a, b), t = q.tb.get(sid); return { day, sales_amount: d.amount, sales_qty_ml: d.qty_ml, tb_debit: t.debit, tb_credit: t.credit }; },
    create(org, sid, body) {
      const s = parseSale(body);
      db.exec('BEGIN IMMEDIATE');
      try {
        check(org, sid);
        const id = Number(q.sale.run(sid, s.pump_id, s.qty_ml, s.price_e4, s.amount, Math.floor(Date.now() / 1000)).lastInsertRowid);
        q.move.run(sid, (s.pump_id % 2) + 1, -s.qty_ml, id);
        const j = Number(q.jr.run(sid, id).lastInsertRowid);
        q.jl.run(j, 1100, s.amount, 0); q.jl.run(j, 4100, 0, s.amount); q.jl.run(j, 5100, s.cost, 0); q.jl.run(j, 1300, 0, s.cost);
        q.au.run(org, id);
        db.exec('COMMIT'); return { id, journal_id: j, amount: s.amount };
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}

function postgres(url) {
  const { Pool, types } = require('pg');
  types.setTypeParser(20, (v) => Number(v)); types.setTypeParser(1700, (v) => Number(v)); // int8 -> Number (values stay < 2^53)
  const pool = new Pool({ connectionString: url, max: Number(process.env.PG_POOL || 4) });
  const n = (s) => { let i = 0; return s.replace(/\?/g, () => '$' + (++i)); };
  const P = { list: n(LIST), day: n(DAY), tb: n(TB), org: n(ORG) };
  const check = async (c, org, sid) => { const r = (await c.query({ name: 'org', text: P.org, values: [sid] })).rows[0]; if (!r || r.org_id !== org) throw new HttpErr(404, 'not found'); };
  return {
    async list(org, sid, limit) { await check(pool, org, sid); return (await pool.query({ name: 'list', text: P.list, values: [sid, limit] })).rows; },
    async summary(org, sid, day) {
      await check(pool, org, sid); const [a, b] = dayRange(day);
      const [d, t] = await Promise.all([pool.query({ name: 'day', text: P.day, values: [sid, a, b] }), pool.query({ name: 'tb', text: P.tb, values: [sid] })]);
      return { day, sales_amount: d.rows[0].amount, sales_qty_ml: d.rows[0].qty_ml, tb_debit: t.rows[0].debit, tb_credit: t.rows[0].credit };
    },
    async create(org, sid, body) {
      const s = parseSale(body); const c = await pool.connect();
      try {
        await c.query('BEGIN'); await check(c, org, sid);
        const id = (await c.query({ name: 'is', text: 'INSERT INTO sales(station_id,pump_id,qty_ml,price_e4,amount,created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', values: [sid, s.pump_id, s.qty_ml, s.price_e4, s.amount, Math.floor(Date.now() / 1000)] })).rows[0].id;
        await c.query({ name: 'im', text: 'INSERT INTO stock_moves(station_id,tank_id,qty_ml,ref_sale) VALUES ($1,$2,$3,$4)', values: [sid, (s.pump_id % 2) + 1, -s.qty_ml, id] });
        const j = (await c.query({ name: 'ij', text: "INSERT INTO journals(station_id,source,ref) VALUES ($1,'sale',$2) RETURNING id", values: [sid, id] })).rows[0].id;
        await c.query({ name: 'il', text: 'INSERT INTO journal_lines(journal_id,account_id,debit,credit) VALUES ($1,1100,$2,0),($1,4100,0,$2),($1,5100,$3,0),($1,1300,0,$3)', values: [j, s.amount, s.cost] });
        await c.query({ name: 'ia', text: "INSERT INTO audit(org_id,action,ref) VALUES ($1,'sale.create',$2)", values: [org, id] });
        await c.query('COMMIT'); return { id, journal_id: j, amount: s.amount };
      } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
    },
  };
}
const url = process.env.DB || '';
module.exports = { store: url.startsWith('postgres') ? postgres(url) : sqlite(url.replace(/^sqlite:/, '')), HttpErr, orgOf };
