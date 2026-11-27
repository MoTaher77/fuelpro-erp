/* Fuel sales by pump meter: create, void, list. Port of v1 createSale / voidSale / listSales (src/services.js),
   same validations, same error codes, same postings — to the minor unit. */
import { sql } from 'kysely';
import { audit, need, scoped, station } from './access.ts';
import { addDays, tx, type Ctx, type Q, type User } from './ctx.ts';
import { AppError, bad, conflict, forbidden, unprocessable } from './errors.ts';
import { assertOpen, inventoryFix, post, reverseSource, stockMove } from './ledger.ts';
import { amountMinor, bpOf, divRound, vatSplit } from './money.ts';
import { can } from './perms.ts';
import type { Station } from './schema.ts';
import { openShift } from './shifts.ts';
import * as V from './validate.ts';

export const MAX_SALE_ML = 5_000_000;
const MAX_BACKDATE_DAYS = 400;

export function resolveDate(ctx: Ctx, st: Station, user: User, input: unknown): string {
  const today = ctx.clock.today(st.timezone);
  const d = V.date(input, 'date') || today;
  if (d > today) throw bad('FUTURE_DATE', 'The date cannot be in the future');
  if (d < addDays(today, -MAX_BACKDATE_DAYS)) throw bad('DATE_TOO_OLD', 'The date is too far in the past');
  if (d !== today) need(user, 'sale.backdate');
  return d;
}
/** What the ledger says a customer owes (posted receivable lines naming the customer). */
export async function customerBalance(q: Q, cid: number, asOf = '9999-12-31'): Promise<number> {
  const r = await q.selectFrom('journal_lines as l').innerJoin('journals as j', 'j.id', 'l.journal_id').innerJoin('accounts as a', 'a.id', 'l.account_id')
    .select(sql<number>`coalesce(sum(l.debit - l.credit), 0)`.as('v'))
    .where('l.party_type', '=', 'customer').where('l.party_id', '=', cid).where('a.sys', '=', 'ar').where('j.status', '=', 'posted').where('j.business_date', '<=', asOf)
    .executeTakeFirstOrThrow();
  return Number(r.v);
}

export interface SaleInput {
  client_id: string; pump_id: number; pay_type?: 'cash' | 'credit'; date?: string; close_ml?: number; quantity_ml?: number;
  expected_open_ml?: number; customer_id?: number; discount?: number; discount_bp?: number;
}
export async function createSale(ctx: Ctx, user: User, sid: number, b: SaleInput) {
  need(user, 'sale.create'); V.obj(b, 'body');
  const clientId = V.str(b.client_id, 'client_id', { min: 8, max: 64 });
  const payType = V.oneOf(b.pay_type || 'cash', 'pay_type', ['cash', 'credit'] as const);
  const pumpId = V.int(b.pump_id, 'pump_id', { min: 1 });
  const closeMl = V.int(b.close_ml, 'close_ml', { min: 1, optional: true });
  const qtyIn = V.int(b.quantity_ml, 'quantity_ml', { min: 1, max: MAX_SALE_ML, optional: true });
  const expOpen = V.int(b.expected_open_ml, 'expected_open_ml', { min: 0, optional: true });
  if ((closeMl === undefined) === (qtyIn === undefined)) throw bad('VALIDATION', 'Send exactly one of close_ml or quantity_ml');
  const custIn = V.int(b.customer_id, 'customer_id', { min: 1, optional: true });
  const discIn = V.int(b.discount, 'discount', { min: 0, optional: true }), discBp = V.int(b.discount_bp, 'discount_bp', { min: 0, max: 10000, optional: true });
  if (discIn !== undefined && discBp !== undefined) throw bad('VALIDATION', 'Send either discount or discount_bp, not both');
  if ((discIn || discBp) && !can(user.role, 'sale.discount')) throw forbidden('You are not allowed to give discounts');

  const run = () => tx(ctx, async (q) => {
    /* Reads that need no lock first; the pump and tank rows are locked (PostgreSQL) only for the short write phase,
       so concurrent sales on other pumps/tanks never wait and the locked section has as few round trips as possible.
       Errors are still raised in v1's order (parity tests compare them). */
    const st = await station(q, user, sid);
    const date = resolveDate(ctx, st, user, b.date);
    const dup = await q.selectFrom('sales').selectAll().where('station_id', '=', sid).where('client_id', '=', clientId).executeTakeFirst();
    if (dup) return { ...dup, duplicate: true };
    const pump = await scoped(ctx, q, 'pumps', pumpId, sid, 'Pump', true);
    if (!pump.active) throw conflict('PUMP_INACTIVE', 'This pump is not active');
    let tq = q.selectFrom('tanks').selectAll().where('id', '=', pump.tank_id);
    if (ctx.dialect === 'postgres') tq = tq.forUpdate();
    const [tank, fuel, org, shift] = await Promise.all([
      tq.executeTakeFirstOrThrow(),
      q.selectFrom('fuels').selectAll().where('id', '=', pump.fuel_id).executeTakeFirstOrThrow(),
      q.selectFrom('orgs').select('locked_through').where('id', '=', user.org_id).executeTakeFirstOrThrow(),
      openShift(q, st, false)
    ]);
    if (!(fuel.price_e4 > 0)) throw unprocessable('PRICE_NOT_SET', 'Set the fuel price before recording sales');

    const open = pump.meter_ml;
    if (expOpen !== undefined && expOpen !== open) throw conflict('METER_MISMATCH', 'The pump meter changed since you opened the form', { current_meter_ml: open });
    let qty: number, close: number;
    if (closeMl !== undefined) {
      if (closeMl <= open) throw bad('METER_NOT_INCREASING', 'The current reading must be greater than the previous one', { current_meter_ml: open });
      qty = closeMl - open; close = closeMl;
    } else { qty = qtyIn!; close = open + qty; }
    if (qty > MAX_SALE_ML) throw bad('QUANTITY_TOO_LARGE', 'Quantity is unusually large. Check the meter reading.');
    if (qty > tank.level_ml && !st.allow_negative) throw conflict('INSUFFICIENT_STOCK', 'Quantity exceeds the tank stock', { available_ml: tank.level_ml });
    if (org.locked_through && date <= org.locked_through) throw conflict('PERIOD_LOCKED', `The accounting period is closed through ${org.locked_through}`, { locked_through: org.locked_through });
    if (!shift && st.require_shift) throw conflict('SHIFT_REQUIRED', 'Open a shift before recording this operation');

    const amount = amountMinor(qty, fuel.price_e4);
    const discount = discBp !== undefined ? bpOf(amount, discBp) : (discIn || 0);
    if (discount >= amount && discount > 0) throw bad('DISCOUNT_TOO_LARGE', 'The discount must be less than the sale amount', { amount });
    const list = vatSplit(amount, st.vat_bp, !!st.vat_included);
    const { net, vat, gross } = vatSplit(amount - discount, st.vat_bp, !!st.vat_included);
    let custId: number | null = null;
    if (payType === 'credit') {
      if (custIn === undefined) throw bad('VALIDATION', 'customer_id is required for credit sales');
      const c = await scoped(ctx, q, 'customers', custIn, sid, 'Customer', true);
      if (!c.active) throw conflict('CUSTOMER_INACTIVE', 'This customer is not active');
      if (c.credit_limit > 0) {
        const bal = await customerBalance(q, c.id);
        if (bal + gross > c.credit_limit) throw conflict('CREDIT_LIMIT', 'This sale exceeds the customer credit limit', { balance: bal, credit_limit: c.credit_limit, sale: gross });
      }
      custId = c.id;
    }
    const row = {
      station_id: sid, client_id: clientId, pump_id: pump.id, fuel_id: fuel.id, tank_id: tank.id, business_date: date, created_at: ctx.clock.now(),
      quantity_ml: qty, price_e4: fuel.price_e4, cost_e4: tank.avg_cost_e4, net, vat, gross, vat_bp: st.vat_bp, vat_included: st.vat_included,
      pay_type: payType, customer_id: custId, open_ml: open, close_ml: close, user_id: user.id, shift_id: shift ? shift.id : null, cogs: 0, discount,
      voided_at: null, void_reason: null, void_by: null, note: null, ref: null, bill: null
    };
    const id = (await q.insertInto('sales').values(row).returning('id').executeTakeFirstOrThrow()).id;
    const [, moved] = await Promise.all([
      q.updateTable('pumps').set({ meter_ml: close }).where('id', '=', pump.id).execute(),
      stockMove(ctx, q, tank.id, { qty: -Math.min(qty, tank.level_ml), kind: 'sale', ref_type: 'sale', ref_id: id, date, user_id: user.id }, tank)
    ]);
    const cogs = -moved;
    await Promise.all([
      q.updateTable('sales').set({ cogs }).where('id', '=', id).execute(),
      post(ctx, q, { org_id: user.org_id, station_id: sid, date, source: 'sale', source_id: id, user_id: user.id, periodChecked: true, lines: [
        { a: payType === 'cash' ? 'cash' : 'ar', dr: gross, party_type: custId ? 'customer' : null, party_id: custId },
        { a: 'sales', cr: list.net }, { a: 'sales_disc', dr: list.net - net }, { a: 'vat_out', cr: vat }, { a: 'cogs', dr: cogs }, { a: 'inventory', cr: cogs }] }),
      audit(ctx, q, user, sid, 'sale.create', 'sale', id, { qty_ml: qty, gross, pay_type: payType, ...(discount ? { discount } : {}) })
    ]);
    return { ...row, id, cogs };
  });
  try { return await run(); }
  catch (e) {
    // two devices sent the same sale at the same moment: the unique (station_id, client_id) index stops the second one
    if (!(e instanceof AppError) && isUniqueViolation(e)) {
      const dup = await ctx.db.selectFrom('sales').selectAll().where('station_id', '=', sid).where('client_id', '=', clientId).executeTakeFirst();
      if (dup) return { ...dup, duplicate: true };
    }
    throw e;
  }
}
export function isUniqueViolation(e: unknown): boolean {
  const x = e as { code?: string; errcode?: string; message?: string };
  return x?.code === '23505' || x?.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed/.test(x.message || '') || /UNIQUE constraint failed/.test(x?.message || '');
}

export async function voidSale(ctx: Ctx, user: User, sid: number, id: number, reason: unknown) {
  need(user, 'sale.void');
  const r = V.str(reason, 'reason', { min: 3, max: 200 });
  return tx(ctx, async (q) => {
    await station(q, user, sid);
    const s = await scoped(ctx, q, 'sales', id, sid, 'sales', true);
    if (s.voided_at) throw conflict('ALREADY_VOIDED', 'This record is already voided');
    if (s.shift_id) {
      const sh = await q.selectFrom('shifts').select('status').where('id', '=', s.shift_id).executeTakeFirstOrThrow();
      if (sh.status !== 'open') throw conflict('SHIFT_CLOSED', 'This record belongs to a closed shift and cannot be changed');
    }
    await assertOpen(q, user.org_id, s.business_date);
    const n = await reverseSource(ctx, q, user.org_id, 'sale', id, user.id, 'Void: ' + r);
    if (n === 0 && s.cogs !== null) throw conflict('LEGACY_DOCUMENT', 'This record predates the general ledger; correct it with a manual journal');
    let tq = q.selectFrom('tanks').selectAll().where('id', '=', s.tank_id);
    if (ctx.dialect === 'postgres') tq = tq.forUpdate();
    const t = await tq.executeTakeFirstOrThrow();
    const cogs = s.cogs ?? 0;
    const back = Math.min(s.quantity_ml, t.capacity_ml - t.level_ml);
    const value = back === s.quantity_ml ? cogs : Number(divRound(BigInt(cogs) * BigInt(back), BigInt(s.quantity_ml)));
    const moved = back > 0 ? await stockMove(ctx, q, t.id, { qty: back, value, kind: 'void', ref_type: 'sale', ref_id: s.id, date: s.business_date, user_id: user.id }) : 0;
    await post(ctx, q, { org_id: user.org_id, station_id: sid, date: s.business_date, source: 'stock_fix', source_id: s.id, user_id: user.id, memo: 'Stock value correction on sale void', lines: inventoryFix(cogs, moved) });
    const p = await q.selectFrom('pumps').selectAll().where('id', '=', s.pump_id).executeTakeFirstOrThrow();
    if (p.meter_ml === s.close_ml) await q.updateTable('pumps').set({ meter_ml: s.open_ml }).where('id', '=', p.id).execute();   // only if no later sale on this pump
    await q.updateTable('sales').set({ voided_at: ctx.clock.now(), void_reason: r, void_by: user.id }).where('id', '=', id).execute();
    await audit(ctx, q, user, sid, 'sales.void', 'sales', id, { reason: r });
    return { ok: true };
  });
}

export async function listSales(ctx: Ctx, user: User, sid: number, opts: { date?: string; before?: number; limit?: number } = {}) {
  await station(ctx.db, user, sid);
  const date = V.date(opts.date, 'date');
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500), before = opts.before ?? Number.MAX_SAFE_INTEGER;
  let qb = ctx.db.selectFrom('sales as s').innerJoin('pumps as p', 'p.id', 's.pump_id').innerJoin('fuels as f', 'f.id', 's.fuel_id')
    .leftJoin('customers as c', 'c.id', 's.customer_id')
    .selectAll('s').select(['p.name as pump_name', 'f.name as fuel_name', 'c.name as customer_name'])
    .where('s.station_id', '=', sid).where('s.id', '<', before);
  if (date) qb = qb.where('s.business_date', '=', date);
  return qb.orderBy('s.id', 'desc').limit(limit).execute();
}
