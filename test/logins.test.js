'use strict';
/* Sign-in history (0.35.0): what is recorded, who may read it, isolation between organisations, "sign out everywhere". */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/server');
const LOG = require('../src/logins');

let server, db, base;
test.before(async () => {
  const app = createApp({ dbPath: ':memory:', appUrl: 'https://app.example/', mailer: { kind: 'test', send: async () => {} } }); server = app.server; db = app.db;
  await new Promise((r) => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());
function client(ua = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36') {
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'User-Agent': ua, ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const text = await res.text(); return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), patch: (p, b) => call('PATCH', p, b) };
}
const PW = 'correct horse battery';
let n = 0;
async function org() {
  const owner = client(), email = `own${Date.now()}${++n}@example.com`;
  const r = await owner.post('/api/auth/register', { org_name: 'Org', name: 'Owner', email, password: PW, station: { name: 'S', currency: 'YER', timezone: 'Asia/Aden' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const cEmail = `cash${Date.now()}${n}@example.com`;
  const u = await owner.post('/api/users', { name: 'Cashier', email: cEmail, password: PW, role: 'cashier', station_ids: [r.body.station_id] });
  assert.equal(u.status, 201);
  return { owner, email, cashierId: u.body.id, cEmail };
}

test('sign-ins, sign-outs and failed attempts are recorded with time, device and address', async () => {
  const o = await org();
  const cash = client('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36');
  assert.equal((await cash.post('/api/auth/login', { email: o.cEmail, password: 'wrong password!!' })).status, 401);
  assert.equal((await cash.post('/api/auth/login', { email: o.cEmail, password: PW })).status, 200);
  assert.equal((await cash.post('/api/auth/logout')).status, 200);
  assert.equal((await cash.post('/api/auth/login', { email: 'nobody@example.com', password: PW })).status, 401);   // unknown e-mail: not stored
  const h = await o.owner.get('/api/users/logins?user_id=' + o.cashierId);
  assert.equal(h.status, 200);
  assert.deepEqual(h.body.map((r) => [r.kind, r.reason]), [['logout', null], ['login', null], ['failed', 'password']]);
  assert.equal(h.body[1].device, 'Chrome · Windows');
  assert.match(h.body[1].ip, /127\.0\.0\.1/);
  assert.match(h.body[1].at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM login_events WHERE user_id IS NULL").get().n, 0);
  // the owner's own registration counts as his first sign-in
  const all = await o.owner.get('/api/users/logins?kind=login');
  assert.ok(all.body.some((r) => r.email === o.email && r.device === 'Chrome · Android'));
});

test('the user list shows the last sign-in and who is online; the owner can sign a user out everywhere', async () => {
  const o = await org();
  const cash = client();
  await cash.post('/api/auth/login', { email: o.cEmail, password: PW });
  let u = (await o.owner.get('/api/users')).body.find((x) => x.id === o.cashierId);
  assert.equal(u.online, true); assert.equal(u.sessions, 1); assert.ok(u.last_login_at); assert.equal(u.last_login_device, 'Chrome · Android');
  const r = await o.owner.post(`/api/users/${o.cashierId}/signout`);
  assert.deepEqual(r.body, { ok: true, sessions: 1 });
  assert.equal((await cash.get('/api/me')).status, 401, 'the cashier is signed out');
  u = (await o.owner.get('/api/users')).body.find((x) => x.id === o.cashierId);
  assert.equal(u.online, false); assert.equal(u.sessions, 0);
  const h = await o.owner.get('/api/users/logins?kind=signed_out');
  assert.equal(h.body[0].reason, 'Owner');
  const audit = db.prepare("SELECT COUNT(*) n FROM audit WHERE action='user.signout' AND entity_id=?").get(o.cashierId).n;
  assert.equal(audit, 1);
});

test('only the owner/admin reads the history, and only for his own organisation', async () => {
  const a = await org(), b = await org();
  const cash = client(); await cash.post('/api/auth/login', { email: a.cEmail, password: PW });
  assert.equal((await cash.get('/api/users/logins')).status, 403);
  assert.equal((await cash.post(`/api/users/${a.cashierId}/signout`)).status, 403);
  const theirs = await b.owner.get('/api/users/logins');
  assert.ok(theirs.body.every((r) => r.email !== a.cEmail && r.email !== a.email), 'no rows from another organisation');
  assert.equal((await b.owner.get('/api/users/logins?user_id=' + a.cashierId)).status, 404);
  assert.equal((await b.owner.post(`/api/users/${a.cashierId}/signout`)).status, 404);
  assert.equal((await a.owner.get('/api/users/logins?from=2026-02-01&to=2026-01-01')).status, 400);
});

test('device labels', () => {
  assert.equal(LOG.deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'), 'Safari · iOS');
  assert.equal(LOG.deviceLabel('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/131.0 Safari/537.36 Edg/131.0'), 'Edge · Windows');
  assert.equal(LOG.deviceLabel('curl/8.5'), 'Script');
  assert.equal(LOG.deviceLabel(''), null);
});
