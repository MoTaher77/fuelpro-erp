/* Copy the ported modules (sales & shifts, stock & deliveries) and the whole general ledger from a v1 database (SQLite) into a v2 database
   (SQLite file or PostgreSQL), keeping every id, then prove the books are the same. The copy and the proof run in ONE
   transaction on the target: any difference rolls everything back and the tool exits with code 2.

   Usage: node tools/migrate-v1.ts --from <v1.db> --to <v2.db | postgres://…> [--json report.json]

   Safety: the source is opened read-only. Passwords, sessions, 2FA secrets are never copied (v2 tables have no such
   columns). Never point --from at the live data/fuelpro.db: work on a backup copy (npm run backup). Moving real data
   off the laptop or the server needs the owner's explicit OK each time. */
import { createRequire } from 'node:module';
import { writeFileSync, existsSync } from 'node:fs';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { DB } from '@fuelpro/core';
import { openPostgres, openSqlite } from '@fuelpro/db';

const require = createRequire(import.meta.url);
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const from = arg('--from'), to = arg('--to'), jsonOut = arg('--json');
if (!from || !to) { console.error('usage: node tools/migrate-v1.ts --from <v1.db> --to <v2.db | postgres://…>'); process.exit(1); }
if (/[\\/]data[\\/]fuelpro\.db$/.test(from)) { console.error('refusing to read the live database directly: make a backup copy first (npm run backup)'); process.exit(1); }
if (!existsSync(from)) { console.error('no such file: ' + from); process.exit(1); }

const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
const src = new DatabaseSync(from, { readOnly: true });

/** in foreign-key order; only the columns v2 has */
const TABLES = ['orgs', 'users', 'stations', 'user_stations', 'fuels', 'tanks', 'pumps', 'customers', 'shifts', 'shift_meters', 'sales',
  'suppliers', 'deliveries', 'adjustments', 'transfers', 'stock_moves', 'accounts', 'journals', 'journal_lines', 'audit'] as const;
/** v2 columns that v1 may lack in older files; filled with these defaults */
const DEFAULTS: Record<string, Record<string, unknown>> = {};

/* ---------- the proof: the same figures computed on both sides ---------- */
const CHECKS: Record<string, string> = {
  counts: `SELECT (SELECT COUNT(*) FROM sales) sales, (SELECT COUNT(*) FROM journals) journals, (SELECT COUNT(*) FROM journal_lines) lines,
           (SELECT COUNT(*) FROM stock_moves) moves, (SELECT COUNT(*) FROM shifts) shifts, (SELECT COUNT(*) FROM customers) customers,
           (SELECT COUNT(*) FROM suppliers) suppliers, (SELECT COUNT(*) FROM deliveries) deliveries, (SELECT COUNT(*) FROM adjustments) counts, (SELECT COUNT(*) FROM transfers) transfers`,
  ledger_totals: `SELECT COALESCE(SUM(l.debit),0) debit, COALESCE(SUM(l.credit),0) credit FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE j.status='posted'`,
  trial_balance: `SELECT j.station_id, l.account_id, SUM(l.debit) debit, SUM(l.credit) credit FROM journal_lines l JOIN journals j ON j.id=l.journal_id
           WHERE j.status='posted' GROUP BY j.station_id, l.account_id ORDER BY j.station_id, l.account_id`,
  boxes: `SELECT a.id, a.code, SUM(l.debit - l.credit) balance FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id
           WHERE j.status='posted' AND a.box IS NOT NULL GROUP BY a.id, a.code ORDER BY a.id`,
  customers: `SELECT l.party_id, SUM(l.debit - l.credit) balance FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id
           WHERE l.party_type='customer' AND a.sys='ar' AND j.status='posted' GROUP BY l.party_id ORDER BY l.party_id`,
  tanks: `SELECT t.id, t.level_ml, t.value, (SELECT COALESCE(SUM(m.qty_ml),0) FROM stock_moves m WHERE m.tank_id=t.id) moved_ml,
           (SELECT COALESCE(SUM(m.value),0) FROM stock_moves m WHERE m.tank_id=t.id) moved_value FROM tanks t ORDER BY t.id`,
  suppliers: `SELECT l.party_id, SUM(l.credit - l.debit) balance FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id
           WHERE l.party_type='supplier' AND a.sys='ap' AND j.status='posted' GROUP BY l.party_id ORDER BY l.party_id`,
  deliveries_by_day: `SELECT station_id, business_date, COUNT(*) n, SUM(quantity_ml) qty, SUM(net) net, SUM(vat) vat FROM deliveries
           WHERE voided_at IS NULL GROUP BY station_id, business_date ORDER BY station_id, business_date`,
  stock_by_kind: `SELECT tank_id, kind, COUNT(*) n, SUM(qty_ml) qty, SUM(value) value FROM stock_moves GROUP BY tank_id, kind ORDER BY tank_id, kind`,
  sales_by_day: `SELECT station_id, business_date, COUNT(*) n, SUM(quantity_ml) qty, SUM(gross) gross, SUM(COALESCE(cogs,0)) cogs FROM sales
           WHERE voided_at IS NULL GROUP BY station_id, business_date ORDER BY station_id, business_date`
};
const num = (rows: Array<Record<string, unknown>>) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) =>
  [k, typeof v === 'bigint' ? Number(v) : typeof v === 'string' && /^-?\d+$/.test(v) && k !== 'code' && k !== 'business_date' ? Number(v) : v])));

class Mismatch extends Error {}

async function main() {
  const target = /^postgres(ql)?:\/\//.test(to!) ? await openPostgres(to!) : await openSqlite(to!);
  const db = target.db as Kysely<DB>;
  const t0 = performance.now();
  const report: Record<string, unknown> = { from: from!.replace(/.*[\\/]/, ''), to: target.dialect, tables: {} as Record<string, number> };
  if (await db.selectFrom('orgs').select('id').limit(1).executeTakeFirst()) { console.error('the target already holds data: migrate into an empty v2 database'); process.exit(1); }
  try {
    await db.transaction().execute(async (q: Transaction<DB>) => {
      for (const t of TABLES) {
        const v2cols = (await sql.raw(target.dialect === 'postgres'
          ? `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${t}' ORDER BY ordinal_position`
          : `SELECT name FROM pragma_table_info('${t}')`).execute(q)).rows.map((r) => String((r as { name: string }).name));
        const v1cols = new Set((src.prepare(`SELECT name FROM pragma_table_info('${t}')`).all() as Array<{ name: string }>).map((r) => r.name));
        const cols = v2cols.filter((c) => v1cols.has(c));
        const missing = v2cols.filter((c) => !v1cols.has(c));
        const it = src.prepare(`SELECT ${cols.join(',')} FROM ${t}${v1cols.has('id') ? ' ORDER BY id' : ''}`).iterate() as IterableIterator<Record<string, unknown>>;
        let batch: Record<string, unknown>[] = [], n = 0;
        const flush = async () => {
          if (!batch.length) return;
          // journals arrive as drafts: the guard triggers refuse lines on a posted journal; they are posted after their lines
          await (q as unknown as Kysely<Record<string, Record<string, unknown>>>).insertInto(t).values(batch).execute();
          n += batch.length; batch = [];
        };
        for (const row of it) {
          const r: Record<string, unknown> = { ...DEFAULTS[t] };
          for (const c of cols) r[c] = row[c];
          for (const c of missing) if (!(c in r)) r[c] = null;
          if (t === 'journals') r.status = 'draft';
          batch.push(r); if (batch.length >= 400) await flush();
        }
        await flush();
        (report.tables as Record<string, number>)[t] = n;
      }
      // post what v1 had posted (the balance trigger checks every journal), then restore the posting time
      const posted = src.prepare("SELECT id, posted_at FROM journals WHERE status='posted' ORDER BY id").all() as Array<{ id: number; posted_at: string }>;
      for (let i = 0; i < posted.length; i += 500) {
        const ids = posted.slice(i, i + 500).map((p) => Number(p.id));
        await q.updateTable('journals').set({ status: 'posted' }).where('id', 'in', ids).execute();
      }
      for (const p of posted) if (p.posted_at) await q.updateTable('journals').set({ posted_at: p.posted_at }).where('id', '=', Number(p.id)).execute();
      if (target.dialect === 'postgres') for (const t of TABLES) {
        if (t === 'user_stations' || t === 'shift_meters') continue;
        await sql.raw(`SELECT setval(pg_get_serial_sequence('${t}','id'), GREATEST((SELECT COALESCE(MAX(id),0) FROM ${t}), 1))`).execute(q);
      }
      // test hook (tests/migrate.test.ts): damage one figure to prove the tool stops and leaves the target empty
      if (process.env.FP_MIGRATE_TAMPER === '1') await q.updateTable('tanks').set({ value: sql<number>`value + 1` }).where('id', '=', 1).execute();
      // the proof
      const diffs: string[] = [];
      const checks: Record<string, unknown> = {};
      for (const [k, s] of Object.entries(CHECKS)) {
        const a = num(src.prepare(s).all() as Array<Record<string, unknown>>);
        const b = num((await sql.raw(s).execute(q)).rows as Array<Record<string, unknown>>);
        const same = JSON.stringify(a) === JSON.stringify(b);
        checks[k] = { rows: a.length, same };
        if (!same) diffs.push(k);
      }
      const tot = num(src.prepare(CHECKS.ledger_totals).all() as Array<Record<string, unknown>>)[0] as { debit: number; credit: number };
      if (tot.debit !== tot.credit) diffs.push('source ledger does not balance');
      report.checks = checks; report.ledger = tot;
      if (diffs.length) throw new Mismatch('the books differ after the copy: ' + diffs.join(', '));
    });
    report.ok = true;
  } catch (e) {
    report.ok = false; report.error = (e as Error).message;
  } finally {
    report.seconds = +((performance.now() - t0) / 1000).toFixed(1);
    await target.close(); src.close();
  }
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) { console.error('STOPPED: nothing was written to the target.'); process.exit(2); }
}
await main();
