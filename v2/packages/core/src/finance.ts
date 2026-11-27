/* Finance (v2 phase 4): chart of accounts, boxes & banks, expenses, cash moves (drawer ↔ bank / owner), receipt & payment
   vouchers, manual journals (draft → post, delete a draft, reverse), period lock, trial balance and account ledger.
   Port of v1 src/services.js (expenses), src/ops.js (cash moves, accounts, journals, period lock, trial balance, ledger)
   and src/books.js (accounts with groups and boxes, checkLine, vouchers). Same rules, same postings.
   Not yet: boxes kept in a foreign currency (needs the currencies & rates module) — refused with FOREIGN_CURRENCY. */
import { sql } from 'kysely';
import { audit, need, scoped, station } from './access.ts';
import { addDays, tx, type Ctx, type Q, type User } from './ctx.ts';
import { bad, conflict, forbidden, notFound } from './errors.ts';
import { assertOpen, ensureChart, expenseKey, post, reverse } from './ledger.ts';
import { voidJournalDoc } from './parties.ts';
import { ORG_WIDE, can } from './perms.ts';
import { resolveDate } from './sales.ts';
import type { Station } from './schema.ts';
import { cashParts, openShift, shiftTotals } from './shifts.ts';
import * as V from './validate.ts';

/* drawer cash (v1 shiftTotals): cash expenses, withdrawals and deposits, cash vouchers */
cashParts.push(async (q, shiftId) => {
  const exp = await q.selectFrom('expenses').select(sql<number>`coalesce(sum(gross), 0)`.as('v')).where('shift_id', '=', shiftId).where('method', '=', 'cash').where('voided_at', 'is', null).executeTakeFirstOrThrow();
  const mv = await q.selectFrom('cash_moves').select([sql<number>`coalesce(sum(case when kind = 'withdrawal' then amount end), 0)`.as('w'), sql<number>`coalesce(sum(case when kind = 'deposit' then amount end), 0)`.as('d')])
    .where('shift_id', '=', shiftId).where('voided_at', 'is', null).executeTakeFirstOrThrow();
  const vc = await q.selectFrom('vouchers').select([sql<number>`coalesce(sum(case when kind = 'receipt' then amount end), 0)`.as('rin'), sql<number>`coalesce(sum(case when kind = 'payment' then amount end), 0)`.as('rout')])
    .where('shift_id', '=', shiftId).where('voided_at', 'is', null).executeTakeFirstOrThrow();
  return { expenses_cash: Number(exp.v), withdrawals: Number(mv.w), deposits: Number(mv.d), voucher_receipts: Number(vc.rin), voucher_payments: Number(vc.rout) };
});
const page = (o: { limit?: number | string; before_id?: number | string }) => ({
  limit: Math.min(Math.max(parseInt(String(o.limit ?? ''), 10) || 100, 1), 200),
  before: parseInt(String(o.before_id ?? ''), 10) || Number.MAX_SAFE_INTEGER
});
/** the business date of the row a page ended on, so the next page continues in the list's own order (date, id) */
async function beforeDate(q: Q, table: 'journals' | 'vouchers' | 'expenses', before: number, scope: 'org_id' | 'station_id', scopeVal: number) {
  if (before >= Number.MAX_SAFE_INTEGER) return '9999-12-31';
  const r = await (q as unknown as import('kysely').Kysely<import('./schema.ts').DB>).selectFrom(table as 'journals').select('business_date').where('id', '=', before).where(scope, '=', scopeVal).executeTakeFirst();
  return r ? r.business_date : '9999-12-31';
}

/* ------------------------------ chart of accounts ------------------------------ */
const CODE_RE = /^[0-9]{1,12}$/;
async function validParent(q: Q, orgId: number, pid: unknown, selfId: number | null): Promise<number | null> {
  if (pid === null || pid === undefined) return null;
  const p = await q.selectFrom('accounts').selectAll().where('id', '=', V.int(pid, 'parent_id', { min: 1 })).where('org_id', '=', orgId).executeTakeFirst();
  if (!p) throw notFound('Parent account');
  if (!p.is_group) throw bad('PARENT_NOT_GROUP', 'The parent must be a group account');
  for (let n: { id: number; parent_id: number | null } | undefined = p, i = 0; n && i < 30; i++) {
    if (n.id === selfId) throw bad('PARENT_CYCLE', 'An account cannot be placed under itself');
    n = n.parent_id ? await q.selectFrom('accounts').select(['id', 'parent_id']).where('id', '=', n.parent_id).executeTakeFirst() : undefined;
  }
  return p.id;
}
export async function listAccounts(ctx: Ctx, user: User) {
  need(user, 'report.read');
  return tx(ctx, async (q) => { await ensureChart(q, user.org_id); return q.selectFrom('accounts').selectAll().where('org_id', '=', user.org_id).orderBy('code').execute(); });
}
export async function createAccount(ctx: Ctx, user: User, b: Record<string, unknown>) {
  need(user, 'account.edit'); V.obj(b, 'body');
  const code = V.str(b.code, 'code', { max: 12 }); if (!CODE_RE.test(code)) throw bad('VALIDATION', 'Account code must be 1 to 12 digits');
  const type = V.oneOf(b.type, 'type', ['asset', 'liability', 'equity', 'income', 'expense'] as const);
  const isGroup = b.is_group ? 1 : 0;
  const box = b.box ? V.oneOf(b.box, 'box', ['cash', 'bank'] as const) : null;
  if (box && (type !== 'asset' || isGroup)) throw bad('VALIDATION', 'Only an asset account that is not a group can be a cash box or bank');
  return tx(ctx, async (q) => {
    if (await q.selectFrom('accounts').select('id').where('org_id', '=', user.org_id).where('code', '=', code).executeTakeFirst()) throw conflict('CODE_TAKEN', 'This account code is already used');
    const parent = await validParent(q, user.org_id, b.parent_id ?? null, null);
    if (b.currency) throw bad('FOREIGN_CURRENCY', 'Accounts in another currency come with the currencies module');
    const id = (await q.insertInto('accounts').values({ org_id: user.org_id, code, type, name_ar: V.str(b.name_ar, 'name_ar', { max: 120 }), name_en: V.str(b.name_en || b.name_ar, 'name_en', { max: 120 }),
      parent_id: parent, is_group: isGroup, box, currency: null, sys: null }).returning('id').executeTakeFirstOrThrow()).id;
    await audit(ctx, q, user, null, 'account.create', 'account', id, { code, type, is_group: isGroup, box }); return { id };
  });
}
export async function updateAccount(ctx: Ctx, user: User, id: number, b: Record<string, unknown>) {
  need(user, 'account.edit'); V.obj(b, 'body');
  return tx(ctx, async (q) => {
    const a = await q.selectFrom('accounts').selectAll().where('id', '=', id).where('org_id', '=', user.org_id).executeTakeFirst(); if (!a) throw notFound('Account');
    if (a.sys && b.active === false) throw conflict('SYSTEM_ACCOUNT', 'System accounts cannot be deactivated');
    const parent = b.parent_id === undefined ? a.parent_id : await validParent(q, user.org_id, b.parent_id, a.id);
    let box = a.box;
    if (b.box !== undefined && !(a.sys === 'cash' || a.sys === 'bank')) {
      box = b.box ? V.oneOf(b.box, 'box', ['cash', 'bank'] as const) : null;
      if (box && (a.type !== 'asset' || a.is_group)) throw bad('VALIDATION', 'Only an asset account that is not a group can be a cash box or bank');
    }
    if (b.currency) throw bad('FOREIGN_CURRENCY', 'Accounts in another currency come with the currencies module');
    if (b.currency !== undefined) await q.updateTable('accounts').set({ currency: null }).where('id', '=', id).execute();
    await q.updateTable('accounts').set({ name_ar: b.name_ar === undefined ? a.name_ar : V.str(b.name_ar, 'name_ar', { max: 120 }),
      name_en: b.name_en === undefined ? a.name_en : V.str(b.name_en, 'name_en', { max: 120 }), active: b.active === undefined ? a.active : (V.bool(b.active) ? 1 : 0), parent_id: parent, box })
      .where('id', '=', id).execute();
    await audit(ctx, q, user, null, 'account.update', 'account', id, { fields: Object.keys(b) }); return { ok: true };
  });
}
export async function boxes(ctx: Ctx, user: User) {
  need(user, 'read');
  return tx(ctx, async (q) => {
    await ensureChart(q, user.org_id);
    return q.selectFrom('accounts').select(['id', 'code', 'name_ar', 'name_en', 'box', 'sys', 'currency']).where('org_id', '=', user.org_id).where('active', '=', 1).where('is_group', '=', 0)
      .where((e) => e.or([e('box', 'is not', null), e('sys', 'in', ['cash', 'bank'])])).orderBy('code').execute();
  });
}
/** a line a person typed (journal or voucher): postable account, and the customer/supplier the account needs (v1 books.checkLine) */
async function checkLine(q: Q, orgId: number, sid: number, accountId: unknown, partyType: unknown, partyId: unknown, label: string) {
  const a = await q.selectFrom('accounts').selectAll().where('id', '=', V.int(accountId, label + '.account_id', { min: 1 })).where('org_id', '=', orgId).executeTakeFirst();
  if (!a || !a.active) throw notFound('Account');
  if (a.is_group) throw bad('GROUP_ACCOUNT', 'Group accounts only add up their children; choose a detail account', { code: a.code });
  if (a.sys === 'inventory') throw bad('USE_STOCK_SCREENS', 'Fuel stock moves only through deliveries, sales, counts and transfers', { code: a.code });
  if (a.sys === 'emp_adv' || a.sys === 'salaries_payable') throw bad('USE_PAYROLL_SCREENS', 'Employee advances and salaries move only through the employees & payroll screens', { code: a.code });
  const needs = a.sys === 'ar' ? 'customer' : a.sys === 'ap' ? 'supplier' : null;
  if (needs) {
    if (partyType && partyType !== needs) throw bad('PARTY_MISMATCH', `This account needs a ${needs}`);
    const pid = V.int(partyId, label + '.party_id', { min: 1 });
    const p = await (q as unknown as import('kysely').Kysely<import('./schema.ts').DB>).selectFrom((needs === 'customer' ? 'customers' : 'suppliers') as 'customers').select('id')
      .where('id', '=', pid).where('station_id', '=', sid).executeTakeFirst();
    if (!p) throw notFound(needs === 'customer' ? 'Customer' : 'Supplier');
    return { a, party_type: needs, party_id: pid };
  }
  return { a, party_type: null, party_id: null };
}

/* ------------------------------ expenses ------------------------------ */
export async function createExpense(ctx: Ctx, user: User, sid: number, b: Record<string, unknown>) {
  need(user, 'expense.create'); V.obj(b, 'body');
  return tx(ctx, async (q) => {
    const st = await station(q, user, sid), today = ctx.clock.today(st.timezone);
    const date = V.date(b.date, 'date') || today;
    if (date > today) throw bad('FUTURE_DATE', 'The date cannot be in the future');
    const gross = V.int(b.gross, 'gross', { min: 1, max: 10 ** 13 }), vat = V.int(b.vat ?? 0, 'vat', { min: 0, max: gross });
    const method = V.oneOf(b.method || 'cash', 'method', ['cash', 'bank'] as const), cat = V.str(b.category, 'category', { max: 40 });
    await assertOpen(q, user.org_id, date);
    const shift = method === 'cash' ? await openShift(q, st, true) : null;
    const id = (await q.insertInto('expenses').values({ station_id: sid, business_date: date, created_at: ctx.clock.now(), category: cat, gross, vat,
      note: V.str(b.note, 'note', { max: 200, optional: true }) || null, user_id: user.id, method, shift_id: shift ? shift.id : null, voided_at: null, void_reason: null, void_by: null })
      .returning('id').executeTakeFirstOrThrow()).id;
    await post(ctx, q, { org_id: user.org_id, station_id: sid, date, source: 'expense', source_id: id, user_id: user.id, memo: cat, periodChecked: true,
      lines: [{ a: expenseKey(cat), dr: gross - vat }, { a: 'vat_in', dr: vat }, { a: method, cr: gross }] });
    await audit(ctx, q, user, sid, 'expense.create', 'expense', id, { gross, vat, method }); return { id };
  });
}
export const voidExpense = (ctx: Ctx, user: User, sid: number, id: number, reason: unknown) => voidJournalDoc(ctx, user, sid, 'expenses', 'expense', 'expense.void', id, reason);
export async function listExpenses(ctx: Ctx, user: User, sid: number, o: { from?: string; to?: string; limit?: number; before_id?: number } = {}) {
  await station(ctx.db, user, sid); const { limit, before } = page(o);
  const from = V.date(o.from, 'from') || '0000-01-01', to = V.date(o.to, 'to') || '9999-12-31';
  const bd = await beforeDate(ctx.db, 'expenses', before, 'station_id', sid);
  return ctx.db.selectFrom('expenses').selectAll().where('station_id', '=', sid).where('business_date', '>=', from).where('business_date', '<=', to)
    .where((e) => e.or([e('business_date', '<', bd), e.and([e('business_date', '=', bd), e('id', '<', before)])])).orderBy('business_date', 'desc').orderBy('id', 'desc').limit(limit).execute();
}

/* ------------------------------ cash moves ------------------------------ */
export async function cashMove(ctx: Ctx, user: User, sid: number, b: Record<string, unknown>) {
  need(user, 'cash.move'); V.obj(b, 'body');
  const kind = V.oneOf(b.kind, 'kind', ['withdrawal', 'deposit'] as const), cp = V.oneOf(b.counterpart || 'bank', 'counterpart', ['bank', 'owner'] as const);
  const amount = V.int(b.amount, 'amount', { min: 1, max: 10 ** 13 }), note = V.str(b.note, 'note', { max: 200, optional: true }) || null;
  return tx(ctx, async (q) => {
    const st = await station(q, user, sid);
    let shq = q.selectFrom('shifts').selectAll().where('station_id', '=', sid).where('status', '=', 'open');
    if (ctx.dialect === 'postgres') shq = shq.forUpdate();   // two withdrawals at once cannot both take the same cash
    const sh = await shq.executeTakeFirst();
    if (!sh) throw conflict('NO_OPEN_SHIFT', 'Open a shift first');
    if (kind === 'withdrawal') { const exp = (await shiftTotals(q, sh)).expected_cash; if (amount > exp) throw conflict('CASH_INSUFFICIENT', 'The drawer does not hold that much cash', { expected_cash: exp }); }
    const date = ctx.clock.today(st.timezone);
    await assertOpen(q, user.org_id, date);
    const id = (await q.insertInto('cash_moves').values({ station_id: sid, shift_id: sh.id, business_date: date, created_at: ctx.clock.now(), kind, counterpart: cp, amount, note, user_id: user.id,
      voided_at: null, void_reason: null, void_by: null }).returning('id').executeTakeFirstOrThrow()).id;
    const other = cp === 'bank' ? 'bank' : (kind === 'withdrawal' ? 'drawings' : 'capital');
    await post(ctx, q, { org_id: user.org_id, station_id: sid, date, source: 'cash_move', source_id: id, user_id: user.id, memo: note, periodChecked: true,
      lines: kind === 'withdrawal' ? [{ a: other, dr: amount }, { a: 'cash', cr: amount }] : [{ a: 'cash', dr: amount }, { a: other, cr: amount }] });
    await audit(ctx, q, user, sid, 'cash.' + kind, 'cash_move', id, { amount, counterpart: cp });
    return { id };
  });
}
export const voidCashMove = (ctx: Ctx, user: User, sid: number, id: number, reason: unknown) => voidJournalDoc(ctx, user, sid, 'cash_moves', 'cash_move', 'cash.move', id, reason);

/* ------------------------------ vouchers ------------------------------ */
export async function createVoucher(ctx: Ctx, user: User, sid: number, b: Record<string, unknown>) {
  need(user, 'voucher.create'); V.obj(b, 'body');
  const kind = V.oneOf(b.kind, 'kind', ['receipt', 'payment'] as const);
  return tx(ctx, async (q) => {
    const st = await station(q, user, sid);
    const date = resolveDate(ctx, st, user, b.date);
    const memo = V.str(b.memo, 'memo', { max: 300, optional: true }) || null;
    let refNo = V.str(b.ref_no, 'ref_no', { max: 30, optional: true }) || null;
    if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > 200) throw bad('VALIDATION', 'A voucher needs between 1 and 200 lines');
    const box = await q.selectFrom('accounts').selectAll().where('id', '=', V.int(b.box_account_id, 'box_account_id', { min: 1 })).where('org_id', '=', user.org_id).executeTakeFirst();
    if (!box || !box.active || box.is_group || !(box.box || box.sys === 'cash' || box.sys === 'bank')) throw bad('NOT_A_BOX', 'Choose a cash box or bank account');
    if (box.currency && box.currency !== st.currency) throw bad('FOREIGN_CURRENCY', 'Boxes in another currency come with the currencies module');
    const lines = [];
    for (const [i, l] of (b.lines as Array<Record<string, unknown>>).entries()) {
      V.obj(l, `lines[${i}]`);
      const r = await checkLine(q, user.org_id, sid, l.account_id, l.party_type, l.party_id, `lines[${i}]`);
      if (r.a.id === box.id) throw bad('VALIDATION', 'A line cannot use the same box');
      lines.push({ ...r, amount: V.int(l.amount, `lines[${i}].amount`, { min: 1, max: 10 ** 14 }), memo: V.str(l.memo, 'memo', { max: 200, optional: true }) || null });
    }
    const amount = lines.reduce((s, l) => s + l.amount, 0);
    if (!refNo) {   // the next number in its own series (receipts and payments count separately)
      const r = await sql<{ m: number | null }>`SELECT MAX(${ctx.dialect === 'postgres' ? sql`substring(ref_no from '^[0-9]+')::bigint` : sql`CAST(ref_no AS INTEGER)`}) m
        FROM vouchers WHERE station_id = ${sid} AND kind = ${kind} AND ${ctx.dialect === 'postgres' ? sql`ref_no ~ '^[0-9]'` : sql`ref_no GLOB '[0-9]*'`}`.execute(q);
      refNo = String(1 + (Number(r.rows[0]?.m) || 0));
    }
    await assertOpen(q, user.org_id, date);
    const shift = box.sys === 'cash' ? await openShift(q, st, false) : null;
    const id = (await q.insertInto('vouchers').values({ station_id: sid, kind, ref_no: refNo, business_date: date, created_at: ctx.clock.now(), box_account_id: box.id, amount, memo,
      shift_id: shift ? shift.id : null, user_id: user.id, fc_code: null, fc_rate_e6: null, fc_amount: null, voided_at: null, void_reason: null, void_by: null }).returning('id').executeTakeFirstOrThrow()).id;
    await q.insertInto('voucher_lines').values(lines.map((l) => ({ voucher_id: id, account_id: l.a.id, party_type: l.party_type, party_id: l.party_id, amount: l.amount, memo: l.memo, fc_amount: null }))).execute();
    const rec = kind === 'receipt';
    await post(ctx, q, { org_id: user.org_id, station_id: sid, date, source: 'voucher', source_id: id, user_id: user.id, periodChecked: true,
      memo: memo || (rec ? 'سند قبض' : 'سند صرف') + (refNo ? ' ' + refNo : ''),
      lines: [{ a: box.id, dr: rec ? amount : 0, cr: rec ? 0 : amount }, ...lines.map((l) => ({ a: l.a.id, dr: rec ? 0 : l.amount, cr: rec ? l.amount : 0, party_type: l.party_type, party_id: l.party_id, memo: l.memo }))] });
    await q.updateTable('journals').set({ doc_type: rec ? 'سند قبض' : 'سند صرف', ref: sql`coalesce(ref, ${refNo})` }).where('source', '=', 'voucher').where('source_id', '=', id).where('org_id', '=', user.org_id).execute();
    await audit(ctx, q, user, sid, 'voucher.' + kind, 'voucher', id, { amount, lines: lines.length });
    return { id, amount };
  });
}
export const voidVoucher = (ctx: Ctx, user: User, sid: number, id: number, reason: unknown) =>
  voidJournalDoc(ctx, user, sid, 'vouchers', 'voucher', 'voucher.void', id, reason, { legacy: false, action: 'voucher.void' });
async function voucherWithLines<T extends { id: number }>(q: Q, v: T) {
  const lines = await q.selectFrom('voucher_lines as l').innerJoin('accounts as a', 'a.id', 'l.account_id')
    .leftJoin('customers as c', (j) => j.onRef('c.id', '=', 'l.party_id').on('l.party_type', '=', 'customer'))
    .leftJoin('suppliers as s', (j) => j.onRef('s.id', '=', 'l.party_id').on('l.party_type', '=', 'supplier'))
    .selectAll('l').select(['a.code', 'a.name_ar', 'a.name_en', sql<string | null>`coalesce(c.name, s.name)`.as('party_name')]).where('l.voucher_id', '=', v.id).orderBy('l.id').execute();
  return { ...v, lines };
}
export async function getVoucher(ctx: Ctx, user: User, sid: number, id: number) {
  need(user, 'journal.read'); await station(ctx.db, user, sid);
  return voucherWithLines(ctx.db, await scoped(ctx, ctx.db, 'vouchers', id, sid, 'Voucher'));
}
export async function listVouchers(ctx: Ctx, user: User, sid: number, o: { from?: string; to?: string; kind?: string; box_account_id?: number; limit?: number; before_id?: number } = {}) {
  need(user, 'journal.read'); await station(ctx.db, user, sid); const { limit, before } = page(o);
  const from = V.date(o.from, 'from') || '0000-01-01', to = V.date(o.to, 'to') || '9999-12-31';
  const kind = o.kind ? V.oneOf(o.kind, 'kind', ['receipt', 'payment'] as const) : null;
  const box = o.box_account_id ? V.int(Number(o.box_account_id), 'box_account_id', { min: 1 }) : null;
  const bd = await beforeDate(ctx.db, 'vouchers', before, 'station_id', sid);
  let qb = ctx.db.selectFrom('vouchers as v').innerJoin('accounts as a', 'a.id', 'v.box_account_id').leftJoin('users as u', 'u.id', 'v.user_id')
    .selectAll('v').select(['a.code as box_code', 'a.name_ar as box_name_ar', 'a.name_en as box_name_en', 'u.name as user_name'])
    .where('v.station_id', '=', sid).where('v.business_date', '>=', from).where('v.business_date', '<=', to)
    .where((e) => e.or([e('v.business_date', '<', bd), e.and([e('v.business_date', '=', bd), e('v.id', '<', before)])]));
  if (kind) qb = qb.where('v.kind', '=', kind);
  if (box) qb = qb.where('v.box_account_id', '=', box);
  const rows = await qb.orderBy('v.business_date', 'desc').orderBy('v.id', 'desc').limit(limit).execute();
  let tq = ctx.db.selectFrom('vouchers').select(['kind', sql<number>`count(*)`.as('n'), sql<number>`sum(amount)`.as('amount')]).where('station_id', '=', sid)
    .where('business_date', '>=', from).where('business_date', '<=', to).where('voided_at', 'is', null);
  if (box) tq = tq.where('box_account_id', '=', box);
  const totals = await tq.groupBy('kind').execute();
  return { rows: await Promise.all(rows.map((v) => voucherWithLines(ctx.db, v))), totals: Object.fromEntries(totals.map((t) => [t.kind, { count: Number(t.n), amount: Number(t.amount) }])) };
}

/* ------------------------------ manual journals ------------------------------ */
async function journalWithLines<J extends { id: number }>(q: Q, j: J) {
  const lines = await q.selectFrom('journal_lines as l').innerJoin('accounts as a', 'a.id', 'l.account_id')
    .leftJoin('customers as c', (jn) => jn.onRef('c.id', '=', 'l.party_id').on('l.party_type', '=', 'customer'))
    .leftJoin('suppliers as s', (jn) => jn.onRef('s.id', '=', 'l.party_id').on('l.party_type', '=', 'supplier'))
    .selectAll('l').select(['a.code', 'a.name_ar', 'a.name_en', sql<string | null>`coalesce(c.name, s.name)`.as('party_name')]).where('l.journal_id', '=', j.id).orderBy('l.id').execute();
  return { ...j, lines };
}
export async function getJournal(ctx: Ctx, user: User, id: number, q: Q = ctx.db) {
  need(user, 'journal.read');
  const j = await q.selectFrom('journals').selectAll().where('id', '=', id).where('org_id', '=', user.org_id).executeTakeFirst(); if (!j) throw notFound('Journal');
  await station(q, user, j.station_id); return journalWithLines(q, j);
}
export async function createJournal(ctx: Ctx, user: User, sid: number, b: Record<string, unknown>) {
  need(user, 'journal.create'); V.obj(b, 'body');
  return tx(ctx, async (q) => {
    const st = await station(q, user, sid), today = ctx.clock.today(st.timezone);
    const date = V.date(b.date, 'date') || today;
    if (date > today) throw bad('FUTURE_DATE', 'The date cannot be in the future');
    const memo = V.str(b.memo, 'memo', { min: 3, max: 300 });
    if (!Array.isArray(b.lines) || b.lines.length < 2 || b.lines.length > 100) throw bad('VALIDATION', 'A journal needs between 2 and 100 lines');
    const lines = [];
    for (const [i, l] of (b.lines as Array<Record<string, unknown>>).entries()) {
      V.obj(l, `lines[${i}]`);
      const dr = V.int(l.debit ?? 0, `lines[${i}].debit`, { min: 0, max: 10 ** 14 }), cr = V.int(l.credit ?? 0, `lines[${i}].credit`, { min: 0, max: 10 ** 14 });
      if ((dr > 0) === (cr > 0)) throw bad('VALIDATION', `Line ${i + 1} needs either a debit or a credit`);
      const r = await checkLine(q, user.org_id, sid, l.account_id, l.party_type, l.party_id, `lines[${i}]`);
      lines.push({ a: r.a.id, dr, cr, party_type: r.party_type, party_id: r.party_id, memo: V.str(l.memo, 'memo', { max: 200, optional: true }) || null });
    }
    const postNow = b.post === true;
    if (postNow) need(user, 'journal.post');
    const id = await post(ctx, q, { org_id: user.org_id, station_id: sid, date, source: 'manual', memo, user_id: user.id, lines, status: postNow ? 'posted' : 'draft' });
    await audit(ctx, q, user, sid, postNow ? 'journal.post' : 'journal.draft', 'journal', id, { memo });
    return { id, status: postNow ? 'posted' : 'draft' };
  });
}
export async function postJournal(ctx: Ctx, user: User, id: number) {
  need(user, 'journal.post');
  return tx(ctx, async (q) => {
    const j = await getJournal(ctx, user, id, q);
    if (j.status !== 'draft') throw conflict('NOT_DRAFT', 'Only drafts can be posted');
    await assertOpen(q, user.org_id, j.business_date);
    const d = j.lines.reduce((s, l) => s + l.debit, 0), c = j.lines.reduce((s, l) => s + l.credit, 0);
    if (d !== c) throw bad('JOURNAL_UNBALANCED', 'Total debit must equal total credit', { debit: d, credit: c });
    await q.updateTable('journals').set({ status: 'posted', posted_at: ctx.clock.now() }).where('id', '=', id).execute();
    await audit(ctx, q, user, j.station_id, 'journal.post', 'journal', id); return { ok: true };
  });
}
/** A draft was never posted, so it may go (lines, then the journal); posted journals are refused by the database. */
export async function deleteDraft(ctx: Ctx, user: User, id: number) {
  need(user, 'journal.create');
  return tx(ctx, async (q) => {
    const j = await getJournal(ctx, user, id, q); if (j.status !== 'draft') throw conflict('NOT_DRAFT', 'Only drafts can be deleted');
    await q.deleteFrom('journal_lines').where('journal_id', '=', id).execute(); await q.deleteFrom('journals').where('id', '=', id).execute();
    await audit(ctx, q, user, j.station_id, 'journal.delete', 'journal', id); return { ok: true };
  });
}
export async function reverseJournal(ctx: Ctx, user: User, id: number, b: { reason?: string }) {
  need(user, 'journal.reverse'); const reason = V.str(b && b.reason, 'reason', { min: 3, max: 200 });
  return tx(ctx, async (q) => {
    const j = await q.selectFrom('journals').selectAll().where('id', '=', id).where('org_id', '=', user.org_id).executeTakeFirst(); if (!j) throw notFound('Journal');
    await station(q, user, j.station_id);
    if (j.source !== 'manual' && j.source !== 'import') throw conflict('USE_DOCUMENT_VOID', 'This entry comes from an operation; void the operation instead');
    const rid = await reverse(ctx, q, j.id, user.id, 'Reversal: ' + reason);
    await audit(ctx, q, user, j.station_id, 'journal.reverse', 'journal', id, { reason, reversal_id: rid }); return { id: rid };
  });
}
export async function listJournals(ctx: Ctx, user: User, sid: number, o: { from?: string; to?: string; source?: string; status?: string; q?: string; account_id?: number; limit?: number; before_id?: number } = {}) {
  need(user, 'journal.read'); await station(ctx.db, user, sid); const { limit, before } = page(o);
  const from = V.date(o.from, 'from') || '0000-01-01', to = V.date(o.to, 'to') || '9999-12-31';
  const src = o.source ? V.str(o.source, 'source', { max: 30 }) : null, status = o.status ? V.oneOf(o.status, 'status', ['draft', 'posted'] as const) : null;
  const term = o.q ? '%' + V.str(o.q, 'q', { max: 60 }) + '%' : null;
  const acc = o.account_id ? V.int(Number(o.account_id), 'account_id', { min: 1 }) : null;
  const bd = await beforeDate(ctx.db, 'journals', before, 'org_id', user.org_id);
  let qb = ctx.db.selectFrom('journals as j').leftJoin('users as u', 'u.id', 'j.user_id').selectAll('j').select('u.name as user_name')
    .where('j.org_id', '=', user.org_id).where('j.station_id', '=', sid).where('j.business_date', '>=', from).where('j.business_date', '<=', to)
    .where((e) => e.or([e('j.business_date', '<', bd), e.and([e('j.business_date', '=', bd), e('j.id', '<', before)])]));
  if (src) qb = qb.where('j.source', '=', src);
  if (status) qb = qb.where('j.status', '=', status);
  if (term) qb = qb.where((e) => e.or([e('j.memo', 'like', term), e('j.ref', '=', o.q!), e(sql`cast(j.id as text)`, '=', o.q!),
    e.exists(e.selectFrom('journal_lines as l').select('l.id').whereRef('l.journal_id', '=', 'j.id').where('l.memo', 'like', term))]));
  if (acc) qb = qb.where((e) => e.exists(e.selectFrom('journal_lines as l').select('l.id').whereRef('l.journal_id', '=', 'j.id').where('l.account_id', '=', acc)));
  const rows = await qb.orderBy('j.business_date', 'desc').orderBy('j.id', 'desc').limit(limit).execute();
  return Promise.all(rows.map((j) => journalWithLines(ctx.db, j)));
}

/* ------------------------------ period lock ------------------------------ */
export async function lockStatus(ctx: Ctx, user: User) {
  need(user, 'read');
  return { locked_through: (await ctx.db.selectFrom('orgs').select('locked_through').where('id', '=', user.org_id).executeTakeFirstOrThrow()).locked_through };
}
export async function lockPeriod(ctx: Ctx, user: User, b: { through: string | null }) {
  need(user, 'period.lock'); V.obj(b, 'body');
  const through = b.through === null ? null : V.date(b.through, 'through')!;
  return tx(ctx, async (q) => {
    const o = await q.selectFrom('orgs').select('locked_through').where('id', '=', user.org_id).executeTakeFirstOrThrow(), cur = o.locked_through;
    if ((through === null || (cur && through < cur)) && !ORG_WIDE.has(user.role)) throw forbidden('Only the owner or an administrator can reopen a closed period');
    if (through && through > new Date().toISOString().slice(0, 10)) throw bad('FUTURE_DATE', 'A period in the future cannot be closed');
    if (through) {
      const d = await q.selectFrom('journals').select(sql<number>`count(*)`.as('n')).where('org_id', '=', user.org_id).where('status', '=', 'draft').where('business_date', '<=', through).executeTakeFirstOrThrow();
      if (Number(d.n)) throw conflict('DRAFTS_PENDING', 'Post or delete draft journals in this period first', { drafts: Number(d.n) });
    }
    await q.updateTable('orgs').set({ locked_through: through }).where('id', '=', user.org_id).execute();
    await audit(ctx, q, user, null, 'period.lock', 'org', user.org_id, { from: cur, to: through }); return { locked_through: through };
  });
}

/* ------------------------------ trial balance & ledger ------------------------------ */
const NORMAL_DEBIT = new Set(['asset', 'expense']);
async function listStations(q: Q, user: User): Promise<Station[]> {
  if (ORG_WIDE.has(user.role)) return q.selectFrom('stations').selectAll().where('org_id', '=', user.org_id).orderBy('id').execute();
  return q.selectFrom('stations as s').innerJoin('user_stations as us', 'us.station_id', 's.id').selectAll('s').where('s.org_id', '=', user.org_id).where('us.user_id', '=', user.id).orderBy('s.id').execute();
}
/** which stations a report covers; never adds different currencies together (v1 ops.scope) */
async function scope(ctx: Ctx, user: User, o: { station_id?: number | string; currency?: string }) {
  if (o.station_id) { const s = await station(ctx.db, user, V.int(Number(o.station_id), 'station_id', { min: 1 })); return { ids: [s.id], currency: s.currency, cur_dec: s.cur_dec, stations: [s] }; }
  let sts = await listStations(ctx.db, user);
  const curs = [...new Set(sts.map((s) => s.currency))];
  const cur = o.currency ? V.str(o.currency, 'currency', { min: 3, max: 3 }).toUpperCase() : (curs.length === 1 ? curs[0] : null);
  if (!cur) throw bad('MIXED_CURRENCY', 'Your stations use different currencies; choose one currency or one station', { currencies: curs });
  sts = sts.filter((s) => s.currency === cur); if (!sts.length) throw notFound('Station');
  return { ids: sts.map((s) => s.id), currency: cur, cur_dec: sts[0].cur_dec, stations: sts };
}
async function balances(ctx: Ctx, user: User, ids: number[], from: string, to: string, noClose = false) {
  let qb = ctx.db.selectFrom('journals as j').innerJoin('journal_lines as l', 'l.journal_id', 'j.id')
    .select(['l.account_id as id', sql<number>`sum(l.debit)`.as('debit'), sql<number>`sum(l.credit)`.as('credit')])
    .where('j.org_id', '=', user.org_id).where('j.status', '=', 'posted').where('j.station_id', 'in', ids).where('j.business_date', '>=', from).where('j.business_date', '<=', to);
  if (noClose) qb = qb.where('j.source', '<>', 'year_close');
  return new Map((await qb.groupBy('l.account_id').execute()).map((r) => [Number(r.id), { debit: Number(r.debit), credit: Number(r.credit) }]));
}
export async function trialBalanceOrg(ctx: Ctx, user: User, o: { to?: string; from?: string; station_id?: number | string; currency?: string; pre_close?: string | boolean } = {}) {
  need(user, 'report.read'); const sc = await scope(ctx, user, o);
  const to = V.date(o.to, 'to'); if (!to) throw bad('VALIDATION', 'to is required');
  const from = V.date(o.from, 'from') || to.slice(0, 4) + '-01-01';
  if (from > to) throw bad('VALIDATION', 'from must not be after to');
  const before = await balances(ctx, user, sc.ids, '0000-01-01', addDays(from, -1));
  const period = await balances(ctx, user, sc.ids, from, to, o.pre_close === '1' || o.pre_close === true);
  const ids = new Set([...before.keys(), ...period.keys()]);
  const accts = (await ctx.db.selectFrom('accounts').selectAll().where('org_id', '=', user.org_id).orderBy('code').execute()).filter((a) => ids.has(a.id));
  const tot = { opening_dr: 0, opening_cr: 0, debit: 0, credit: 0, closing_dr: 0, closing_cr: 0 };
  const rows = accts.map((a) => {
    const ob0 = before.get(a.id) || { debit: 0, credit: 0 }, p = period.get(a.id) || { debit: 0, credit: 0 };
    const ob = ob0.debit - ob0.credit, cb = ob + p.debit - p.credit;
    const r = { account_id: a.id, code: a.code, name_ar: a.name_ar, name_en: a.name_en, type: a.type,
      opening_dr: Math.max(ob, 0), opening_cr: Math.max(-ob, 0), debit: p.debit, credit: p.credit, closing_dr: Math.max(cb, 0), closing_cr: Math.max(-cb, 0) };
    for (const k of Object.keys(tot) as Array<keyof typeof tot>) tot[k] += r[k]; return r;
  });
  return { from, to, currency: sc.currency, cur_dec: sc.cur_dec, stations: sc.stations.map((s) => ({ id: s.id, name: s.name })), rows, totals: tot,
    balanced: tot.debit === tot.credit && tot.closing_dr === tot.closing_cr && tot.opening_dr === tot.opening_cr };
}
export async function accountLedger(ctx: Ctx, user: User, o: { account_id?: number | string; to?: string; from?: string; station_id?: number | string; currency?: string } = {}) {
  need(user, 'report.read'); const sc = await scope(ctx, user, o);
  const a = await ctx.db.selectFrom('accounts').selectAll().where('id', '=', V.int(Number(o.account_id), 'account_id', { min: 1 })).where('org_id', '=', user.org_id).executeTakeFirst(); if (!a) throw notFound('Account');
  const to = V.date(o.to, 'to'); if (!to) throw bad('VALIDATION', 'to is required');
  const from = V.date(o.from, 'from') || to.slice(0, 8) + '01';
  const sign = NORMAL_DEBIT.has(a.type) ? 1 : -1;
  const obr = await ctx.db.selectFrom('journal_lines as l').innerJoin('journals as j', 'j.id', 'l.journal_id').select(sql<number>`coalesce(sum(l.debit - l.credit), 0)`.as('v'))
    .where('l.account_id', '=', a.id).where('j.status', '=', 'posted').where('j.station_id', 'in', sc.ids).where('j.business_date', '<', from).executeTakeFirstOrThrow();
  const ob = Number(obr.v) * sign;
  let bal = ob;
  const lines = await ctx.db.selectFrom('journal_lines as l').innerJoin('journals as j', 'j.id', 'l.journal_id')
    .leftJoin('vouchers as v', (jn) => jn.onRef('v.id', '=', 'j.source_id').on('j.source', '=', 'voucher'))
    .leftJoin('sales as s', (jn) => jn.onRef('s.id', '=', 'j.source_id').on('j.source', '=', 'sale'))
    .leftJoin('customers as c', (jn) => jn.onRef('c.id', '=', 'l.party_id').on('l.party_type', '=', 'customer'))
    .leftJoin('suppliers as su', (jn) => jn.onRef('su.id', '=', 'l.party_id').on('l.party_type', '=', 'supplier'))
    .selectAll('l').select(['j.business_date', 'j.source', 'j.source_id', 'j.memo as jmemo', 'j.station_id', 'j.created_at',
      sql<string | null>`coalesce(v.ref_no, s.ref, j.ref)`.as('ref'), 's.note as sale_note', 'j.doc_type', sql<string | null>`coalesce(j.doc_ref, s.bill)`.as('doc_ref'),
      sql<string | null>`case l.party_type when 'customer' then c.name when 'supplier' then su.name end`.as('party_name')])
    .where('l.account_id', '=', a.id).where('j.status', '=', 'posted').where('j.station_id', 'in', sc.ids).where('j.business_date', '>=', from).where('j.business_date', '<=', to)
    .orderBy('j.business_date').orderBy('j.created_at').orderBy('j.id').orderBy('l.id').limit(30000).execute();
  // the running balance is set on each row in place: copying a database row object ({...l}) cost a quarter of the request
  const out = lines as Array<(typeof lines)[number] & { balance: number }>;
  for (const l of out) { bal += (l.debit - l.credit) * sign; l.balance = bal; }
  return { account: a, from, to, currency: sc.currency, cur_dec: sc.cur_dec, opening: ob, closing: bal, lines: out };
}
void can;
