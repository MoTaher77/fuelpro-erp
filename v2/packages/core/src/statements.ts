/* Financial reports (v2 phase 5): income statement, balance sheet, cash-flow statement, profit by month, meter sheet,
   cash & bank boxes, collections follow-up, the daily station report, and the letterhead printed on every document.
   Port of v1 src/ops.js (incomeStatement, balanceSheet, cashFlow), src/books.js (profitByMonth, meterSheet, brand) and
   src/reports.js (boxReport, collections, dailyReport). Same figures, same rules; nothing is stored or cached (ADR-23).
   Not yet: fixed assets (v1 counts their accounts as investing in the cash flow; v2 has no fixed-asset register yet,
   so those accounts fall back to their group / type exactly as v1 does for an account outside the register). */
import { sql, type RawBuilder } from 'kysely';
import { audit, need, station } from './access.ts';
import { addDays, tx, type Ctx, type User } from './ctx.ts';
import { bad, notFound } from './errors.ts';
import { boxes as listBoxes, scope } from './finance.ts';
import type { Station } from './schema.ts';
import * as V from './validate.ts';

type Row = Record<string, unknown>;
const rows = async <T = Row>(ctx: Ctx, q: RawBuilder<unknown>) => (await q.execute(ctx.db)).rows as T[];
const list = (ids: number[]) => sql.join(ids.map((i) => sql`${i}`));
/** a date the report cannot do without: v1 V.date without `optional` (missing → VALIDATION) */
const reqDate = (v: unknown, name: string) => { const d = V.date(v, name); if (!d) throw bad('VALIDATION', `${name} must be a valid YYYY-MM-DD date`); return d; };
/** text joined from several rows (v1 GROUP_CONCAT(DISTINCT x)); PostgreSQL spells it string_agg */
const concat = (ctx: Ctx, col: RawBuilder<unknown>) => ctx.dialect === 'postgres' ? sql`string_agg(distinct ${col}, ',')` : sql`group_concat(distinct ${col})`;
const NORMAL_DEBIT = new Set(['asset', 'expense']);
type Bal = { id: number; code: string; name_ar: string; name_en: string | null; type: string; debit: number; credit: number };

/* add the lines up per account first, then name the accounts (v1 ops.balances): same rows, same order */
async function balances(ctx: Ctx, user: User, ids: number[], from: string, to: string, noClose = false) {
  const r = await rows<Bal>(ctx, sql`select a.id, a.code, a.name_ar, a.name_en, a.type, t.debit, t.credit from (select l.account_id id, sum(l.debit) debit, sum(l.credit) credit
    from journals j join journal_lines l on l.journal_id = j.id
    where j.org_id = ${user.org_id} and j.status = 'posted' and j.station_id in (${list(ids)}) and j.business_date between ${from} and ${to}${noClose ? sql` and j.source <> 'year_close'` : sql``}
    group by l.account_id) t join accounts a on a.id = t.id order by a.code`);
  for (const x of r) { x.id = Number(x.id); x.debit = Number(x.debit); x.credit = Number(x.credit); }
  return r;
}

/* ------------------------------ income statement ------------------------------ */
type IsQ = { station_id?: number | string; currency?: string; from?: string; to?: string };
export async function incomeStatement(ctx: Ctx, user: User, o: IsQ = {}) {
  need(user, 'report.read'); const sc = await scope(ctx, user, o);
  const to = reqDate(o.to, 'to'), from = V.date(o.from, 'from') || to.slice(0, 8) + '01';
  const r = (await balances(ctx, user, sc.ids, from, to, true)).filter((x) => x.type === 'income' || x.type === 'expense') as Array<Bal & { amount: number; sec: string }>;
  for (const x of r) x.amount = x.type === 'income' ? x.credit - x.debit : x.debit - x.credit;
  const sum = (f: (x: Bal) => boolean) => r.filter(f).reduce((s, x) => s + x.amount, 0);
  /* FuelPro chart: 4xxx revenue, 49xx other income, 5xxx cost of sales. Imported charts in the Yemeni layout: 42x other income, 31x cost of activity. */
  const isOther = (x: Bal) => x.code.startsWith('49') || (x.code.startsWith('42') && x.code.length > 4), isCos = (x: Bal) => x.code.startsWith('5') || (x.code.startsWith('31') && x.code.length !== 4);
  const revenue = sum((x) => x.type === 'income' && !isOther(x)), other = sum((x) => x.type === 'income' && isOther(x));
  const cogs = sum((x) => x.type === 'expense' && isCos(x)), opex = sum((x) => x.type === 'expense' && !isCos(x));
  for (const x of r) x.sec = x.type === 'income' ? (isOther(x) ? 'other' : 'revenue') : (isCos(x) ? 'cos' : 'opex');
  return { from, to, currency: sc.currency, cur_dec: sc.cur_dec, rows: r, revenue, cost_of_sales: cogs, gross_profit: revenue - cogs, operating_expenses: opex, other_income: other,
    net_profit: revenue + other - cogs - opex };
}

/* ------------------------------ balance sheet ------------------------------ */
export async function balanceSheet(ctx: Ctx, user: User, o: IsQ & { as_of?: string } = {}) {
  need(user, 'report.read'); const sc = await scope(ctx, user, o);
  const asOf = reqDate(o.as_of || o.to, 'as_of');
  const r = (await balances(ctx, user, sc.ids, '0000-01-01', asOf)) as Array<Bal & { amount: number }>;
  for (const x of r) x.amount = NORMAL_DEBIT.has(x.type) ? x.debit - x.credit : x.credit - x.debit;
  const pick = (t: string) => r.filter((x) => x.type === t && x.amount !== 0);
  const total = (t: string) => r.filter((x) => x.type === t).reduce((s, x) => s + x.amount, 0);
  const earnings = total('income') - total('expense');   // not yet closed to retained earnings
  const assets = total('asset'), liabilities = total('liability'), equity = total('equity') + earnings;
  return { as_of: asOf, currency: sc.currency, cur_dec: sc.cur_dec, assets: pick('asset'), liabilities: pick('liability'), equity: pick('equity'), current_earnings: earnings,
    total_assets: assets, total_liabilities: liabilities, total_equity: equity, balanced: assets === liabilities + equity };
}

/* ------------------------------ cash-flow statement (direct method) ------------------------------
   Cash = every account marked as a box (cash or bank). For each posted journal that touches a box, each of its non-box
   lines contributes (credit − debit) to the class of its account; the journal balances, so the contributions add up
   exactly to the change in the boxes (`reconciled` proves it). The cost-of-sales pair inside a sale moves no cash. */
const CF_SYS: Record<string, string> = { capital: 'financing', drawings: 'financing', retained: 'financing', interbranch: 'financing', accum_dep: 'investing' };
const CF_GROUPS: Record<string, string> = { '11': 'investing', '214': 'investing', '216': 'financing', '217': 'financing', '224': 'financing', '227': 'financing' };
type Acct = { id: number; code: string; name_ar: string; name_en: string | null; type: string; sys: string | null; box: string | null; parent_id: number | null; is_group: number };
export async function cashFlow(ctx: Ctx, user: User, o: IsQ = {}) {
  need(user, 'report.read'); const sc = await scope(ctx, user, o);
  const to = reqDate(o.to, 'to'), from = V.date(o.from, 'from') || to.slice(0, 8) + '01';
  if (from > to) throw bad('VALIDATION', 'from must not be after to');
  const accts = await ctx.db.selectFrom('accounts').select(['id', 'code', 'name_ar', 'name_en', 'type', 'sys', 'box', 'parent_id', 'is_group']).where('org_id', '=', user.org_id).execute() as Acct[];
  const byId = new Map(accts.map((a) => [a.id, a]));
  const isBox = (a: Acct) => !!(a.box || a.sys === 'cash' || a.sys === 'bank');
  const classOf = (a: Acct) => {
    if (a.sys && CF_SYS[a.sys]) return CF_SYS[a.sys];
    if (a.sys) return 'operating';
    for (let p: Acct | undefined = a, guard = 0; p && guard < 20; p = p.parent_id ? byId.get(p.parent_id) : undefined, guard++) if (p.is_group && CF_GROUPS[p.code]) return CF_GROUPS[p.code];
    return a.type === 'equity' ? 'financing' : 'operating';
  };
  const boxIds = accts.filter(isBox).map((a) => a.id);
  const sec = () => ({ rows: [] as Array<{ account_id: number; code: string; name_ar: string; name_en: string | null; amount: number }>, inflow: 0, outflow: 0, total: 0 });
  const out = { operating: sec(), investing: sec(), financing: sec(), opening: sec(), fx: sec() };
  const boxBal = async (cond: RawBuilder<unknown>) => boxIds.length ? new Map((await rows<{ id: number; v: number }>(ctx, sql`select l.account_id id, coalesce(sum(l.debit - l.credit), 0) v
      from journal_lines l join journals j on j.id = l.journal_id
      where j.org_id = ${user.org_id} and j.status = 'posted' and j.station_id in (${list(sc.ids)}) and +l.account_id in (${list(boxIds)}) and ${cond} group by l.account_id`))
    .map((x) => [Number(x.id), Number(x.v)])) : new Map<number, number>();
  const openMap = await boxBal(sql`j.business_date < ${from}`);
  const moveMap = await boxBal(sql`j.business_date between ${from} and ${to}`);
  const contrib = boxIds.length ? await rows<{ id: number; k: string; v: number }>(ctx, sql`select l.account_id id,
      case when j.source like '%opening%' or j.source = 'migration' then 'opening' when j.source = 'fx_reval' then 'fx' else '' end as k, sum(l.credit - l.debit) as v
    from journal_lines l join journals j on j.id = l.journal_id
    where j.org_id = ${user.org_id} and j.status = 'posted' and j.station_id in (${list(sc.ids)}) and j.business_date between ${from} and ${to} and l.account_id not in (${list(boxIds)})
      and exists (select 1 from journal_lines b where b.journal_id = j.id and b.account_id in (${list(boxIds)}))
      and not (j.source = 'sale' and l.account_id in (select id from accounts where org_id = j.org_id and sys in ('cogs', 'inventory')))
    group by l.account_id, k having sum(l.credit - l.debit) <> 0`) : [];
  for (const c of contrib) {
    const a = byId.get(Number(c.id))!, v = Number(c.v), s = out[(c.k || classOf(a)) as keyof typeof out];
    s.rows.push({ account_id: a.id, code: a.code, name_ar: a.name_ar, name_en: a.name_en, amount: v });
    if (v > 0) s.inflow += v; else s.outflow += v; s.total += v;
  }
  for (const k of Object.keys(out) as Array<keyof typeof out>) out[k].rows.sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount) || x.code.localeCompare(y.code));
  const opening = [...openMap.values()].reduce((t, v) => t + v, 0), change = [...moveMap.values()].reduce((t, v) => t + v, 0);
  const flows = out.operating.total + out.investing.total + out.financing.total + out.opening.total + out.fx.total;
  const boxes = boxIds.filter((id) => openMap.get(id) || moveMap.get(id)).map((id) => {
    const a = byId.get(id)!, ob = openMap.get(id) || 0, m = moveMap.get(id) || 0;
    return { account_id: id, code: a.code, name_ar: a.name_ar, name_en: a.name_en, box: a.box || a.sys, opening: ob, change: m, closing: ob + m };
  }).sort((x, y) => x.code.localeCompare(y.code));
  return { from, to, currency: sc.currency, cur_dec: sc.cur_dec, stations: sc.stations.map((s) => ({ id: s.id, name: s.name })),
    opening_cash: opening, ...out, net_change: change, closing_cash: opening + change, reconciled: flows === change, boxes };
}

/* ------------------------------ profit by month ------------------------------ */
export async function profitByMonth(ctx: Ctx, user: User, o: { station_id?: number | string; year?: number | string } = {}) {
  need(user, 'report.read');
  const sid = V.int(Number(o.station_id), 'station_id', { min: 1 }); const st = await station(ctx.db, user, sid);
  const today = ctx.clock.today(st.timezone);
  const year = o.year ? V.int(Number(o.year), 'year', { min: 2000, max: 2100 }) : Number(today.slice(0, 4));
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const from = `${year}-${String(m).padStart(2, '0')}-01`, to = new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
    if (from > today) break;
    const is = await incomeStatement(ctx, user, { station_id: sid, from, to });
    const s = await ctx.db.selectFrom('sales').select(sql<number>`coalesce(sum(quantity_ml), 0)`.as('q')).where('station_id', '=', sid).where('voided_at', 'is', null)
      .where('business_date', '>=', from).where('business_date', '<=', to).executeTakeFirstOrThrow();
    months.push({ month: from.slice(0, 7), qty_ml: Number(s.q), revenue: is.revenue, cost_of_sales: is.cost_of_sales, gross_profit: is.gross_profit, operating_expenses: is.operating_expenses,
      other_income: is.other_income, net_profit: is.net_profit,
      expenses: is.rows.filter((r) => r.sec === 'opex' && r.amount).map((r) => ({ code: r.code, name_ar: r.name_ar, name_en: r.name_en, amount: r.amount })) });
  }
  const fuels = await rows(ctx, sql`select max(f.name) fuel_name, substr(s.business_date, 1, 7) as month, sum(s.quantity_ml) qty_ml, sum(s.net) revenue, sum(s.cogs) cogs
    from sales s join fuels f on f.id = s.fuel_id
    where s.station_id = ${sid} and s.voided_at is null and s.business_date between ${`${year}-01-01`} and ${`${year}-12-31`} group by f.id, substr(s.business_date, 1, 7) order by f.id, month`);
  for (const f of fuels) { f.qty_ml = Number(f.qty_ml); f.revenue = Number(f.revenue); f.cogs = f.cogs == null ? null : Number(f.cogs); }
  return { year, currency: st.currency, cur_dec: st.cur_dec, months, fuels };
}

/* ------------------------------ meter sheet (كشف العدادات) ------------------------------ */
export async function meterSheet(ctx: Ctx, user: User, sid: number, o: { from?: string; to?: string } = {}) {
  need(user, 'report.read'); const st = await station(ctx.db, user, sid);
  const to = V.date(o.to, 'to') || ctx.clock.today(st.timezone), from = V.date(o.from, 'from') || to.slice(0, 8) + '01';
  if (from > to) throw bad('VALIDATION', 'from must not be after to');
  const r = await rows<Row & { date: string; qty_ml: number; amount: number; cash: number; credit: number }>(ctx, sql`select s.business_date as date, s.pump_id, max(p.name) pump_name, max(f.name) fuel_name,
      min(s.open_ml) open_ml, max(s.close_ml) close_ml, sum(s.quantity_ml) qty_ml, sum(s.gross) amount, sum(case s.pay_type when 'cash' then s.gross else 0 end) cash,
      sum(case s.pay_type when 'credit' then s.gross else 0 end) credit, sum(s.cogs) cogs, count(*) as n, max(s.price_e4) price_e4
    from sales s join pumps p on p.id = s.pump_id join fuels f on f.id = s.fuel_id
    where s.station_id = ${sid} and s.business_date between ${from} and ${to} and s.voided_at is null
    group by s.business_date, s.pump_id order by s.business_date, pump_name, s.pump_id`);
  const days = new Map<string, { date: string; qty_ml: number; amount: number; cash: number; credit: number; pumps: Row[] }>();
  for (const x of r) {
    for (const k of ['pump_id', 'open_ml', 'close_ml', 'qty_ml', 'amount', 'cash', 'credit', 'n', 'price_e4']) x[k] = Number(x[k]);
    x.cogs = x.cogs == null ? null : Number(x.cogs);
    const d = days.get(x.date) || { date: x.date, qty_ml: 0, amount: 0, cash: 0, credit: 0, pumps: [] };
    d.qty_ml += x.qty_ml; d.amount += x.amount; d.cash += x.cash; d.credit += x.credit; d.pumps.push(x); days.set(x.date, d);
  }
  const all = [...days.values()];
  const totals = all.reduce((t, d) => ({ qty_ml: t.qty_ml + d.qty_ml, amount: t.amount + d.amount, cash: t.cash + d.cash, credit: t.credit + d.credit }), { qty_ml: 0, amount: 0, cash: 0, credit: 0 });
  return { from, to, currency: st.currency, cur_dec: st.cur_dec, days: all, totals };
}

/* ------------------------------ cash & bank boxes (حركة الصناديق والبنوك) ------------------------------ */
const period = (ctx: Ctx, st: Station, o: { from?: string; to?: string }, maxDays = 1100) => {
  const to = V.date(o.to, 'to') || ctx.clock.today(st.timezone), from = V.date(o.from, 'from') || to;
  if (from > to) throw bad('VALIDATION', 'from must not be after to');
  if (addDays(from, maxDays) < to) throw bad('VALIDATION', 'The period is too long');
  return { from, to };
};
type BoxRow = { account_id: number; code: string; name_ar: string; name_en: string | null; kind: string | null; currency: string | null; opening: number; debit: number; credit: number;
  closing: number; moves: number; fc: { opening: number; debit: number; credit: number; closing: number } | null };
/** Every box with its opening balance, money in, money out and closing balance; with box_account_id, its day-by-day movement too. */
export async function boxReport(ctx: Ctx, user: User, sid: number, o: { from?: string; to?: string; box_account_id?: number | string } = {}) {
  need(user, 'report.read'); const st = await station(ctx.db, user, sid); const { from, to } = period(ctx, st, o);
  const all = await listBoxes(ctx, user);
  const boxes: BoxRow[] = [];
  for (const a of all) {
    const fc = a.currency && a.currency !== st.currency ? a.currency : null;
    // `+j.…`: read this box's own lines (account index), not every journal of the station up to `to`
    const [r] = await rows<Record<string, number>>(ctx, sql`select coalesce(sum(case when j.business_date < ${from} then l.debit - l.credit end), 0) ob,
        coalesce(sum(case when j.business_date >= ${from} then l.debit end), 0) dr, coalesce(sum(case when j.business_date >= ${from} then l.credit end), 0) cr,
        coalesce(sum(case when j.business_date < ${from} and l.fc_code = ${fc} then case when l.debit > 0 then l.fc_amount else -l.fc_amount end end), 0) fob,
        coalesce(sum(case when j.business_date >= ${from} and l.fc_code = ${fc} and l.debit > 0 then l.fc_amount end), 0) fdr,
        coalesce(sum(case when j.business_date >= ${from} and l.fc_code = ${fc} and l.credit > 0 then l.fc_amount end), 0) fcr,
        count(case when j.business_date >= ${from} then 1 end) as n
      from journal_lines l join journals j on j.id = l.journal_id where l.account_id = ${a.id} and +j.station_id = ${sid} and j.status = 'posted' and j.business_date <= ${to}`);
    const ob = Number(r.ob), dr = Number(r.dr), cr = Number(r.cr), fob = Number(r.fob), fdr = Number(r.fdr), fcr = Number(r.fcr);
    const b = { account_id: a.id, code: a.code, name_ar: a.name_ar, name_en: a.name_en, kind: a.box || a.sys, currency: fc, opening: ob, debit: dr, credit: cr, closing: ob + dr - cr, moves: Number(r.n),
      fc: fc ? { opening: fob, debit: fdr, credit: fcr, closing: fob + fdr - fcr } : null };
    if (b.opening || b.moves || b.closing) boxes.push(b);
  }
  const sum = (k: 'opening' | 'debit' | 'credit' | 'closing') => boxes.reduce((s, b) => s + b[k], 0);
  const out: Record<string, unknown> = { from, to, currency: st.currency, cur_dec: st.cur_dec, boxes, totals: { opening: sum('opening'), debit: sum('debit'), credit: sum('credit'), closing: sum('closing') } };
  if (o.box_account_id) {
    const id = V.int(Number(o.box_account_id), 'box_account_id', { min: 1 });
    if (!boxes.find((x) => x.account_id === id) && !all.find((x) => x.id === id)) throw bad('NOT_A_BOX', 'Choose a cash box or bank account');
    const days = await rows<{ d: string; dr: number; cr: number; n: number }>(ctx, sql`select j.business_date as d, sum(l.debit) dr, sum(l.credit) cr, count(*) as n
      from journal_lines l join journals j on j.id = l.journal_id
      where l.account_id = ${id} and j.station_id = ${sid} and j.status = 'posted' and j.business_date between ${from} and ${to} group by j.business_date order by j.business_date`);
    let bal = (boxes.find((x) => x.account_id === id) || { opening: 0 }).opening;
    out.days = days.map((d) => { bal += Number(d.dr) - Number(d.cr); return { date: d.d, debit: Number(d.dr), credit: Number(d.cr), moves: Number(d.n), balance: bal }; });
    out.box_account_id = id;
  }
  return out;
}

/* ------------------------------ collections follow-up (متابعة التحصيل) ------------------------------
   Customers who owe the station: balance, credit limit, last credit sale, last payment and the days since money last came in.
   days = only customers with no payment for at least that many days (0 = everyone who owes). */
export async function collections(ctx: Ctx, user: User, sid: number, o: { as_of?: string; days?: number | string } = {}) {
  need(user, 'report.read'); const st = await station(ctx.db, user, sid);
  const asOf = V.date(o.as_of, 'as_of') || ctx.clock.today(st.timezone);
  const minDays = o.days ? V.int(Number(o.days), 'days', { min: 0, max: 3650 }) : 0;
  const r = await rows<Row & { id: number; balance: number; credit_limit: number; last_debit: string | null; last_credit: string | null; last_move: string | null }>(ctx, sql`select c.id, c.name, c.ref, c.phone,
      c.credit_limit, c.terms_days, coalesce(sum(l.debit - l.credit), 0) balance,
      max(case when l.debit > 0 then j.business_date end) last_debit,
      max(case when l.credit > 0 and j.reversal_of is null and j.reversed_by is null then j.business_date end) last_credit,
      max(j.business_date) last_move
    from customers c left join journal_lines l on l.party_type = 'customer' and l.party_id = c.id
      left join journals j on j.id = l.journal_id and j.status = 'posted' and j.business_date <= ${asOf}
      left join accounts a on a.id = l.account_id
    where c.station_id = ${sid} and (l.id is null or (a.sys = 'ar' and j.id is not null)) group by c.id order by c.id`);
  const since = (d: string | null) => d ? Math.round((Date.parse(asOf) - Date.parse(d)) / 864e5) : null;
  const out: Array<Row & { balance: number; days_since_payment: number | null; band?: string }> = [];
  for (const x of r) {
    x.id = Number(x.id); x.balance = Number(x.balance); x.credit_limit = Number(x.credit_limit); x.terms_days = Number(x.terms_days);
    if (x.balance <= 0) continue;
    const ref = x.last_credit || null, days = since(ref || x.last_debit);
    let amount = 0;
    if (ref) {
      const p = await rows<{ amount: number }>(ctx, sql`select l.credit amount from journal_lines l join journals j on j.id = l.journal_id join accounts a on a.id = l.account_id
        where l.party_type = 'customer' and l.party_id = ${x.id} and a.sys = 'ar' and l.credit > 0 and j.status = 'posted' and j.business_date = ${ref}
          and j.reversal_of is null and j.reversed_by is null order by j.id desc limit 1`);
      amount = Number(p[0].amount);
    }
    out.push({ ...x, last_credit_amount: amount, days_since_payment: days, idle_days: since(x.last_move), over_limit: x.credit_limit > 0 && x.balance > x.credit_limit, never_paid: !ref });
  }
  const shown = out.filter((x) => (x.days_since_payment ?? 99999) >= minDays).sort((a, b) => (b.days_since_payment ?? 99999) - (a.days_since_payment ?? 99999) || b.balance - a.balance);
  const band = (d: number | null) => d == null ? 'b4' : d <= 30 ? 'b1' : d <= 60 ? 'b2' : d <= 90 ? 'b3' : 'b4';
  const bands = { b1: 0, b2: 0, b3: 0, b4: 0 };
  for (const x of shown) { x.band = band(x.days_since_payment); bands[x.band as keyof typeof bands] += x.balance; }
  return { as_of: asOf, days: minDays, currency: st.currency, cur_dec: st.cur_dec, rows: shown, total: shown.reduce((s, x) => s + x.balance, 0), over_limit: shown.filter((x) => x.over_limit).length, bands };
}

/* ------------------------------ daily station report (التقرير اليومي) ------------------------------ */
const nums = (r: Row[], keys: string[]) => { for (const x of r) for (const k of keys) if (x[k] != null) x[k] = Number(x[k]); return r; };
export async function dailyReport(ctx: Ctx, user: User, sid: number, o: { date?: string } = {}) {
  need(user, 'report.read'); const st = await station(ctx.db, user, sid);
  const date = V.date(o.date, 'date') || ctx.clock.today(st.timezone);
  const meters = await meterSheet(ctx, user, sid, { from: date, to: date });
  const fuels = nums(await rows(ctx, sql`select max(f.name) fuel_name, sum(s.quantity_ml) qty_ml, sum(s.gross) amount, sum(case s.pay_type when 'cash' then s.gross else 0 end) cash,
      sum(case s.pay_type when 'credit' then s.gross else 0 end) credit, sum(s.cogs) cogs, max(s.price_e4) price_e4
    from sales s join fuels f on f.id = s.fuel_id where s.station_id = ${sid} and s.business_date = ${date} and s.voided_at is null group by f.id order by f.id`), ['qty_ml', 'amount', 'cash', 'credit', 'cogs', 'price_e4']);
  const credit = nums(await rows(ctx, sql`select max(c.name) customer_name, max(c.ref) ref, max(f.name) fuel_name, sum(s.quantity_ml) qty_ml, sum(s.gross) amount, ${concat(ctx, sql`s.note`)} note
    from sales s join customers c on c.id = s.customer_id join fuels f on f.id = s.fuel_id where s.station_id = ${sid} and s.business_date = ${date} and s.voided_at is null and s.pay_type = 'credit'
    group by c.id, f.id order by amount desc, c.id, f.id`), ['qty_ml', 'amount']);
  /* money that went in or out of a box that day, other than cash sales: vouchers, collections, payments, imported entries */
  const boxIds = (await listBoxes(ctx, user)).map((a) => a.id);
  const moves = boxIds.length ? nums(await rows(ctx, sql`select o.credit amount_in, o.debit amount_out, oa.code, oa.name_ar account_name, coalesce(c.name, s.name) party_name, coalesce(o.memo, j.memo) memo,
      j.doc_type, j.source, coalesce(j.ref, (select ref_no from vouchers v where j.source = 'voucher' and v.id = j.source_id)) ref,
      coalesce((select va.name_ar from vouchers v join accounts va on va.id = v.box_account_id where j.source = 'voucher' and v.id = j.source_id),
        (select ${concat(ctx, sql`ba.name_ar`)} from journal_lines bl join accounts ba on ba.id = bl.account_id where bl.journal_id = j.id and bl.account_id in (${list(boxIds)}))) box_name
    from journals j join journal_lines o on o.journal_id = j.id join accounts oa on oa.id = o.account_id
      left join customers c on o.party_type = 'customer' and c.id = o.party_id left join suppliers s on o.party_type = 'supplier' and s.id = o.party_id
    where j.station_id = ${sid} and j.business_date = ${date} and j.status = 'posted' and j.source <> 'sale' and j.reversal_of is null and j.reversed_by is null
      and o.account_id not in (${list(boxIds)}) and exists (select 1 from journal_lines bl where bl.journal_id = j.id and bl.account_id in (${list(boxIds)}))
    order by j.id, o.id`), ['amount_in', 'amount_out']) : [];
  const expenses = nums(await rows(ctx, sql`select category, gross amount, note memo from expenses where station_id = ${sid} and business_date = ${date} and voided_at is null order by id`), ['amount']);
  const deliveries = nums(await rows(ctx, sql`select d.ref, f.name fuel_name, d.quantity_ml, d.net + d.vat total, s.name supplier_name from deliveries d join fuels f on f.id = d.fuel_id
    left join suppliers s on s.id = d.supplier_id where d.station_id = ${sid} and d.business_date = ${date} and d.voided_at is null order by d.id`), ['quantity_ml', 'total']);
  const boxes = (await boxReport(ctx, user, sid, { from: date, to: date })).boxes as BoxRow[];
  /* stock: book level at the end of the day = today's level minus everything that moved after that day */
  const tanks = [];
  for (const t of await rows<{ id: number; name: string; fuel_name: string; capacity_ml: number; level_ml: number }>(ctx, sql`select t.id, t.name, f.name fuel_name, t.capacity_ml, t.level_ml
      from tanks t join fuels f on f.id = t.fuel_id where t.station_id = ${sid} and t.active = 1 order by t.id`)) {
    const [after] = await rows<{ v: number }>(ctx, sql`select coalesce(sum(qty_ml), 0) v from stock_moves where tank_id = ${t.id} and business_date > ${date}`);
    const [day] = await rows<{ inq: number; outq: number }>(ctx, sql`select coalesce(sum(case when qty_ml > 0 then qty_ml end), 0) inq, coalesce(sum(case when qty_ml < 0 then -qty_ml end), 0) outq
      from stock_moves where tank_id = ${t.id} and business_date = ${date}`);
    const close = Number(t.level_ml) - Number(after.v), inq = Number(day.inq), outq = Number(day.outq);
    tanks.push({ tank_name: t.name, fuel_name: t.fuel_name, capacity_ml: Number(t.capacity_ml), opening_ml: close - inq + outq, in_ml: inq, out_ml: outq, closing_ml: close });
  }
  const sum = (a: Row[], k: string) => a.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  return { date, currency: st.currency, cur_dec: st.cur_dec, meters: meters.days[0] || null, fuels, credit, moves, expenses, deliveries, boxes, tanks,
    totals: { qty_ml: sum(fuels, 'qty_ml'), amount: sum(fuels, 'amount'), cash: sum(fuels, 'cash'), credit: sum(fuels, 'credit'), gross_profit: sum(fuels, 'amount') - sum(fuels, 'cogs'),
      receipts: sum(moves, 'amount_in'), payments: sum(moves, 'amount_out'), expenses: sum(expenses, 'amount'), deliveries: sum(deliveries, 'total') } };
}

/* ------------------------------ letterhead (ترويسة المستندات) ------------------------------ */
const LOGO_RE = /^data:image\/(svg\+xml|png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
export async function getBrand(ctx: Ctx, user: User) {
  need(user, 'read');
  const b = await ctx.db.selectFrom('org_brand').selectAll().where('org_id', '=', user.org_id).executeTakeFirst();
  const org = await ctx.db.selectFrom('orgs').select('name').where('id', '=', user.org_id).executeTakeFirst();
  if (!org) throw notFound('Organisation');
  return { name: b?.name || org.name, activity: b?.activity || '', address: b?.address || '', phones: b?.phones || '', footer: b?.footer || '', logo: b?.logo || null };
}
export async function setBrand(ctx: Ctx, user: User, b: Record<string, unknown>) {
  need(user, 'config.edit'); V.obj(b, 'body');
  const cur = await getBrand(ctx, user);
  const val = (k: 'name' | 'activity' | 'address' | 'phones' | 'footer', max: number) => b[k] === undefined ? cur[k] : (V.str(b[k], k, { max, optional: true }) || '');
  let logo = cur.logo;
  if (b.logo !== undefined) {
    if (b.logo === null || b.logo === '') logo = null;
    else { if (typeof b.logo !== 'string' || b.logo.length > 600_000 || !LOGO_RE.test(b.logo)) throw bad('VALIDATION', 'The logo must be a PNG, JPEG, WEBP or SVG image under 400 KB'); logo = b.logo; }
  }
  const row = { name: val('name', 120), activity: val('activity', 160), address: val('address', 200), phones: val('phones', 120), footer: val('footer', 200), logo, updated_at: ctx.clock.now() };
  return tx(ctx, async (q) => {
    await q.insertInto('org_brand').values({ org_id: user.org_id, ...row }).onConflict((c) => c.column('org_id').doUpdateSet(row)).execute();
    await audit(ctx, q, user, null, 'brand.update', 'org', user.org_id, { fields: Object.keys(b) });
    return getBrand({ ...ctx, db: q as unknown as Ctx['db'] }, user);
  });
}
