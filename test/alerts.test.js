'use strict';
/* Smart alerts: derived from the books, role-checked, station-scoped. */
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
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}) };
}
const ok = (r, code = 200) => { assert.equal(r.status, code, JSON.stringify(r.body)); return r.body; };
const reg = async (c, name) => ok(await c.post('/api/auth/register', { org_name: name, name: 'Owner', email: `al${Date.now()}-${++n}@ex.com`, password: 'correct horse battery', station: { name: 'A', currency: 'YER', timezone: 'Asia/Aden' } }), 201);

test('alerts: quiet when all is well, then stock, credit limit and negative-box alerts appear, most severe first', async () => {
  const c = client();
  const r = await reg(c, 'DEMO A');
  const sid = r.station_id, p = `/api/stations/${sid}`;
  const fuel = ok(await c.post(`${p}/fuels`, { name: 'Gasoline', price_e4: 5_000_000, cost_e4: 4_000_000 }), 201).id;
  const tank = ok(await c.post(`${p}/tanks`, { name: 'T1', fuel_id: fuel, capacity_ml: 20_000_000, level_ml: 10_000_000, min_ml: 6_000_000 }), 201).id;
  const pump = ok(await c.post(`${p}/pumps`, { name: 'P1', tank_id: tank, meter_ml: 1_000_000 }), 201).id;
  const quiet = ok(await c.get(`${p}/alerts`)); assert.equal(quiet.total, 0, JSON.stringify(quiet.alerts));

  const accts = ok(await c.get('/api/accounts')); const sys = (k) => accts.find(a => a.sys === k).id;
  /* a big sale takes the tank below its minimum; a credit sale pushes a customer over his limit; a payment from an empty bank goes negative */
  ok(await c.post(`${p}/sales`, { client_id: 'al-1-' + Date.now(), pump_id: pump, quantity_ml: 5_000_000, pay_type: 'cash' }), 201);
  const cust = ok(await c.post(`${p}/customers`, { name: 'DEMO Co', credit_limit: 1_000, terms_days: 30, opening_balance: 50_000 }), 201).id;
  ok(await c.post(`${p}/vouchers`, { kind: 'payment', box_account_id: sys('bank'), lines: [{ account_id: sys('exp_rent'), amount: 5_000 }] }), 201);
  ok(await c.post(`${p}/shifts`, { float_amount: 0 }), 201);

  const a = ok(await c.get(`${p}/alerts`)); const kinds = a.alerts.map(x => x.kind);
  assert.ok(kinds.includes('stock_low'), kinds.join()); assert.ok(kinds.includes('credit_limit'), kinds.join()); assert.ok(kinds.includes('box_negative'), kinds.join());
  assert.ok(!kinds.includes('shift_open'), 'a fresh shift is not an alert');
  assert.equal(a.counts.critical, a.alerts.filter(x => x.severity === 'critical').length);
  assert.equal(a.alerts[0].severity, 'critical', 'most severe first');
  assert.equal(a.alerts.find(x => x.kind === 'credit_limit').items[0].name, 'DEMO Co');
  assert.equal(a.alerts.find(x => x.kind === 'box_negative').amount, -5_000);

  /* another organisation cannot read them */
  const o = client(); await reg(o, 'DEMO B');
  assert.equal((await o.get(`${p}/alerts`)).status, 404);
});
