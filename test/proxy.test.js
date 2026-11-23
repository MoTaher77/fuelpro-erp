'use strict';
/* Running behind Cloudflare Tunnel (TRUST_PROXY=1, COOKIE_SECURE=1): a forged X-Forwarded-For must not get around the
   sign-in lockout, cookies are Secure, and HSTS is sent. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/server');

let base, server;
test.before(async () => {
  const app = createApp({ dbPath: ':memory:', mailer: { send: async () => {} }, trustProxy: true, secureCookie: true }); server = app.server;
  await new Promise(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise(r => server.close(r)));
const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('behind the tunnel: forged X-Forwarded-For does not reset the lockout; Secure cookie and HSTS', async () => {
  const email = `px${Date.now()}@ex.com`;
  const reg = await post('/api/auth/register', { org_name: 'DEMO P', name: 'Owner', email, password: 'correct horse battery', station: { name: 'A', currency: 'YER', timezone: 'Asia/Aden' } });
  assert.equal(reg.status, 201);
  assert.match(reg.headers.get('set-cookie'), /; Secure/);
  assert.match(reg.headers.get('strict-transport-security') || '', /max-age=/);
  const cf = { 'CF-Connecting-IP': '203.0.113.7' };
  for (let i = 0; i < 5; i++) assert.equal((await post('/api/auth/login', { email, password: 'wrong password ' + i }, { ...cf, 'X-Forwarded-For': `198.51.100.${i}, 203.0.113.7` })).status, 401);
  const r = await post('/api/auth/login', { email, password: 'correct horse battery' }, { ...cf, 'X-Forwarded-For': '198.51.100.99, 203.0.113.7' });
  assert.equal(r.status, 429, 'still locked although the first X-Forwarded-For entry changed');
  /* another client (another real address) is not affected */
  assert.equal((await post('/api/auth/login', { email, password: 'correct horse battery' }, { 'CF-Connecting-IP': '203.0.113.8' })).status, 200);
});
