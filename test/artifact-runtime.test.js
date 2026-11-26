'use strict';
/* FuelPro Artifact edition (ADR-20): the browser bundle (unchanged src/ + shims) on sql.js.
   Runs real operations through the same HTTP handler the page uses, saves the database file, reopens it in a
   fresh context and checks that every document, journal and balance survived and the books still balance.
   Skips when the sql.js package is not installed (the server itself has zero dependencies; CI installs it). */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

let initSqlJs = null;
try { initSqlJs = require('sql.js/dist/sql-asm-memory-growth.js'); } catch { /* optional */ }
const skip = initSqlJs ? false : 'sql.js not installed (npm i --no-save sql.js@1.10.3)';

/* a page-like global: no Node Buffer/require/process, only what a browser offers */
async function page(bytes) {
  const SQL = await initSqlJs();
  const ctx = { console, TextEncoder, TextDecoder, crypto: globalThis.crypto, setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams, location: { origin: 'https://artifact.test' } };
  ctx.globalThis = ctx; ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(require('../web/bundle').bundleCore(), ctx, { filename: 'fuelpro-core.js' });
  assert.equal(typeof ctx.Buffer, 'undefined', 'the bundle must not rely on a global Buffer');
  ctx.FP_SQLITE = ctx.FP_makeSqlite(SQL); ctx.__FP_DB_BYTES = bytes || null;
  const core = ctx.FPCore.start();
  let cookie = '';
  const call = async (method, path, body) => {
    const r = await core.request(method, path, { headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers['Set-Cookie']; if (sc) cookie = sc.split(';')[0];
    return { status: r.status, body: r.body ? JSON.parse(r.body) : undefined };
  };
  return { core, call, signOut: () => { cookie = ''; } };
}

test('artifact edition: real operations on sql.js, saved, reopened, books still balance', { skip }, async () => {
  const a = await page(null);
  const pw = 'artifact test password 1';
  const reg = await a.call('POST', '/api/auth/register', { org_name: 'DEMO Org', name: 'Owner', email: 'owner@demo.test', password: pw, station: { name: 'S1', currency: 'YER', timezone: 'Asia/Aden' } });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  const p = `/api/stations/${reg.body.station_id}`;
  const fuel = (await a.call('POST', `${p}/fuels`, { name: 'Gasoline', price_e4: 12_000_000, cost_e4: 10_800_000 })).body.id;
  const tank = (await a.call('POST', `${p}/tanks`, { name: 'T1', fuel_id: fuel, capacity_ml: 20_000_000, level_ml: 10_000_000 })).body.id;
  const pump = (await a.call('POST', `${p}/pumps`, { name: 'P1', tank_id: tank, meter_ml: 1_000_000 })).body.id;
  const cust = (await a.call('POST', `${p}/customers`, { name: 'Fleet A', credit_limit: 10_000_000 })).body.id;

  const s1 = await a.call('POST', `${p}/sales`, { client_id: 'cid-art-0001', pump_id: pump, close_ml: 1_150_000, pay_type: 'cash' });
  assert.equal(s1.status, 201, JSON.stringify(s1.body)); assert.equal(s1.body.gross, 180_000);
  const s2 = await a.call('POST', `${p}/sales`, { client_id: 'cid-art-0002', pump_id: pump, close_ml: 1_250_000, pay_type: 'credit', customer_id: cust });
  assert.equal(s2.status, 201, JSON.stringify(s2.body));
  assert.equal((await a.call('POST', `${p}/sales`, { client_id: 'cid-art-0002', pump_id: pump, close_ml: 1_250_000, pay_type: 'credit', customer_id: cust })).body.id, s2.body.id, 'same client_id never duplicates');
  const pay = await a.call('POST', `${p}/payments`, { customer_id: cust, amount: 50_000 });
  assert.ok(pay.status < 300, JSON.stringify(pay.body));
  const exp = await a.call('POST', `${p}/expenses`, { category: 'Maintenance', gross: 12_000 });
  assert.equal(exp.status, 201);
  const v = await a.call('POST', `${p}/expenses/${exp.body.id}/void`, { reason: 'entered twice' });
  assert.ok(v.status < 300, JSON.stringify(v.body));
  assert.equal((await a.call('POST', `${p}/sales/${s1.body.id}/void`, {})).status, 400, 'void needs a written reason');

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Aden' }).format(new Date());   // the station's day (UTC+3); the UTC date is a day behind from 21:00 to 24:00 UTC
  const tb1 = (await a.call('GET', `/api/accounting/trial-balance?to=${today}`)).body;
  const tanks1 = (await a.call('GET', `${p}/tanks`)).body, custs1 = (await a.call('GET', `${p}/customers`)).body;
  assert.equal(tanks1[0].level_ml, 10_000_000 - 250_000);
  const integ1 = await a.call('GET', '/api/accounting/integrity'); assert.equal(integ1.status, 200);

  /* save exactly as the page does (database file bytes), then reopen in a brand-new page */
  const bytes = a.core.engine.bytes();
  assert.ok(bytes.length > 50_000);
  const b = await page(bytes);
  assert.equal((await b.call('GET', '/api/me')).status, 401, 'no session carried over without the cookie');
  assert.equal((await b.call('POST', '/api/auth/login', { email: 'owner@demo.test', password: 'wrong password!' })).status, 401);
  assert.equal((await b.call('POST', '/api/auth/login', { email: 'owner@demo.test', password: pw })).status, 200, 'password hash (scrypt) verifies in the page');
  assert.deepEqual((await b.call('GET', `/api/accounting/trial-balance?to=${today}`)).body, tb1, 'trial balance identical after reopen');
  assert.deepEqual((await b.call('GET', `${p}/tanks`)).body, tanks1);
  assert.deepEqual((await b.call('GET', `${p}/customers`)).body, custs1);
  assert.deepEqual((await b.call('GET', '/api/accounting/integrity')).body, integ1.body, 'integrity report unchanged');
  const sales = (await b.call('GET', `${p}/sales?date=${today}`)).body;
  assert.equal(sales.filter(x => !x.voided_at).length, 2);

  /* posted data stays protected by the database triggers after reopening */
  assert.throws(() => b.core.engine.exec('DELETE FROM journal_lines'), /./, 'posted journal lines cannot be deleted');
  /* and work continues on the reopened copy */
  const s3 = await b.call('POST', `${p}/sales`, { client_id: 'cid-art-0003', pump_id: pump, close_ml: 1_300_000, pay_type: 'cash' });
  assert.equal(s3.status, 201, JSON.stringify(s3.body));
});

test('artifact edition: sign-in is required and permissions are enforced by the bundled server', { skip }, async () => {
  const a = await page(null);
  assert.equal((await a.call('GET', '/api/me')).status, 401);
  assert.equal((await a.call('GET', '/api/accounting/trial-balance?to=2026-01-01')).status, 401);
  assert.equal((await a.call('GET', '/healthz')).status, 200);
  const reg = await a.call('POST', '/api/auth/register', { org_name: 'DEMO', name: 'O', email: 'o@demo.test', password: 'long enough password', station: { currency: 'USD' } });
  assert.equal(reg.status, 201);
  const cashier = await a.call('POST', '/api/users', { email: 'c@demo.test', name: 'C', role: 'cashier', password: 'cashier password 123', station_ids: [reg.body.station_id] });
  assert.ok(cashier.status < 300, JSON.stringify(cashier.body));
  a.signOut();
  assert.equal((await a.call('POST', '/api/auth/login', { email: 'c@demo.test', password: 'cashier password 123' })).status, 200);
  assert.equal((await a.call('GET', '/api/accounting/trial-balance?to=2026-01-01')).status, 403, 'cashier cannot read the books');
});
