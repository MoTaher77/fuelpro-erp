'use strict';
/* Account tree, cash & bank boxes, receipt / payment vouchers, ledger-based party balances, daily meter sheet. */
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

test('account tree: groups roll up their children; group accounts cannot be posted to; boxes are listed', async () => {
  const s = await org();
  const g = ok(await s.c.post('/api/accounts', { code: '122', type: 'asset', name_ar: 'بنوك', is_group: true }), 201).id;
  const kur = ok(await s.c.post('/api/accounts', { code: '122001', type: 'asset', name_ar: 'بنك الكريمي', parent_id: g, box: 'bank' }), 201).id;
  assert.equal((await s.c.post('/api/accounts', { code: '122002', type: 'asset', name_ar: 'x', parent_id: kur })).body.error.code, 'PARENT_NOT_GROUP');
  assert.equal((await s.c.patch(`/api/accounts/${g}`, { parent_id: g })).body.error.code, 'PARENT_CYCLE');
  const boxes = ok(await s.c.get('/api/boxes'));
  assert.ok(boxes.some(b => b.id === kur) && boxes.some(b => b.sys === 'cash'));
  // deposit 300,000 from the drawer into the bank with a payment voucher
  ok(await s.c.post(`${s.p}/sales`, { client_id: 'c-' + Date.now(), pump_id: s.pump, quantity_ml: 100_000, pay_type: 'cash' }), 201);   // 100 L x 500 = 50,000
  ok(await s.c.post(`${s.p}/vouchers`, { kind: 'payment', box_account_id: s.sys('cash'), lines: [{ account_id: kur, amount: 30_000 }] }), 201);
  const tree = ok(await s.c.get('/api/accounts/tree')).rows;
  assert.equal(tree.find(a => a.id === g).balance, 30_000);
  assert.equal(tree.find(a => a.sys === 'cash').balance, 20_000);
  assert.equal((await s.c.post(`${s.p}/vouchers`, { kind: 'payment', box_account_id: s.sys('cash'), lines: [{ account_id: g, amount: 1 }] })).body.error.code, 'GROUP_ACCOUNT');
  assert.equal((await s.c.post(`${s.p}/vouchers`, { kind: 'payment', box_account_id: g, lines: [{ account_id: kur, amount: 1 }] })).body.error.code, 'NOT_A_BOX');
  await integrity(s.c);
});

test('vouchers move customer and supplier balances, show on statements and ageing, count in the shift, and void cleanly', async () => {
  const s = await org();
  const cust = ok(await s.c.post(`${s.p}/customers`, { name: 'Co' }), 201).id;
  const sup = ok(await s.c.post(`${s.p}/suppliers`, { name: 'Oil Co', opening_balance: 500_000 }), 201).id;
  ok(await s.c.post(`${s.p}/sales`, { client_id: 'c-' + Date.now(), pump_id: s.pump, quantity_ml: 400_000, pay_type: 'credit', customer_id: cust }), 201);   // 200,000 on credit
  ok(await s.c.post(`${s.p}/shifts`, { float_amount: 0 }), 201);
  assert.equal((await s.c.post(`${s.p}/vouchers`, { kind: 'receipt', box_account_id: s.sys('cash'), lines: [{ account_id: s.sys('ar'), amount: 1000 }] })).body.error.code, 'VALIDATION');   // needs the customer
  const rv = ok(await s.c.post(`${s.p}/vouchers`, { kind: 'receipt', box_account_id: s.sys('cash'), ref_no: 'R-1', memo: 'collection', lines: [{ account_id: s.sys('ar'), party_id: cust, amount: 120_000 }] }), 201);
  ok(await s.c.post(`${s.p}/vouchers`, { kind: 'payment', box_account_id: s.sys('cash'), lines: [{ account_id: s.sys('ap'), party_id: sup, amount: 100_000 }, { account_id: s.sys('exp_power'), amount: 5_000 }] }), 201);
  assert.equal(ok(await s.c.get(`${s.p}/customers`)).find(c => c.id === cust).balance, 80_000);
  assert.equal(ok(await s.c.get(`${s.p}/suppliers`)).find(x => x.id === sup).balance, 400_000);
  const st = ok(await s.c.get(`${s.p}/customers/${cust}/statement`));
  assert.equal(st.balance, 80_000); assert.equal(st.entries.at(-1).kind, 'journal'); assert.equal(st.entries.at(-1).ref_no, 'R-1');
  const ss = ok(await s.c.get(`${s.p}/suppliers/${sup}/statement`)); assert.equal(ss.balance, 400_000);
  const ag = ok(await s.c.get(`${s.p}/ageing?type=customer`)).rows.find(r => r.id === cust); assert.equal(ag.balance, 80_000);
  const sh = ok(await s.c.get(`${s.p}/shifts/current`)).shift;
  assert.equal(sh.totals.voucher_receipts, 120_000); assert.equal(sh.totals.voucher_payments, 105_000); assert.equal(sh.totals.expected_cash, 15_000);
  const list = ok(await s.c.get(`${s.p}/vouchers?q=collection`)); assert.equal(list.rows.length, 1); assert.equal(list.rows[0].lines[0].party_name, 'Co');
  ok(await s.c.post(`${s.p}/vouchers/${rv.id}/void`, { reason: 'typed twice' }));
  assert.equal(ok(await s.c.get(`${s.p}/customers`)).find(c => c.id === cust).balance, 200_000);
  assert.equal(ok(await s.c.get(`${s.p}/customers/${cust}/statement`)).balance, 200_000);
  await integrity(s.c);
});

test('manual journals: receivable lines need a customer, stock lines are refused', async () => {
  const s = await org();
  const cust = ok(await s.c.post(`${s.p}/customers`, { name: 'Co' }), 201).id;
  const base = { memo: 'settlement discount', post: true };
  assert.equal((await s.c.post(`${s.p}/journals`, { ...base, lines: [{ account_id: s.sys('exp_other'), debit: 1000 }, { account_id: s.sys('ar'), credit: 1000 }] })).body.error.code, 'VALIDATION');
  assert.equal((await s.c.post(`${s.p}/journals`, { ...base, lines: [{ account_id: s.sys('exp_other'), debit: 1000 }, { account_id: s.sys('inventory'), credit: 1000 }] })).body.error.code, 'USE_STOCK_SCREENS');
  ok(await s.c.post(`${s.p}/journals`, { ...base, lines: [{ account_id: s.sys('ar'), party_id: cust, debit: 1000 }, { account_id: s.sys('other_income'), credit: 1000 }] }), 201);
  assert.equal(ok(await s.c.get(`${s.p}/customers`)).find(c => c.id === cust).balance, 1000);
  await integrity(s.c);
});

test('daily meter sheet groups sales by day and pump with first and last readings', async () => {
  const s = await org();
  const cust = ok(await s.c.post(`${s.p}/customers`, { name: 'Co' }), 201).id;
  ok(await s.c.post(`${s.p}/sales`, { client_id: 'a-' + Date.now(), pump_id: s.pump, quantity_ml: 100_000, pay_type: 'cash' }), 201);
  ok(await s.c.post(`${s.p}/sales`, { client_id: 'b-' + Date.now(), pump_id: s.pump, quantity_ml: 50_000, pay_type: 'credit', customer_id: cust }), 201);
  const r = ok(await s.c.get(`${s.p}/reports/meters`));
  assert.equal(r.days.length, 1); const p = r.days[0].pumps[0];
  assert.equal(p.open_ml, 1_000_000); assert.equal(p.close_ml, 1_150_000); assert.equal(p.qty_ml, 150_000);
  assert.equal(p.cash, 50_000); assert.equal(p.credit, 25_000); assert.equal(r.totals.amount, 75_000);
});

test('price changes are kept in the price history; the ledger shows each line with its document', async () => {
  const s = await org();
  const fuel = ok(await s.c.get(`${s.p}/fuels`))[0];
  ok(await s.c.patch(`${s.p}/fuels/${fuel.id}`, { price_e4: 5_500_000, note: 'official rise' }));
  ok(await s.c.patch(`${s.p}/fuels/${fuel.id}`, { price_e4: 5_500_000 }));            // same price: no new row
  const hist = ok(await s.c.get(`${s.p}/price-history`));
  assert.equal(hist.length, 1); assert.equal(hist[0].old_price_e4, 5_000_000); assert.equal(hist[0].price_e4, 5_500_000); assert.equal(hist[0].note, 'official rise');
  const v = ok(await s.c.post(`${s.p}/vouchers`, { kind: 'payment', box_account_id: s.sys('cash'), ref_no: 'P-9', lines: [{ account_id: s.sys('exp_power'), amount: 700, memo: 'diesel for generator' }] }), 201);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Aden' }).format(new Date());
  const lg = ok(await s.c.get(`/api/accounting/ledger?station_id=${s.p.split('/').pop()}&account_id=${s.sys('exp_power')}&to=${today}`));
  assert.equal(lg.lines.length, 1); assert.equal(lg.lines[0].ref, 'P-9'); assert.equal(lg.lines[0].memo, 'diesel for generator'); assert.ok(v.id);
});

test('sales register, purchase invoices, monthly profit, voucher numbering and journal search', async () => {
  const s = await org(); const sid = s.p.split('/').pop();
  const cust = ok(await s.c.post(`${s.p}/customers`, { name: 'Fleet Co' }), 201).id;
  const sup = ok(await s.c.post(`${s.p}/suppliers`, { name: 'Oil Co' }), 201).id;
  const tank = ok(await s.c.get(`${s.p}/tanks`))[0];
  ok(await s.c.post(`${s.p}/sales`, { client_id: 'a-' + Date.now(), pump_id: s.pump, quantity_ml: 100_000, pay_type: 'cash' }), 201);
  ok(await s.c.post(`${s.p}/sales`, { client_id: 'b-' + Date.now(), pump_id: s.pump, quantity_ml: 40_000, pay_type: 'credit', customer_id: cust }), 201);
  const reg = ok(await s.c.get(`${s.p}/sales-register`));
  assert.equal(reg.bills.length, 2); assert.equal(reg.totals.amount, 70_000); assert.equal(reg.totals.credit, 20_000);
  const bill = ok(await s.c.get(`${s.p}/sales-register/${encodeURIComponent(reg.bills[0].bill)}`)); assert.equal(bill.rows.length, 1);
  assert.equal(ok(await s.c.get(`${s.p}/sales-register?pay_type=credit`)).bills.length, 1);
  const d1 = ok(await s.c.post(`${s.p}/deliveries`, { tank_id: tank.id, quantity_ml: 1_000_000, cost_e4: 4_000_000, pay_type: 'credit', supplier_id: sup, note: 'فاتورة مشتريات 1000 لتر' }), 201);
  const d2 = ok(await s.c.post(`${s.p}/deliveries`, { tank_id: tank.id, quantity_ml: 500_000, cost_e4: 4_000_000, pay_type: 'cash' }), 201);
  assert.equal(d1.ref, '1'); assert.equal(d2.ref, '2');
  const pu = ok(await s.c.get(`${s.p}/purchases?q=${encodeURIComponent('1000 لتر')}`)); assert.equal(pu.rows.length, 1); assert.equal(pu.rows[0].payable, 400_000);
  const pd = ok(await s.c.get(`${s.p}/purchases/${d1.id}`)); assert.ok(pd.lines.length >= 2);
  const v1 = ok(await s.c.post(`${s.p}/vouchers`, { kind: 'receipt', box_account_id: s.sys('cash'), lines: [{ account_id: s.sys('ar'), party_id: cust, amount: 5_000, memo: 'تسديد دفعة' }] }), 201);
  const v2 = ok(await s.c.post(`${s.p}/vouchers`, { kind: 'receipt', box_account_id: s.sys('cash'), lines: [{ account_id: s.sys('other_income'), amount: 1_000 }] }), 201);
  assert.equal(ok(await s.c.get(`${s.p}/vouchers/${v1.id}`)).ref_no, '1'); assert.equal(ok(await s.c.get(`${s.p}/vouchers/${v2.id}`)).ref_no, '2');
  assert.equal(ok(await s.c.get(`${s.p}/journals?q=${encodeURIComponent('تسديد دفعة')}`)).length, 1);
  const pl = ok(await s.c.get(`/api/accounting/profit-by-month?station_id=${sid}`));
  const m = pl.months.at(-1); assert.equal(m.revenue, 70_000); assert.equal(m.gross_profit, m.revenue - m.cost_of_sales); assert.equal(pl.fuels.length, 1);
});

test('foreign-currency box: vouchers in the currency, statement balance in both, revaluation posts the difference', async () => {
  const s = await org(); const sid = s.p.split('/').pop();
  ok(await s.c.post('/api/currencies', { code: 'SAR', name_ar: 'ريال سعودي', decimals: 2, rate_e6: 140_000_000, date: '2026-01-01' }));
  const box = ok(await s.c.post('/api/accounts', { code: '121003', type: 'asset', name_ar: 'الصندوق / سعودي', box: 'cash', currency: 'SAR' }), 201).id;
  ok(await s.c.post(`${s.p}/vouchers`, { kind: 'receipt', box_account_id: box, lines: [{ account_id: s.sys('other_income'), fc_amount: 100_00 }] }), 201);   // 100 SAR at 140
  assert.equal(ok(await s.c.get('/api/accounts/tree')).rows.find(a => a.id === box).balance, 14_000);
  ok(await s.c.post('/api/currencies/rates', { code: 'SAR', rate_e6: 150_000_000 }));
  const rv = ok(await s.c.get(`/api/accounting/revaluation?station_id=${sid}`)).rows.find(r => r.account_id === box);
  assert.equal(rv.fc_balance, 10_000); assert.equal(rv.book, 14_000); assert.equal(rv.worth, 15_000); assert.equal(rv.diff, 1_000);
  ok(await s.c.post('/api/accounting/revaluation', { station_id: sid }), 201);
  assert.equal(ok(await s.c.get(`/api/accounting/revaluation?station_id=${sid}`)).rows.find(r => r.account_id === box).diff, 0);
  assert.equal((await s.c.post('/api/accounting/revaluation', { station_id: sid })).body.error.code, 'NOTHING_TO_POST');
});

test('fixed assets: straight-line depreciation posts once a month and stops at the depreciable amount', async () => {
  const s = await org();
  const acc = ok(await s.c.post('/api/accounts', { code: '113001', type: 'asset', name_ar: 'مولد' }), 201).id;
  const a = ok(await s.c.post(`${s.p}/assets`, { name: 'مولد كهرباء', account_id: acc, acquired_on: '2026-01-01', cost: 1_200_000, salvage: 0, life_months: 12, opening_accum: 1_000_000 }), 201).id;
  const r1 = ok(await s.c.post(`${s.p}/assets/depreciate`, { month: '2026-02' }), 201); assert.equal(r1.total, 100_000);
  assert.equal(ok(await s.c.post(`${s.p}/assets/depreciate`, { month: '2026-02' }), 201).total, 0);               // once a month
  ok(await s.c.post(`${s.p}/assets/depreciate`, { month: '2026-03' }), 201);
  assert.equal(ok(await s.c.post(`${s.p}/assets/depreciate`, { month: '2026-04' }), 201).total, 0);                 // fully depreciated
  const row = ok(await s.c.get(`${s.p}/assets`)).find(x => x.id === a);
  assert.equal(row.accumulated, 1_200_000); assert.equal(row.book_value, 0); assert.equal(row.last_month, '2026-03');
});

test('monthly stock reconciliation and a shortage charged to the supplier', async () => {
  const s = await org();
  const sup = ok(await s.c.post(`${s.p}/suppliers`, { name: 'Gas Co' }), 201).id;
  const tank = ok(await s.c.get(`${s.p}/tanks`))[0];
  ok(await s.c.post(`${s.p}/sales`, { client_id: 'm-' + Date.now(), pump_id: s.pump, quantity_ml: 2_000_000, pay_type: 'cash' }), 201);   // 2,000 L sold
  const adj = ok(await s.c.post(`${s.p}/adjustments`, { tank_id: tank.id, after_ml: 7_990_000, note: 'monthly dip', charge_supplier_id: sup }), 201);   // 10 L short
  assert.equal(adj.diff_ml, -10_000);
  assert.equal(ok(await s.c.get(`${s.p}/suppliers`)).find(x => x.id === sup).balance, -4_000);   // 10 L x 400 charged back to the supplier
  const r = ok(await s.c.get(`${s.p}/stock/monthly`));
  const m = r.tanks[0].months.at(-1);
  assert.equal(m.sold_ml, 2_000_000); assert.equal(m.shortage_ml, 10_000); assert.equal(m.loss_bp, 50); assert.equal(m.over_tolerance, false); assert.equal(m.closing_ml, 7_990_000);
  await integrity(s.c);
});

test('backups: a consistent copy can be made, listed and downloaded by the owner only', async () => {
  const os = require('node:os'), fs = require('node:fs'), path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-bk-')); process.env.BACKUP_DIR = path.join(dir, 'bk'); process.env.BACKUP_AUTO = '0';
  const app = createApp({ dbPath: path.join(dir, 'fp.db'), mailer: { send: async () => {} } });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r)); const b = `http://127.0.0.1:${app.server.address().port}`;
  let cookie = ''; const call = async (m, p, body) => { const res = await fetch(b + p, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; return res; };
  await call('POST', '/api/auth/register', { org_name: 'DEMO Bk', name: 'O', email: `bk${Date.now()}@ex.com`, password: 'correct horse battery', station: { name: 'A', currency: 'YER', timezone: 'Asia/Aden' } });
  const made = await (await call('POST', '/api/backups')).json(); assert.match(made.name, /^fuelpro-.*-manual\.db$/);
  const list = await (await call('GET', '/api/backups')).json(); assert.equal(list.rows.length, 1);
  const dl = await call('GET', '/api/backups/' + made.name); assert.equal(dl.status, 200); assert.equal((await dl.arrayBuffer()).byteLength, made.bytes);
  assert.equal((await call('GET', '/api/backups/..%2Ffp.db')).status, 404);
  await new Promise(r => app.server.close(r)); delete process.env.BACKUP_DIR; delete process.env.BACKUP_AUTO;
});
