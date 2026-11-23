'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/server');

let base, server, db, n = 0;
const outbox = [];
test.before(async () => {
  const app = createApp({ dbPath: ':memory:', appUrl: 'https://app.example/', mailer: { kind: 'test', send: async (m) => { outbox.push(m); } } }); server = app.server; db = app.db;
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise(r => server.close(r)));

function client() {
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const text = await res.text(); let json; try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
    return { status: res.status, body: json };
  };
  return { get: (p) => call('GET', p), post: (p, b, h) => call('POST', p, b ?? {}, h), patch: (p, b) => call('PATCH', p, b), call };
}
const uniq = () => `${Date.now()}-${++n}`;

async function setup({ vatBp = 0, incl = true, price = 12_000_000, level = 10_000_000 } = {}) {
  const c = client(), email = `owner${uniq()}@example.com`;
  const r = await c.post('/api/auth/register', { org_name: 'Org', name: 'Owner', email, password: 'correct horse battery', station: { name: 'S1', currency: 'YER', timezone: 'Asia/Aden' } });
  assert.equal(r.status, 201);
  const sid = r.body.station_id, p = `/api/stations/${sid}`;
  if (vatBp) assert.equal((await c.patch(p, { vat_bp: vatBp, vat_included: incl })).status, 200);
  const fuel = (await c.post(`${p}/fuels`, { name: 'Gasoline', price_e4: price, cost_e4: 10_800_000 })).body.id;
  const tank = (await c.post(`${p}/tanks`, { name: 'T1', fuel_id: fuel, capacity_ml: 20_000_000, level_ml: level })).body.id;
  const pump = (await c.post(`${p}/pumps`, { name: 'P1', tank_id: tank, meter_ml: 1_000_000 })).body.id;
  return { c, sid, p, fuel, tank, pump, email };
}
const sale = (s, over = {}) => s.c.post(`${s.p}/sales`, { client_id: 'cid-' + uniq(), pump_id: s.pump, close_ml: 1_150_000, pay_type: 'cash', ...over });

test('register, me, weak password, duplicate email', async () => {
  const s = await setup(); const me = await s.c.get('/api/me');
  assert.equal(me.body.user.role, 'owner'); assert.equal(me.body.stations.length, 1);
  const weak = await client().post('/api/auth/register', { org_name: 'x', name: 'x', email: `w${uniq()}@e.com`, password: 'short', station: { currency: 'USD' } });
  assert.equal(weak.status, 400); assert.equal(weak.body.error.code, 'WEAK_PASSWORD');
  const dup = await client().post('/api/auth/register', { org_name: 'x', name: 'x', email: s.email, password: 'another long password', station: { currency: 'USD' } });
  assert.equal(dup.status, 409);
});

test('sale by meter reading updates tank and pump atomically', async () => {
  const s = await setup(); const r = await sale(s);
  assert.equal(r.status, 201); assert.equal(r.body.quantity_ml, 150_000); assert.equal(r.body.gross, 180_000);   // 150 L x 1,200 YER
  assert.equal((await s.c.get(`${s.p}/tanks`)).body[0].level_ml, 10_000_000 - 150_000);
  assert.equal((await s.c.get(`${s.p}/pumps`)).body[0].meter_ml, 1_150_000);
});

test('meter must increase; stale form is detected; stock is enforced; price must be set', async () => {
  const s = await setup();
  assert.equal((await sale(s, { close_ml: 1_000_000 })).body.error.code, 'METER_NOT_INCREASING');
  const mm = await sale(s, { expected_open_ml: 999 }); assert.equal(mm.status, 409); assert.equal(mm.body.error.code, 'METER_MISMATCH');
  const low = await setup({ level: 100_000 }); const r = await sale(low);
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'INSUFFICIENT_STOCK'); assert.equal(r.body.error.details.available_ml, 100_000);
  const np = await setup({ price: 0 }); assert.equal((await sale(np)).body.error.code, 'PRICE_NOT_SET');
});

test('retrying the same client_id never duplicates a sale', async () => {
  const s = await setup(); const cid = 'retry-' + uniq();
  const a = await sale(s, { client_id: cid }), b = await sale(s, { client_id: cid });
  assert.equal(a.status, 201); assert.equal(b.status, 200); assert.equal(b.body.duplicate, true); assert.equal(a.body.id, b.body.id);
  assert.equal((await s.c.get(`${s.p}/tanks`)).body[0].level_ml, 10_000_000 - 150_000);
});

test('VAT is computed per sale from station settings (20% included and excluded)', async () => {
  const inc = await setup({ vatBp: 2000, incl: true }); const a = await sale(inc);
  assert.deepEqual([a.body.net, a.body.vat, a.body.gross], [150_000, 30_000, 180_000]);
  const exc = await setup({ vatBp: 2000, incl: false }); const b = await sale(exc);
  assert.deepEqual([b.body.net, b.body.vat, b.body.gross], [180_000, 36_000, 216_000]);
});

test('void restores stock and meter; double void rejected; cashier cannot void', async () => {
  const s = await setup(); const r = await sale(s);
  const cashier = client();
  await s.c.post('/api/users', { name: 'C', email: `c${uniq()}@e.com`, password: 'cashier password 1', role: 'cashier', station_ids: [s.sid] });
  const users = (await s.c.get('/api/users')).body; const cu = users.find(u => u.role === 'cashier');
  await s.c.patch(`/api/users/${cu.id}`, { password: 'cashier password 2' });
  assert.equal((await cashier.post('/api/auth/login', { email: cu.email, password: 'cashier password 2' })).status, 200);
  assert.equal((await cashier.post(`${s.p}/sales/${r.body.id}/void`, { reason: 'mistake' })).status, 403);
  assert.equal((await s.c.post(`${s.p}/sales/${r.body.id}/void`, { reason: 'wrong pump' })).status, 200);
  assert.equal((await s.c.get(`${s.p}/tanks`)).body[0].level_ml, 10_000_000);
  assert.equal((await s.c.get(`${s.p}/pumps`)).body[0].meter_ml, 1_000_000);
  assert.equal((await s.c.post(`${s.p}/sales/${r.body.id}/void`, { reason: 'again' })).status, 409);
  assert.equal((await s.c.post(`${s.p}/sales/${r.body.id}/void`, { reason: '' })).status, 400);
});

test('cashier can sell but cannot change prices or back-date', async () => {
  const s = await setup(); const cashier = client(), email = `c${uniq()}@e.com`;
  await s.c.post('/api/users', { name: 'C', email, password: 'cashier password 1', role: 'cashier', station_ids: [s.sid] });
  await cashier.post('/api/auth/login', { email, password: 'cashier password 1' });
  assert.equal((await cashier.post(`${s.p}/sales`, { client_id: 'c-' + uniq(), pump_id: s.pump, close_ml: 1_100_000 })).status, 201);
  assert.equal((await cashier.patch(`${s.p}/fuels/${s.fuel}`, { price_e4: 1 })).status, 403);
  assert.equal((await cashier.post(`${s.p}/sales`, { client_id: 'c-' + uniq(), pump_id: s.pump, close_ml: 1_200_000, date: '2026-01-01' })).status, 403);
});

test('organisations are isolated from each other', async () => {
  const a = await setup(), b = await setup();
  assert.equal((await b.c.get(`/api/stations/${a.sid}/tanks`)).status, 404);
  assert.equal((await b.c.post(`/api/stations/${a.sid}/sales`, { client_id: 'x-' + uniq(), pump_id: a.pump, close_ml: 1_100_000 })).status, 404);
  assert.equal((await b.c.post(`${b.p}/sales`, { client_id: 'y-' + uniq(), pump_id: a.pump, close_ml: 1_100_000 })).status, 404);   // foreign pump id
  assert.equal((await b.c.get('/api/users')).body.length, 1);
});

test('credit sales, balances and overpayment protection', async () => {
  const s = await setup(); const cust = (await s.c.post(`${s.p}/customers`, { name: 'Acme' })).body.id;
  assert.equal((await sale(s, { pay_type: 'credit' })).status, 400);
  assert.equal((await sale(s, { pay_type: 'credit', customer_id: cust })).status, 201);
  assert.equal((await s.c.get(`${s.p}/customers`)).body[0].balance, 180_000);
  assert.equal((await s.c.post(`${s.p}/payments`, { customer_id: cust, amount: 200_000 })).body.error.code, 'OVERPAYMENT');
  const pay = await s.c.post(`${s.p}/payments`, { customer_id: cust, amount: 80_000 }); assert.equal(pay.body.balance, 100_000);
  await s.c.post(`${s.p}/payments/${pay.body.id}/void`, { reason: 'bounced' });
  assert.equal((await s.c.get(`${s.p}/customers`)).body[0].balance, 180_000);
});

test('deliveries respect capacity; voiding a delivery whose fuel was sold is refused', async () => {
  const s = await setup({ level: 100_000 });
  assert.equal((await s.c.post(`${s.p}/deliveries`, { tank_id: s.tank, quantity_ml: 20_000_000, cost_e4: 10_000_000 })).body.error.code, 'EXCEEDS_CAPACITY');
  const d = await s.c.post(`${s.p}/deliveries`, { tank_id: s.tank, quantity_ml: 1_000_000, cost_e4: 10_000_000 }); assert.equal(d.status, 201);
  assert.equal(d.body.net, 10_000_000 * 1_000_000 / 10_000_000 / 1);   // 1000 L x 1000 YER = 1,000,000
  await sale(s, { close_ml: 1_900_000 });                                  // sells 900 L
  await sale(s, { close_ml: 1_990_000 });                                  // 90 L more; tank now 10 L
  assert.equal((await s.c.post(`${s.p}/deliveries/${d.body.id}/void`, { reason: 'wrong tank' })).body.error.code, 'STOCK_ALREADY_SOLD');
});

test('stock count records before/after and is audited', async () => {
  const s = await setup(); const r = await s.c.post(`${s.p}/adjustments`, { tank_id: s.tank, after_ml: 9_000_000, note: 'dipstick' });
  assert.equal(r.body.before_ml, 10_000_000); assert.equal(r.body.after_ml, 9_000_000);
  const log = (await s.c.get(`${s.p}/audit`)).body; assert.ok(log.some(a => a.action === 'tank.adjust'));
});

test('summary: totals, margin, VAT payable, voided rows excluded', async () => {
  const s = await setup({ vatBp: 2000, incl: true });
  const a = await sale(s); await sale(s, { close_ml: 1_300_000 });
  await s.c.post(`${s.p}/sales/${a.body.id}/void`, { reason: 'test void' });
  await s.c.post(`${s.p}/expenses`, { category: 'Maintenance', gross: 12_000, vat: 2_000 });
  const d = (await s.c.get(`${s.p}/dashboard`)).body, day = d.today;
  const r = (await s.c.get(`${s.p}/summary?from=${day}&to=${day}`)).body;
  assert.equal(r.totals.gross, 180_000); assert.equal(r.totals.vat, 30_000); assert.equal(r.totals.net, 150_000);
  assert.equal(r.gross_margin, 150_000 - 162_000);                       // cost 1,080 YER/L x 150 L = 162,000
  assert.equal(r.vat.output, 30_000); assert.equal(r.vat.input, 2_000); assert.equal(r.vat.payable, 28_000);
  assert.equal(d.sales.gross, 180_000);
});

test('login is throttled after repeated failures', async () => {
  const s = await setup(); const c = client();
  for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/auth/login', { email: s.email, password: 'wrong password!' })).status, 401);
  assert.equal((await c.post('/api/auth/login', { email: s.email, password: 'correct horse battery' })).status, 429);
});

test('cross-origin writes are blocked; unauthenticated calls are refused', async () => {
  const s = await setup();
  const r = await s.c.post(`${s.p}/customers`, { name: 'x' }, { Origin: 'https://evil.example' }); assert.equal(r.status, 403);
  assert.equal((await client().get('/api/me')).status, 401);
});

test('invalid input is rejected with clear errors', async () => {
  const s = await setup();
  assert.equal((await sale(s, { close_ml: 1.5 })).status, 400);
  assert.equal((await sale(s, { close_ml: '1150000' })).status, 400);
  assert.equal((await sale(s, { close_ml: undefined, quantity_ml: undefined })).status, 400);
  assert.equal((await sale(s, { date: '2999-01-01' })).body.error.code, 'FUTURE_DATE');
  assert.equal((await sale(s, { quantity_ml: 6_000_000, close_ml: undefined })).status, 400);
});

test('customer statement has a running balance and ignores voided entries', async () => {
  const s = await setup(); const cust = (await s.c.post(`${s.p}/customers`, { name: 'Acme' })).body.id;
  await sale(s, { pay_type: 'credit', customer_id: cust });                                   // +180,000
  const p = await s.c.post(`${s.p}/payments`, { customer_id: cust, amount: 50_000 });          // -50,000
  const st1 = (await s.c.get(`${s.p}/customers/${cust}/statement`)).body;
  assert.equal(st1.balance, 130_000); assert.deepEqual(st1.entries.map(e => e.balance), [180_000, 130_000]);
  await s.c.post(`${s.p}/payments/${p.body.id}/void`, { reason: 'bounced cheque' });
  const st2 = (await s.c.get(`${s.p}/customers/${cust}/statement`)).body;
  assert.equal(st2.balance, 180_000); assert.equal(st2.entries[1].voided, true);
  const other = await setup(); assert.equal((await other.c.get(`${s.p}/customers/${cust}/statement`)).status, 404);
});

test('change password: needs the current one and signs out other devices', async () => {
  const s = await setup(); const other = client();
  await other.post('/api/auth/login', { email: s.email, password: 'correct horse battery' });
  assert.equal((await other.get('/api/me')).status, 200);
  assert.equal((await s.c.post('/api/auth/change-password', { current: 'wrong', new: 'a brand new password' })).status, 403);
  assert.equal((await s.c.post('/api/auth/change-password', { current: 'correct horse battery', new: 'short' })).status, 400);
  assert.equal((await s.c.post('/api/auth/change-password', { current: 'correct horse battery', new: 'a brand new password' })).status, 200);
  assert.equal((await other.get('/api/me')).status, 401);        // other device signed out
  assert.equal((await s.c.get('/api/me')).status, 200);          // this device stays signed in
  assert.equal((await client().post('/api/auth/login', { email: s.email, password: 'a brand new password' })).status, 200);
});

test('sales export and expense range filter', async () => {
  const s = await setup(); await sale(s); await sale(s, { close_ml: 1_300_000 });
  const day = (await s.c.get(`${s.p}/dashboard`)).body.today;
  const ex = (await s.c.get(`${s.p}/sales/export?from=${day}&to=${day}`)).body;
  assert.equal(ex.length, 2); assert.equal(ex[0].pump_name, 'P1'); assert.equal(ex[0].gross, 180_000);
  assert.equal((await s.c.get(`${s.p}/sales/export?from=${day}&to=2000-01-01`)).status, 400);
  await s.c.post(`${s.p}/expenses`, { category: 'Rent', gross: 5000 });
  assert.equal((await s.c.get(`${s.p}/expenses?from=${day}&to=${day}`)).body.length, 1);
  assert.equal((await s.c.get(`${s.p}/expenses?from=2000-01-01&to=2000-01-31`)).body.length, 0);
});

test('summary warns when sales have no purchase cost (margin would be overstated)', async () => {
  const s = await setup(); const noCost = await s.c.post(`${s.p}/fuels`, { name: 'Diesel', price_e4: 12_500_000 });   // cost_e4 defaults to 0
  const tk = (await s.c.post(`${s.p}/tanks`, { name: 'T2', fuel_id: noCost.body.id, capacity_ml: 20_000_000, level_ml: 10_000_000 })).body.id;
  const pm = (await s.c.post(`${s.p}/pumps`, { name: 'P2', tank_id: tk, meter_ml: 0 })).body.id;
  await s.c.post(`${s.p}/sales`, { client_id: 'nc-' + uniq(), pump_id: pm, close_ml: 100_000 });
  const day = (await s.c.get(`${s.p}/dashboard`)).body.today;
  assert.equal((await s.c.get(`${s.p}/summary?from=${day}&to=${day}`)).body.rows_without_cost, 1);
  await sale(s);   // this fuel has a cost
  assert.equal((await s.c.get(`${s.p}/summary?from=${day}&to=${day}`)).body.rows_without_cost, 1);
});

/* ---------- password reset ---------- */
const TOTP = require('../src/totp');
const tokenFrom = (m) => /#reset=([A-Za-z0-9_-]{43})/.exec(m.text)[1];

test('forgot password: same answer for unknown email, reset link works once and signs out everywhere', async () => {
  const s = await setup();
  const before = outbox.length;
  const unk = await client().post('/api/auth/forgot', { email: `nobody${uniq()}@example.com` });
  assert.equal(unk.status, 200); assert.deepEqual(unk.body, { ok: true });
  const r = await client().post('/api/auth/forgot', { email: s.email, lang: 'ar' });
  assert.deepEqual(r.body, { ok: true });
  await new Promise(r => setImmediate(r));
  assert.equal(outbox.length, before + 1);
  const m = outbox.at(-1); assert.equal(m.to, s.email); assert.match(m.text, /^مرحباً/); assert.match(m.text, /https:\/\/app\.example\/#reset=/);
  const token = tokenFrom(m);
  const weak = await client().post('/api/auth/reset', { token, password: 'short' }); assert.equal(weak.body.error.code, 'WEAK_PASSWORD');
  const ok = await client().post('/api/auth/reset', { token, password: 'a brand new passphrase' }); assert.equal(ok.status, 200);
  assert.equal((await s.c.get('/api/me')).status, 401);                                    // old session gone
  assert.equal((await client().post('/api/auth/reset', { token, password: 'another passphrase 2' })).body.error.code, 'RESET_INVALID');   // single use
  assert.equal((await client().post('/api/auth/login', { email: s.email, password: 'correct horse battery' })).status, 401);
  assert.equal((await client().post('/api/auth/login', { email: s.email, password: 'a brand new passphrase' })).status, 200);
  assert.equal((await client().post('/api/auth/reset', { token: 'x'.repeat(43), password: 'a brand new passphrase' })).body.error.code, 'RESET_INVALID');
});

test('reset link expires; requests are rate limited', async () => {
  const s = await setup();
  await client().post('/api/auth/forgot', { email: s.email }); await new Promise(r => setImmediate(r));
  const token = tokenFrom(outbox.at(-1));
  db.prepare('UPDATE reset_tokens SET expires_at=?').run(Date.now() - 1);
  assert.equal((await client().post('/api/auth/reset', { token, password: 'a brand new passphrase' })).body.error.code, 'RESET_INVALID');
  await client().post('/api/auth/forgot', { email: s.email });
  await client().post('/api/auth/forgot', { email: s.email });
  const lim = await client().post('/api/auth/forgot', { email: s.email });
  assert.equal(lim.status, 429);
});

/* ---------- two-factor ---------- */
const codeFor = (secret, offset = 0) => TOTP.totp(TOTP.b32decode(secret), Date.now() + offset);
async function with2fa() {
  const s = await setup();
  const st = await s.c.post('/api/auth/2fa/setup', { password: 'correct horse battery' });
  assert.equal(st.status, 200); assert.match(st.body.uri, /^otpauth:\/\/totp\/FuelPro%3Aowner/); assert.equal(TOTP.b32decode(st.body.secret).length, 20);
  return { ...s, secret: st.body.secret };
}

test('2FA: setup needs password, enable needs a valid code, login then needs a code', async () => {
  const s0 = await setup();
  assert.equal((await s0.c.post('/api/auth/2fa/setup', { password: 'wrong password!!' })).status, 403);
  const s = await with2fa();
  assert.equal((await s.c.post('/api/auth/2fa/enable', { code: '000000' })).body.error.code, 'BAD_TOTP');
  const en = await s.c.post('/api/auth/2fa/enable', { code: codeFor(s.secret) });
  assert.equal(en.status, 200); assert.equal(en.body.recovery_codes.length, 10); assert.match(en.body.recovery_codes[0], /^[A-Z2-7]{5}-[A-Z2-7]{5}$/);
  const me = await s.c.get('/api/me'); assert.equal(me.body.user.totp, true); assert.equal(me.body.user.recovery_left, 10); assert.equal(me.body.user.sid, undefined);
  assert.equal((await s.c.post('/api/auth/2fa/setup', { password: 'correct horse battery' })).body.error.code, 'TOTP_ALREADY_ON');
  const creds = { email: s.email, password: 'correct horse battery' };
  assert.equal((await client().post('/api/auth/login', creds)).body.error.code, 'TOTP_REQUIRED');
  assert.equal((await client().post('/api/auth/login', { ...creds, code: '123456' })).body.error.code, 'BAD_TOTP');
  // the code used to enable cannot be replayed
  assert.equal((await client().post('/api/auth/login', { ...creds, code: codeFor(s.secret) })).body.error.code, 'BAD_TOTP');
  db.prepare('UPDATE users SET totp_last_step=0 WHERE email=?').run(s.email);
  const c = client(); assert.equal((await c.post('/api/auth/login', { ...creds, code: codeFor(s.secret) })).status, 200);
  assert.equal((await client().post('/api/auth/login', { ...creds, code: codeFor(s.secret) })).body.error.code, 'BAD_TOTP');   // replay blocked
  // wrong password never reveals the 2FA step
  assert.equal((await client().post('/api/auth/login', { email: s.email, password: 'wrong password!!' })).body.error.code, 'BAD_CREDENTIALS');
  // recovery code works exactly once, lower-case and without dash accepted
  const rc = en.body.recovery_codes[3];
  assert.equal((await client().post('/api/auth/login', { ...creds, code: rc.toLowerCase().replace('-', '') })).status, 200);
  assert.equal((await client().post('/api/auth/login', { ...creds, code: rc })).body.error.code, 'BAD_TOTP');
  assert.equal((await c.get('/api/me')).body.user.recovery_left, 9);
});

test('2FA: disable needs password and code; owner can reset a staff member; secrets sealed with APP_SECRET', async () => {
  process.env.APP_SECRET = 'test-secret-for-sealing-0123456789';
  try {
    const s = await with2fa();
    const row = db.prepare('SELECT totp_secret FROM users WHERE email=?').get(s.email);
    assert.match(row.totp_secret, /^g:/); assert.ok(!row.totp_secret.includes(s.secret));
    const en = await s.c.post('/api/auth/2fa/enable', { code: codeFor(s.secret) }); assert.equal(en.status, 200);
    assert.equal((await s.c.post('/api/auth/2fa/disable', { password: 'correct horse battery', code: '000000' })).status, 403);
    assert.equal((await s.c.post('/api/auth/2fa/disable', { password: 'nope nope nope', code: en.body.recovery_codes[0] })).status, 403);
    const nc = await s.c.post('/api/auth/2fa/recovery-codes', { password: 'correct horse battery', code: en.body.recovery_codes[0] });
    assert.equal(nc.status, 200); assert.notEqual(nc.body.recovery_codes[1], en.body.recovery_codes[1]);
    assert.equal((await s.c.post('/api/auth/2fa/disable', { password: 'correct horse battery', code: en.body.recovery_codes[1] })).status, 403);   // old set revoked
    assert.equal((await s.c.post('/api/auth/2fa/disable', { password: 'correct horse battery', code: nc.body.recovery_codes[0] })).status, 200);
    assert.equal((await s.c.get('/api/me')).body.user.totp, false);
    // staff member turns on 2FA, owner resets it
    const email = `cash${uniq()}@example.com`;
    const u = await s.c.post('/api/users', { name: 'Cash', email, role: 'cashier', password: 'cashier password 1', station_ids: [s.sid] });
    const cc = client(); await cc.post('/api/auth/login', { email, password: 'cashier password 1' });
    const st = await cc.post('/api/auth/2fa/setup', { password: 'cashier password 1' });
    await cc.post('/api/auth/2fa/enable', { code: codeFor(st.body.secret) });
    assert.equal((await client().post('/api/auth/login', { email, password: 'cashier password 1' })).body.error.code, 'TOTP_REQUIRED');
    assert.equal((await s.c.patch(`/api/users/${u.body.id}`, { reset_2fa: true })).status, 200);
    assert.equal((await client().post('/api/auth/login', { email, password: 'cashier password 1' })).status, 200);
    assert.equal((await cc.get('/api/me')).status, 401);
  } finally { delete process.env.APP_SECRET; }
});
