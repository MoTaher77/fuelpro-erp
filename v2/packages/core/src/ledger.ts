/* Double-entry general ledger + perpetual stock ledger (weighted average cost). Port of v1 src/ledger.js.
   Every document posts one balanced journal inside the same transaction as the document. The database itself
   (triggers in @fuelpro/db migrations) refuses an unbalanced posted journal and any change to a posted one. */
import type { Ctx, Q } from './ctx.ts';
import { bad, conflict } from './errors.ts';
import { atCost, avgCost } from './money.ts';
import type { Tank } from './schema.ts';

/** [system key, code, type, Arabic name, English name] — identical to v1 CHART */
export const CHART: ReadonlyArray<readonly [string, string, string, string, string]> = [
  ['cash', '1010', 'asset', 'الصندوق (النقدية)', 'Cash on hand'],
  ['bank', '1020', 'asset', 'البنك', 'Bank'],
  ['ar', '1100', 'asset', 'ذمم العملاء', 'Accounts receivable'],
  ['vat_in', '1150', 'asset', 'ضريبة المدخلات', 'Input VAT'],
  ['interbranch', '1190', 'asset', 'جاري الفروع', 'Inter-branch current account'],
  ['inventory', '1200', 'asset', 'مخزون الوقود', 'Fuel inventory'],
  ['ap', '2010', 'liability', 'ذمم الموردين', 'Accounts payable'],
  ['vat_out', '2100', 'liability', 'ضريبة المخرجات', 'Output VAT'],
  ['capital', '3010', 'equity', 'رأس المال والأرصدة الافتتاحية', 'Capital & opening balances'],
  ['drawings', '3200', 'equity', 'مسحوبات المالك', 'Owner drawings'],
  ['retained', '3900', 'equity', 'الأرباح المحتجزة', 'Retained earnings'],
  ['sales_disc', '4050', 'income', 'خصومات المبيعات', 'Sales discounts'],
  ['sales', '4010', 'income', 'مبيعات الوقود', 'Fuel sales'],
  ['other_income', '4900', 'income', 'إيرادات أخرى (زيادات المخزون والصندوق)', 'Other income (stock & cash surpluses)'],
  ['cogs', '5010', 'expense', 'تكلفة الوقود المباع', 'Cost of fuel sold'],
  ['stock_loss', '5100', 'expense', 'عجز المخزون', 'Stock shortage'],
  ['cash_short', '5200', 'expense', 'عجز الصندوق', 'Cash shortage'],
  ['exp_salaries', '6010', 'expense', 'الرواتب والأجور', 'Salaries & wages'],
  ['exp_power', '6020', 'expense', 'الكهرباء والمولدات', 'Power & generators'],
  ['exp_maint', '6030', 'expense', 'الصيانة', 'Maintenance'],
  ['exp_transport', '6040', 'expense', 'النقل', 'Transport'],
  ['exp_rent', '6050', 'expense', 'الإيجار', 'Rent'],
  ['exp_fees', '6060', 'expense', 'الرسوم والضرائب', 'Fees & taxes'],
  ['exp_other', '6090', 'expense', 'مصروفات أخرى', 'Other expenses'],
  ['exp_dep', '6070', 'expense', 'مصروف الإهلاك', 'Depreciation expense'],
  ['accum_dep', '1290', 'asset', 'مجمع إهلاك الأصول الثابتة', 'Accumulated depreciation'],
  ['fx', '4950', 'income', 'فروق أسعار الصرف', 'Exchange differences'],
  ['emp_adv', '1160', 'asset', 'سلف الموظفين', 'Employee advances'],
  ['salaries_payable', '2200', 'liability', 'رواتب مستحقة للموظفين', 'Salaries payable']
];

const EXPENSE_KEYS = new Set(['salaries', 'power', 'maint', 'transport', 'rent', 'fees', 'other']);
/** expense category → system account key (v1 ledger.expenseKey) */
export const expenseKey = (cat: string) => 'exp_' + (EXPENSE_KEYS.has(cat) ? cat : 'other');

export async function ensureChart(q: Q, orgId: number): Promise<void> {
  for (const [sys, code, type, ar, en] of CHART) {
    for (let k = 0; k < 10; k++) {
      if (await q.selectFrom('accounts').select('id').where('org_id', '=', orgId).where('sys', '=', sys).executeTakeFirst()) break;
      await q.insertInto('accounts').values({ org_id: orgId, code: k ? code + k : code, type, name_ar: ar, name_en: en, sys, box: sys === 'cash' || sys === 'bank' ? sys : null })
        .onConflict((oc) => oc.columns(['org_id', 'code']).doNothing()).execute();
    }
  }
}
/* System account ids never change once created, so they are cached per database handle. Only ids that already
   existed are cached (an id created inside a transaction that later rolls back is never remembered). */
const acctCache = new WeakMap<object, Map<string, number>>();
export async function acct(q: Q, orgId: number, sys: string, cacheOn?: object): Promise<number> {
  const cache = cacheOn ? (acctCache.get(cacheOn) || acctCache.set(cacheOn, new Map()).get(cacheOn)!) : null;
  const key = orgId + ':' + sys, hit = cache?.get(key);
  if (hit) return hit;
  const found = await q.selectFrom('accounts').select('id').where('org_id', '=', orgId).where('sys', '=', sys).executeTakeFirst();
  if (found) { cache?.set(key, found.id); return found.id; }
  let r: { id: number } | undefined = await q.selectFrom('accounts').select('id').where('org_id', '=', orgId).where('sys', '=', sys).executeTakeFirst();
  if (!r) { await ensureChart(q, orgId); r = await q.selectFrom('accounts').select('id').where('org_id', '=', orgId).where('sys', '=', sys).executeTakeFirst(); }
  if (!r) throw new Error('Unknown system account ' + sys);
  return r.id;
}
export async function assertOpen(q: Q, orgId: number, date: string): Promise<void> {
  const o = await q.selectFrom('orgs').select('locked_through').where('id', '=', orgId).executeTakeFirstOrThrow();
  const l = o.locked_through;
  if (l && date <= l) throw conflict('PERIOD_LOCKED', `The accounting period is closed through ${l}`, { locked_through: l });
}

export interface Line { a: string | number; dr?: number; cr?: number; party_type?: string | null; party_id?: number | null; memo?: string | null }
export interface PostArgs {
  org_id: number; station_id: number; date: string; source: string; source_id?: number | null; memo?: string | null;
  user_id?: number | null; lines: Line[]; reversal_of?: number | null; ref?: string | null;
  /** 'draft' leaves a manual journal unposted (v1 post status); everything else posts at once */
  status?: 'draft' | 'posted';
  /** the caller already ran assertOpen for this org and date in this transaction */
  periodChecked?: boolean;
}
/** Insert a balanced posted journal. Zero lines are dropped; returns null when nothing is left. */
export async function post(ctx: Ctx, q: Q, p: PostArgs): Promise<number | null> {
  if (!p.periodChecked) await assertOpen(q, p.org_id, p.date);
  const clean: Array<Line & { dr: number; cr: number; account_id: number }> = [];
  for (const l of p.lines) {
    const dr = l.dr || 0, cr = l.cr || 0;
    if (!Number.isSafeInteger(dr) || !Number.isSafeInteger(cr) || dr < 0 || cr < 0) throw new Error('Bad journal amount');
    const net = dr - cr; if (net === 0) continue;
    clean.push({ ...l, dr: net > 0 ? net : 0, cr: net < 0 ? -net : 0, account_id: typeof l.a === 'number' ? l.a : await acct(q, p.org_id, l.a, ctx.db) });
  }
  if (!clean.length) return null;
  const d = clean.reduce((s, l) => s + l.dr, 0), c = clean.reduce((s, l) => s + l.cr, 0);
  if (d !== c) throw bad('JOURNAL_UNBALANCED', 'Total debit must equal total credit', { debit: d, credit: c });
  const now = ctx.clock.now();
  const j = await q.insertInto('journals').values({
    org_id: p.org_id, station_id: p.station_id, business_date: p.date, created_at: now, status: 'draft', source: p.source,
    source_id: p.source_id ?? null, memo: p.memo ?? null, user_id: p.user_id ?? null, reversal_of: p.reversal_of ?? null
  }).returning('id').executeTakeFirstOrThrow();
  await q.insertInto('journal_lines').values(clean.map((l) => ({
    journal_id: j.id, account_id: l.account_id, debit: l.dr, credit: l.cr, party_type: l.party_type || null, party_id: l.party_id || null, memo: l.memo || null
  }))).execute();
  if (p.status !== 'draft') await q.updateTable('journals').set({ status: 'posted', posted_at: now }).where('id', '=', j.id).execute();   // trigger re-checks the balance
  return j.id;
}
/** Reverse one posted journal with a mirror entry on the same business date. */
export async function reverse(ctx: Ctx, q: Q, jid: number, userId: number, memo?: string): Promise<number | null> {
  const j = await q.selectFrom('journals').selectAll().where('id', '=', jid).executeTakeFirstOrThrow();
  if (j.status !== 'posted') throw conflict('NOT_POSTED', 'Only posted journals can be reversed');
  if (j.reversed_by) throw conflict('ALREADY_REVERSED', 'This journal is already reversed');
  if (j.reversal_of) throw conflict('IS_REVERSAL', 'A reversal cannot itself be reversed; post a new entry instead');
  // v1 reads the lines through its (journal_id, account_id, debit, credit) index; the same explicit order keeps both systems identical
  const lines = await q.selectFrom('journal_lines').selectAll().where('journal_id', '=', j.id).orderBy('account_id').orderBy('debit').orderBy('credit').orderBy('id').execute();
  const rid = await post(ctx, q, {
    org_id: j.org_id, station_id: j.station_id, date: j.business_date, source: j.source, source_id: j.source_id, memo: memo || ('Reversal of #' + j.id),
    user_id: userId, reversal_of: j.id, lines: lines.map((l) => ({ a: l.account_id, dr: l.credit, cr: l.debit, party_type: l.party_type, party_id: l.party_id }))
  });
  await q.updateTable('journals').set({ reversed_by: rid }).where('id', '=', j.id).execute();
  return rid;
}
/** How many journals reverseSource would reverse — lets a command run every check before its first write. */
export async function countReversible(q: Q, orgId: number, source: string, sourceId: number): Promise<number> {
  const r = await q.selectFrom('journals').select((e) => e.fn.countAll<number>().as('n')).where('org_id', '=', orgId).where('source', '=', source).where('source_id', '=', sourceId)
    .where('status', '=', 'posted').where('reversed_by', 'is', null).where('reversal_of', 'is', null).executeTakeFirstOrThrow();
  return Number(r.n);
}
export async function reverseSource(ctx: Ctx, q: Q, orgId: number, source: string, sourceId: number, userId: number, memo?: string): Promise<number> {
  const js = await q.selectFrom('journals').select('id').where('org_id', '=', orgId).where('source', '=', source).where('source_id', '=', sourceId)
    .where('status', '=', 'posted').where('reversed_by', 'is', null).where('reversal_of', 'is', null).orderBy('id').execute();
  for (const j of js) await reverse(ctx, q, j.id, userId, memo);
  return js.length;
}

export interface MoveArgs { qty: number; value?: number | null; kind: string; ref_type?: string | null; ref_id?: number | null; date: string; user_id?: number | null }
/** Move stock in or out of a tank keeping level, value and weighted average cost consistent.
    Returns the value actually moved (an issue that empties the tank takes the whole remaining value). */
export async function stockMove(ctx: Ctx, q: Q, tankId: number, m: MoveArgs, locked?: Tank): Promise<number> {
  // `locked`: the caller already read (and on PostgreSQL locked) this tank row in this transaction and has not changed it
  let t = locked;
  if (!t) {
    let tq = q.selectFrom('tanks').selectAll().where('id', '=', tankId);
    if (ctx.dialect === 'postgres') tq = tq.forUpdate();
    t = await tq.executeTakeFirstOrThrow();
  }
  const { level, nv, moved, avg } = planMove(t, m.qty, m.value);
  await q.updateTable('tanks').set({ level_ml: level, value: nv, avg_cost_e4: avg }).where('id', '=', tankId).execute();
  await q.insertInto('stock_moves').values({
    station_id: t.station_id, tank_id: tankId, business_date: m.date, created_at: ctx.clock.now(), kind: m.kind, ref_type: m.ref_type ?? null, ref_id: m.ref_id ?? null,
    qty_ml: m.qty, value: moved, balance_ml: level, balance_value: nv, avg_cost_e4: avg, user_id: m.user_id ?? null
  }).execute();
  return moved;
}
/** The pure arithmetic of a stock move (no write): new level, value, moved value and average cost. */
export function planMove(t: Pick<Tank, 'level_ml' | 'capacity_ml' | 'value' | 'avg_cost_e4'>, qty: number, value?: number | null) {
  const level = t.level_ml + qty;
  if (level < 0 || level > t.capacity_ml) throw conflict(level < 0 ? 'INSUFFICIENT_STOCK' : 'EXCEEDS_CAPACITY', 'Stock movement out of tank range', { level_ml: t.level_ml, capacity_ml: t.capacity_ml });
  let v = value;
  if (v === undefined || v === null) v = qty < 0 ? (level === 0 ? -t.value : -atCost(-qty, t.avg_cost_e4)) : atCost(qty, t.avg_cost_e4);
  let nv = t.value + v;
  if (level === 0 || nv < 0) nv = 0;
  return { level, nv, moved: nv - t.value, avg: level > 0 ? avgCost(nv, level) : t.avg_cost_e4 };
}
/** Route any difference between intended and actual inventory value to cost of sales. */
export function inventoryFix(intended: number, actual: number): Line[] {
  const d = actual - intended;
  return d > 0 ? [{ a: 'inventory', dr: d }, { a: 'cogs', cr: d }] : d < 0 ? [{ a: 'cogs', dr: -d }, { a: 'inventory', cr: -d }] : [];
}
export { atCost };
