/* Stock & deliveries (v2 phase 2): suppliers, fuel deliveries (cash / bank / credit, VAT), stock counts, transfers between
   tanks and stations, stock movements and the tank reconciliation. Port of v1 src/services.js (createDelivery, voidDelivery,
   createAdjustment) and src/ops.js (suppliers, transfers, stockMoves, stockReconciliation): same rules, same postings. */
import { sql } from 'kysely';
import { audit, need, scoped, station } from './access.ts';
import { addDays, tx, type Ctx, type Q, type User } from './ctx.ts';
import { bad, conflict, notFound } from './errors.ts';
import { assertOpen, atCost, countReversible, inventoryFix, planMove, post, reverseSource, stockMove } from './ledger.ts';
import { amountMinor, divRound } from './money.ts';
import type { Tank } from './schema.ts';
import { cashParts, openShift } from './shifts.ts';
import * as V from './validate.ts';

const MAX_DELIVERY_ML = 100_000_000;
void atCost;

/* cash paid for deliveries leaves the shift's drawer (v1 shiftTotals.purchases_cash) */
cashParts.push(async (q, shiftId) => {
  const r = await q.selectFrom('deliveries').select(sql<number>`coalesce(sum(net + vat), 0)`.as('v'))
    .where('shift_id', '=', shiftId).where('pay_type', '=', 'cash').where('voided_at', 'is', null).executeTakeFirstOrThrow();
  return { purchases_cash: Number(r.v) };
});

async function lockTank(ctx: Ctx, q: Q, id: number): Promise<Tank> {
  let qb = q.selectFrom('tanks').selectAll().where('id', '=', id);
  if (ctx.dialect === 'postgres') qb = qb.forUpdate();
  return qb.executeTakeFirstOrThrow();
}
const page = (o: { limit?: number | string; before_id?: number | string }) => ({
  limit: Math.min(Math.max(parseInt(String(o.limit ?? ''), 10) || 100, 1), 200),
  before: parseInt(String(o.before_id ?? ''), 10) || Number.MAX_SAFE_INTEGER
});

/* ------------------------------ suppliers ------------------------------ */
export async function supplierBalance(q: Q, id: number, asOf = '9999-12-31'): Promise<number> {
  const r = await q.selectFrom('journal_lines as l').innerJoin('journals as j', 'j.id', 'l.journal_id').innerJoin('accounts as a', 'a.id', 'l.account_id')
    .select(sql<number>`coalesce(sum(l.credit - l.debit), 0)`.as('v'))
    .where('l.party_type', '=', 'supplier').where('l.party_id', '=', id).where('a.sys', '=', 'ap').where('j.status', '=', 'posted').where('j.business_date', '<=', asOf)
    .executeTakeFirstOrThrow();
  return Number(r.v);
}
export async function listSuppliers(ctx: Ctx, user: User, sid: number) {
  await station(ctx.db, user, sid);
  const bal = await ctx.db.selectFrom('journal_lines as l').innerJoin('journals as j', 'j.id', 'l.journal_id').innerJoin('accounts as a', 'a.id', 'l.account_id')
    .select(['l.party_id', sql<number>`sum(l.credit - l.debit)`.as('v')])
    .where('l.party_type', '=', 'supplier').where('a.sys', '=', 'ap').where('j.status', '=', 'posted')
    .where('l.party_id', 'in', ctx.db.selectFrom('suppliers').select('id').where('station_id', '=', sid)).groupBy('l.party_id').execute();
  const m = new Map(bal.map((r) => [Number(r.party_id), Number(r.v)]));
  const rows = await ctx.db.selectFrom('suppliers').selectAll().where('station_id', '=', sid).where('active', '=', 1).orderBy('name').execute();
  for (const s of rows as Array<(typeof rows)[number] & { balance: number }>) s.balance = m.get(s.id) || 0;
  return rows as Array<(typeof rows)[number] & { balance: number }>;
}
export async function createSupplier(ctx: Ctx, user: User, sid: number, b: Record<string, unknown>) {
  need(user, 'supplier.manage'); V.obj(b, 'body');
  const opening = V.int(b.opening_balance ?? 0, 'opening_balance', { min: -(10 ** 13), max: 10 ** 13 }), terms = V.int(b.terms_days ?? 30, 'terms_days', { min: 0, max: 365 });
  return tx(ctx, async (q) => {
    const st = await station(q, user, sid), date = ctx.clock.today(st.timezone);
    const id = (await q.insertInto('suppliers').values({ station_id: sid, name: V.str(b.name, 'name', { max: 120 }), phone: V.str(b.phone, 'phone', { max: 40, optional: true }) || null,
      opening_balance: opening, terms_days: terms, created_on: date, ref: null }).returning('id').executeTakeFirstOrThrow()).id;
    if (opening) await post(ctx, q, { org_id: user.org_id, station_id: sid, date, source: 'supplier_opening', source_id: id, user_id: user.id, memo: 'Supplier opening balance',
      lines: [{ a: 'capital', dr: Math.max(opening, 0), cr: Math.max(-opening, 0) }, { a: 'ap', dr: Math.max(-opening, 0), cr: Math.max(opening, 0), party_type: 'supplier', party_id: id }] });
    await audit(ctx, q, user, sid, 'supplier.create', 'supplier', id, { opening_balance: opening });
    return { id };
  });
}

/* ------------------------------ deliveries ------------------------------ */
export interface DeliveryInput {
  tank_id: number; quantity_ml: number; cost_e4: number; vat?: number; pay_type?: 'cash' | 'bank' | 'credit'; supplier_id?: number; supplier?: string;
  date?: string; ref?: string; note?: string;
}
export async function createDelivery(ctx: Ctx, user: User, sid: number, b: DeliveryInput) {
  need(user, 'delivery.create'); V.obj(b, 'body');
  return tx(ctx, async (q) => {
    const st = await station(q, user, sid), today = ctx.clock.today(st.timezone);
    const date = V.date(b.date, 'date') || today;
    if (date > today) throw bad('FUTURE_DATE', 'The date cannot be in the future');
    const qty = V.int(b.quantity_ml, 'quantity_ml', { min: 1, max: MAX_DELIVERY_ML });
    const cost = V.int(b.cost_e4, 'cost_e4', { min: 0, max: 10 ** 12 });
    const net = amountMinor(qty, cost);
    const vat = b.vat === undefined ? Number(divRound(BigInt(net) * BigInt(st.vat_bp), 10000n)) : V.int(b.vat, 'vat', { min: 0, max: net * 2 + 1 });
    const payType = V.oneOf(b.pay_type || 'cash', 'pay_type', ['cash', 'bank', 'credit'] as const);
    const supIn = V.int(b.supplier_id, 'supplier_id', { min: 1, optional: true });
    if (payType === 'credit' && !supIn) throw bad('VALIDATION', 'Choose the supplier for a credit purchase');
    await assertOpen(q, user.org_id, date);
    const tank0 = await scoped(ctx, q, 'tanks', V.int(b.tank_id, 'tank_id', { min: 1 }), sid, 'Tank');
    const tank = await lockTank(ctx, q, tank0.id);
    if (tank.level_ml + qty > tank.capacity_ml) throw conflict('EXCEEDS_CAPACITY', 'The delivery exceeds the tank capacity', { free_ml: tank.capacity_ml - tank.level_ml });
    const sup = supIn ? await scoped(ctx, q, 'suppliers', supIn, sid, 'Supplier') : null;
    const shift = payType === 'cash' ? await openShift(q, st, false) : null;
    const due = payType === 'credit' ? addDays(date, sup!.terms_days) : null;
    let ref = V.str(b.ref, 'ref', { max: 30, optional: true });
    if (!ref) {
      // next number = 1 + the largest reference that starts with digits (v1: CAST(ref AS INTEGER) over ref GLOB '[0-9]*')
      const r = await sql<{ m: number | null }>`SELECT MAX(${ctx.dialect === 'postgres' ? sql`substring(ref from '^[0-9]+')::bigint` : sql`CAST(ref AS INTEGER)`}) m
        FROM deliveries WHERE station_id = ${sid} AND ${ctx.dialect === 'postgres' ? sql`ref ~ '^[0-9]'` : sql`ref GLOB '[0-9]*'`}`.execute(q);
      ref = String(1 + (Number(r.rows[0]?.m) || 0));
    }
    const id = (await q.insertInto('deliveries').values({
      station_id: sid, tank_id: tank.id, fuel_id: tank.fuel_id, business_date: date, created_at: ctx.clock.now(), quantity_ml: qty, cost_e4: cost, net, vat,
      supplier: sup ? sup.name : (V.str(b.supplier, 'supplier', { max: 120, optional: true }) || null), supplier_id: sup ? sup.id : null, pay_type: payType,
      due_date: due, shift_id: shift ? shift.id : null, user_id: user.id, ref, note: V.str(b.note, 'note', { max: 300, optional: true }) || null,
      voided_at: null, void_reason: null, void_by: null, payable: null
    }).returning('id').executeTakeFirstOrThrow()).id;
    const moved = await stockMove(ctx, q, tank.id, { qty, value: net, kind: 'delivery', ref_type: 'delivery', ref_id: id, date, user_id: user.id }, tank);
    if (cost > 0) await q.updateTable('fuels').set({ cost_e4: cost }).where('id', '=', tank.fuel_id).execute();   // last purchase cost (reference only)
    const jid = await post(ctx, q, { org_id: user.org_id, station_id: sid, date, source: 'delivery', source_id: id, user_id: user.id, periodChecked: true, lines: [
      { a: 'inventory', dr: moved }, { a: 'vat_in', dr: vat },
      { a: payType === 'credit' ? 'ap' : payType, cr: net + vat, party_type: sup ? 'supplier' : null, party_id: sup ? sup.id : null }, ...inventoryFix(net, moved)] });
    if (jid) await q.updateTable('journals').set({ ref }).where('source', '=', 'delivery').where('source_id', '=', id).where('org_id', '=', user.org_id).execute();
    await audit(ctx, q, user, sid, 'delivery.create', 'delivery', id, { qty_ml: qty, net, vat, pay_type: payType });
    return q.selectFrom('deliveries').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  });
}
export async function voidDelivery(ctx: Ctx, user: User, sid: number, id: number, reason: unknown) {
  need(user, 'delivery.void');
  const r = V.str(reason, 'reason', { min: 3, max: 200 });
  return tx(ctx, async (q) => {
    await station(q, user, sid);
    const d = await scoped(ctx, q, 'deliveries', id, sid, 'deliveries', true);
    if (d.voided_at) throw conflict('ALREADY_VOIDED', 'This record is already voided');
    if (d.shift_id) {
      const sh = await q.selectFrom('shifts').select('status').where('id', '=', d.shift_id).executeTakeFirstOrThrow();
      if (sh.status !== 'open') throw conflict('SHIFT_CLOSED', 'This record belongs to a closed shift and cannot be changed');
    }
    await assertOpen(q, user.org_id, d.business_date);
    // every check before the first write, in v1's order (a rolled-back write would leave a gap in PostgreSQL's ids)
    const n = await countReversible(q, user.org_id, 'delivery', id);
    if (n === 0 && d.net + d.vat > 0) throw conflict('LEGACY_DOCUMENT', 'This record predates the general ledger; correct it with a manual journal');
    const t = await lockTank(ctx, q, d.tank_id);
    if (t.level_ml < d.quantity_ml) throw conflict('STOCK_ALREADY_SOLD', 'Part of this delivery has already been sold. Use a stock count to correct the tank.');
    await reverseSource(ctx, q, user.org_id, 'delivery', id, user.id, 'Void: ' + r);
    const moved = await stockMove(ctx, q, t.id, { qty: -d.quantity_ml, value: -d.net, kind: 'void', ref_type: 'delivery', ref_id: d.id, date: d.business_date, user_id: user.id }, t);
    await post(ctx, q, { org_id: user.org_id, station_id: sid, date: d.business_date, source: 'stock_fix', source_id: d.id, user_id: user.id, memo: 'Stock value correction on delivery void', lines: inventoryFix(-d.net, moved) });
    await q.updateTable('deliveries').set({ voided_at: ctx.clock.now(), void_reason: r, void_by: user.id }).where('id', '=', id).execute();
    await audit(ctx, q, user, sid, 'deliveries.void', 'deliveries', id, { reason: r });
    return { ok: true };
  });
}
export async function listDeliveries(ctx: Ctx, user: User, sid: number, o: { limit?: number; before_id?: number } = {}) {
  await station(ctx.db, user, sid); const { limit, before } = page(o);
  return ctx.db.selectFrom('deliveries as d').innerJoin('tanks as t', 't.id', 'd.tank_id').selectAll('d').select('t.name as tank_name')
    .where('d.station_id', '=', sid).where('d.id', '<', before).orderBy('d.id', 'desc').limit(limit).execute();
}

/* ------------------------------ stock counts ------------------------------ */
export async function createAdjustment(ctx: Ctx, user: User, sid: number, b: { tank_id: number; after_ml: number; note: string; charge_supplier_id?: number }) {
  need(user, 'adjust.create'); V.obj(b, 'body');
  const note = V.str(b.note, 'note', { min: 3, max: 200 });
  return tx(ctx, async (q) => {
    const st = await station(q, user, sid);
    const tank0 = await scoped(ctx, q, 'tanks', V.int(b.tank_id, 'tank_id', { min: 1 }), sid, 'Tank');
    const tank = await lockTank(ctx, q, tank0.id);
    const after = V.int(b.after_ml, 'after_ml', { min: 0, max: tank.capacity_ml }), date = ctx.clock.today(st.timezone);
    await assertOpen(q, user.org_id, date);
    const diff = after - tank.level_ml;
    // the supplier is checked before any write (v1 checks it after; same outcome, no id gap on PostgreSQL)
    const willMove = diff ? planMove(tank, diff).moved : 0;
    const sup = b.charge_supplier_id && willMove < 0 ? await scoped(ctx, q, 'suppliers', V.int(b.charge_supplier_id, 'charge_supplier_id', { min: 1 }), sid, 'Supplier') : null;
    const id = (await q.insertInto('adjustments').values({ station_id: sid, tank_id: tank.id, business_date: date, created_at: ctx.clock.now(), before_ml: tank.level_ml, after_ml: after, note, user_id: user.id })
      .returning('id').executeTakeFirstOrThrow()).id;
    const moved = diff ? await stockMove(ctx, q, tank.id, { qty: diff, kind: 'count', ref_type: 'adjustment', ref_id: id, date, user_id: user.id }, tank) : 0;
    // a shortage can be charged to the supplier who delivered short instead of the station's own loss
    await post(ctx, q, { org_id: user.org_id, station_id: sid, date, source: 'stock_count', source_id: id, user_id: user.id, memo: note, periodChecked: true,
      lines: moved < 0 ? [sup ? { a: 'ap', dr: -moved, party_type: 'supplier', party_id: sup.id, memo: note } : { a: 'stock_loss', dr: -moved }, { a: 'inventory', cr: -moved }]
        : [{ a: 'inventory', dr: moved }, { a: 'other_income', cr: moved }] });
    await audit(ctx, q, user, sid, 'tank.adjust', 'tank', tank.id, { before_ml: tank.level_ml, after_ml: after, value: moved, note });
    return { id, before_ml: tank.level_ml, after_ml: after, diff_ml: diff, value: moved };
  });
}

/* ------------------------------ transfers ------------------------------ */
const sameFuel = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
export async function createTransfer(ctx: Ctx, user: User, sid: number, b: { to_station_id?: number; from_tank_id: number; to_tank_id: number; quantity_ml: number; note?: string }) {
  need(user, 'transfer.create'); V.obj(b, 'body');
  return tx(ctx, async (q) => {
    const st = await station(q, user, sid);
    const toSid = V.int(b.to_station_id ?? sid, 'to_station_id', { min: 1 }); const st2 = await station(q, user, toSid);
    if (st2.currency !== st.currency) throw bad('CURRENCY_MISMATCH', 'Transfers between stations with different currencies are not supported');
    const qty = V.int(b.quantity_ml, 'quantity_ml', { min: 1, max: 100_000_000 }), note = V.str(b.note, 'note', { max: 200, optional: true }) || null;
    const date = ctx.clock.today(st.timezone);
    await assertOpen(q, user.org_id, date);
    const f0 = await scoped(ctx, q, 'tanks', V.int(b.from_tank_id, 'from_tank_id', { min: 1 }), sid, 'Tank');
    const t0 = await scoped(ctx, q, 'tanks', V.int(b.to_tank_id, 'to_tank_id', { min: 1 }), toSid, 'Tank');
    if (f0.id === t0.id) throw bad('VALIDATION', 'Choose two different tanks');
    // lock both tanks in id order: two opposite transfers at the same moment cannot deadlock
    const [a, z] = f0.id < t0.id ? [f0.id, t0.id] : [t0.id, f0.id];
    const la = await lockTank(ctx, q, a), lz = await lockTank(ctx, q, z);
    const from = la.id === f0.id ? la : lz, to = la.id === t0.id ? la : lz;
    const fuels = await q.selectFrom('fuels').select(['id', 'name']).where('id', 'in', [from.fuel_id, to.fuel_id]).execute();
    const f1 = fuels.find((f) => f.id === from.fuel_id)!.name, f2 = fuels.find((f) => f.id === to.fuel_id)!.name;
    if (!sameFuel(f1, f2)) throw conflict('FUEL_MISMATCH', 'Both tanks must hold the same fuel', { from: f1, to: f2 });
    if (qty > from.level_ml) throw conflict('INSUFFICIENT_STOCK', 'Quantity exceeds the source tank stock', { available_ml: from.level_ml });
    if (to.level_ml + qty > to.capacity_ml) throw conflict('EXCEEDS_CAPACITY', 'The destination tank does not have room', { free_ml: to.capacity_ml - to.level_ml });
    const id = (await q.insertInto('transfers').values({ org_id: user.org_id, from_station_id: sid, to_station_id: toSid, from_tank_id: from.id, to_tank_id: to.id, business_date: date,
      created_at: ctx.clock.now(), quantity_ml: qty, value: 0, note, user_id: user.id, voided_at: null, void_reason: null, void_by: null }).returning('id').executeTakeFirstOrThrow()).id;
    const value = -(await stockMove(ctx, q, from.id, { qty: -qty, kind: 'transfer_out', ref_type: 'transfer', ref_id: id, date, user_id: user.id }, from));
    await stockMove(ctx, q, to.id, { qty, value, kind: 'transfer_in', ref_type: 'transfer', ref_id: id, date, user_id: user.id }, to);
    await q.updateTable('transfers').set({ value }).where('id', '=', id).execute();
    if (toSid !== sid) {   // each branch's books stay balanced through the inter-branch account
      await post(ctx, q, { org_id: user.org_id, station_id: sid, date, source: 'transfer', source_id: id, user_id: user.id, memo: 'Transfer out to ' + st2.name, periodChecked: true, lines: [{ a: 'interbranch', dr: value }, { a: 'inventory', cr: value }] });
      await post(ctx, q, { org_id: user.org_id, station_id: toSid, date, source: 'transfer', source_id: id, user_id: user.id, memo: 'Transfer in from ' + st.name, periodChecked: true, lines: [{ a: 'inventory', dr: value }, { a: 'interbranch', cr: value }] });
    }
    await audit(ctx, q, user, sid, 'transfer.create', 'transfer', id, { qty_ml: qty, to_station_id: toSid, value });
    return { id, value };
  });
}
export async function voidTransfer(ctx: Ctx, user: User, sid: number, id: number, b: { reason?: string }) {
  need(user, 'transfer.void');
  const reason = V.str(b && b.reason, 'reason', { min: 3, max: 200 });
  return tx(ctx, async (q) => {
    await station(q, user, sid);
    let tq = q.selectFrom('transfers').selectAll().where('id', '=', id).where('org_id', '=', user.org_id)
      .where((e) => e.or([e('from_station_id', '=', sid), e('to_station_id', '=', sid)]));
    if (ctx.dialect === 'postgres') tq = tq.forUpdate();
    const t = await tq.executeTakeFirst();
    if (!t) throw notFound('Transfer');
    await station(q, user, t.from_station_id); await station(q, user, t.to_station_id);
    if (t.voided_at) throw conflict('ALREADY_VOIDED', 'This record is already voided');
    await assertOpen(q, user.org_id, t.business_date);
    const [a, z] = t.from_tank_id < t.to_tank_id ? [t.from_tank_id, t.to_tank_id] : [t.to_tank_id, t.from_tank_id];
    const la = await lockTank(ctx, q, a), lz = await lockTank(ctx, q, z);
    const from = la.id === t.from_tank_id ? la : lz, to = la.id === t.to_tank_id ? la : lz;
    if (to.level_ml < t.quantity_ml) throw conflict('STOCK_ALREADY_SOLD', 'Part of the transferred fuel has been sold already');
    if (from.level_ml + t.quantity_ml > from.capacity_ml) throw conflict('EXCEEDS_CAPACITY', 'The source tank has no room to take the fuel back');
    await reverseSource(ctx, q, user.org_id, 'transfer', id, user.id, 'Void: ' + reason);
    const out = await stockMove(ctx, q, to.id, { qty: -t.quantity_ml, value: -t.value, kind: 'void', ref_type: 'transfer', ref_id: id, date: t.business_date, user_id: user.id }, to);
    const back = await stockMove(ctx, q, from.id, { qty: t.quantity_ml, value: -out, kind: 'void', ref_type: 'transfer', ref_id: id, date: t.business_date, user_id: user.id }, from);
    if (t.from_station_id !== t.to_station_id) {
      await post(ctx, q, { org_id: user.org_id, station_id: t.to_station_id, date: t.business_date, source: 'stock_fix', source_id: id, user_id: user.id, lines: inventoryFix(-t.value, out) });
      await post(ctx, q, { org_id: user.org_id, station_id: t.from_station_id, date: t.business_date, source: 'stock_fix', source_id: id, user_id: user.id, lines: inventoryFix(t.value, back) });
    }
    await q.updateTable('transfers').set({ voided_at: ctx.clock.now(), void_reason: reason, void_by: user.id }).where('id', '=', id).execute();
    await audit(ctx, q, user, sid, 'transfer.void', 'transfer', id, { reason });
    return { ok: true };
  });
}
export async function listTransfers(ctx: Ctx, user: User, sid: number, o: { limit?: number; before_id?: number } = {}) {
  await station(ctx.db, user, sid); const { limit, before } = page(o);
  return ctx.db.selectFrom('transfers as t').innerJoin('stations as fs', 'fs.id', 't.from_station_id').innerJoin('stations as ts', 'ts.id', 't.to_station_id')
    .innerJoin('tanks as ft', 'ft.id', 't.from_tank_id').innerJoin('tanks as tt', 'tt.id', 't.to_tank_id')
    .selectAll('t').select(['fs.name as from_station', 'ts.name as to_station', 'ft.name as from_tank', 'tt.name as to_tank'])
    .where('t.org_id', '=', user.org_id).where((e) => e.or([e('t.from_station_id', '=', sid), e('t.to_station_id', '=', sid)]))
    .where('t.id', '<', before).orderBy('t.id', 'desc').limit(limit).execute();
}

/* ------------------------------ reports ------------------------------ */
export async function stockMoves(ctx: Ctx, user: User, sid: number, o: { tank_id?: number; from?: string; to?: string; limit?: number; before_id?: number } = {}) {
  await station(ctx.db, user, sid); const { limit, before } = page(o);
  const tank = o.tank_id ? V.int(Number(o.tank_id), 'tank_id', { min: 1 }) : undefined;
  const from = V.date(o.from, 'from') || '0000-01-01', to = V.date(o.to, 'to') || '9999-12-31';
  let qb = ctx.db.selectFrom('stock_moves as m').innerJoin('tanks as t', 't.id', 'm.tank_id').leftJoin('users as u', 'u.id', 'm.user_id')
    .selectAll('m').select(['t.name as tank_name', 'u.name as user_name'])
    .where('m.station_id', '=', sid).where('m.business_date', '>=', from).where('m.business_date', '<=', to).where('m.id', '<', before);
  if (tank) qb = qb.where('m.tank_id', '=', tank);
  return qb.orderBy('m.id', 'desc').limit(limit).execute();
}
/** Tank reconciliation: book movement from documents vs. physical counts, per tank, for a period (v1 stockReconciliation). */
export async function stockReconciliation(ctx: Ctx, user: User, sid: number, o: { from?: string; to?: string } = {}) {
  need(user, 'report.read'); const st = await station(ctx.db, user, sid);
  const to = V.date(o.to, 'to') || ctx.clock.today(st.timezone), from = V.date(o.from, 'from') || to.slice(0, 8) + '01';
  if (from > to) throw bad('VALIDATION', 'from must not be after to');
  const tanks = await ctx.db.selectFrom('tanks as t').innerJoin('fuels as f', 'f.id', 't.fuel_id').selectAll('t').select('f.name as fuel_name').where('t.station_id', '=', sid).orderBy('t.id').execute();
  const rows = [];
  for (const t of tanks) {
    const sum = async (op: '<' | '<=', d: string) => {
      const r = await ctx.db.selectFrom('stock_moves').select([sql<number>`coalesce(sum(qty_ml), 0)`.as('q'), sql<number>`coalesce(sum(value), 0)`.as('v')])
        .where('tank_id', '=', t.id).where('business_date', op, d).executeTakeFirstOrThrow();
      return { q: Number(r.q), v: Number(r.v) };
    };
    const open = await sum('<', from), close = await sum('<=', to);
    const by: Record<string, number> = {};
    for (const r of await ctx.db.selectFrom('stock_moves').select(['kind', sql<number>`sum(qty_ml)`.as('q')]).where('tank_id', '=', t.id)
      .where('business_date', '>=', from).where('business_date', '<=', to).groupBy('kind').execute()) by[r.kind] = Number(r.q);
    const g = (k: string) => by[k] || 0;
    const ms = await ctx.db.selectFrom('sales').select(sql<number>`coalesce(sum(quantity_ml), 0)`.as('v')).where('tank_id', '=', t.id)
      .where('business_date', '>=', from).where('business_date', '<=', to).where('voided_at', 'is', null).executeTakeFirstOrThrow();
    const meterSales = Number(ms.v);
    const book = open.q + g('opening') + g('delivery') + g('transfer_in') + g('transfer_out') + g('sale') + g('void');
    const variance = g('count');
    rows.push({ tank_id: t.id, tank_name: t.name, fuel_name: t.fuel_name, min_ml: t.min_ml, capacity_ml: t.capacity_ml,
      opening_ml: open.q, opening_value: open.v, received_ml: g('delivery') + g('opening'), transfer_in_ml: g('transfer_in'), transfer_out_ml: -g('transfer_out'),
      sales_ml: -(g('sale') + g('void')), meter_sales_ml: meterSales, book_closing_ml: book, count_variance_ml: variance, closing_ml: close.q, closing_value: close.v,
      variance_pct: meterSales ? Math.round(variance * 10000 / meterSales) / 100 : null, consistent: book + variance === close.q });
  }
  return { from, to, rows };
}
