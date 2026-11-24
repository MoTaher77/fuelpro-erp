'use strict';
/* Public-server setting (docs/VPS.md): REGISTRATION=open | first | closed. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/server');

async function start(registration) {
  const app = createApp({ dbPath: ':memory:', registration, mailer: { send: async () => {} } });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const reg = (email) => fetch(base + '/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ org_name: 'Org', name: 'Owner', email, password: 'correct horse battery', station: { name: 'S1', currency: 'YER', timezone: 'Asia/Aden' } }) });
  const health = async () => (await (await fetch(base + '/api/health')).json()).register;
  return { reg, health, close: () => new Promise(r => app.server.close(r)) };
}

test('REGISTRATION=first: the first organisation can register, the next one gets 403 REGISTRATION_CLOSED', async () => {
  const s = await start('first');
  assert.equal(await s.health(), true);
  assert.equal((await s.reg('a@example.com')).status, 201);
  assert.equal(await s.health(), false, 'the sign-in page stops offering «create account»');
  const r = await s.reg('b@example.com'); assert.equal(r.status, 403);
  assert.equal((await r.json()).error.code, 'REGISTRATION_CLOSED');
  await s.close();
});

test('REGISTRATION=closed refuses even the first; open (the default) keeps today\'s behaviour', async () => {
  const c = await start('closed'); assert.equal((await c.reg('c@example.com')).status, 403); assert.equal(await c.health(), false); await c.close();
  const o = await start('open'); assert.equal((await o.reg('d@example.com')).status, 201); assert.equal((await o.reg('e@example.com')).status, 201); assert.equal(await o.health(), true); await o.close();
});
