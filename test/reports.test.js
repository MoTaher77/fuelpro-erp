'use strict';
/* Daily station report, cash & bank boxes, collections follow-up, year-end closing. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/server');

let base, server, n = 0;
test.before(async () => {
  const app = createApp({ dbPath: ':memory:', mailer: { send: async () => {} } }); server = app.server;
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
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), patch: (p, b) => call('PATCH', p, b) };
}
const ok = (r, code = 200) => { assert.equal(r.status, code, JSON.stringify(r.body)); return r.body; };
async function org() {
  const c = client();
  const r = ok(await c.post('/api/auth/register', { org_name: 'DEMO Books', name: 'Owner', email: `b${Date.now()}-${++n}@ex.com`, password: 'correct horse battery', station: { name: 'A', currency: 'YER', timezone: 'Asia/Aden' } }), 201);
  const p = `/api/stations/${r.station_id}`;
  const fuel = ok(await c.post(`${p}/fuels`, { name: 'Gasoline', price_e4: 5_000_000, cost_e4: 4_000_000 }), 201).id;
  const tank = ok(await c.post(`${p}/tanks`, { name: 'T1', fuel_id: fuel, capacity_ml: 20_000_000, level_ml: 10_000_000 }), 201).id;
  const pump = ok(await c.post(`${p}/pumps`, { name: 'P1', tank_id: tank, meter_ml: 1_000_000 }), 201).id;
  const accts = ok(await c.get('/api/accounts')); const sys = (k) => accts.find(a => a.sys === k).id;
  return { c, p, pump, sys };
}
const integrity = async (c) => { const r = ok(await c.get('/api/accounting/integrity')); assert.ok(r.ok, JSON.stringify(r.checks.filter(x => !x.ok))); };

test('daily report, box report and collections agree with the sales and vouchers of the day', async () => {
  const s = await org();
  const cust = ok(await s.c.post(`${s.p}/customers`, { name: 'Late payer' }), 201).id;
  ok(await s.c.post(`${s.p}/sales`, { client_id: 'r-' + Date.now(), pump_id: s.pump, quantity_ml: 100_000, pay_type: 'cash' }), 201);           // 50,000 cash
  ok(await s.c.post(`${s.p}/sales`, { client_id: 'r2-' + Date.now(), pump_id: s.pump, quantity_ml: 400_000, pay_type: 'credit', customer_id: cust }), 201);   // 200,000 credit
  ok(await s.c.post(`${s.p}/vouchers`, { kind: 'receipt', box_account_id: s.sys('cash'), lines: [{ account_id: s.sys('ar'), party_id: cust, amount: 120_000 }] }), 201);
  ok(await s.c.post(`${s.p}/vouchers`, { kind: 'payment', box_account_id: s.sys('cash'), lines: [{ account_id: s.sys('exp_rent'), amount: 30_000 }] }), 201);
  const d = ok(await s.c.get(`${s.p}/reports/daily`));
  assert.equal(d.totals.amount, 250_000); assert.equal(d.totals.cash, 50_000); assert.equal(d.totals.credit, 200_000);
  assert.equal(d.totals.receipts, 120_000); assert.equal(d.totals.payments, 30_000);
  assert.equal(d.credit.length, 1); assert.equal(d.credit[0].amount, 200_000);
  assert.equal(d.tanks[0].out_ml, 500_000); assert.equal(d.tanks[0].closing_ml, 9_500_000);
  const b = ok(await s.c.get(`${s.p}/reports/boxes`));
  const cash = b.boxes.find(x => x.account_id === s.sys('cash'));
  assert.equal(cash.debit, 170_000); assert.equal(cash.credit, 30_000); assert.equal(cash.closing, 140_000);
  const days = ok(await s.c.get(`${s.p}/reports/boxes?box_account_id=${s.sys('cash')}`)).days;
  assert.equal(days.length, 1); assert.equal(days[0].balance, 140_000);
  const c = ok(await s.c.get(`${s.p}/reports/collections`));
  assert.equal(c.rows.length, 1); assert.equal(c.rows[0].balance, 80_000); assert.equal(c.rows[0].last_credit_amount, 120_000); assert.equal(c.rows[0].days_since_payment, 0);
  assert.equal(ok(await s.c.get(`${s.p}/reports/collections?days=30`)).rows.length, 0);
  await integrity(s.c);
});

test('year-end closing moves income and expenses into retained earnings, keeps the income statement, and can be reopened', async () => {
  const s = await org(); const y = new Date().getUTCFullYear() - 1;
  const A = (k) => s.sys(k);
  ok(await s.c.post(`${s.p}/journals`, { date: `${y}-12-20`, memo: 'old sale', post: true, lines: [{ account_id: A('cash'), debit: 90_000 }, { account_id: A('sales'), credit: 90_000 }] }), 201);
  ok(await s.c.post(`${s.p}/journals`, { date: `${y}-12-21`, memo: 'old rent', post: true, lines: [{ account_id: A('exp_rent'), debit: 25_000 }, { account_id: A('cash'), credit: 25_000 }] }), 201);
  const pv = ok(await s.c.get(`/api/accounting/year-close?year=${y}`)).stations[0];
  assert.equal(pv.net_profit, 65_000); assert.equal(pv.closed, null);
  assert.equal((await s.c.post('/api/accounting/year-close', { year: y + 2 })).body.error.code, 'YEAR_NOT_ENDED');
  const r = ok(await s.c.post('/api/accounting/year-close', { year: y, lock: false }), 201); assert.equal(r.posted, 1);
  assert.equal((await s.c.post('/api/accounting/year-close', { year: y })).body.error.code, 'ALREADY_CLOSED');
  const is = ok(await s.c.get(`/api/accounting/income-statement?from=${y}-01-01&to=${y}-12-31`)); assert.equal(is.net_profit, 65_000);
  const bs = ok(await s.c.get(`/api/accounting/balance-sheet?as_of=${y}-12-31`)); assert.equal(bs.current_earnings, 0); assert.ok(bs.balanced);
  assert.equal(bs.equity.find(e => e.id === A('retained')).amount, 65_000);
  const tb = ok(await s.c.get(`/api/accounting/trial-balance?from=${y}-01-01&to=${y}-12-31`)); assert.ok(tb.balanced); assert.ok(!tb.rows.find(x => x.account_id === A('sales')).closing_cr);
  const tbp = ok(await s.c.get(`/api/accounting/trial-balance?from=${y}-01-01&to=${y}-12-31&pre_close=1`)); assert.equal(tbp.rows.find(x => x.account_id === A('sales')).closing_cr, 90_000);
  ok(await s.c.post('/api/accounting/year-reopen', { year: y, reason: 'correction' }));
  assert.equal(ok(await s.c.get(`/api/accounting/balance-sheet?as_of=${y}-12-31`)).current_earnings, 65_000);
  assert.equal(ok(await s.c.get(`/api/accounting/year-close?year=${y}`)).stations[0].closed, null);
  await integrity(s.c);
});
