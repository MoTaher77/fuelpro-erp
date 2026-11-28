/* After a move with tools/migrate-v1.ts: run every financial report on the v1 file and on the v2 database and prove the
   answers are identical (to the minor unit, row for row), with the time each side took.
   Usage: node tools/compare-reports.ts --v1 <copy of the v1 file> --v2 <v2.db | postgres://…> [--json out.json]
   The v1 side runs on the file it is given (a report can create a missing system account, as v1 always has): pass a COPY,
   never data/fuelpro.db. The JSON holds counts and timings only — no names, no amounts. */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { openPostgres, openSqlite } from '@fuelpro/db';
import { statements, finance, type User } from '@fuelpro/core';

const require = createRequire(import.meta.url);
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const v1file = arg('--v1'), v2url = arg('--v2'), jsonOut = arg('--json');
if (!v1file || !v2url) { console.error('usage: node tools/compare-reports.ts --v1 <v1 copy> --v2 <v2.db | postgres://…>'); process.exit(1); }
if (/[\\/]data[\\/]fuelpro\.db$/.test(v1file)) { console.error('refusing to use the live database: pass a backup copy'); process.exit(1); }

const { openDb } = require('../../src/db.js');
const O = require('../../src/ops.js'), B = require('../../src/books.js'), R = require('../../src/reports.js');
const db1 = openDb(v1file);
const ctx = /^postgres(ql)?:\/\//.test(v2url) ? await openPostgres(v2url) : await openSqlite(v2url);

/* GROUP_CONCAT / string_agg give the same names in any order: compare them sorted */
const canon = (x: unknown): unknown => {
  if (Array.isArray(x)) return x.map(canon);
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, (k === 'box_name' || k === 'note') && typeof v === 'string' ? v.split(',').sort().join(',') : canon(v)]));
  return x;
};
const out: Array<{ report: string; same: boolean; v1_ms: number; v2_ms: number; rows: number }> = [];
const size = (r: unknown) => JSON.stringify(r).length;
async function both(name: string, f1: () => unknown, f2: () => Promise<unknown>) {
  let a: unknown, b: unknown, e1: unknown, e2: unknown;
  const t0 = performance.now(); try { a = f1(); } catch (e) { e1 = (e as { code?: string }).code || String(e); }
  const t1 = performance.now(); try { b = await f2(); } catch (e) { e2 = (e as { code?: string }).code || String(e); }
  const t2 = performance.now();
  const same = e1 || e2 ? e1 === e2 : JSON.stringify(canon(a)) === JSON.stringify(canon(b));
  out.push({ report: name, same, v1_ms: +(t1 - t0).toFixed(1), v2_ms: +(t2 - t1).toFixed(1), rows: e1 ? 0 : size(a) });
  if (!same) console.error('DIFFERENT:', name, e1 || '', e2 || '');
}

const owners = db1.prepare("SELECT id, org_id, role FROM users WHERE role='owner' ORDER BY id").all() as User[];
for (const u of owners) {
  const sts = db1.prepare('SELECT id, currency FROM stations WHERE org_id=? ORDER BY id').all(u.org_id) as Array<{ id: number; currency: string }>;
  for (const cur of [...new Set(sts.map((s) => s.currency))]) {
    const span = db1.prepare(`SELECT MIN(business_date) a, MAX(business_date) b FROM journals WHERE org_id=? AND status='posted'`).get(u.org_id) as { a: string | null; b: string | null };
    if (!span.a || !span.b) continue;
    const q = { currency: cur, from: span.a, to: span.b };
    await both(`income ${cur} all`, () => O.incomeStatement(db1, u, q), () => statements.incomeStatement(ctx, u, q));
    await both(`balance ${cur} end`, () => O.balanceSheet(db1, u, { currency: cur, as_of: span.b }), () => statements.balanceSheet(ctx, u, { currency: cur, as_of: span.b! }));
    await both(`cash flow ${cur} all`, () => O.cashFlow(db1, u, q), () => statements.cashFlow(ctx, u, q));
    await both(`trial balance ${cur} all`, () => O.trialBalance(db1, u, q), () => finance.trialBalanceOrg(ctx, u, q));
  }
  for (const st of sts) {
    const days = (db1.prepare('SELECT DISTINCT business_date d FROM journals WHERE station_id=? ORDER BY d').all(st.id) as Array<{ d: string }>).map((x) => x.d);
    if (!days.length) continue;
    const first = days[0], last = days[days.length - 1], mid = days[Math.floor(days.length / 2)];
    const month = (d: string) => ({ from: d.slice(0, 8) + '01', to: d });
    await both(`income station ${st.id} last month`, () => O.incomeStatement(db1, u, { station_id: st.id, ...month(last) }), () => statements.incomeStatement(ctx, u, { station_id: st.id, ...month(last) }));
    await both(`balance station ${st.id} mid`, () => O.balanceSheet(db1, u, { station_id: st.id, as_of: mid }), () => statements.balanceSheet(ctx, u, { station_id: st.id, as_of: mid }));
    await both(`cash flow station ${st.id} last month`, () => O.cashFlow(db1, u, { station_id: st.id, ...month(last) }), () => statements.cashFlow(ctx, u, { station_id: st.id, ...month(last) }));
    for (const y of [...new Set([first, last].map((d) => d.slice(0, 4)))]) {
      await both(`profit by month ${st.id} ${y}`, () => B.profitByMonth(db1, u, { station_id: st.id, year: y }), () => statements.profitByMonth(ctx, u, { station_id: st.id, year: y }));
    }
    await both(`meters ${st.id} last month`, () => B.meterSheet(db1, u, st.id, month(last)), () => statements.meterSheet(ctx, u, st.id, month(last)));
    await both(`boxes ${st.id} all`, () => R.boxReport(db1, u, st.id, { from: first, to: last }), () => statements.boxReport(ctx, u, st.id, { from: first, to: last }));
    await both(`boxes ${st.id} cash by day`, () => R.boxReport(db1, u, st.id, { from: month(last).from, to: last, box_account_id: O.listAccounts(db1, u).find((a: { sys: string }) => a.sys === 'cash').id }),
      async () => statements.boxReport(ctx, u, st.id, { from: month(last).from, to: last, box_account_id: (await finance.listAccounts(ctx, u)).find((a) => a.sys === 'cash')!.id }));
    for (const d of [last, mid, first]) {
      await both(`collections ${st.id} ${d === last ? 'end' : d === mid ? 'mid' : 'start'}`, () => R.collections(db1, u, st.id, { as_of: d }), () => statements.collections(ctx, u, st.id, { as_of: d }));
      await both(`daily ${st.id} ${d === last ? 'last' : d === mid ? 'mid' : 'first'}`, () => R.dailyReport(db1, u, st.id, { date: d }), () => statements.dailyReport(ctx, u, st.id, { date: d }));
    }
  }
  await both('letterhead', () => B.getBrand(db1, u), () => statements.getBrand(ctx, u));
}
db1.close(); await ctx.close();
const bad = out.filter((x) => !x.same);
const sum = (k: 'v1_ms' | 'v2_ms') => +out.reduce((a, x) => a + x[k], 0).toFixed(1);
const report = { engine: ctx.dialect, reports: out.length, identical: out.length - bad.length, v1_ms_total: sum('v1_ms'), v2_ms_total: sum('v2_ms'), detail: out.map(({ rows: _r, ...x }) => x) };
console.log(JSON.stringify({ ...report, detail: undefined }));
for (const x of out) console.log((x.same ? 'same ' : 'DIFF ') + x.report.padEnd(36) + ` v1 ${String(x.v1_ms).padStart(7)} ms  v2 ${String(x.v2_ms).padStart(7)} ms`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2) + '\n');
process.exit(bad.length ? 2 : 0);
