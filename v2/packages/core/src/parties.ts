/* Customers, suppliers & collections (v2 phase 3): edit customers and suppliers, customer payments, supplier payments,
   voids, account statements and debt ageing. Port of v1 src/services.js (createPayment, voidPayment, statement) and
   src/ops.js (updateCustomer, updateSupplier, supplierPayment, supplierStatement, ageing) + the helpers in src/books.js
   (partyExtras, partyExtrasMany, periodize). Same rules, same postings, same figures. */
import { sql } from 'kysely';
import { audit, need, scoped, station } from './access.ts';
import { addDays, tx, type Ctx, type Q, type User } from './ctx.ts';
import { bad, conflict, notFound } from './errors.ts';
import { assertOpen, countReversible, post, reverseSource } from './ledger.ts';
import { customerBalance } from './sales.ts';
import { cashParts, openShift } from './shifts.ts';
import { supplierBalance } from './stock.ts';
import * as V from './validate.ts';

type PartyType = 'customer' | 'supplier';
/* sources whose documents appear on the statement in their own right; any other ledger line naming the party
   (vouchers, manual journals, imported history) is shown as an «extra» line (v1 books.DOC_SOURCES) */
const DOC_SOURCES: Record<PartyType, string[]> = { customer: ['sale', 'payment', 'customer_opening', 'migration'], supplier: ['delivery', 'supplier_payment', 'supplier_opening', 'migration'] };
const PARTY_SYS: Record<PartyType, string> = { customer: 'ar', supplier: 'ap' };

/* drawer cash (v1 shiftTotals): customer cash payments come in, supplier cash payments go out */
cashParts.push(async (q, shiftId) => {
  const one = async (t: 'payments' | 'supplier_payments') => Number((await q.selectFrom(t).select(sql<number>`coalesce(sum(amount), 0)`.as('v'))
    .where('shift_id', '=', shiftId).where('method', '=', 'cash').where('voided_at', 'is', null).executeTakeFirstOrThrow()).v);
  return { collections_cash: await one('payments'), supplier_payments_cash: await one('supplier_payments') };
});

/* ------------------------------ edit ------------------------------ */
export async function updateCustomer(ctx: Ctx, user: User, sid: number, id: number, b: Record<string, unknown>) {
  need(user, 'customer.edit'); V.obj(b, 'body');
  return tx(ctx, async (q) => {
    await station(q, user, sid);
    const c = await scoped(ctx, q, 'customers', id, sid, 'Customer', true);
    await q.updateTable('customers').set({
      name: b.name === undefined ? c.name : V.str(b.name, 'name', { max: 120 }), phone: b.phone === undefined ? c.phone : (V.str(b.phone, 'phone', { max: 40, optional: true }) || null),
      credit_limit: b.credit_limit === undefined ? c.credit_limit : V.int(b.credit_limit, 'credit_limit', { min: 0, max: 10 ** 13 }),
      terms_days: b.terms_days === undefined ? c.terms_days : V.int(b.terms_days, 'terms_days', { min: 0, max: 365 }), active: b.active === undefined ? c.active : (V.bool(b.active) ? 1 : 0)
    }).where('id', '=', id).execute();
    await audit(ctx, q, user, sid, 'customer.update', 'customer', id, { fields: Object.keys(b) }); return { ok: true };
  });
}
export async function updateSupplier(ctx: Ctx, user: User, sid: number, id: number, b: Record<string, unknown>) {
  need(user, 'supplier.manage'); V.obj(b, 'body');
  return tx(ctx, async (q) => {
    await station(q, user, sid);
    const s = await scoped(ctx, q, 'suppliers', id, sid, 'Supplier', true);
    await q.updateTable('suppliers').set({
      name: b.name === undefined ? s.name : V.str(b.name, 'name', { max: 120 }), phone: b.phone === undefined ? s.phone : (V.str(b.phone, 'phone', { max: 40, optional: true }) || null),
      terms_days: b.terms_days === undefined ? s.terms_days : V.int(b.terms_days, 'terms_days', { min: 0, max: 365 }), active: b.active === undefined ? s.active : (V.bool(b.active) ? 1 : 0)
    }).where('id', '=', id).execute();
    await audit(ctx, q, user, sid, 'supplier.update', 'supplier', id, { fields: Object.keys(b) }); return { ok: true };
  });
}

/* ------------------------------ payments ------------------------------ */
export async function createPayment(ctx: Ctx, user: User, sid: number, b: { customer_id: number; amount: number; method?: 'cash' | 'bank'; note?: string }) {
  need(user, 'payment.create'); V.obj(b, 'body');
  return tx(ctx, async (q) => {
    const st = await station(q, user, sid);
    const amount = V.int(b.amount, 'amount', { min: 1, max: 10 ** 13 }), method = V.oneOf(b.method || 'cash', 'method', ['cash', 'bank'] as const);
    const date = ctx.clock.today(st.timezone);
    const c = await scoped(ctx, q, 'customers', V.int(b.customer_id, 'customer_id', { min: 1 }), sid, 'Customer', true);
    const bal = await customerBalance(q, c.id);
    if (amount > bal) throw conflict('OVERPAYMENT', 'The payment is larger than the customer balance', { balance: bal });
    const shift = method === 'cash' ? await openShift(q, st, true) : null;
    await assertOpen(q, user.org_id, date);   // checked before the first write (ADR-40); v1 checks it inside post() — same outcome
    const id = (await q.insertInto('payments').values({ station_id: sid, customer_id: c.id, business_date: date, created_at: ctx.clock.now(), amount,
      note: V.str(b.note, 'note', { max: 200, optional: true }) || null, user_id: user.id, method, shift_id: shift ? shift.id : null, voided_at: null, void_reason: null, void_by: null })
      .returning('id').executeTakeFirstOrThrow()).id;
    await post(ctx, q, { org_id: user.org_id, station_id: sid, date, source: 'payment', source_id: id, user_id: user.id, periodChecked: true,
      lines: [{ a: method, dr: amount }, { a: 'ar', cr: amount, party_type: 'customer', party_id: c.id }] });
    await audit(ctx, q, user, sid, 'payment.create', 'payment', id, { customer_id: c.id, amount, method });
    return { id, balance: bal - amount };
  });
}
export async function supplierPayment(ctx: Ctx, user: User, sid: number, b: { supplier_id: number; amount: number; method?: 'cash' | 'bank'; note?: string }) {
  need(user, 'supplier.pay'); V.obj(b, 'body');
  return tx(ctx, async (q) => {
    const st = await station(q, user, sid);
    const amount = V.int(b.amount, 'amount', { min: 1, max: 10 ** 13 }), method = V.oneOf(b.method || 'bank', 'method', ['cash', 'bank'] as const);
    const date = ctx.clock.today(st.timezone);
    const s = await scoped(ctx, q, 'suppliers', V.int(b.supplier_id, 'supplier_id', { min: 1 }), sid, 'Supplier', true);
    const bal = await supplierBalance(q, s.id);
    if (amount > bal) throw conflict('OVERPAYMENT', 'The payment is larger than the amount owed', { balance: bal });
    const sh = method === 'cash' ? await openShift(q, st, true) : null;
    await assertOpen(q, user.org_id, date);
    const id = (await q.insertInto('supplier_payments').values({ station_id: sid, supplier_id: s.id, shift_id: sh ? sh.id : null, business_date: date, created_at: ctx.clock.now(),
      amount, method, note: V.str(b.note, 'note', { max: 200, optional: true }) || null, user_id: user.id, voided_at: null, void_reason: null, void_by: null })
      .returning('id').executeTakeFirstOrThrow()).id;
    await post(ctx, q, { org_id: user.org_id, station_id: sid, date, source: 'supplier_payment', source_id: id, user_id: user.id, periodChecked: true,
      lines: [{ a: 'ap', dr: amount, party_type: 'supplier', party_id: s.id }, { a: method, cr: amount }] });
    await audit(ctx, q, user, sid, 'supplier.payment', 'supplier_payment', id, { supplier_id: s.id, amount, method });
    return { id, balance: bal - amount };
  });
}
/** v1 voidRow for documents whose only side effect is their journal (payments, supplier payments). */
async function voidJournalDoc(ctx: Ctx, user: User, sid: number, table: 'payments' | 'supplier_payments', source: string, perm: string, id: number, reason: unknown) {
  need(user, perm);
  const r = V.str(reason, 'reason', { min: 3, max: 200 });
  return tx(ctx, async (q) => {
    await station(q, user, sid);
    const row = await scoped(ctx, q, table, id, sid, table, true);
    if (row.voided_at) throw conflict('ALREADY_VOIDED', 'This record is already voided');
    if (row.shift_id) {
      const sh = await q.selectFrom('shifts').select('status').where('id', '=', row.shift_id).executeTakeFirstOrThrow();
      if (sh.status !== 'open') throw conflict('SHIFT_CLOSED', 'This record belongs to a closed shift and cannot be changed');
    }
    await assertOpen(q, user.org_id, row.business_date);
    if (await countReversible(q, user.org_id, source, id) === 0) throw conflict('LEGACY_DOCUMENT', 'This record predates the general ledger; correct it with a manual journal');
    await reverseSource(ctx, q, user.org_id, source, id, user.id, 'Void: ' + r);
    await (q as unknown as import('kysely').Kysely<import('./schema.ts').DB>).updateTable(table as 'payments').set({ voided_at: ctx.clock.now(), void_reason: r, void_by: user.id }).where('id', '=', id).execute();
    await audit(ctx, q, user, sid, `${table}.void`, table, id, { reason: r });
    return { ok: true };
  });
}
export const voidPayment = (ctx: Ctx, user: User, sid: number, id: number, reason: unknown) => voidJournalDoc(ctx, user, sid, 'payments', 'payment', 'payment.void', id, reason);
export const voidSupplierPayment = (ctx: Ctx, user: User, sid: number, id: number, reason: unknown) => voidJournalDoc(ctx, user, sid, 'supplier_payments', 'supplier_payment', 'supplier.pay', id, reason);

/* ------------------------------ statements ------------------------------ */
export interface Entry {
  kind: string; id: number; date: string; created_at: string; debit: number; credit: number; voided: boolean; balance?: number; [k: string]: unknown;
}
async function partyExtras(q: Q, type: PartyType, id: number, asOf = '9999-12-31'): Promise<Entry[]> {
  const rows = await q.selectFrom('journal_lines as l').innerJoin('journals as j', 'j.id', 'l.journal_id').innerJoin('accounts as a', 'a.id', 'l.account_id')
    .select(['j.id', 'j.business_date as date', 'j.created_at', 'j.source', 'j.memo', 'l.memo as lmemo', 'l.debit', 'l.credit', 'j.doc_type', 'j.doc_ref', 'j.ref as ref_no'])
    .where('l.party_type', '=', type).where('l.party_id', '=', id).where('a.sys', '=', PARTY_SYS[type]).where('j.status', '=', 'posted').where('j.business_date', '<=', asOf)
    .where('j.source', 'not in', DOC_SOURCES[type]).orderBy('j.business_date').orderBy('j.id').orderBy('l.id').execute();
  // vouchers carry their own number in v1 (vouchers.ref_no); they move to v2 with the finance module — until then j.ref
  return rows.map((r) => ({ kind: 'journal', id: r.id, date: r.date, created_at: r.created_at, debit: r.debit, credit: r.credit, source: r.source,
    note: r.lmemo || r.memo || '', ref_no: r.ref_no || null, doc_type: r.doc_type || null, doc_ref: r.doc_ref || null, exact: !!r.lmemo, voided: false }));
}
/** a statement cut to a period: opening balance before `from`, the lines inside, closing balance (v1 books.periodize) */
function periodize<T extends { entries: Entry[]; balance: number }>(st: T, o: { from?: string; to?: string }) {
  const from = o.from ? V.date(o.from, 'from')! : null, to = o.to ? V.date(o.to, 'to')! : null;
  if (from && to && from > to) throw bad('VALIDATION', 'from must not be after to');
  if (!from && !to) { const live = st.entries.filter((e) => !e.voided); return { ...st, from: null, to: null, opening: 0, total_debit: live.reduce((s, e) => s + e.debit, 0), total_credit: live.reduce((s, e) => s + e.credit, 0) }; }
  let opening = 0; const rows: Entry[] = [];
  for (const e of st.entries) {
    const d = e.date || '';
    if (from && d < from) { if (!e.voided) opening = e.balance!; continue; }
    if (to && d > to) continue;
    rows.push(e);
  }
  const live = rows.filter((e) => !e.voided);
  const closing = live.length ? live[live.length - 1].balance! : opening;
  return { ...st, from, to, opening, entries: rows, balance: closing, total_debit: live.reduce((s, e) => s + e.debit, 0), total_credit: live.reduce((s, e) => s + e.credit, 0) };
}
export async function customerStatement(ctx: Ctx, user: User, sid: number, cid: number, o: { from?: string; to?: string } = {}) {
  await station(ctx.db, user, sid);
  const c = await scoped(ctx, ctx.db, 'customers', cid, sid, 'Customer');
  const sales: Entry[] = (await ctx.db.selectFrom('sales as s').innerJoin('fuels as f', 'f.id', 's.fuel_id')
    .select(['s.id', 's.business_date as date', 's.created_at', 's.gross as debit', 's.quantity_ml', 's.note', 's.ref', 's.bill', 'f.name as fuel_name', 's.voided_at'])
    .where('s.customer_id', '=', cid).execute())
    .map((r) => ({ kind: 'sale', id: r.id, date: r.date, created_at: r.created_at, debit: r.debit, credit: 0, quantity_ml: r.quantity_ml, fuel_name: r.fuel_name,
      note: r.note || undefined, ref_no: r.ref || undefined, doc_ref: r.bill || undefined, voided: !!r.voided_at }));
  const pays: Entry[] = (await ctx.db.selectFrom('payments').select(['id', 'business_date as date', 'created_at', 'amount as credit', 'note', 'voided_at']).where('customer_id', '=', cid).execute())
    .map((r) => ({ kind: 'payment', id: r.id, date: r.date, created_at: r.created_at, debit: 0, credit: r.credit, note: r.note, voided: !!r.voided_at }));
  // by business date; same-second ties: a sale precedes the payment that settles it
  const entries = sales.concat(pays).sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at) || (a.kind === b.kind ? a.id - b.id : (a.kind === 'sale' ? -1 : 1)));
  if (c.opening_balance) entries.unshift({ kind: 'opening', id: 0, date: c.created_on || '', created_at: '', debit: Math.max(c.opening_balance, 0), credit: Math.max(-c.opening_balance, 0), voided: false });
  const extras = await partyExtras(ctx.db, 'customer', cid);
  if (extras.length) { entries.push(...extras); entries.sort((a, b) => Number(b.kind === 'opening') - Number(a.kind === 'opening') || (a.date || '').localeCompare(b.date || '') || (a.created_at || '').localeCompare(b.created_at || '')); }
  let bal = 0;
  for (const e of entries) { if (!e.voided) bal += e.debit - e.credit; e.balance = bal; }
  return periodize({ customer: { id: c.id, name: c.name, phone: c.phone, credit_limit: c.credit_limit, terms_days: c.terms_days, ref: c.ref }, balance: bal, entries }, o);
}
export async function supplierStatement(ctx: Ctx, user: User, sid: number, id: number, o: { from?: string; to?: string } = {}) {
  await station(ctx.db, user, sid);
  const s = await scoped(ctx, ctx.db, 'suppliers', id, sid, 'Supplier');
  const e: Entry[] = [];
  if (s.opening_balance) e.push({ kind: 'opening', id: 0, date: s.created_on || '', created_at: '', debit: Math.max(-s.opening_balance, 0), credit: Math.max(s.opening_balance, 0), voided: false });
  const dels = await ctx.db.selectFrom('deliveries as d').innerJoin('tanks as t', 't.id', 'd.tank_id').selectAll('d').select('t.name as tank_name')
    .where('d.supplier_id', '=', id).where('d.pay_type', '=', 'credit').orderBy('d.id').execute();
  const refs = new Map((await ctx.db.selectFrom('journals').select(['source_id', 'ref']).where('source', '=', 'delivery').where('reversal_of', 'is', null).where('org_id', '=', user.org_id)
    .where('source_id', 'in', dels.length ? dels.map((d) => d.id) : [0]).execute()).map((r) => [r.source_id, r.ref]));
  for (const d of dels) e.push({ kind: 'purchase', id: d.id, date: d.business_date, created_at: d.created_at, debit: 0, credit: d.payable ?? (d.net + d.vat), quantity_ml: d.quantity_ml,
    due_date: d.due_date, tank_name: d.tank_name, note: d.note || undefined, ref_no: refs.get(d.id) || d.ref || undefined, doc_ref: d.ref || undefined, voided: !!d.voided_at });
  for (const p of await ctx.db.selectFrom('supplier_payments').selectAll().where('supplier_id', '=', id).orderBy('id').execute())
    e.push({ kind: 'payment', id: p.id, date: p.business_date, created_at: p.created_at, debit: p.amount, credit: 0, method: p.method, note: p.note, voided: !!p.voided_at });
  e.push(...await partyExtras(ctx.db, 'supplier', id));
  e.sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.created_at.localeCompare(b.created_at));
  let bal = 0; for (const x of e) { if (!x.voided) bal += x.credit - x.debit; x.balance = bal; }
  return periodize({ supplier: s, balance: bal, entries: e }, o);
}

/* ------------------------------ ageing ------------------------------ */
type Bucket = 'current' | 'd30' | 'd60' | 'd90' | 'over90';
export async function ageing(ctx: Ctx, user: User, sid: number, o: { type?: string; as_of?: string } = {}) {
  need(user, 'report.read'); const st = await station(ctx.db, user, sid);
  const type = V.oneOf(o.type || 'customer', 'type', ['customer', 'supplier'] as const);
  const asOf = V.date(o.as_of, 'as_of') || ctx.clock.today(st.timezone);
  const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  const tot = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0, advance: 0, balance: 0 };
  const rows: Array<Record<string, unknown> & typeof tot> = [];
  const tbl = type === 'customer' ? 'customers' : 'suppliers';
  const parties = (await (ctx.db as unknown as import('kysely').Kysely<import('./schema.ts').DB>).selectFrom(tbl as 'customers').selectAll().where('station_id', '=', sid).where('active', '=', 1).orderBy('name').execute()) as Array<{
    id: number; name: string; terms_days: number; credit_limit?: number; opening_balance: number; created_on: string | null }>;
  const ids = parties.length ? parties.map((p) => p.id) : [0];
  const group = <R extends { pid: number }>(list: R[]) => { const m = new Map<number, R[]>(); for (const r of list) { const a = m.get(r.pid); if (a) a.push(r); else m.set(r.pid, [r]); } return m; };
  const docs = group<{ pid: number; d: string; due_date?: string | null; amt: number }>(type === 'customer'
    ? (await ctx.db.selectFrom('sales').select(['customer_id as pid', 'business_date as d', 'gross as amt']).where('customer_id', 'in', ids).where('pay_type', '=', 'credit')
      .where('voided_at', 'is', null).where('business_date', '<=', asOf).orderBy('customer_id').orderBy('business_date').orderBy('id').execute()) as Array<{ pid: number; d: string; amt: number }>
    : (await ctx.db.selectFrom('deliveries').select(['supplier_id as pid', 'business_date as d', 'due_date', sql<number>`coalesce(payable, net + vat)`.as('amt')]).where('supplier_id', 'in', ids)
      .where('pay_type', '=', 'credit').where('voided_at', 'is', null).where('business_date', '<=', asOf).orderBy('supplier_id').orderBy('business_date').orderBy('id').execute())
      .map((r) => ({ pid: Number(r.pid), d: r.d, due_date: r.due_date, amt: Number(r.amt) })));
  const paidRows = type === 'customer'
    ? await ctx.db.selectFrom('payments').select(['customer_id as pid', sql<number>`sum(amount)`.as('v')]).where('customer_id', 'in', ids).where('voided_at', 'is', null).where('business_date', '<=', asOf).groupBy('customer_id').execute()
    : await ctx.db.selectFrom('supplier_payments').select(['supplier_id as pid', sql<number>`sum(amount)`.as('v')]).where('supplier_id', 'in', ids).where('voided_at', 'is', null).where('business_date', '<=', asOf).groupBy('supplier_id').execute();
  const paidBy = new Map(paidRows.map((r) => [Number(r.pid), Number(r.v)]));
  const extraRows = await ctx.db.selectFrom('journal_lines as l').innerJoin('journals as j', 'j.id', 'l.journal_id').innerJoin('accounts as a', 'a.id', 'l.account_id')
    .select(['l.party_id as pid', 'j.business_date as date', 'l.debit', 'l.credit'])
    .where('l.party_type', '=', type).where('l.party_id', 'in', ids).where('a.sys', '=', PARTY_SYS[type]).where('j.status', '=', 'posted').where('j.business_date', '<=', asOf)
    .where('j.source', 'not in', DOC_SOURCES[type]).orderBy('l.party_id').orderBy('j.business_date').orderBy('j.id').orderBy('l.id').execute();
  const extras = group(extraRows.map((r) => ({ ...r, pid: Number(r.pid) })));
  for (const p of parties) {
    const debts: Array<{ date: string; due: string; amt: number }> = [];   // amounts owed, oldest first, each with a due date
    if (p.opening_balance > 0) debts.push({ date: '', due: p.created_on || asOf, amt: p.opening_balance });
    let paid = p.opening_balance < 0 ? -p.opening_balance : 0;
    for (const d of docs.get(p.id) || []) debts.push({ date: d.d, due: (type === 'supplier' && d.due_date) || addDays(d.d, p.terms_days), amt: d.amt });
    paid += paidBy.get(p.id) || 0;
    for (const x of extras.get(p.id) || []) {
      const owed = type === 'customer' ? x.debit - x.credit : x.credit - x.debit;
      if (owed > 0) debts.push({ date: x.date, due: addDays(x.date, p.terms_days), amt: owed }); else paid += -owed;
    }
    debts.sort((a, b) => a.date.localeCompare(b.date));
    const r = { id: p.id, name: p.name, terms_days: p.terms_days, credit_limit: p.credit_limit, current: 0, d30: 0, d60: 0, d90: 0, over90: 0, advance: 0, balance: 0, oldest_due: null as string | null };
    for (const d of debts) {               // payments settle the oldest debts first (FIFO)
      const use = Math.min(paid, d.amt); paid -= use; const left = d.amt - use; if (!left) continue;
      const late = days(d.due, asOf);
      const k: Bucket = late <= 0 ? 'current' : late <= 30 ? 'd30' : late <= 60 ? 'd60' : late <= 90 ? 'd90' : 'over90';
      r[k] += left;
      if (!r.oldest_due) r.oldest_due = d.due;
    }
    r.advance = paid;
    r.balance = r.current + r.d30 + r.d60 + r.d90 + r.over90 - r.advance;
    if (r.balance || r.advance) { rows.push(r); for (const k of Object.keys(tot) as Array<keyof typeof tot>) tot[k] += r[k]; }
  }
  return { type, as_of: asOf, currency: st.currency, cur_dec: st.cur_dec, rows, totals: tot };
}
void notFound;
