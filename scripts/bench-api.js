// @ts-check
'use strict';
/* Repeatable API speed benchmark (docs/PERFORMANCE.md). Runs the real HTTP server in this process on a COPY of a database,
   signs in, and times every main read screen's request: p50 / p95 / max in ms, plus the response size.
   Usage:
     node scripts/dev-admin.js --db /tmp/bench.db            # snapshot copy + throwaway admin (prints the password)
     node scripts/bench-api.js --db /tmp/bench.db --email dev@local.test --password <pw> [--runs 30] [--json out.json]
   Never point it at data/fuelpro.db: it only reads, but a benchmark has no business on the live books. */
const path = require('path');
const fs = require('fs');
const { createApp } = require('../src/server');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const dbPath = path.resolve(arg('--db', ''));
const email = arg('--email', 'dev@local.test');
const password = arg('--password', process.env.BENCH_PASSWORD || '');
const runs = Number(arg('--runs', 30));   // 0 = only fetch once (with --dump)
const jsonOut = arg('--json', '');
const dumpOut = arg('--dump', '');   // every response body, to prove a change returns the same numbers (scripts/compare-dump.js)
if (!dbPath || !fs.existsSync(dbPath)) { console.error('--db <copy of a FuelPro database> is required'); process.exit(1); }
if (/[\\/]data[\\/]fuelpro\.db$/.test(dbPath)) { console.error('refusing to benchmark the live database'); process.exit(1); }

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)]; };

(async () => {
  const { server, db } = createApp({ dbPath, mailer: { kind: 'none', send: async () => {} } });
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(null)));
  const base = `http://127.0.0.1:${/** @type {import('net').AddressInfo} */ (server.address()).port}`;
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const text = await r.text();
    return { status: r.status, bytes: Buffer.byteLength(text), json: text && (text[0] === '{' || text[0] === '[') ? JSON.parse(text) : null };
  };
  const login = await call('POST', '/api/auth/login', { email, password });
  if (login.status !== 200) { console.error('sign-in failed', login.status); process.exit(1); }
  const me = (await call('GET', '/api/me')).json;
  const sid = me.stations[0].id;
  const span = db.prepare('SELECT MIN(business_date) a, MAX(business_date) b FROM journals WHERE station_id=?').get(sid);
  const to = String(span.b || new Date().toISOString().slice(0, 10));
  const yearStart = to.slice(0, 4) + '-01-01';
  const monthStart = to.slice(0, 8) + '01';
  const year = to.slice(0, 4);
  const cust = db.prepare('SELECT customer_id id FROM sales WHERE station_id=? AND customer_id IS NOT NULL GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1').get(sid);
  const sup = db.prepare('SELECT id FROM suppliers WHERE station_id=? LIMIT 1').get(sid);
  const acct = db.prepare('SELECT l.account_id id FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE j.station_id=? GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1').get(sid);
  const s = (p) => `/api/stations/${sid}${p}`;
  const R = [
    ['me', '/api/me'],
    ['dashboard', s('/dashboard')],
    ['alerts', s('/alerts')],
    ['customers', s('/customers')],
    ['suppliers', s('/suppliers')],
    ['accounts', '/api/accounts'],
    ['account tree', `/api/accounts/tree?to=${to}&station_id=${sid}`],
    ['boxes', '/api/boxes'],
    ['tanks', s('/tanks')],
    ['sales of day', s(`/sales?date=${to}&limit=200`)],
    ['shifts', s('/shifts?limit=60')],
    ['journals (month)', s(`/journals?from=${monthStart}&to=${to}&limit=100`)],
    ['vouchers (year)', s(`/vouchers?from=${yearStart}&to=${to}&limit=200`)],
    ['trial balance (year)', `/api/accounting/trial-balance?station_id=${sid}&from=${yearStart}&to=${to}`],
    ['income statement', `/api/accounting/income-statement?station_id=${sid}&from=${yearStart}&to=${to}`],
    ['balance sheet', `/api/accounting/balance-sheet?station_id=${sid}&to=${to}`],
    ['cash flow', `/api/accounting/cash-flow?station_id=${sid}&from=${yearStart}&to=${to}`],
    ['ledger (busiest acct)', `/api/accounting/ledger?station_id=${sid}&account_id=${acct && acct.id}&from=${yearStart}&to=${to}`],
    ['customer statement', cust ? s(`/customers/${cust.id}/statement?from=${yearStart}&to=${to}`) : null],
    ['supplier statement', sup ? s(`/suppliers/${sup.id}/statement?from=${yearStart}&to=${to}`) : null],
    ['ageing', s('/ageing?type=customer')],
    ['ageing suppliers', s('/ageing?type=supplier')],
    ['ageing mid-year', s(`/ageing?type=customer&as_of=${year}-06-30`)],
    ['sales register (month)', s(`/sales-register?from=${monthStart}&to=${to}`)],
    ['daily report', s(`/reports/daily?date=${to}`)],
    ['box report (month)', s(`/reports/boxes?from=${monthStart}&to=${to}`)],
    ['collections', s('/reports/collections?days=30')],
    ['stock moves (month)', s(`/stock/moves?from=${monthStart}&to=${to}&limit=200`)],
    ['stock reconciliation', s(`/stock/reconciliation?from=${monthStart}&to=${to}`)],
    ['stock monthly', s(`/stock/monthly?year=${year}`)],
    ['meters (month)', s(`/reports/meters?from=${monthStart}&to=${to}`)],
    ['analytics (year)', s(`/analytics?from=${yearStart}&to=${to}`)],
    ['summary (month)', s(`/summary?from=${monthStart}&to=${to}`)],
    ['purchases (year)', s(`/purchases?from=${yearStart}&to=${to}`)],
    ['profit by month', `/api/accounting/profit-by-month?station_id=${sid}&year=${year}`],
    ['integrity', '/api/accounting/integrity'],
    ['audit', s('/audit')]
  ].filter((r) => r[1]);
  const out = [], dump = {};
  for (const [name, url] of R) {
    const first = await call('GET', url); dump[name] = first.json;
    if (first.status !== 200) { out.push({ name, url, status: first.status }); continue; }
    if (!runs) continue;
    const t = [];
    for (let i = 0; i < runs; i++) { const a = performance.now(); await call('GET', url); t.push(performance.now() - a); }
    out.push({ name, p50: +pct(t, 50).toFixed(1), p95: +pct(t, 95).toFixed(1), max: +Math.max(...t).toFixed(1), kb: +(first.bytes / 1024).toFixed(1) });
  }
  const mem = process.memoryUsage();
  const pad = (v, n) => String(v).padStart(n);
  console.log(`FuelPro API benchmark · ${runs} runs each · node ${process.version} · ${new Date().toISOString()}`);
  console.log('endpoint'.padEnd(26) + pad('p50', 8) + pad('p95', 8) + pad('max', 8) + pad('KB', 8));
  for (const r of out) console.log(r.status ? `${r.name.padEnd(26)} HTTP ${r.status}` : r.name.padEnd(26) + pad(r.p50, 8) + pad(r.p95, 8) + pad(r.max, 8) + pad(r.kb, 8));
  const ok = out.filter((r) => !r.status);
  console.log(`slowest p95: ${Math.max(...ok.map((r) => r.p95))} ms · over 250 ms: ${ok.filter((r) => r.p95 > 250).map((r) => r.name).join(', ') || 'none'} · RSS ${(mem.rss / 1048576).toFixed(0)} MB`);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ at: new Date().toISOString(), runs, node: process.version, rows: out, rss_mb: Math.round(mem.rss / 1048576) }, null, 1));
  if (dumpOut) fs.writeFileSync(dumpOut, JSON.stringify(dump));
  server.close(); db.close();
})().catch((e) => { console.error(e); process.exit(1); });
