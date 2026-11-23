'use strict';
/* Ledger, inventory, shifts, suppliers, roles and migration. Amounts in YER (0 decimals): price_e4 12_000_000 = 1,200 YER per litre. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/server');

let base, server, db, n = 0;
test.before(async () => {
  const app = createApp({ dbPath: ':memory:', mailer: { send: async () => {} } }); server = app.server; db = app.db;
  await new Promise(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise(r => server.close(r)));

function client() {
  let cookie = '';
  const call = async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await res.text(); let j; try { j = t ? JSON.parse(t) : undefined; } catch { j = t; }
    return { status: res.status, body: j };
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), patch: (p, b) => call('PATCH', p, b), del: (p) => call('DELETE', p) };
}
const uniq = () => `${Date.now()}-${++n}`;
const PW = 'correct horse battery';
const ok = (r, code = 200) => { assert.equal(r.status, code, JSON.stringify(r.body)); return r.body; };

async function org({ vatBp = 0, level = 10_000_000, cost = 10_800_000 } = {}) {
  const c = client(), email = `o${uniq()}@ex.com`;
  const r = ok(await c.post('/api/auth/register', { org_name: 'DEMO Org', name: 'Owner', email, password: PW, station: { name: 'A', currency: 'YER', timezone: 'Asia/Aden' } }), 201);
  const sid = r.station_id, p = `/api/stations/${sid}`;
  if (vatBp) ok(await c.patch(p, { vat_bp: vatBp }));
  const fuel = ok(await c.post(`${p}/fuels`, { name: 'Gasoline', price_e4: 12_000_000, cost_e4: cost }), 201).id;
  const tank = ok(await c.post(`${p}/tanks`, { name: 'T1', fuel_id: fuel, capacity_ml: 20_000_000, level_ml: level }), 201).id;
  const pump = ok(await c.post(`${p}/pumps`, { name: 'P1', tank_id: tank, meter_ml: 1_000_000 }), 201).id;
  return { c, sid, p, fuel, tank, pump, email, org_id: r.org_id };
}
const sale = (s, over = {}) => s.c.post(`${s.p}/sales`, { client_id: 'cid-' + uniq(), pump_id: s.pump, quantity_ml: 150_000, pay_type: 'cash', ...over });
const integrity = async (c) => { const r = ok(await c.get('/api/accounting/integrity')); assert.ok(r.ok, JSON.stringify(r.checks.filter(x => !x.ok))); return r; };
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Aden' }).format(new Date());
const daysAgo = (k) => { const d = new Date(today() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - k); return d.toISOString().slice(0, 10); };

test('every operation posts a balanced journal; inventory uses weighted average cost', async () => {
  const s = await org({ level: 1_000_000, cost: 10_000_000 });                // 1,000 L at 1,000
  ok(await s.c.post(`${s.p}/deliveries`, { tank_id: s.tank, quantity_ml: 1_000_000, cost_e4: 12_000_000, pay_type: 'bank' }), 201);   // 1,000 L at 1,200
  const t = ok(await s.c.get(`${s.p}/tanks`))[0];
  assert.equal(t.avg_cost_e4, 11_000_000); assert.equal(t.value, 2_200_000);
  const sl = ok(await sale(s, { quantity_ml: 500_000 }), 201);                 // 500 L
  assert.equal(sl.gross, 600_000); assert.equal(sl.cogs, 550_000);           // at the 1,100 average, not the last cost
  ok(await s.c.post(`${s.p}/expenses`, { category: 'power', gross: 20_000 }), 201);
  const is = ok(await s.c.get(`/api/accounting/income-statement?station_id=${s.sid}&from=${daysAgo(5)}&to=${today()}`));
  assert.equal(is.revenue, 600_000); assert.equal(is.cost_of_sales, 550_000); assert.equal(is.operating_expenses, 20_000); assert.equal(is.net_profit, 30_000);
  const tb = ok(await s.c.get(`/api/accounting/trial-balance?to=${today()}&from=${daysAgo(30)}`)); assert.ok(tb.balanced);
  const bs = ok(await s.c.get(`/api/accounting/balance-sheet?as_of=${today()}`)); assert.ok(bs.balanced);
  assert.equal(bs.current_earnings, 30_000);
  const js = ok(await s.c.get(`${s.p}/journals`));
  const sj = js.find(j => j.source === 'sale');
  assert.equal(sj.lines.reduce((a, l) => a + l.debit, 0), sj.lines.reduce((a, l) => a + l.credit, 0));
  assert.deepEqual(sj.lines.map(l => l.code).sort(), ['1010', '1200', '4010', '5010']);
  await integrity(s.c);
});

test('void reverses the journal and the stock value exactly; ledger rows are append-only', async () => {
  const s = await org();
  const sl = ok(await sale(s), 201);
  ok(await s.c.post(`${s.p}/sales/${sl.id}/void`, { reason: 'wrong pump' }));
  const t = ok(await s.c.get(`${s.p}/tanks`))[0];
  assert.equal(t.level_ml, 10_000_000); assert.equal(t.value, 10_800_000);
  const js = ok(await s.c.get(`${s.p}/journals?source=sale`));
  assert.equal(js.length, 2); assert.ok(js.some(j => j.reversal_of === sl.id || j.reversal_of));
  await integrity(s.c);
  assert.throws(() => db.prepare('UPDATE stock_moves SET qty_ml=0').run(), /append-only/);
  assert.throws(() => db.prepare("UPDATE journal_lines SET debit=debit+1 WHERE debit>0").run(), /immutable/);
  assert.throws(() => db.prepare("DELETE FROM journals WHERE status='posted'").run(), /cannot be deleted/);
});

test('stock count posts shortage; reconciliation shows the variance', async () => {
  const s = await org();
  ok(await sale(s, { quantity_ml: 1_000_000 }), 201);
  const r = ok(await s.c.post(`${s.p}/adjustments`, { tank_id: s.tank, after_ml: 8_990_000, note: 'dip reading' }), 201);
  assert.equal(r.diff_ml, -10_000); assert.equal(r.value, -10_800);
  const rec = ok(await s.c.get(`${s.p}/stock/reconciliation?from=${daysAgo(1)}&to=${today()}`)).rows[0];
  assert.equal(rec.sales_ml, 1_000_000); assert.equal(rec.count_variance_ml, -10_000); assert.equal(rec.closing_ml, 8_990_000); assert.equal(rec.variance_pct, -1); assert.ok(rec.consistent);
  const is = ok(await s.c.get(`/api/accounting/income-statement?station_id=${s.sid}&to=${today()}&from=${daysAgo(1)}`));
  assert.equal(is.rows.find(x => x.code === '5100').amount, 10_800);
  ok(await s.c.patch(`${s.p}/tanks/${s.tank}`, { min_ml: 9_000_000 }));
  assert.equal(ok(await s.c.get(`${s.p}/dashboard`)).tanks[0].low, true);
  await integrity(s.c);
});

test('transfer between stations keeps both branches balanced and can be voided', async () => {
  const s = await org();
  const sid2 = ok(await s.c.post('/api/stations', { name: 'B', currency: 'YER', timezone: 'Asia/Aden' }), 201).id, p2 = `/api/stations/${sid2}`;
  const f2 = ok(await s.c.post(`${p2}/fuels`, { name: 'gasoline ', price_e4: 12_000_000 }), 201).id;
  const t2 = ok(await s.c.post(`${p2}/tanks`, { name: 'B1', fuel_id: f2, capacity_ml: 5_000_000 }), 201).id;
  const fd = ok(await s.c.post(`${p2}/fuels`, { name: 'Diesel', price_e4: 9_000_000 }), 201).id;
  const td = ok(await s.c.post(`${p2}/tanks`, { name: 'D1', fuel_id: fd, capacity_ml: 5_000_000 }), 201).id;
  assert.equal((await s.c.post(`${s.p}/transfers`, { from_tank_id: s.tank, to_station_id: sid2, to_tank_id: td, quantity_ml: 1000 })).body.error.code, 'FUEL_MISMATCH');
  const tr = ok(await s.c.post(`${s.p}/transfers`, { from_tank_id: s.tank, to_station_id: sid2, to_tank_id: t2, quantity_ml: 1_000_000 }), 201);
  assert.equal(tr.value, 1_080_000);
  const b1 = ok(await s.c.get(`${p2}/tanks`)).find(t => t.id === t2);
  assert.equal(b1.level_ml, 1_000_000); assert.equal(b1.avg_cost_e4, 10_800_000);
  for (const id of [s.sid, sid2]) assert.ok(ok(await s.c.get(`/api/accounting/trial-balance?station_id=${id}&to=${today()}`)).balanced);
  const bs = ok(await s.c.get(`/api/accounting/balance-sheet?as_of=${today()}`));      // org-wide: inter-branch nets to zero
  assert.equal((bs.assets.find(a => a.code === '1190') || { amount: 0 }).amount, 0);
  await integrity(s.c);
  ok(await s.c.post(`${s.p}/transfers/${tr.id}/void`, { reason: 'sent to wrong tank' }));
  assert.equal(ok(await s.c.get(`${s.p}/tanks`))[0].level_ml, 10_000_000);
  assert.equal(ok(await s.c.get(`${s.p}/tanks`))[0].value, 10_800_000);
  await integrity(s.c);
});

test('shift: required, expected cash excludes credit and bank, variance posted on approval, closed shift is frozen', async () => {
  const s = await org();
  ok(await s.c.patch(s.p, { require_shift: true }));
  assert.equal((await sale(s)).body.error.code, 'SHIFT_REQUIRED');
  const cust = ok(await s.c.post(`${s.p}/customers`, { name: 'DEMO Fleet' }), 201).id;
  const sh = ok(await s.c.post(`${s.p}/shifts`, { float_amount: 5_000 }), 201).id;
  assert.equal((await s.c.post(`${s.p}/shifts`, {})).body.error.code, 'SHIFT_ALREADY_OPEN');
  const cashSale = ok(await sale(s), 201);                                             // +180,000 cash
  ok(await sale(s, { pay_type: 'credit', customer_id: cust }), 201);                   // credit: not in drawer
  ok(await s.c.post(`${s.p}/payments`, { customer_id: cust, amount: 50_000 }), 201);   // +50,000 cash
  ok(await s.c.post(`${s.p}/payments`, { customer_id: cust, amount: 10_000, method: 'bank' }), 201);   // bank: not in drawer
  ok(await s.c.post(`${s.p}/expenses`, { category: 'other', gross: 3_000 }), 201);      // -3,000
  assert.equal((await s.c.post(`${s.p}/cash-moves`, { kind: 'withdrawal', amount: 10_000_000 })).body.error.code, 'CASH_INSUFFICIENT');
  ok(await s.c.post(`${s.p}/cash-moves`, { kind: 'withdrawal', counterpart: 'bank', amount: 100_000 }), 201);   // -100,000
  const cur = ok(await s.c.get(`${s.p}/shifts/current`)).shift;
  assert.equal(cur.totals.expected_cash, 5_000 + 180_000 + 50_000 - 3_000 - 100_000);
  assert.equal(cur.meters[0].meter_ml, 300_000); assert.equal(cur.meters[0].unrecorded_ml, 0);
  const cl = ok(await s.c.post(`${s.p}/shifts/${sh}/close`, { counted_cash: 131_500 }));
  assert.equal(cl.expected_cash, 132_000); assert.equal(cl.variance, -500);
  assert.equal((await s.c.post(`${s.p}/sales/${cashSale.id}/void`, { reason: 'test' })).body.error.code, 'SHIFT_CLOSED');
  ok(await s.c.post(`${s.p}/shifts/${sh}/approve`));
  let is = ok(await s.c.get(`/api/accounting/income-statement?station_id=${s.sid}&to=${today()}`));
  assert.equal(is.rows.find(x => x.code === '5200').amount, 500);
  ok(await s.c.post(`${s.p}/shifts/${sh}/unapprove`, { reason: 'recount' }));
  is = ok(await s.c.get(`/api/accounting/income-statement?station_id=${s.sid}&to=${today()}`));
  assert.equal((is.rows.find(x => x.code === '5200') || { amount: 0 }).amount, 0);
  ok(await s.c.post(`${s.p}/shifts/${sh}/reopen`, { reason: 'recount' }));
  ok(await s.c.post(`${s.p}/shifts/${sh}/close`, { counted_cash: 132_000 }));
  ok(await s.c.post(`${s.p}/shifts/${sh}/approve`));
  assert.equal(ok(await s.c.get(`${s.p}/shifts/${sh}`)).status, 'approved');
  await integrity(s.c);
});

test('suppliers: credit purchase, payment, statement, overpayment, ageing; customer credit limit and ageing', async () => {
  const s = await org();
  const sup = ok(await s.c.post(`${s.p}/suppliers`, { name: 'DEMO Oil Co', opening_balance: 100_000, terms_days: 15 }), 201).id;
  assert.equal((await s.c.post(`${s.p}/deliveries`, { tank_id: s.tank, quantity_ml: 1_000_000, cost_e4: 10_000_000, pay_type: 'credit' })).body.error.code, 'VALIDATION');
  ok(await s.c.post(`${s.p}/deliveries`, { tank_id: s.tank, quantity_ml: 1_000_000, cost_e4: 10_000_000, pay_type: 'credit', supplier_id: sup, date: daysAgo(40) }), 201);   // 1,000,000 due 25 days ago
  assert.equal(ok(await s.c.get(`${s.p}/suppliers`))[0].balance, 1_100_000);
  assert.equal((await s.c.post(`${s.p}/supplier-payments`, { supplier_id: sup, amount: 2_000_000 })).body.error.code, 'OVERPAYMENT');
  ok(await s.c.post(`${s.p}/supplier-payments`, { supplier_id: sup, amount: 300_000, method: 'bank' }), 201);
  const stt = ok(await s.c.get(`${s.p}/suppliers/${sup}/statement`)); assert.equal(stt.balance, 800_000); assert.equal(stt.entries.length, 3);
  const ag = ok(await s.c.get(`${s.p}/ageing?type=supplier`));
  assert.equal(ag.rows[0].d30, 800_000); assert.equal(ag.rows[0].balance, 800_000);        // opening settled first (FIFO), rest is 25 days late

  const cust = ok(await s.c.post(`${s.p}/customers`, { name: 'DEMO Transport', credit_limit: 300_000, terms_days: 30, opening_balance: 50_000 }), 201).id;
  ok(await sale(s, { pay_type: 'credit', customer_id: cust, date: daysAgo(45) }), 201);    // 180,000, 15 days late
  const lim = await sale(s, { pay_type: 'credit', customer_id: cust });
  assert.equal(lim.status, 409); assert.equal(lim.body.error.code, 'CREDIT_LIMIT'); assert.equal(lim.body.error.details.balance, 230_000);
  const st = ok(await s.c.get(`${s.p}/customers/${cust}/statement`)); assert.equal(st.entries[0].kind, 'opening'); assert.equal(st.balance, 230_000);
  const ca = ok(await s.c.get(`${s.p}/ageing?type=customer`)).rows.find(r => r.id === cust);
  assert.equal(ca.d30, 180_000); assert.equal(ca.current, 50_000);
  await integrity(s.c);
});

test('manual journals: must balance, draft then post, reverse; operation entries cannot be reversed directly; period lock', async () => {
  const s = await org();
  const accts = ok(await s.c.get('/api/accounts')); const A = (code) => accts.find(a => a.code === code).id;
  assert.equal((await s.c.post(`${s.p}/journals`, { memo: 'bad', lines: [{ account_id: A('6050'), debit: 100 }, { account_id: A('1020'), credit: 99 }] })).body.error.code, 'JOURNAL_UNBALANCED');
  const j = ok(await s.c.post(`${s.p}/journals`, { memo: 'Rent paid by bank', lines: [{ account_id: A('6050'), debit: 40_000 }, { account_id: A('1020'), credit: 40_000 }] }), 201);
  assert.equal(j.status, 'draft');
  let is = ok(await s.c.get(`/api/accounting/income-statement?to=${today()}`)); assert.equal(is.operating_expenses, 0);   // drafts do not count
  ok(await s.c.post(`/api/journals/${j.id}/post`));
  is = ok(await s.c.get(`/api/accounting/income-statement?to=${today()}`)); assert.equal(is.operating_expenses, 40_000);
  const rv = ok(await s.c.post(`/api/journals/${j.id}/reverse`, { reason: 'duplicate' }));
  assert.equal((await s.c.post(`/api/journals/${rv.id}/reverse`, { reason: 'again' })).body.error.code, 'IS_REVERSAL');
  const sl = ok(await sale(s), 201);
  const sj = ok(await s.c.get(`${s.p}/journals?source=sale`))[0];
  assert.equal((await s.c.post(`/api/journals/${sj.id}/reverse`, { reason: 'x y z' })).body.error.code, 'USE_DOCUMENT_VOID');
  const led = ok(await s.c.get(`/api/accounting/ledger?account_id=${A('1010')}&from=${daysAgo(1)}&to=${today()}`)); assert.equal(led.closing, 180_000);

  // close yesterday: back-dating into it and voiding documents dated in it are refused
  ok(await s.c.post('/api/accounting/lock', { through: daysAgo(1) }));
  assert.equal((await sale(s, { date: daysAgo(2) })).body.error.code, 'PERIOD_LOCKED');
  ok(await sale(s), 201);                                                         // today is still open
  const acc = client(); const email = `acc${uniq()}@ex.com`;
  ok(await s.c.post('/api/users', { name: 'Acc', email, password: PW, role: 'accountant', station_ids: [s.sid] }), 201);
  ok(await acc.post('/api/auth/login', { email, password: PW }));
  assert.equal((await acc.post('/api/accounting/lock', { through: null })).status, 403);   // only owner/admin may reopen
  ok(await s.c.post('/api/accounting/lock', { through: null }));
  assert.equal(sl.id > 0, true);
  await integrity(s.c);
});

test('roles and station access are enforced on the server', async () => {
  const s = await org();
  const sid2 = ok(await s.c.post('/api/stations', { name: 'B', currency: 'USD', timezone: 'Asia/Aden' }), 201).id;
  const mk = async (role, stations = [s.sid]) => { const c = client(), email = `${role}${uniq()}@ex.com`; ok(await s.c.post('/api/users', { name: role, email, password: PW, role, station_ids: stations }), 201); ok(await c.post('/api/auth/login', { email, password: PW })); return c; };
  const cashier = await mk('cashier'), viewer = await mk('viewer'), accountant = await mk('accountant'), manager = await mk('manager'), supervisor = await mk('supervisor');
  assert.equal((await cashier.get(`/api/stations/${sid2}/tanks`)).status, 404);           // not assigned
  assert.equal(ok(await cashier.get('/api/me')).stations.length, 1);
  assert.equal((await cashier.post(`${s.p}/sales`, { client_id: 'c-' + uniq(), pump_id: s.pump, quantity_ml: 1000, pay_type: 'cash' })).status, 201);
  assert.equal((await cashier.get(`${s.p}/summary?from=${today()}&to=${today()}`)).status, 403);
  assert.equal((await viewer.post(`${s.p}/sales`, { client_id: 'c-' + uniq(), pump_id: s.pump, quantity_ml: 1000 })).status, 403);
  assert.equal((await viewer.get(`${s.p}/summary?from=${today()}&to=${today()}`)).status, 200);
  assert.equal((await accountant.post(`${s.p}/sales`, { client_id: 'c-' + uniq(), pump_id: s.pump, quantity_ml: 1000 })).status, 403);
  assert.equal((await accountant.get(`${s.p}/journals`)).status, 200);
  assert.equal((await supervisor.get(`${s.p}/journals`)).status, 403);
  assert.equal((await manager.post('/api/users', { name: 'x', email: `x${uniq()}@e.com`, password: PW, role: 'cashier', station_ids: [s.sid] })).status, 403);
  assert.equal((await s.c.post('/api/users', { name: 'x', email: `x${uniq()}@e.com`, password: PW, role: 'cashier' })).body.error.code, 'VALIDATION');
  assert.equal((await s.c.get('/api/accounting/trial-balance?to=' + today())).body.error.code, 'MIXED_CURRENCY');
  assert.equal(ok(await s.c.get(`/api/accounting/trial-balance?to=${today()}&currency=USD`)).rows.length, 0);
  const users = ok(await s.c.get('/api/users')); assert.deepEqual(users.find(u => u.role === 'cashier').station_ids, [s.sid]);
});

test('duplicate submissions in parallel create one sale', async () => {
  const s = await org(); const cid = 'dup-' + uniq();
  const rs = await Promise.all(Array.from({ length: 15 }, () => sale(s, { client_id: cid })));
  assert.equal(rs.filter(r => r.status === 201).length, 1); assert.equal(rs.filter(r => r.status === 200).length, 14);
  assert.equal(ok(await s.c.get(`${s.p}/sales`)).length, 1);
  await integrity(s.c);
});

test('upgrade from a v2 database keeps users, assigns stations and opens the books from existing balances', () => {
  const { DatabaseSync } = require('node:sqlite'); const { MIGRATIONS, openDb } = require('../src/db');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fp-')), 'v2.db');
  const raw = new DatabaseSync(file); raw.exec('PRAGMA foreign_keys=ON');
  for (let i = 0; i < 2; i++) { raw.exec(MIGRATIONS[i]); raw.exec(`PRAGMA user_version=${i + 1}`); }
  raw.exec(`INSERT INTO orgs(id,name) VALUES(1,'Old');
    INSERT INTO users(id,org_id,email,name,pw_hash,role) VALUES(1,1,'o@old','O','x','owner'),(2,1,'c@old','C','x','cashier');
    INSERT INTO stations(id,org_id,name,currency,cur_dec,timezone) VALUES(1,1,'S','YER',0,'Asia/Aden');
    INSERT INTO fuels(id,station_id,name,price_e4,cost_e4) VALUES(1,1,'G',12000000,10000000);
    INSERT INTO tanks(id,station_id,name,fuel_id,capacity_ml,level_ml) VALUES(1,1,'T',1,10000000,2000000);
    INSERT INTO pumps(id,station_id,name,tank_id,fuel_id,meter_ml) VALUES(1,1,'P',1,1,100000);
    INSERT INTO customers(id,station_id,name) VALUES(1,1,'Cu');
    INSERT INTO sales(station_id,client_id,pump_id,fuel_id,tank_id,business_date,quantity_ml,price_e4,cost_e4,net,vat,gross,vat_bp,vat_included,pay_type,customer_id,open_ml,close_ml,user_id)
      VALUES(1,'old-1',1,1,1,'2026-01-01',100000,12000000,10000000,120000,0,120000,0,1,'credit',1,0,100000,2);`);
  raw.close();
  const d = openDb(file);
  assert.equal(d.prepare('PRAGMA user_version').get().user_version, 13);
  assert.equal(d.prepare('SELECT role FROM users WHERE id=2').get().role, 'cashier');
  assert.deepEqual(d.prepare('SELECT station_id FROM user_stations WHERE user_id=2').all().map(r => r.station_id), [1]);
  assert.equal(d.prepare('SELECT value FROM tanks WHERE id=1').get().value, 2_000_000);
  const gl = (sys) => d.prepare("SELECT COALESCE(SUM(l.debit-l.credit),0) v FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE a.sys=?").get(sys).v;
  assert.equal(gl('inventory'), 2_000_000); assert.equal(gl('ar'), 120_000); assert.equal(gl('capital'), -2_120_000);
  assert.equal(d.prepare('PRAGMA foreign_key_check').all().length, 0);
  d.close();
});

test('backup with VACUUM INTO restores to identical, balanced books', () => {
  const { openDb } = require('../src/db'); const O = require('../src/ops'); const S2 = require('../src/services');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fpb-')), src = path.join(dir, 'live.db'), bak = path.join(dir, 'backup.db');
  const d = openDb(src);
  const r = S2.registerOrg(d, { org_name: 'DEMO B', name: 'O', email: `b${uniq()}@ex.com`, password: PW, station: { currency: 'YER', timezone: 'Asia/Aden' } });
  const u = { id: r.user_id, org_id: r.org_id, role: 'owner' };
  const f = S2.createFuel(d, u, r.station_id, { name: 'G', price_e4: 12_000_000, cost_e4: 10_000_000 }).id;
  const t = S2.createTank(d, u, r.station_id, { name: 'T', fuel_id: f, capacity_ml: 10_000_000, level_ml: 5_000_000 }).id;
  const p = S2.createPump(d, u, r.station_id, { name: 'P', tank_id: t }).id;
  for (let i = 0; i < 20; i++) S2.createSale(d, u, r.station_id, { client_id: 'bk-' + i + '-' + uniq(), pump_id: p, quantity_ml: 10_000 + i });
  d.exec(`VACUUM INTO '${bak}'`); d.close();
  const b = openDb(bak);
  assert.equal(b.prepare('SELECT COUNT(*) n FROM sales').get().n, 20);
  assert.ok(O.integrity(b, u).ok);
  assert.ok(O.trialBalance(b, u, { to: '2999-12-31', from: '2000-01-01' }).balanced);
  b.close();
});
