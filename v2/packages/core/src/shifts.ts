/* Shifts & cash drawer: open, close (expected vs counted cash), approve (variance journal), unapprove, reopen.
   Port of v1 src/ops.js. Cash from modules not yet ported to v2 (collections, expenses, purchases, supplier payments,
   cash moves, vouchers, payroll) is supplied by `cashParts`; until a module moves, its part is 0. */
import { sql } from 'kysely';
import { audit, need, station } from './access.ts';
import { tx, type Ctx, type Q, type User } from './ctx.ts';
import { conflict, notFound } from './errors.ts';
import { assertOpen, post, reverseSource } from './ledger.ts';
import type { Shift, Station } from './schema.ts';
import * as V from './validate.ts';

export async function openShift(q: Q, st: Station, required: boolean): Promise<Shift | null> {
  const sh = await q.selectFrom('shifts').selectAll().where('station_id', '=', st.id).where('status', '=', 'open').executeTakeFirst();
  if (!sh && required && st.require_shift) throw conflict('SHIFT_REQUIRED', 'Open a shift before recording this operation');
  return sh || null;
}
export interface ShiftTotals {
  cash_sales: number; credit_sales: number; qty_ml: number; sales_count: number;
  collections_cash: number; expenses_cash: number; purchases_cash: number; supplier_payments_cash: number; withdrawals: number; deposits: number;
  voucher_receipts: number; voucher_payments: number; payroll_cash: number; expected_cash: number;
}
type CashPart = (q: Q, shiftId: number) => Promise<Partial<ShiftTotals>>;
/** Other modules register their drawer cash here as they are ported (same field names as v1 shiftTotals). */
export const cashParts: CashPart[] = [];

export async function shiftTotals(q: Q, sh: Shift): Promise<ShiftTotals> {
  const r = await q.selectFrom('sales').where('shift_id', '=', sh.id).where('voided_at', 'is', null).select([
    sql<number>`coalesce(sum(case when pay_type = 'cash' then gross else 0 end), 0)`.as('cash_sales'),
    sql<number>`coalesce(sum(case when pay_type = 'credit' then gross else 0 end), 0)`.as('credit_sales'),
    sql<number>`coalesce(sum(quantity_ml), 0)`.as('qty_ml'),
    sql<number>`count(*)`.as('sales_count')
  ]).executeTakeFirstOrThrow();
  const t: ShiftTotals = {
    cash_sales: Number(r.cash_sales), credit_sales: Number(r.credit_sales), qty_ml: Number(r.qty_ml), sales_count: Number(r.sales_count),
    collections_cash: 0, expenses_cash: 0, purchases_cash: 0, supplier_payments_cash: 0, withdrawals: 0, deposits: 0,
    voucher_receipts: 0, voucher_payments: 0, payroll_cash: 0, expected_cash: 0
  };
  for (const part of cashParts) Object.assign(t, await part(q, sh.id));
  // credit sales and bank receipts never enter the drawer
  t.expected_cash = sh.float_amount + t.cash_sales + t.collections_cash + t.deposits + t.voucher_receipts - t.expenses_cash - t.purchases_cash
    - t.supplier_payments_cash - t.withdrawals - t.voucher_payments - t.payroll_cash;
  return t;
}
async function getShiftRow(ctx: Ctx, q: Q, sid: number, id: number): Promise<Shift> {
  let qb = q.selectFrom('shifts').selectAll().where('id', '=', id).where('station_id', '=', sid);
  if (ctx.dialect === 'postgres') qb = qb.forUpdate();
  const sh = await qb.executeTakeFirst();
  if (!sh) throw notFound('Shift');
  return sh;
}

export async function openShiftCmd(ctx: Ctx, user: User, sid: number, b: { float_amount?: number } = {}) {
  need(user, 'shift.open'); V.obj(b, 'body');
  const float = V.int(b.float_amount ?? 0, 'float_amount', { min: 0, max: 10 ** 13 });
  return tx(ctx, async (q) => {
    const st = await station(q, user, sid);
    if (await openShift(q, st, false)) throw conflict('SHIFT_ALREADY_OPEN', 'A shift is already open at this station');
    const id = (await q.insertInto('shifts').values({ station_id: sid, business_date: ctx.clock.today(st.timezone), float_amount: float, opened_by: user.id, opened_at: ctx.clock.now(),
      closed_by: null, closed_at: null, counted_cash: null, expected_cash: null, variance: null, close_note: null, approved_by: null, approved_at: null })
      .returning('id').executeTakeFirstOrThrow()).id;
    const pumps = await q.selectFrom('pumps').select(['id', 'meter_ml']).where('station_id', '=', sid).where('active', '=', 1).orderBy('id').execute();
    if (pumps.length) await q.insertInto('shift_meters').values(pumps.map((p) => ({ shift_id: id, pump_id: p.id, open_ml: p.meter_ml, close_ml: null }))).execute();
    await audit(ctx, q, user, sid, 'shift.open', 'shift', id, { float_amount: float });
    return { id };
  });
}
export async function closeShift(ctx: Ctx, user: User, sid: number, id: number, b: { counted_cash: number; note?: string }) {
  need(user, 'shift.close'); V.obj(b, 'body');
  const counted = V.int(b.counted_cash, 'counted_cash', { min: 0, max: 10 ** 13 });
  const note = V.str(b.note, 'note', { max: 300, optional: true }) || null;
  return tx(ctx, async (q) => {
    await station(q, user, sid);
    const sh = await getShiftRow(ctx, q, sid, id);
    if (sh.status !== 'open') throw conflict('SHIFT_NOT_OPEN', 'This shift is not open');
    const t = await shiftTotals(q, sh), variance = counted - t.expected_cash;
    const ms = await q.selectFrom('shift_meters as sm').innerJoin('pumps as p', 'p.id', 'sm.pump_id').select(['sm.pump_id', 'p.meter_ml']).where('sm.shift_id', '=', id).execute();
    for (const m of ms) await q.updateTable('shift_meters').set({ close_ml: m.meter_ml }).where('shift_id', '=', id).where('pump_id', '=', m.pump_id).execute();
    await q.updateTable('shifts').set({ status: 'closed', closed_by: user.id, closed_at: ctx.clock.now(), counted_cash: counted, expected_cash: t.expected_cash, variance, close_note: note })
      .where('id', '=', id).execute();
    await audit(ctx, q, user, sid, 'shift.close', 'shift', id, { expected_cash: t.expected_cash, counted_cash: counted, variance });
    return { id, expected_cash: t.expected_cash, counted_cash: counted, variance };
  });
}
export async function approveShift(ctx: Ctx, user: User, sid: number, id: number) {
  need(user, 'shift.approve');
  return tx(ctx, async (q) => {
    await station(q, user, sid);
    const sh = await getShiftRow(ctx, q, sid, id);
    if (sh.status !== 'closed') throw conflict('SHIFT_NOT_CLOSED', 'Only a closed shift can be approved');
    const v = sh.variance ?? 0;
    await post(ctx, q, { org_id: user.org_id, station_id: sid, date: sh.business_date, source: 'shift', source_id: id, user_id: user.id, memo: 'Cash drawer variance',
      lines: v < 0 ? [{ a: 'cash_short', dr: -v }, { a: 'cash', cr: -v }] : [{ a: 'cash', dr: v }, { a: 'other_income', cr: v }] });
    await q.updateTable('shifts').set({ status: 'approved', approved_by: user.id, approved_at: ctx.clock.now() }).where('id', '=', id).execute();
    await audit(ctx, q, user, sid, 'shift.approve', 'shift', id, { variance: v });
    return { ok: true };
  });
}
export async function unapproveShift(ctx: Ctx, user: User, sid: number, id: number, b: { reason?: string }) {
  need(user, 'shift.approve');
  const reason = V.str(b && b.reason, 'reason', { min: 3, max: 200 });
  return tx(ctx, async (q) => {
    await station(q, user, sid);
    const sh = await getShiftRow(ctx, q, sid, id);
    if (sh.status !== 'approved') throw conflict('SHIFT_NOT_APPROVED', 'This shift is not approved');
    await assertOpen(q, user.org_id, sh.business_date);
    await reverseSource(ctx, q, user.org_id, 'shift', id, user.id, 'Unapprove: ' + reason);
    await q.updateTable('shifts').set({ status: 'closed', approved_by: null, approved_at: null }).where('id', '=', id).execute();
    await audit(ctx, q, user, sid, 'shift.unapprove', 'shift', id, { reason });
    return { ok: true };
  });
}
export async function reopenShift(ctx: Ctx, user: User, sid: number, id: number, b: { reason?: string }) {
  need(user, 'shift.approve');
  const reason = V.str(b && b.reason, 'reason', { min: 3, max: 200 });
  return tx(ctx, async (q) => {
    const st = await station(q, user, sid);
    const sh = await getShiftRow(ctx, q, sid, id);
    if (sh.status !== 'closed') throw conflict('SHIFT_NOT_CLOSED', 'Only a closed (not approved) shift can be reopened');
    if (await openShift(q, st, false)) throw conflict('SHIFT_ALREADY_OPEN', 'Close the current shift first');
    await q.updateTable('shifts').set({ status: 'open', closed_by: null, closed_at: null, counted_cash: null, expected_cash: null, variance: null }).where('id', '=', id).execute();
    await q.updateTable('shift_meters').set({ close_ml: null }).where('shift_id', '=', id).execute();
    await audit(ctx, q, user, sid, 'shift.reopen', 'shift', id, { reason });
    return { ok: true };
  });
}
export async function currentShift(ctx: Ctx, user: User, sid: number) {
  const st = await station(ctx.db, user, sid);
  const sh = await openShift(ctx.db, st, false);
  return sh ? { ...sh, totals: await shiftTotals(ctx.db, sh) } : null;
}
export async function listShifts(ctx: Ctx, user: User, sid: number, limit = 30) {
  await station(ctx.db, user, sid);
  return ctx.db.selectFrom('shifts').selectAll().where('station_id', '=', sid).orderBy('id', 'desc').limit(Math.min(limit, 200)).execute();
}
