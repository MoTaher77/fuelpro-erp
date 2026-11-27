/* Organisation and station set-up needed by the sales & shifts module: org, station, fuel, tank (opening stock),
   pump, customer (opening balance). Same validations, postings and audit rows as v1 src/services.js. */
import { audit, need, scoped, station } from './access.ts';
import { tx, validTz, type Ctx, type User } from './ctx.ts';
import { bad, forbidden } from './errors.ts';
import { atCost, ensureChart, post, stockMove } from './ledger.ts';
import { currencyDecimals } from './money.ts';
import { can } from './perms.ts';
import * as V from './validate.ts';

/** A new organisation with its first station and owner. Authentication (password/passkey) is attached by the run mode. */
export async function createOrg(ctx: Ctx, b: { org_name: string; name: string; email: string; currency: string; timezone?: string; station_name?: string }) {
  const orgName = V.str(b.org_name, 'org_name', { max: 120 }), name = V.str(b.name, 'name', { max: 120 });
  const email = V.str(b.email, 'email', { max: 254 }).toLowerCase();
  const currency = V.str(b.currency, 'currency', { min: 3, max: 3 }).toUpperCase(), dec = currencyDecimals(currency);
  if (dec === null) throw bad('VALIDATION', 'Unknown currency code');
  const timezone = V.str(b.timezone || 'UTC', 'timezone', { max: 60 });
  if (!validTz(timezone)) throw bad('VALIDATION', 'Unknown time zone');
  return tx(ctx, async (q) => {
    if (await q.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst()) throw bad('EMAIL_TAKEN', 'This email is already registered');
    const now = ctx.clock.now();
    const org = (await q.insertInto('orgs').values({ name: orgName, created_at: now, locked_through: null }).returning('id').executeTakeFirstOrThrow()).id;
    const uid = (await q.insertInto('users').values({ org_id: org, email, name, role: 'owner', created_at: now }).returning('id').executeTakeFirstOrThrow()).id;
    const sid = (await q.insertInto('stations').values({ org_id: org, name: V.str(b.station_name || orgName, 'station_name', { max: 120 }), currency, cur_dec: dec, disp_dec: null, timezone, created_at: now })
      .returning('id').executeTakeFirstOrThrow()).id;
    const user: User = { id: uid, org_id: org, role: 'owner' };
    await ensureChart(q, org);
    await audit(ctx, q, user, sid, 'org.register', 'org', org);
    return { user_id: uid, org_id: org, station_id: sid };
  });
}
export async function updateStation(ctx: Ctx, user: User, sid: number, b: Record<string, unknown>) {
  need(user, 'users.manage'); V.obj(b, 'body');
  return tx(ctx, async (q) => {
    const st = await station(q, user, sid);
    const vat_bp = b.vat_bp === undefined ? st.vat_bp : V.int(b.vat_bp, 'vat_bp', { min: 0, max: 10000 });
    const vat_included = b.vat_included === undefined ? st.vat_included : (V.bool(b.vat_included) ? 1 : 0);
    const allow_negative = b.allow_negative === undefined ? st.allow_negative : (V.bool(b.allow_negative) ? 1 : 0);
    const require_shift = b.require_shift === undefined ? st.require_shift : (V.bool(b.require_shift) ? 1 : 0);
    await q.updateTable('stations').set({ vat_bp, vat_included, allow_negative, require_shift }).where('id', '=', sid).execute();
    await audit(ctx, q, user, sid, 'station.update', 'station', sid, { from: { vat_bp: st.vat_bp, vat_included: st.vat_included, allow_negative: st.allow_negative, timezone: st.timezone }, to: { vat_bp, vat_included, allow_negative, timezone: st.timezone } });
    return { ok: true };
  });
}
export async function createFuel(ctx: Ctx, user: User, sid: number, b: Record<string, unknown>) {
  need(user, 'config.edit'); V.obj(b, 'body');
  return tx(ctx, async (q) => {
    await station(q, user, sid);
    const id = (await q.insertInto('fuels').values({ station_id: sid, name: V.str(b.name, 'name', { max: 60 }), price_e4: V.int(b.price_e4 ?? 0, 'price_e4', { min: 0, max: 10 ** 12 }), cost_e4: V.int(b.cost_e4 ?? 0, 'cost_e4', { min: 0, max: 10 ** 12 }) })
      .returning('id').executeTakeFirstOrThrow()).id;
    await audit(ctx, q, user, sid, 'fuel.create', 'fuel', id); return { id };
  });
}
export async function createTank(ctx: Ctx, user: User, sid: number, b: Record<string, unknown>) {
  need(user, 'config.edit'); V.obj(b, 'body');
  return tx(ctx, async (q) => {
    const st = await station(q, user, sid);
    const fuel = await scoped(ctx, q, 'fuels', V.int(b.fuel_id, 'fuel_id', { min: 1 }), sid, 'Fuel');
    const cap = V.int(b.capacity_ml, 'capacity_ml', { min: 1, max: 10 ** 9 }), lvl = V.int(b.level_ml ?? 0, 'level_ml', { min: 0, max: cap });
    const minMl = V.int(b.min_ml ?? 0, 'min_ml', { min: 0, max: cap });
    const cost = V.int(b.cost_e4 ?? fuel.cost_e4, 'cost_e4', { min: 0, max: 10 ** 12 });
    const date = ctx.clock.today(st.timezone);
    const id = (await q.insertInto('tanks').values({ station_id: sid, name: V.str(b.name, 'name', { max: 60 }), fuel_id: fuel.id, capacity_ml: cap, level_ml: 0, min_ml: minMl })
      .returning('id').executeTakeFirstOrThrow()).id;
    if (lvl > 0) {
      const value = await stockMove(ctx, q, id, { qty: lvl, value: atCost(lvl, cost), kind: 'opening', ref_type: 'tank', ref_id: id, date, user_id: user.id });
      await post(ctx, q, { org_id: user.org_id, station_id: sid, date, source: 'tank_opening', source_id: id, user_id: user.id, memo: 'Opening stock', lines: [{ a: 'inventory', dr: value }, { a: 'capital', cr: value }] });
    }
    await audit(ctx, q, user, sid, 'tank.create', 'tank', id, { capacity_ml: cap, level_ml: lvl }); return { id };
  });
}
export async function createPump(ctx: Ctx, user: User, sid: number, b: Record<string, unknown>) {
  need(user, 'config.edit'); V.obj(b, 'body');
  return tx(ctx, async (q) => {
    await station(q, user, sid);
    const tank = await scoped(ctx, q, 'tanks', V.int(b.tank_id, 'tank_id', { min: 1 }), sid, 'Tank');
    const meter = V.int(b.meter_ml ?? 0, 'meter_ml', { min: 0, max: 10 ** 13 });
    const id = (await q.insertInto('pumps').values({ station_id: sid, name: V.str(b.name, 'name', { max: 60 }), tank_id: tank.id, fuel_id: tank.fuel_id, meter_ml: meter })
      .returning('id').executeTakeFirstOrThrow()).id;
    await audit(ctx, q, user, sid, 'pump.create', 'pump', id, { meter_ml: meter }); return { id };
  });
}
export async function createCustomer(ctx: Ctx, user: User, sid: number, b: Record<string, unknown>) {
  need(user, 'customer.create'); V.obj(b, 'body');
  const opening = V.int(b.opening_balance ?? 0, 'opening_balance', { min: -(10 ** 13), max: 10 ** 13 });
  if (opening && !can(user.role, 'customer.edit')) throw forbidden('Only a manager or accountant can enter an opening balance');
  const limit = V.int(b.credit_limit ?? 0, 'credit_limit', { min: 0, max: 10 ** 13 }), terms = V.int(b.terms_days ?? 30, 'terms_days', { min: 0, max: 365 });
  if (limit && !can(user.role, 'customer.edit')) throw forbidden('Only a manager or accountant can set a credit limit');
  return tx(ctx, async (q) => {
    const st = await station(q, user, sid), date = ctx.clock.today(st.timezone);
    const id = (await q.insertInto('customers').values({ station_id: sid, name: V.str(b.name, 'name', { max: 120 }), phone: V.str(b.phone, 'phone', { max: 40, optional: true }) || null,
      credit_limit: limit, terms_days: terms, opening_balance: opening, created_on: date, ref: null }).returning('id').executeTakeFirstOrThrow()).id;
    if (opening) await post(ctx, q, { org_id: user.org_id, station_id: sid, date, source: 'customer_opening', source_id: id, user_id: user.id, memo: 'Customer opening balance',
      lines: [{ a: 'ar', dr: Math.max(opening, 0), cr: Math.max(-opening, 0), party_type: 'customer', party_id: id }, { a: 'capital', dr: Math.max(-opening, 0), cr: Math.max(opening, 0) }] });
    await audit(ctx, q, user, sid, 'customer.create', 'customer', id, { opening_balance: opening, credit_limit: limit }); return { id };
  });
}
export async function listPumps(ctx: Ctx, user: User, sid: number) {
  await station(ctx.db, user, sid);
  return ctx.db.selectFrom('pumps as p').innerJoin('fuels as f', 'f.id', 'p.fuel_id').selectAll('p').select(['f.name as fuel_name', 'f.price_e4'])
    .where('p.station_id', '=', sid).where('p.active', '=', 1).orderBy('p.id').execute();
}
export async function listTanks(ctx: Ctx, user: User, sid: number) {
  await station(ctx.db, user, sid);
  return ctx.db.selectFrom('tanks as t').innerJoin('fuels as f', 'f.id', 't.fuel_id').selectAll('t').select('f.name as fuel_name')
    .where('t.station_id', '=', sid).where('t.active', '=', 1).orderBy('t.id').execute();
}
export async function listCustomers(ctx: Ctx, user: User, sid: number) {
  await station(ctx.db, user, sid);
  return ctx.db.selectFrom('customers').select(['id', 'name', 'phone', 'credit_limit', 'terms_days']).where('station_id', '=', sid).where('active', '=', 1).orderBy('name').execute();
}
export async function getStation(ctx: Ctx, user: User, sid: number) { return station(ctx.db, user, sid); }

/** First start of an empty database (any edition): one organisation, one station, one fuel, one tank, N pumps. */
export async function firstRun(ctx: Ctx, b: Record<string, unknown>) {
  V.obj(b, 'body');
  if (await ctx.db.selectFrom('orgs').select('id').limit(1).executeTakeFirst()) throw bad('ALREADY_SET_UP', 'This database already has an organisation');
  const r = await createOrg(ctx, {
    org_name: V.str(b.station_name, 'station_name', { max: 120 }), name: V.str(b.owner_name || 'Owner', 'owner_name', { max: 120 }),
    email: V.str(b.email || 'owner@local', 'email', { max: 254 }), currency: V.str(b.currency || 'YER', 'currency'), timezone: V.str(b.timezone || 'Asia/Aden', 'timezone')
  });
  const u: User = { id: r.user_id, org_id: r.org_id, role: 'owner' }, sid = r.station_id;
  if (b.require_shift !== undefined) await updateStation(ctx, u, sid, { require_shift: b.require_shift });
  const f = await createFuel(ctx, u, sid, { name: b.fuel_name || 'بنزين', price_e4: b.price_e4, cost_e4: b.cost_e4 ?? 0 });
  const t = await createTank(ctx, u, sid, { name: 'خزان 1', fuel_id: f.id, capacity_ml: b.capacity_ml, level_ml: b.level_ml ?? 0 });
  const pumps = V.int(b.pumps ?? 2, 'pumps', { min: 1, max: 20 });
  for (let i = 1; i <= pumps; i++) await createPump(ctx, u, sid, { name: 'مضخة ' + i, tank_id: t.id });
  return { ...r };
}
/** The edition's single local user (desktop/phone) or the server's first owner. */
export async function firstOwner(ctx: Ctx): Promise<(User & { station_id: number }) | null> {
  const u = await ctx.db.selectFrom('users').select(['id', 'org_id', 'role']).where('role', '=', 'owner').orderBy('id').limit(1).executeTakeFirst();
  if (!u) return null;
  const s = await ctx.db.selectFrom('stations').select('id').where('org_id', '=', u.org_id).orderBy('id').limit(1).executeTakeFirstOrThrow();
  return { ...u, station_id: s.id };
}
