'use strict';
/* Sale discounts (posted to «خصومات المبيعات») and bank reconciliation (cleared marks beside the books). */
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
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), patch: (p, b) => call('PATCH', p, b), del: (p) => call('DELETE', p) };
}
const ok = (r, code = 200) => { assert.equal(r.status, code, JSON.stringify(r.body)); return r.body; };
async function org() {
  const c = client();
  const r = ok(await c.post('/api/auth/register', { org_name: 'DEMO D', name: 'Owner', email: `d${Date.now()}-${++n}@ex.com`, password: 'correct horse battery', station: { name: 'A', currency: 'YER', timezone: 'Asia/Aden' } }), 201);
  const sid = r.station_id, p = `/api/stations/${sid}`;
  const fuel = ok(await c.post(`${p}/fuels`, { name: 'Gasoline', price_e4: 5_000_000, cost_e4: 4_000_000 }), 201).id;
  const tank = ok(await c.post(`${p}/tanks`, { name: 'T1', fuel_id: fuel, capacity_ml: 20_000_000, level_ml: 10_000_000 }), 201).id;
  const pump = ok(await c.post(`${p}/pumps`, { name: 'P1', tank_id: tank, meter_ml: 1_000_000 }), 201).id;
  const accts = ok(await c.get('/api/accounts')); const sys = (k) => accts.find(a => a.sys === k).id;
  return { c, p, sid, pump, sys };
}
const integrity = async (c) => { const r = ok(await c.get('/api/accounting/integrity')); assert.ok(r.ok, JSON.stringify(r.checks.filter(x => !x.ok))); };
const journalOf = async (s, saleId) => (ok(await s.c.get(`${s.p}/journals?source=sale&limit=100&from=2000-01-01&to=2100-01-01`))).find(j => j.source_id === saleId);
async function cashier(s) {
  const email = `cash${Date.now()}-${++n}@ex.com`;
  ok(await s.c.post('/api/users', { name: 'C', email, password: 'cashier password 1', role: 'cashier', station_ids: [s.sid] }), 201);
  const c = client(); ok(await c.post('/api/auth/login', { email, password: 'cashier password 1' })); return c;
}

test('a sale discount is posted to sales discounts, VAT follows what the customer pays, and a void reverses it', async () => {
  const s = await org();
  const sale = ok(await s.c.post(`${s.p}/sales`, { client_id: 'disc-1-' + Date.now(), pump_id: s.pump, quantity_ml: 100_000, pay_type: 'cash', discount: 5_000 }), 201);
  assert.equal(sale.gross, 45_000); assert.equal(sale.discount, 5_000);
  const j = await journalOf(s, sale.id); const line = (sys) => j.lines.find(l => l.account_id === s.sys(sys)) || { debit: 0, credit: 0 };
  assert.equal(line('cash').debit, 45_000); assert.equal(line('sales').credit, 50_000); assert.equal(line('sales_disc').debit, 5_000);
  const is = ok(await s.c.get(`/api/accounting/income-statement?station_id=${s.sid}&from=2000-01-01&to=2100-01-01`));
  assert.equal(is.revenue, 45_000); assert.equal(is.rows.find(r => r.code === '4050').amount, -5_000);
  /* a percentage gives the same; too large is refused; a sale without discount posts no discount line */
  const p10 = ok(await s.c.post(`${s.p}/sales`, { client_id: 'disc-2-' + Date.now(), pump_id: s.pump, quantity_ml: 100_000, pay_type: 'cash', discount_bp: 1000 }), 201);
  assert.equal(p10.discount, 5_000); assert.equal(p10.gross, 45_000);
  assert.equal((await s.c.post(`${s.p}/sales`, { client_id: 'disc-3-' + Date.now(), pump_id: s.pump, quantity_ml: 100_000, discount: 50_000 })).body.error.code, 'DISCOUNT_TOO_LARGE');
  const plain = ok(await s.c.post(`${s.p}/sales`, { client_id: 'disc-4-' + Date.now(), pump_id: s.pump, quantity_ml: 100_000 }), 201);
  assert.ok(!(await journalOf(s, plain.id)).lines.some(l => l.account_id === s.sys('sales_disc')));
  /* VAT 15% included: the customer pays 45,000 incl. VAT; sales show the list price before VAT */
  ok(await s.c.patch(s.p, { vat_bp: 1500, vat_included: true }));
  const v = ok(await s.c.post(`${s.p}/sales`, { client_id: 'disc-5-' + Date.now(), pump_id: s.pump, quantity_ml: 100_000, pay_type: 'cash', discount: 5_000 }), 201);
  const jv = await journalOf(s, v.id); const lv = (sys) => jv.lines.find(l => l.account_id === s.sys(sys)) || { debit: 0, credit: 0 };
  assert.equal(v.gross, 45_000); assert.equal(v.vat, Math.round(45_000 * 1500 / 11500)); assert.equal(lv('vat_out').credit, v.vat);
  assert.equal(lv('sales').credit - lv('sales_disc').debit, v.net); assert.equal(lv('sales').credit, 50_000 - Math.round(50_000 * 1500 / 11500));
  /* only roles with sale.discount may give one */
  const cash = await cashier(s);
  assert.equal((await cash.post(`${s.p}/sales`, { client_id: 'disc-6-' + Date.now(), pump_id: s.pump, quantity_ml: 100_000, discount: 100 })).status, 403);
  /* void */
  ok(await s.c.post(`${s.p}/sales/${sale.id}/void`, { reason: 'wrong discount' }));
  const after = ok(await s.c.get(`/api/accounting/income-statement?station_id=${s.sid}&from=2000-01-01&to=2100-01-01`));
  assert.equal(after.rows.find(r => r.code === '4050').amount, -5_000 - (lv('sales').credit - v.net), 'only the voided discount is gone');
  await integrity(s.c);
});

test('bank reconciliation: tick statement lines, finalise only when they add up, never touches the books', async () => {
  const s = await org(); const bank = s.sys('bank');
  ok(await s.c.post(`${s.p}/vouchers`, { kind: 'receipt', box_account_id: bank, lines: [{ account_id: s.sys('capital'), amount: 100_000 }] }), 201);
  ok(await s.c.post(`${s.p}/vouchers`, { kind: 'payment', box_account_id: bank, lines: [{ account_id: s.sys('exp_rent'), amount: 30_000 }] }), 201);
  ok(await s.c.post(`${s.p}/vouchers`, { kind: 'payment', box_account_id: bank, lines: [{ account_id: s.sys('exp_other'), amount: 5_000 }] }), 201);
  const today = new Date().toISOString().slice(0, 10), later = '2099-12-31';
  const ov = ok(await s.c.get(`${s.p}/bank-recs`)).find(a => a.account_id === bank); assert.equal(ov.book_balance, 65_000);

  /* statement shows the deposit and the rent only */
  let r = ok(await s.c.post(`${s.p}/bank-recs`, { account_id: bank, statement_date: later, statement_balance: 70_000 }), 201);
  assert.equal(r.lines.length, 3); assert.equal(r.summary.book_balance, 65_000); assert.equal(r.summary.difference, 70_000);
  assert.equal((await s.c.post(`${s.p}/bank-recs`, { account_id: bank, statement_date: later, statement_balance: 1 })).body.error.code, 'DRAFT_EXISTS');
  const dep = r.lines.find(l => l.amount === 100_000).id, rent = r.lines.find(l => l.amount === -30_000).id, other = r.lines.find(l => l.amount === -5_000).id;
  r = ok(await s.c.patch(`${s.p}/bank-recs/${r.id}`, { clear: [dep] }));
  assert.equal((await s.c.post(`${s.p}/bank-recs/${r.id}/finalize`)).body.error.code, 'REC_NOT_BALANCED');
  r = ok(await s.c.patch(`${s.p}/bank-recs/${r.id}`, { clear: [rent] }));
  assert.ok(r.summary.balanced); assert.equal(r.summary.outstanding_payments, -5_000); assert.equal(r.summary.book_balance - r.summary.outstanding_payments, r.summary.cleared_balance);
  const first = ok(await s.c.post(`${s.p}/bank-recs/${r.id}/finalize`)); assert.equal(first.status, 'final');
  assert.equal((await s.c.patch(`${s.p}/bank-recs/${r.id}`, { unclear: [dep] })).body.error.code, 'REC_FINAL');

  /* next statement: the earlier lines are already cleared and not offered again */
  let r2 = ok(await s.c.post(`${s.p}/bank-recs`, { account_id: bank, statement_date: later, statement_balance: 65_000 }), 201);
  assert.deepEqual(r2.lines.map(l => l.id), [other]); assert.equal(r2.summary.cleared_before, 70_000);
  assert.equal((await s.c.patch(`${s.p}/bank-recs/${r2.id}`, { clear: [dep] })).body.error.code, 'LINE_ALREADY_CLEARED');
  r2 = ok(await s.c.patch(`${s.p}/bank-recs/${r2.id}`, { clear: [other] })); assert.ok(r2.summary.balanced);
  ok(await s.c.post(`${s.p}/bank-recs/${r2.id}/finalize`));
  assert.equal((await s.c.post(`${s.p}/bank-recs/${first.id}/reopen`)).body.error.code, 'NOT_LATEST');
  assert.equal(ok(await s.c.post(`${s.p}/bank-recs/${r2.id}/reopen`)).status, 'draft');
  ok(await s.c.del(`${s.p}/bank-recs/${r2.id}`));
  assert.equal(ok(await s.c.get(`${s.p}/bank-recs`)).find(a => a.account_id === bank).last_final.id, first.id);

  /* rights and isolation; the books are unchanged */
  const cash = await cashier(s);
  assert.equal((await cash.post(`${s.p}/bank-recs`, { account_id: bank, statement_date: today, statement_balance: 0 })).status, 403);
  const o = await org(); assert.equal((await o.c.get(`${s.p}/bank-recs/${first.id}`)).status, 404);
  assert.equal(ok(await s.c.get(`${s.p}/bank-recs`)).find(a => a.account_id === bank).book_balance, 65_000);
  await integrity(s.c);
});
