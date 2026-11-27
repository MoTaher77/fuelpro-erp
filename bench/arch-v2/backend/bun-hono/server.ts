import { Hono } from 'hono';
import { Database } from 'bun:sqlite';
const db = new Database(process.env.DB!.replace(/^sqlite:/, ''));
db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; PRAGMA cache_size=-65536; PRAGMA temp_store=MEMORY; PRAGMA mmap_size=268435456; PRAGMA foreign_keys=ON');
class HttpErr extends Error { constructor(public status: number, m: string) { super(m); } }
const q = {
  list: db.prepare('SELECT id, station_id, pump_id, qty_ml, price_e4, amount, created_at FROM sales WHERE station_id=? ORDER BY id DESC LIMIT ?'),
  day: db.prepare('SELECT COALESCE(SUM(amount),0) AS amount, COALESCE(SUM(qty_ml),0) AS qty_ml FROM sales WHERE station_id=? AND created_at>=? AND created_at<?'),
  tb: db.prepare('SELECT COALESCE(SUM(l.debit),0) AS debit, COALESCE(SUM(l.credit),0) AS credit FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE j.station_id=?'),
  org: db.prepare('SELECT org_id FROM stations WHERE id=?'),
  sale: db.prepare('INSERT INTO sales(station_id,pump_id,qty_ml,price_e4,amount,created_at) VALUES (?,?,?,?,?,?) RETURNING id'),
  move: db.prepare('INSERT INTO stock_moves(station_id,tank_id,qty_ml,ref_sale) VALUES (?,?,?,?)'),
  jr: db.prepare("INSERT INTO journals(station_id,source,ref) VALUES (?,'sale',?) RETURNING id"),
  jl: db.prepare('INSERT INTO journal_lines(journal_id,account_id,debit,credit) VALUES (?,?,?,?)'),
  au: db.prepare("INSERT INTO audit(org_id,action,ref) VALUES (?,'sale.create',?)"),
};
const orgOf = (h?: string) => { const o = Number(h); if (!Number.isSafeInteger(o) || o <= 0) throw new HttpErr(401, 'X-Org'); return o; };
const check = (org: number, sid: number) => { const r = q.org.get(sid) as any; if (!r || r.org_id !== org) throw new HttpErr(404, 'not found'); };
const ok = (v: any) => Number.isSafeInteger(v) && v > 0;
const create = db.transaction((org: number, sid: number, s: any) => {
  check(org, sid);
  const id = (q.sale.get(sid, s.pump_id, s.qty_ml, s.price_e4, s.amount, Math.floor(Date.now() / 1000)) as any).id;
  q.move.run(sid, (s.pump_id % 2) + 1, -s.qty_ml, id);
  const j = (q.jr.get(sid, id) as any).id;
  q.jl.run(j, 1100, s.amount, 0); q.jl.run(j, 4100, 0, s.amount); q.jl.run(j, 5100, s.cost, 0); q.jl.run(j, 1300, 0, s.cost);
  q.au.run(org, id); return { id, journal_id: j, amount: s.amount };
});
const app = new Hono();
app.onError((e: any, c) => c.json({ error: e.message }, e.status || 500));
app.get('/stations/:sid/sales', (c) => { const sid = Number(c.req.param('sid')); check(orgOf(c.req.header('x-org')), sid); return c.json(q.list.all(sid, Math.min(Number(c.req.query('limit')) || 50, 200))); });
app.get('/stations/:sid/summary', (c) => {
  const sid = Number(c.req.param('sid')); check(orgOf(c.req.header('x-org')), sid); const day = c.req.query('day') || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpErr(400, 'bad day');
  const t0 = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) / 1000;
  const d = q.day.get(sid, t0, t0 + 86400) as any, t = q.tb.get(sid) as any;
  return c.json({ day, sales_amount: d.amount, sales_qty_ml: d.qty_ml, tb_debit: t.debit, tb_credit: t.credit });
});
app.post('/stations/:sid/sales', async (c) => {
  const org = orgOf(c.req.header('x-org')); let b: any; try { b = await c.req.json(); } catch { b = null; }
  if (!b || !ok(b.pump_id) || !ok(b.qty_ml) || !ok(b.price_e4)) throw new HttpErr(400, 'bad body');
  const amount = Math.floor(b.qty_ml * b.price_e4 / 10000);
  return c.json(create.immediate(org, Number(c.req.param('sid')), { pump_id: b.pump_id, qty_ml: b.qty_ml, price_e4: b.price_e4, amount, cost: Math.floor(amount * 9 / 10) }), 201);
});
export default { port: Number(process.env.PORT || 8080), hostname: '127.0.0.1', fetch: app.fetch };
