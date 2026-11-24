// @ts-check
'use strict';
/* Load / concurrency test (docs/PERFORMANCE.md §stress). Many simultaneous users on a COPY of a demo database:
   reads (dashboard, customers, statements, trial balance, ledger) mixed with writes (sales by quantity, some sent twice with the
   same client_id as a network retry would, and expenses). At the end it checks the books: no 5xx, no duplicate sale, every retry
   answered with the first sale, the integrity self-check still OK, journals balanced.
   Usage: node scripts/stress-api.js --db <demo copy> --password <pw> [--email demo@fuelpro.demo] [--users 20] [--seconds 20]
   It WRITES to the database: only ever give it a throwaway copy (it refuses data/fuelpro.db and the snapshot). */
const path = require('path');
const fs = require('fs');
const { createApp } = require('../src/server');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const dbPath = path.resolve(arg('--db', ''));
const email = arg('--email', 'demo@fuelpro.demo');
const password = arg('--password', process.env.BENCH_PASSWORD || '');
const USERS = Number(arg('--users', 20)), SECONDS = Number(arg('--seconds', 20));
if (!dbPath || !fs.existsSync(dbPath)) { console.error('--db <throwaway copy of a demo database> is required'); process.exit(1); }
if (/[\\/]data[\\/]fuelpro\.db$/.test(dbPath) || /fuelpro-snapshot\.db$/.test(dbPath)) { console.error('refusing: this script writes; use a throwaway copy'); process.exit(1); }

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)] : 0; };

(async () => {
  const { server, db } = createApp({ dbPath, mailer: { kind: 'none', send: async () => {} } });
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(null)));
  const base = `http://127.0.0.1:${/** @type {import('net').AddressInfo} */ (server.address()).port}`;
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (login.status !== 200) { console.error('sign-in failed', login.status); process.exit(1); }
  const cookie = String(login.headers.get('set-cookie')).split(';')[0];
  const call = async (method, url, body) => {
    const a = performance.now();
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'accept-encoding': 'gzip', cookie }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    return { status: r.status, ms: performance.now() - a, json: text && (text[0] === '{' || text[0] === '[') ? JSON.parse(text) : null };
  };
  const me = (await call('GET', '/api/me')).json; const sid = me.stations[0].id; const s = (p) => `/api/stations/${sid}${p}`;
  const pumps = (await call('GET', s('/pumps'))).json.filter((p) => p.active);
  const tanks = new Map((await call('GET', s('/tanks'))).json.map((t) => [t.id, t]));
  const custs = (await call('GET', s('/customers'))).json;
  const acct = db.prepare(`SELECT l.account_id id FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE j.station_id=? GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`).get(sid);
  const today = new Date().toISOString().slice(0, 10), yStart = today.slice(0, 4) + '-01-01';
  const count = (t) => Number(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n);
  const before = { sales: count('sales'), expenses: count('expenses') };
  if (!db.prepare("SELECT 1 FROM shifts WHERE station_id=? AND status='open'").get(sid)) await call('POST', s('/shifts'), {});

  /** @type {Array<[string, () => string]>} */
  const reads = [
    ['dashboard', () => s('/dashboard')], ['customers', () => s('/customers')], ['tanks', () => s('/tanks')],
    ['sales of day', () => s(`/sales?date=${today}&limit=200`)], ['trial balance', () => `/api/accounting/trial-balance?station_id=${sid}&from=${yStart}&to=${today}`],
    ['customer statement', () => s(`/customers/${custs[Math.floor(Math.random() * custs.length)].id}/statement?from=${yStart}&to=${today}`)],
    ['ledger', () => `/api/accounting/ledger?station_id=${sid}&account_id=${acct.id}&from=${today.slice(0, 8)}01&to=${today}`]
  ];
  const stats = new Map(); const rec = (k, r) => { const o = stats.get(k) || { ms: [], st: {} }; o.ms.push(r.ms); o.st[r.status] = (o.st[r.status] || 0) + 1; stats.set(k, o); };
  let seq = 0, retries = 0, retryOk = 0; const saleIds = new Set();
  const end = Date.now() + SECONDS * 1000;
  async function user(u) {
    while (Date.now() < end) {
      const x = Math.random();
      if (x < 0.72) { const [k, f] = reads[Math.floor(Math.random() * reads.length)]; rec(k, await call('GET', f())); continue; }
      if (x < 0.95) {
        const p = pumps[Math.floor(Math.random() * pumps.length)]; const t = tanks.get(p.tank_id);
        const cid = `stress-${process.pid}-${u}-${++seq}`;
        const body = { client_id: cid, pump_id: p.id, quantity_ml: 1000 + Math.floor(Math.random() * 20000), pay_type: 'cash' };
        const r = await call('POST', s('/sales'), body); rec('sale', r);
        if (r.status === 201) saleIds.add(r.json.id);
        if (r.status === 201 && Math.random() < 0.3) {   // the same request again, as a retry after a lost answer would send it
          retries++; const again = await call('POST', s('/sales'), body); rec('sale retry', again);
          if (again.status === 200 && again.json.duplicate && again.json.id === r.json.id) retryOk++;
        }
        void t; continue;
      }
      rec('expense', await call('POST', s('/expenses'), { category: 'other', gross: 1000 + Math.floor(Math.random() * 5000), note: 'stress test' }));
    }
  }
  const t0 = performance.now();
  await Promise.all(Array.from({ length: USERS }, (_, i) => user(i)));
  const secs = (performance.now() - t0) / 1000;

  const integrity = (await call('GET', '/api/accounting/integrity')).json;
  const dupSales = db.prepare("SELECT COUNT(*) n FROM (SELECT client_id FROM sales WHERE client_id LIKE 'stress-%' GROUP BY station_id, client_id HAVING COUNT(*)>1)").get().n;
  const unbalanced = db.prepare("SELECT COUNT(*) n FROM (SELECT j.id FROM journals j JOIN journal_lines l ON l.journal_id=j.id WHERE j.status='posted' GROUP BY j.id HAVING SUM(l.debit)<>SUM(l.credit))").get().n;
  const after = { sales: count('sales'), expenses: count('expenses') };
  let total = 0, five = 0;
  console.log(`FuelPro stress · ${USERS} users · ${secs.toFixed(1)} s · node ${process.version}`);
  console.log('operation'.padEnd(20) + 'count'.padStart(7) + 'p50'.padStart(8) + 'p95'.padStart(8) + 'max'.padStart(8) + '  statuses');
  for (const [k, o] of stats) {
    total += o.ms.length; five += Object.entries(o.st).filter(([c]) => +c >= 500).reduce((a, [, n]) => a + n, 0);
    console.log(k.padEnd(20) + String(o.ms.length).padStart(7) + pct(o.ms, 50).toFixed(1).padStart(8) + pct(o.ms, 95).toFixed(1).padStart(8) + Math.max(...o.ms).toFixed(1).padStart(8) + '  ' + JSON.stringify(o.st));
  }
  const newSales = after.sales - before.sales;
  console.log(`throughput ${(total / secs).toFixed(0)} req/s · 5xx: ${five} · sales created ${newSales} (unique ids ${saleIds.size}) · retries ${retries}, answered with the first sale ${retryOk} · duplicate sales ${dupSales}`);
  console.log(`expenses created ${after.expenses - before.expenses} · unbalanced journals ${unbalanced} · integrity ${integrity.ok ? 'OK' : 'FAILED ' + JSON.stringify(integrity.checks.filter((c) => !c.ok))}`);
  const ok = five === 0 && dupSales === 0 && retries === retryOk && newSales === saleIds.size && unbalanced === 0 && integrity.ok;
  console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
  server.close(); db.close(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
