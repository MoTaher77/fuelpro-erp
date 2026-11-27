/* Before/after for the sales & shifts module: v1 (in use) vs v2 on SQLite and on PostgreSQL, same demo year of data
   (v2 databases made from the v1 file by tools/migrate-v1.ts). Each server in its own process; autocannon here.
   node bench/compare.ts --v1 <demo-v1.db> --v2 <demo-v2.db> [--pg postgres://…/template_db] [--conn 100] [--dur 10] [--json out.json]
   Demo data only. */
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import autocannon from 'autocannon';
import hdr from 'hdr-histogram-js';

const require = createRequire(import.meta.url);
const arg = (k: string, d?: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CONN = Number(arg('--conn', '100')), DUR = Number(arg('--dur', '10'));
const here = fileURLToPath(new URL('.', import.meta.url)), tmp = join(tmpdir(), 'fpv2-bench-' + process.pid);
require('node:fs').mkdirSync(tmp, { recursive: true });
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

type Target = { name: string; start(): Promise<{ proc: ChildProcess; base: string; headers: Record<string, string>; sid: number; pump: number; pumps: number[]; prefix: string }>; check(): Promise<unknown> };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function up(base: string, headers: Record<string, string>, path: string) {
  for (let i = 0; i < 100; i++) { try { const r = await fetch(base + path, { headers }); if (r.status < 500) return; } catch { /* starting */ } await wait(100); }
  throw new Error('server did not start: ' + base);
}
let port = 39100;

function v1Target(file: string): Target {
  const db = join(tmp, 'v1.db');
  return {
    name: 'v1 (SQLite)',
    async start() {
      copyFileSync(file, db);
      const d = new DatabaseSync(db);
      const owner = d.prepare("SELECT id, org_id FROM users WHERE role='owner' ORDER BY id LIMIT 1").get() as { id: number; org_id: number };
      const sid = (d.prepare('SELECT id FROM stations WHERE org_id=? ORDER BY id LIMIT 1').get(owner.org_id) as { id: number }).id;
      const pump = (d.prepare('SELECT p.id FROM pumps p JOIN tanks t ON t.id=p.tank_id WHERE p.station_id=? AND p.active=1 ORDER BY t.level_ml DESC LIMIT 1').get(sid) as { id: number }).id;
      const pumps = (d.prepare('SELECT id FROM pumps WHERE station_id=? AND active=1 ORDER BY id').all(sid) as Array<{ id: number }>).map((r) => r.id);
      d.close();
      // a session for the demo owner straight in the bench copy (no password involved)
      const auth = require('../../src/auth.js'), { openDb } = require('../../src/db.js');
      const odb = openDb(db); const token = auth.createSession(odb, owner.id, '127.0.0.1'); odb.close();
      const p = ++port, base = `http://127.0.0.1:${p}`, headers = { cookie: 'sid=' + token, 'content-type': 'application/json' };
      const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(here, 'v1-server.cjs'), db, String(p)], { stdio: 'ignore', env: { ...process.env, NODE_ENV: 'production' } });
      await up(base, headers, '/api/me');
      return { proc, base, headers, sid, pump, pumps, prefix: `/api/stations/${sid}` };
    },
    async check() { const d = new DatabaseSync(db); const r = d.prepare("SELECT (SELECT COUNT(*) FROM sales) sales, (SELECT SUM(debit)-SUM(credit) FROM journal_lines) diff").get(); d.close(); return r; }
  };
}
function v2Target(name: string, spec: () => Promise<string>, done: (s: string) => Promise<unknown>): Target {
  let dbSpec = '';
  return {
    name,
    async start() {
      dbSpec = await spec();
      const p = ++port, base = `http://127.0.0.1:${p}`, token = 'bench-' + process.pid, headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
      const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', join(here, '../apps/server/src/main.ts')], { stdio: 'ignore',
        env: { ...process.env, NODE_ENV: 'production', V2_DB: dbSpec, V2_TOKEN: token, PORT: String(p) } });
      await up(base, headers, '/api/v2/state');
      const sid = (await (await fetch(base + '/api/v2/state', { headers })).json()).station_id as number;
      const pumps = await (await fetch(`${base}/api/v2/stations/${sid}/pumps`, { headers })).json() as Array<{ id: number; tank_id: number }>;
      const tanks = await (await fetch(`${base}/api/v2/stations/${sid}/tanks`, { headers })).json() as Array<{ id: number; level_ml: number }>;
      const best = tanks.sort((a, b) => b.level_ml - a.level_ml)[0];
      return { proc, base, headers, sid, pump: pumps.find((x) => x.tank_id === best.id)!.id, pumps: pumps.map((x) => x.id), prefix: `/api/v2/stations/${sid}` };
    },
    check: () => done(dbSpec)
  };
}

/** a working day: per connection 9 reads (sales list, current shift) then 1 sale on any pump of the station */
async function mix(base: string, prefix: string, shiftPath: string, headers: Record<string, string>, pumps: number[], tag: string) {
  const h = hdr.build({ lowestDiscernibleValue: 1, highestTrackableValue: 120_000_000, numberOfSignificantValueDigits: 3 });
  let i = 0;
  const reads = Array.from({ length: 9 }, (_, k) => ({ method: 'GET' as const, path: prefix + (k % 2 ? shiftPath : '/sales?limit=50') }));
  const r = await new Promise<autocannon.Result>((ok, fail) => {
    const inst = autocannon({ url: base, connections: CONN, duration: DUR, headers, timeout: 20, requests: [...reads,
      { method: 'POST', path: prefix + '/sales', setupRequest: (q: autocannon.Request) => ({ ...q, body: JSON.stringify({ client_id: `mix-${tag}-${process.pid}-${i}`, pump_id: pumps[i++ % pumps.length], quantity_ml: 50, pay_type: 'cash' }) }) }] },
      (e, res) => (e ? fail(e) : ok(res)));
    inst.on('response', (_c: unknown, _code: number, _b: number, rt: number) => h.recordValue(Math.max(1, Math.round(rt * 1000))));
  });
  const q = (p: number) => +(h.getValueAtPercentile(p) / 1000).toFixed(1);
  return { rps: Math.round(r.requests.total / r.duration), p50: q(50), p95: q(95), p99: q(99), errors: r.errors + r.timeouts, non2xx: r.non2xx };
}
/** 100 people at work: requests arrive at random (Poisson) at `rate` per second in total — 9 reads for each sale —
    and every request is timed from its planned start, so a slow server cannot hide its queue (no coordinated omission). */
async function people(base: string, prefix: string, shiftPath: string, headers: Record<string, string>, pumps: number[], tag: string, rate: number) {
  const lat: number[] = []; let errors = 0, i = 0; const pending: Promise<void>[] = [];
  const t0 = performance.now(); let next = t0;
  while (next - t0 < DUR * 1000) {
    next += -Math.log(1 - Math.random()) / rate * 1000;
    const wait = next - performance.now(); if (wait > 1) await new Promise((r) => setTimeout(r, wait));
    const planned = next, k = i++;
    const req = k % 10 === 9
      ? fetch(base + prefix + '/sales', { method: 'POST', headers, body: JSON.stringify({ client_id: `ppl-${tag}-${process.pid}-${k}`, pump_id: pumps[k % pumps.length], quantity_ml: 50, pay_type: 'cash' }) })
      : fetch(base + prefix + (k % 2 ? shiftPath : '/sales?limit=50'), { headers });
    pending.push(req.then(async (r) => { await r.arrayBuffer(); if (!r.ok) errors++; lat.push(performance.now() - planned); }, () => { errors++; }));
  }
  await Promise.all(pending);
  lat.sort((a, b) => a - b);
  const q = (p: number) => +lat[Math.min(lat.length - 1, Math.ceil(p / 100 * lat.length) - 1)].toFixed(1);
  return { rps: Math.round(lat.length / DUR), p50: q(50), p95: q(95), p99: q(99), errors };
}
async function load(url: string, headers: Record<string, string>, post?: (i: number) => string) {
  const h = hdr.build({ lowestDiscernibleValue: 1, highestTrackableValue: 120_000_000, numberOfSignificantValueDigits: 3 });
  let i = 0;
  const opts: autocannon.Options = { url, connections: CONN, duration: DUR, headers, timeout: 20,
    ...(post ? { method: 'POST', requests: [{ setupRequest: (r: autocannon.Request) => ({ ...r, body: post(i++) }) }] } : {}) };
  const r = await new Promise<autocannon.Result>((ok, fail) => {
    const inst = autocannon(opts, (e, res) => (e ? fail(e) : ok(res)));
    inst.on('response', (_c: unknown, _code: number, _b: number, rt: number) => h.recordValue(Math.max(1, Math.round(rt * 1000))));
  });
  const q = (p: number) => +(h.getValueAtPercentile(p) / 1000).toFixed(1);
  return { rps: Math.round(r.requests.total / r.duration), p50: q(50), p95: q(95), p99: q(99), errors: r.errors + r.timeouts, non2xx: r.non2xx };
}
function rss(pid: number) { try { return Number(/VmHWM:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))![1]); } catch { return null; } }

const targets: Target[] = [v1Target(arg('--v1')!)];
const v2file = arg('--v2');
if (v2file) targets.push(v2Target('v2 (SQLite)', async () => { const f = join(tmp, 'v2.db'); copyFileSync(v2file, f); return f; },
  async (f) => { const d = new DatabaseSync(f); const r = d.prepare('SELECT (SELECT COUNT(*) FROM sales) sales, (SELECT SUM(debit)-SUM(credit) FROM journal_lines) diff').get(); d.close(); return r; }));
const pgTpl = arg('--pg');
if (pgTpl) {
  const pg = require('pg') as typeof import('pg');
  const u = new URL(pgTpl), tpl = u.pathname.slice(1), name = 'fpv2_bench_' + process.pid;
  const admin = () => { const a = new URL(pgTpl); a.pathname = '/postgres'; return new pg.Client({ connectionString: a.toString() }); };
  targets.push(v2Target('v2 (PostgreSQL)', async () => {
    const c = admin(); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${name}`); await c.query(`CREATE DATABASE ${name} TEMPLATE ${tpl}`); await c.end();
    const t = new URL(pgTpl); t.pathname = '/' + name; return t.toString();
  }, async (s) => {
    const c = new pg.Client({ connectionString: s }); await c.connect();
    const r = (await c.query('SELECT (SELECT COUNT(*) FROM sales)::int sales, (SELECT SUM(debit)-SUM(credit) FROM journal_lines)::bigint diff')).rows[0]; await c.end();
    const a = admin(); await a.connect(); await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await a.end(); return r;
  }));
}

const results: Record<string, unknown> = { conn: CONN, dur_s: DUR, node: process.version, cpus: require('node:os').cpus().length };
for (const t of targets) {
  const s = await t.start();
  const cur = await (await fetch(s.base + s.prefix + (t.name.startsWith('v1') ? '/shifts/current' : '/shift'), { headers: s.headers })).json() as { shift?: unknown } | null;
  const open = t.name.startsWith('v1') ? !!(cur && (cur as { shift: unknown }).shift) : !!cur;
  if (!open) await fetch(s.base + s.prefix + '/shifts', { method: 'POST', headers: s.headers, body: JSON.stringify({ float_amount: 0 }) });
  const shiftPath = t.name.startsWith('v1') ? '/shifts/current' : '/shift';
  const row: Record<string, unknown> = {};
  await load(s.base + s.prefix + '/sales?limit=50', s.headers);                       // warm-up
  row.list = await load(s.base + s.prefix + '/sales?limit=50', s.headers);
  row.shift = await load(s.base + s.prefix + shiftPath, s.headers);
  row.post = await load(s.base + s.prefix + '/sales', s.headers, (i) => JSON.stringify({ client_id: `bench-${t.name.length}-${process.pid}-${i}`, pump_id: s.pump, quantity_ml: 50, pay_type: 'cash' }));
  row.mix = await mix(s.base, s.prefix, shiftPath, s.headers, s.pumps, String(t.name.length));
  // 100 people working: each sends about 2 requests a second (open loop), not as fast as the machine allows
  row.users100 = await people(s.base, s.prefix, shiftPath, s.headers, s.pumps, 'u' + t.name.length, 2 * CONN);
  row.rss_mb = Math.round((rss(s.proc.pid!) || 0) / 1024);
  s.proc.kill(); await wait(300);
  row.books = await t.check();
  results[t.name] = row;
  console.log(t.name, JSON.stringify(row));
}
rmSync(tmp, { recursive: true, force: true });
const out = arg('--json'); if (out) writeFileSync(out, JSON.stringify(results, null, 2) + '\n');
