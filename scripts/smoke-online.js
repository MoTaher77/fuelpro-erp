'use strict';
/* End-to-end check of a running FuelPro (local or hosted): node scripts/smoke-online.js <base-url> <email> <password> [--write]
   --write also posts a test expense, reads it back and voids it (use it on the DEMO service only: it leaves an audit trail).
   Never prints the password or the session cookie. */
const [base, email, password] = process.argv.slice(2);
const write = process.argv.includes('--write');
if (!base || !email || !password) { console.error('usage: node scripts/smoke-online.js <base-url> <email> <password> [--write]'); process.exit(2); }
let cookie = '', fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
async function call(method, path, body) {
  const r = await fetch(base + path, { method, redirect: 'manual', headers: { 'content-type': 'application/json', cookie, origin: base }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  let j = null; try { j = await r.json(); } catch { /* not JSON */ }
  return { s: r.status, j, h: r.headers };
}
(async () => {
  ok(base.startsWith('https://') || /localhost|127\.0\.0\.1/.test(base), 'address is HTTPS (or local)');
  const hz = await call('GET', '/healthz'); ok(hz.s === 200, 'healthz 200');
  ok(!!hz.h.get('content-security-policy') || !!hz.h.get('x-content-type-options'), 'security headers present');
  ok((await call('GET', '/api/me')).s === 401, 'API closed without sign-in');
  ok((await call('GET', '/api/accounting/trial-balance')).s === 401, 'reports closed without sign-in');
  const bad = await call('POST', '/api/auth/login', { email, password: 'wrong-' + Date.now() }); ok(bad.s === 401 || bad.s === 400 || bad.s === 429, 'wrong password rejected');
  cookie = '';
  const l = await call('POST', '/api/auth/login', { email, password }); ok(l.s === 200 && !!cookie, 'sign-in works');
  if (!cookie) process.exit(1);
  const me = await call('GET', '/api/me'); ok(me.s === 200 && me.j.stations.length > 0, 'session + stations');
  const sid = me.j.stations[0].id;
  const tb = await call('GET', '/api/accounting/trial-balance?to=' + new Date().toISOString().slice(0, 10)); ok(tb.s === 200, 'trial balance loads');
  const dash = await call('GET', `/api/stations/${sid}/dashboard`); ok(dash.s === 200, 'dashboard loads');
  if (write) {
    const e = await call('POST', `/api/stations/${sid}/expenses`, { category: 'Maintenance', gross: 1000, memo: 'smoke test' }); ok(e.s === 201, 'expense posted');
    const list = await call('GET', `/api/stations/${sid}/expenses`); ok(list.s === 200 && list.j.some(x => x.id === e.j.id), 'expense saved and listed');
    const v = await call('POST', `/api/stations/${sid}/expenses/${e.j.id}/void`, { reason: 'smoke test cleanup' }); ok(v.s === 200 || v.s === 201, 'expense voided with reason');
  }
  const out = await call('POST', '/api/auth/logout'); ok(out.s === 200 || out.s === 204, 'sign-out');
  console.log(fails ? `\n${fails} check(s) FAILED` : '\nall checks passed'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('error:', e.message); process.exit(1); });
