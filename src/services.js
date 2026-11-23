'use strict';
const { tx } = require('./db');
const { amountMinor, vatSplit, divRound, currencyDecimals } = require('./money');
const { bad, conflict, notFound, forbidden, HttpError } = require('./errors');
const V = require('./validate');
const auth = require('./auth');
const TOTP = require('./totp');
const L = require('./ledger');

const MAX_SALE_ML = 5_000_000;            // 5,000 L in one transaction is treated as a data-entry error
const MAX_DELIVERY_ML = 100_000_000;      // 100,000 L
const MAX_BACKDATE_DAYS = 400;

/* ---------- helpers ---------- */
function tzToday(tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}
function addDays(d, n) { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
function validTz(tz) { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }

function audit(db, user, stationId, action, entity, entityId, detail) {
  db.prepare('INSERT INTO audit(org_id,station_id,user_id,action,entity,entity_id,detail) VALUES(?,?,?,?,?,?,?)')
    .run(user.org_id, stationId || null, user.id, action, entity || null, entityId || null, detail ? JSON.stringify(detail) : null);
}
function need(user, perm) { if (!auth.can(user.role, perm)) throw forbidden(); }

function station(db, user, sid) {
  const s = db.prepare('SELECT * FROM stations WHERE id=? AND org_id=?').get(sid, user.org_id);
  if (!s) throw notFound('Station');
  if (!auth.ORG_WIDE.has(user.role) && !db.prepare('SELECT 1 FROM user_stations WHERE user_id=? AND station_id=?').get(user.id, sid)) throw notFound('Station');
  return s;
}
function resolveDate(st, user, input) {
  const today = tzToday(st.timezone);
  const d = V.date(input, 'date', { optional: true }) || today;
  if (d > today) throw bad('FUTURE_DATE', 'The date cannot be in the future');
  if (d < addDays(today, -MAX_BACKDATE_DAYS)) throw bad('DATE_TOO_OLD', 'The date is too far in the past');
  if (d !== today) need(user, 'sale.backdate');
  return d;
}
function scoped(db, table, id, sid, what) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id=? AND station_id=?`).get(id, sid);
  if (!row) throw notFound(what || table);
  return row;
}
/* A customer's balance is what the ledger says: every posted line on receivables that names this customer
   (sales, payments, openings, vouchers, imported history, reversals). Positive = the customer owes us. */
function customerBalance(db, cid, asOf) {
  return db.prepare(`SELECT COALESCE(SUM(l.debit-l.credit),0) v FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id
    WHERE l.party_type='customer' AND l.party_id=? AND a.sys='ar' AND j.status='posted' AND j.business_date<=?`).get(cid, asOf || '9999-12-31').v;
}
/* the station's open shift, if any; SHIFT_REQUIRED when the station requires one for this action */
function openShift(db, st, required) {
  const sh = db.prepare("SELECT * FROM shifts WHERE station_id=? AND status='open'").get(st.id);
  if (!sh && required && st.require_shift) throw conflict('SHIFT_REQUIRED', 'Open a shift before recording this operation');
  return sh || null;
}
function pageArgs(q) {
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 100, 1), 200);
  const before = parseInt(q.before_id, 10) || Number.MAX_SAFE_INTEGER;
  return { limit, before };
}

/* ---------- organisation / auth ---------- */
function registerOrg(db, input, ip) {
  const b = V.obj(input, 'body');
  const orgName = V.str(b.org_name, 'org_name', { max: 120 });
  const name = V.str(b.name, 'name', { max: 120 });
  const email = V.email(b.email);
  auth.checkPasswordPolicy(b.password);
  const st = V.obj(b.station || {}, 'station');
  const stName = V.str(st.name || orgName, 'station.name', { max: 120 });
  const currency = V.str(st.currency, 'station.currency', { min: 3, max: 3 }).toUpperCase();
  const dec = currencyDecimals(currency);
  if (dec === null) throw bad('VALIDATION', 'Unknown currency code');
  const timezone = V.str(st.timezone || 'UTC', 'station.timezone', { max: 60 });
  if (!validTz(timezone)) throw bad('VALIDATION', 'Unknown time zone');
  const pwHash = auth.hashPassword(b.password);
  return tx(db, () => {
    if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw conflict('EMAIL_TAKEN', 'This email is already registered');
    const org = db.prepare('INSERT INTO orgs(name) VALUES(?)').run(orgName).lastInsertRowid;
    const uid = db.prepare('INSERT INTO users(org_id,email,name,pw_hash,role) VALUES(?,?,?,?,\'owner\')').run(org, email, name, pwHash).lastInsertRowid;
    const sid = db.prepare('INSERT INTO stations(org_id,name,currency,cur_dec,timezone) VALUES(?,?,?,?,?)').run(org, stName, currency, dec, timezone).lastInsertRowid;
    const user = { id: Number(uid), org_id: Number(org), role: 'owner' };
    L.ensureChart(db, Number(org));
    audit(db, user, Number(sid), 'org.register', 'org', Number(org));
    return { user_id: Number(uid), org_id: Number(org), station_id: Number(sid) };
  });
}

function login(db, input, ip) {
  const b = V.obj(input, 'body');
  const email = V.email(b.email);
  auth.assertNotLocked(ip, email);
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  const ok = auth.verifyPassword(String(b.password || ''), u ? u.pw_hash : auth.DUMMY);   // constant-ish time
  if (!u || !ok || !u.active) { auth.recordFail(ip, email); throw new HttpError(401, 'BAD_CREDENTIALS', 'Email or password is incorrect'); }
  if (u.totp_enabled) {
    auth.assertTfNotLocked(u.id);
    if (b.code == null || String(b.code).trim() === '') throw new HttpError(401, 'TOTP_REQUIRED', 'Enter the code from your authenticator app');
    const used = secondFactor(db, u, b.code);
    if (!used) { auth.recordFail(ip, email); auth.recordTfFail(u.id); throw new HttpError(401, 'BAD_TOTP', 'The verification code is incorrect'); }
    auth.clearTfFails(u.id);
    if (used === 'recovery') audit(db, { id: u.id, org_id: u.org_id }, null, 'user.2fa.recovery_used', 'user', u.id);
  }
  auth.clearFails(ip, email);
  return { token: auth.createSession(db, u.id, ip), user: { id: u.id, name: u.name, email: u.email, role: u.role } };
}

/* ---------- users (owner) ---------- */
function listUsers(db, user) {
  need(user, 'users.manage');
  const rows = db.prepare('SELECT id,name,email,role,active,totp_enabled,created_at FROM users WHERE org_id=? ORDER BY id').all(user.org_id);
  const st = db.prepare('SELECT station_id FROM user_stations WHERE user_id=?');
  return rows.map(r => ({ ...r, station_ids: st.all(r.id).map(x => x.station_id) }));
}
const ASSIGNABLE = ['admin', 'manager', 'accountant', 'supervisor', 'cashier', 'viewer'];
function stationIds(db, user, v, role) {
  if (auth.ORG_WIDE.has(role)) return [];
  if (!Array.isArray(v) || !v.length) throw bad('VALIDATION', 'Choose at least one station for this user');
  const ids = [...new Set(v.map(x => V.int(x, 'station_ids', { min: 1 })))];
  for (const id of ids) if (!db.prepare('SELECT 1 FROM stations WHERE id=? AND org_id=?').get(id, user.org_id)) throw notFound('Station');
  return ids;
}
function setStations(db, uid, ids) {
  db.prepare('DELETE FROM user_stations WHERE user_id=?').run(uid);
  const ins = db.prepare('INSERT INTO user_stations(user_id,station_id) VALUES(?,?)'); for (const s of ids) ins.run(uid, s);
}
function createUser(db, user, b) {
  need(user, 'users.manage'); V.obj(b, 'body');
  const email = V.email(b.email), name = V.str(b.name, 'name'), role = V.oneOf(b.role, 'role', ASSIGNABLE);
  if (role === 'admin' && user.role !== 'owner') throw forbidden('Only the owner can create administrators');
  const sids = stationIds(db, user, b.station_ids, role);
  auth.checkPasswordPolicy(b.password);
  const h = auth.hashPassword(b.password);
  return tx(db, () => {
    if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw conflict('EMAIL_TAKEN', 'This email is already registered');
    const id = Number(db.prepare('INSERT INTO users(org_id,email,name,pw_hash,role) VALUES(?,?,?,?,?)').run(user.org_id, email, name, h, role).lastInsertRowid);
    setStations(db, id, sids);
    audit(db, user, null, 'user.create', 'user', id, { role, station_ids: sids });
    return { id, email, name, role, station_ids: sids };
  });
}
function updateUser(db, user, id, b) {
  need(user, 'users.manage'); V.obj(b, 'body');
  const t = db.prepare('SELECT * FROM users WHERE id=? AND org_id=?').get(id, user.org_id);
  if (!t) throw notFound('User');
  if (t.role === 'owner') throw forbidden('The owner account cannot be changed here');
  if (t.role === 'admin' && user.role !== 'owner') throw forbidden('Only the owner can change administrators');
  if (t.id === user.id) throw forbidden('You cannot change your own role or access');
  return tx(db, () => {
    const role = b.role === undefined ? t.role : V.oneOf(b.role, 'role', ASSIGNABLE);
    if (role === 'admin' && user.role !== 'owner') throw forbidden('Only the owner can create administrators');
    if (b.role !== undefined) db.prepare('UPDATE users SET role=? WHERE id=?').run(role, id);
    if (b.station_ids !== undefined || (b.role !== undefined && auth.ORG_WIDE.has(role))) setStations(db, id, stationIds(db, user, b.station_ids, role));
    else if (b.role !== undefined && !auth.ORG_WIDE.has(role) && !db.prepare('SELECT 1 FROM user_stations WHERE user_id=?').get(id)) throw bad('VALIDATION', 'Choose at least one station for this user');
    if (b.role !== undefined || b.station_ids !== undefined) auth.destroyUserSessions(db, id);   // new rights take effect at next sign-in
    if (b.name !== undefined) db.prepare('UPDATE users SET name=? WHERE id=?').run(V.str(b.name, 'name', { min: 1, max: 80 }), id);
    if (b.email !== undefined) { const em = V.email(b.email, 'email');
      if (db.prepare('SELECT 1 FROM users WHERE email=? AND id<>?').get(em, id)) throw conflict('EMAIL_TAKEN', 'This e-mail is already used');
      db.prepare('UPDATE users SET email=? WHERE id=?').run(em, id); }
    if (b.active !== undefined) {
      if (V.bool(b.active) && /@old-system.invalid$/i.test(db.prepare('SELECT email FROM users WHERE id=?').get(id).email)) throw bad('EMAIL_REQUIRED', 'Give this user a real e-mail and a password before activating');
      db.prepare('UPDATE users SET active=? WHERE id=?').run(V.bool(b.active) ? 1 : 0, id); if (!V.bool(b.active)) auth.destroyUserSessions(db, id); }
    if (b.reset_2fa === true) { db.prepare('UPDATE users SET totp_enabled=0, totp_secret=NULL, totp_last_step=0 WHERE id=?').run(id); db.prepare('DELETE FROM recovery_codes WHERE user_id=?').run(id); auth.destroyUserSessions(db, id); }
    if (b.password !== undefined) { auth.checkPasswordPolicy(b.password); db.prepare('UPDATE users SET pw_hash=? WHERE id=?').run(auth.hashPassword(b.password), id); auth.destroyUserSessions(db, id); }
    audit(db, user, null, 'user.update', 'user', id, { fields: Object.keys(b).filter(k => k !== 'password'), role });
    return { ok: true };
  });
}

/* ---------- stations & configuration ---------- */
function listStations(db, user) {
  if (auth.ORG_WIDE.has(user.role)) return db.prepare('SELECT * FROM stations WHERE org_id=? ORDER BY id').all(user.org_id);
  return db.prepare('SELECT s.* FROM stations s JOIN user_stations us ON us.station_id=s.id WHERE s.org_id=? AND us.user_id=? ORDER BY s.id').all(user.org_id, user.id);
}
function createStation(db, user, b) {
  need(user, 'users.manage'); V.obj(b, 'body');
  const currency = V.str(b.currency, 'currency', { min: 3, max: 3 }).toUpperCase(), dec = currencyDecimals(currency);
  if (dec === null) throw bad('VALIDATION', 'Unknown currency code');
  const tz = V.str(b.timezone || 'UTC', 'timezone'); if (!validTz(tz)) throw bad('VALIDATION', 'Unknown time zone');
  return tx(db, () => {
    const id = Number(db.prepare('INSERT INTO stations(org_id,name,currency,cur_dec,timezone) VALUES(?,?,?,?,?)').run(user.org_id, V.str(b.name, 'name'), currency, dec, tz).lastInsertRowid);
    audit(db, user, id, 'station.create', 'station', id); return { id };
  });
}
function updateStation(db, user, sid, b) {
  need(user, 'users.manage'); V.obj(b, 'body');
  const st = station(db, user, sid);
  return tx(db, () => {
    const vatBp = b.vat_bp === undefined ? st.vat_bp : V.int(b.vat_bp, 'vat_bp', { min: 0, max: 10000 });
    const vatInc = b.vat_included === undefined ? st.vat_included : (V.bool(b.vat_included) ? 1 : 0);
    const neg = b.allow_negative === undefined ? st.allow_negative : (V.bool(b.allow_negative) ? 1 : 0);
    const reqShift = b.require_shift === undefined ? st.require_shift : (V.bool(b.require_shift) ? 1 : 0);
    const tz = b.timezone === undefined ? st.timezone : V.str(b.timezone, 'timezone');
    if (!validTz(tz)) throw bad('VALIDATION', 'Unknown time zone');
    const name = b.name === undefined ? st.name : V.str(b.name, 'name');
    const tol = b.loss_tolerance_bp === undefined ? st.loss_tolerance_bp : V.int(b.loss_tolerance_bp, 'loss_tolerance_bp', { min: 0, max: 2000 });
    db.prepare('UPDATE stations SET name=?,vat_bp=?,vat_included=?,allow_negative=?,timezone=?,require_shift=?,loss_tolerance_bp=? WHERE id=?').run(name, vatBp, vatInc, neg, tz, reqShift, tol, sid);
    audit(db, user, sid, 'station.update', 'station', sid, { from: { vat_bp: st.vat_bp, vat_included: st.vat_included, allow_negative: st.allow_negative, timezone: st.timezone }, to: { vat_bp: vatBp, vat_included: vatInc, allow_negative: neg, timezone: tz } });
    return { ok: true };
  });
}
function listFuels(db, user, sid) { station(db, user, sid); return db.prepare('SELECT * FROM fuels WHERE station_id=? AND active=1 ORDER BY id').all(sid); }
function createFuel(db, user, sid, b) {
  need(user, 'config.edit'); station(db, user, sid); V.obj(b, 'body');
  return tx(db, () => {
    const id = Number(db.prepare('INSERT INTO fuels(station_id,name,price_e4,cost_e4) VALUES(?,?,?,?)').run(sid, V.str(b.name, 'name', { max: 60 }), V.int(b.price_e4 ?? 0, 'price_e4', { min: 0, max: 10 ** 12 }), V.int(b.cost_e4 ?? 0, 'cost_e4', { min: 0, max: 10 ** 12 })).lastInsertRowid);
    audit(db, user, sid, 'fuel.create', 'fuel', id); return { id };
  });
}
function updateFuelPrice(db, user, sid, fid, b) {
  need(user, 'price.edit'); station(db, user, sid); V.obj(b, 'body');
  const f = scoped(db, 'fuels', fid, sid, 'Fuel');
  return tx(db, () => {
    const p = b.price_e4 === undefined ? f.price_e4 : V.int(b.price_e4, 'price_e4', { min: 1, max: 10 ** 12 });
    const c = b.cost_e4 === undefined ? f.cost_e4 : V.int(b.cost_e4, 'cost_e4', { min: 0, max: 10 ** 12 });
    db.prepare('UPDATE fuels SET price_e4=?,cost_e4=? WHERE id=?').run(p, c, fid);
    if (p !== f.price_e4) db.prepare("INSERT INTO price_history(station_id,fuel_id,effective_at,price_e4,cost_e4,old_price_e4,user_id,note) VALUES(?,?,datetime('now'),?,?,?,?,?)")
      .run(sid, fid, p, c, f.price_e4, user.id, V.str(b.note, 'note', { max: 200, optional: true }) || null);
    audit(db, user, sid, 'fuel.price', 'fuel', fid, { price_e4: [f.price_e4, p], cost_e4: [f.cost_e4, c] });
    return { ok: true };
  });
}
function listTanks(db, user, sid) { station(db, user, sid); return db.prepare('SELECT t.*, f.name fuel_name FROM tanks t JOIN fuels f ON f.id=t.fuel_id WHERE t.station_id=? AND t.active=1 ORDER BY t.id').all(sid); }
function createTank(db, user, sid, b) {
  need(user, 'config.edit'); station(db, user, sid); V.obj(b, 'body');
  const fuel = scoped(db, 'fuels', V.int(b.fuel_id, 'fuel_id', { min: 1 }), sid, 'Fuel');
  const cap = V.int(b.capacity_ml, 'capacity_ml', { min: 1, max: 10 ** 9 }), lvl = V.int(b.level_ml ?? 0, 'level_ml', { min: 0, max: cap });
  const minMl = V.int(b.min_ml ?? 0, 'min_ml', { min: 0, max: cap });
  const cost = V.int(b.cost_e4 ?? fuel.cost_e4, 'cost_e4', { min: 0, max: 10 ** 12 });   // unit cost of the opening stock
  const st = station(db, user, sid), date = tzToday(st.timezone);
  return tx(db, () => {
    const id = Number(db.prepare('INSERT INTO tanks(station_id,name,fuel_id,capacity_ml,level_ml,min_ml) VALUES(?,?,?,?,0,?)').run(sid, V.str(b.name, 'name', { max: 60 }), fuel.id, cap, minMl).lastInsertRowid);
    if (lvl > 0) {
      const value = L.stockMove(db, id, { qty: lvl, value: L.atCost(lvl, cost), kind: 'opening', ref_type: 'tank', ref_id: id, date, user_id: user.id });
      L.post(db, { org_id: user.org_id, station_id: sid, date, source: 'tank_opening', source_id: id, user_id: user.id, memo: 'Opening stock', lines: [{ a: 'inventory', dr: value }, { a: 'capital', cr: value }] });
    }
    audit(db, user, sid, 'tank.create', 'tank', id, { capacity_ml: cap, level_ml: lvl }); return { id };
  });
}
function listPumps(db, user, sid) { station(db, user, sid); return db.prepare('SELECT p.*, f.name fuel_name FROM pumps p JOIN fuels f ON f.id=p.fuel_id WHERE p.station_id=? AND p.active=1 ORDER BY p.id').all(sid); }
function createPump(db, user, sid, b) {
  need(user, 'config.edit'); station(db, user, sid); V.obj(b, 'body');
  const tank = scoped(db, 'tanks', V.int(b.tank_id, 'tank_id', { min: 1 }), sid, 'Tank');
  const meter = V.int(b.meter_ml ?? 0, 'meter_ml', { min: 0, max: 10 ** 13 });
  return tx(db, () => {
    const id = Number(db.prepare('INSERT INTO pumps(station_id,name,tank_id,fuel_id,meter_ml) VALUES(?,?,?,?,?)').run(sid, V.str(b.name, 'name', { max: 60 }), tank.id, tank.fuel_id, meter).lastInsertRowid);
    audit(db, user, sid, 'pump.create', 'pump', id, { meter_ml: meter }); return { id };
  });
}
function correctMeter(db, user, sid, pid, b) {
  need(user, 'config.edit'); station(db, user, sid); V.obj(b, 'body');
  const p = scoped(db, 'pumps', pid, sid, 'Pump');
  const m = V.int(b.meter_ml, 'meter_ml', { min: 0, max: 10 ** 13 }), note = V.str(b.note, 'note', { min: 3, max: 200 });
  return tx(db, () => {
    db.prepare('UPDATE pumps SET meter_ml=? WHERE id=?').run(m, pid);
    audit(db, user, sid, 'pump.meter', 'pump', pid, { from: p.meter_ml, to: m, note }); return { ok: true };
  });
}
function listCustomers(db, user, sid) {
  station(db, user, sid);
  return db.prepare('SELECT id,name,phone,credit_limit,terms_days,opening_balance,ref FROM customers WHERE station_id=? AND active=1 ORDER BY name').all(sid).map(c => ({ ...c, balance: customerBalance(db, c.id) }));
}
function createCustomer(db, user, sid, b) {
  need(user, 'customer.create'); const st = station(db, user, sid); V.obj(b, 'body');
  const opening = V.int(b.opening_balance ?? 0, 'opening_balance', { min: -(10 ** 13), max: 10 ** 13 });
  if (opening && !auth.can(user.role, 'customer.edit')) throw forbidden('Only a manager or accountant can enter an opening balance');
  const limit = V.int(b.credit_limit ?? 0, 'credit_limit', { min: 0, max: 10 ** 13 }), terms = V.int(b.terms_days ?? 30, 'terms_days', { min: 0, max: 365 });
  if (limit && !auth.can(user.role, 'customer.edit')) throw forbidden('Only a manager or accountant can set a credit limit');
  const date = tzToday(st.timezone);
  return tx(db, () => {
    const id = Number(db.prepare('INSERT INTO customers(station_id,name,phone,credit_limit,terms_days,opening_balance,created_on) VALUES(?,?,?,?,?,?,?)')
      .run(sid, V.str(b.name, 'name', { max: 120 }), V.str(b.phone, 'phone', { max: 40, optional: true }) || null, limit, terms, opening, date).lastInsertRowid);
    if (opening) L.post(db, { org_id: user.org_id, station_id: sid, date, source: 'customer_opening', source_id: id, user_id: user.id, memo: 'Customer opening balance',
      lines: [{ a: 'ar', dr: Math.max(opening, 0), cr: Math.max(-opening, 0), party_type: 'customer', party_id: id }, { a: 'capital', dr: Math.max(-opening, 0), cr: Math.max(opening, 0) }] });
    audit(db, user, sid, 'customer.create', 'customer', id, { opening_balance: opening, credit_limit: limit }); return { id };
  });
}

/* ---------- sales ---------- */
function createSale(db, user, sid, b) {
  need(user, 'sale.create'); V.obj(b, 'body');
  const st = station(db, user, sid);
  const clientId = V.str(b.client_id, 'client_id', { min: 8, max: 64 });
  const payType = V.oneOf(b.pay_type || 'cash', 'pay_type', ['cash', 'credit']);
  const date = resolveDate(st, user, b.date);
  const pumpId = V.int(b.pump_id, 'pump_id', { min: 1 });
  const closeMl = V.int(b.close_ml, 'close_ml', { min: 1, optional: true });
  const qtyIn = V.int(b.quantity_ml, 'quantity_ml', { min: 1, max: MAX_SALE_ML, optional: true });
  const expOpen = V.int(b.expected_open_ml, 'expected_open_ml', { min: 0, optional: true });
  if ((closeMl === undefined) === (qtyIn === undefined)) throw bad('VALIDATION', 'Send exactly one of close_ml or quantity_ml');
  const custIn = V.int(b.customer_id, 'customer_id', { min: 1, optional: true });

  return tx(db, () => {
    const dup = db.prepare('SELECT * FROM sales WHERE station_id=? AND client_id=?').get(sid, clientId);
    if (dup) return { ...dup, duplicate: true };

    const pump = scoped(db, 'pumps', pumpId, sid, 'Pump');
    if (!pump.active) throw conflict('PUMP_INACTIVE', 'This pump is not active');
    const tank = db.prepare('SELECT * FROM tanks WHERE id=?').get(pump.tank_id);
    const fuel = db.prepare('SELECT * FROM fuels WHERE id=?').get(pump.fuel_id);
    if (!(fuel.price_e4 > 0)) throw new HttpError(422, 'PRICE_NOT_SET', 'Set the fuel price before recording sales');

    const open = pump.meter_ml;
    if (expOpen !== undefined && expOpen !== open) throw conflict('METER_MISMATCH', 'The pump meter changed since you opened the form', { current_meter_ml: open });
    let qty, close;
    if (closeMl !== undefined) {
      if (closeMl <= open) throw bad('METER_NOT_INCREASING', 'The current reading must be greater than the previous one', { current_meter_ml: open });
      qty = closeMl - open; close = closeMl;
    } else { qty = qtyIn; close = open + qty; }
    if (qty > MAX_SALE_ML) throw bad('QUANTITY_TOO_LARGE', 'Quantity is unusually large. Check the meter reading.');

    if (qty > tank.level_ml && !st.allow_negative) throw conflict('INSUFFICIENT_STOCK', 'Quantity exceeds the tank stock', { available_ml: tank.level_ml });
    L.assertOpen(db, user.org_id, date);
    const shift = openShift(db, st, true);

    const amount = amountMinor(qty, fuel.price_e4);
    const { net, vat, gross } = vatSplit(amount, st.vat_bp, !!st.vat_included);
    let custId = null;
    if (payType === 'credit') {
      if (custIn === undefined) throw bad('VALIDATION', 'customer_id is required for credit sales');
      const c = scoped(db, 'customers', custIn, sid, 'Customer');
      if (!c.active) throw conflict('CUSTOMER_INACTIVE', 'This customer is not active');
      if (c.credit_limit > 0) { const bal = customerBalance(db, c.id); if (bal + gross > c.credit_limit) throw conflict('CREDIT_LIMIT', 'This sale exceeds the customer credit limit', { balance: bal, credit_limit: c.credit_limit, sale: gross }); }
      custId = c.id;
    }
    const id = Number(db.prepare(`INSERT INTO sales(station_id,client_id,pump_id,fuel_id,tank_id,business_date,quantity_ml,price_e4,cost_e4,net,vat,gross,vat_bp,vat_included,pay_type,customer_id,open_ml,close_ml,user_id,shift_id,cogs)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`).run(sid, clientId, pump.id, fuel.id, tank.id, date, qty, fuel.price_e4, tank.avg_cost_e4, net, vat, gross, st.vat_bp, st.vat_included, payType, custId, open, close, user.id, shift ? shift.id : null).lastInsertRowid);
    db.prepare('UPDATE pumps SET meter_ml=? WHERE id=?').run(close, pump.id);
    const cogs = -L.stockMove(db, tank.id, { qty: -Math.min(qty, tank.level_ml), kind: 'sale', ref_type: 'sale', ref_id: id, date, user_id: user.id });
    db.prepare('UPDATE sales SET cogs=? WHERE id=?').run(cogs, id);
    L.post(db, { org_id: user.org_id, station_id: sid, date, source: 'sale', source_id: id, user_id: user.id, lines: [
      { a: payType === 'cash' ? 'cash' : 'ar', dr: gross, party_type: custId ? 'customer' : null, party_id: custId },
      { a: 'sales', cr: net }, { a: 'vat_out', cr: vat }, { a: 'cogs', dr: cogs }, { a: 'inventory', cr: cogs }] });
    audit(db, user, sid, 'sale.create', 'sale', id, { qty_ml: qty, gross, pay_type: payType });
    return db.prepare('SELECT * FROM sales WHERE id=?').get(id);
  });
}
const SOURCE = { sales: 'sale', deliveries: 'delivery', expenses: 'expense', payments: 'payment', supplier_payments: 'supplier_payment', cash_moves: 'cash_move' };
function voidRow(db, user, sid, table, id, reason, perm, undo, { expectJournal = () => true } = {}) {
  need(user, perm); station(db, user, sid);
  const r = V.str(reason, 'reason', { min: 3, max: 200 });
  return tx(db, () => {
    const row = scoped(db, table, id, sid, table);
    if (row.voided_at) throw conflict('ALREADY_VOIDED', 'This record is already voided');
    if (row.shift_id) { const sh = db.prepare('SELECT status FROM shifts WHERE id=?').get(row.shift_id); if (sh.status !== 'open') throw conflict('SHIFT_CLOSED', 'This record belongs to a closed shift and cannot be changed'); }
    L.assertOpen(db, user.org_id, row.business_date);
    const n = L.reverseSource(db, user.org_id, SOURCE[table], id, user.id, 'Void: ' + r);
    if (n === 0 && expectJournal(row)) throw conflict('LEGACY_DOCUMENT', 'This record predates the general ledger; correct it with a manual journal');
    undo && undo(row);
    db.prepare(`UPDATE ${table} SET voided_at=datetime('now'), void_reason=?, void_by=? WHERE id=?`).run(r, user.id, id);
    audit(db, user, sid, `${table}.void`, table, id, { reason: r });
    return { ok: true };
  });
}
function voidSale(db, user, sid, id, reason) {
  return voidRow(db, user, sid, 'sales', id, reason, 'sale.void', (s) => {
    const t = db.prepare('SELECT * FROM tanks WHERE id=?').get(s.tank_id);
    const back = Math.min(s.quantity_ml, t.capacity_ml - t.level_ml), value = back === s.quantity_ml ? s.cogs : Number(divRound(BigInt(s.cogs) * BigInt(back), BigInt(s.quantity_ml)));
    const moved = back > 0 ? L.stockMove(db, t.id, { qty: back, value, kind: 'void', ref_type: 'sale', ref_id: s.id, date: s.business_date, user_id: user.id }) : 0;
    L.post(db, { org_id: user.org_id, station_id: sid, date: s.business_date, source: 'stock_fix', source_id: s.id, user_id: user.id, memo: 'Stock value correction on sale void', lines: L.inventoryFix(s.cogs, moved) });
    const p = db.prepare('SELECT * FROM pumps WHERE id=?').get(s.pump_id);
    if (p.meter_ml === s.close_ml) db.prepare('UPDATE pumps SET meter_ml=? WHERE id=?').run(s.open_ml, p.id);   // only if no later sale on this pump
  }, { expectJournal: (s) => s.cogs !== null });
}
function listSales(db, user, sid, q) {
  station(db, user, sid);
  const date = V.date(q.date, 'date', { optional: true }), { limit, before } = pageArgs(q);
  return db.prepare(`SELECT s.*, p.name pump_name, f.name fuel_name, c.name customer_name FROM sales s
    JOIN pumps p ON p.id=s.pump_id JOIN fuels f ON f.id=s.fuel_id LEFT JOIN customers c ON c.id=s.customer_id
    WHERE s.station_id=? AND (? IS NULL OR s.business_date=?) AND s.id<? ORDER BY s.id DESC LIMIT ?`).all(sid, date || null, date || null, before, limit);
}

/* ---------- deliveries / stock count ---------- */
function createDelivery(db, user, sid, b) {
  need(user, 'delivery.create'); const st = station(db, user, sid); V.obj(b, 'body');
  const date = V.date(b.date, 'date', { optional: true }) || tzToday(st.timezone);
  if (date > tzToday(st.timezone)) throw bad('FUTURE_DATE', 'The date cannot be in the future');
  const qty = V.int(b.quantity_ml, 'quantity_ml', { min: 1, max: MAX_DELIVERY_ML });
  const cost = V.int(b.cost_e4, 'cost_e4', { min: 0, max: 10 ** 12 });
  const net = amountMinor(qty, cost);
  const vat = b.vat === undefined ? Number(divRound(BigInt(net) * BigInt(st.vat_bp), 10000n)) : V.int(b.vat, 'vat', { min: 0, max: net * 2 + 1 });
  const payType = V.oneOf(b.pay_type || 'cash', 'pay_type', ['cash', 'bank', 'credit']);
  const supIn = V.int(b.supplier_id, 'supplier_id', { min: 1, optional: true });
  if (payType === 'credit' && !supIn) throw bad('VALIDATION', 'Choose the supplier for a credit purchase');
  return tx(db, () => {
    L.assertOpen(db, user.org_id, date);
    const tank = scoped(db, 'tanks', V.int(b.tank_id, 'tank_id', { min: 1 }), sid, 'Tank');
    if (tank.level_ml + qty > tank.capacity_ml) throw conflict('EXCEEDS_CAPACITY', 'The delivery exceeds the tank capacity', { free_ml: tank.capacity_ml - tank.level_ml });
    const sup = supIn ? scoped(db, 'suppliers', supIn, sid, 'Supplier') : null;
    const shift = payType === 'cash' ? openShift(db, st, false) : null;
    const due = payType === 'credit' ? addDays(date, sup.terms_days) : null;
    const ref = V.str(b.ref, 'ref', { max: 30, optional: true }) || String(1 + (db.prepare("SELECT MAX(CAST(ref AS INTEGER)) m FROM deliveries WHERE station_id=? AND ref GLOB '[0-9]*'").get(sid).m || 0));
    const id = Number(db.prepare('INSERT INTO deliveries(station_id,tank_id,fuel_id,business_date,quantity_ml,cost_e4,net,vat,supplier,supplier_id,pay_type,due_date,shift_id,user_id,ref,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(sid, tank.id, tank.fuel_id, date, qty, cost, net, vat, sup ? sup.name : (V.str(b.supplier, 'supplier', { max: 120, optional: true }) || null), sup ? sup.id : null, payType, due, shift ? shift.id : null, user.id,
        ref, V.str(b.note, 'note', { max: 300, optional: true }) || null).lastInsertRowid);
    const moved = L.stockMove(db, tank.id, { qty, value: net, kind: 'delivery', ref_type: 'delivery', ref_id: id, date, user_id: user.id });
    if (cost > 0) db.prepare('UPDATE fuels SET cost_e4=? WHERE id=?').run(cost, tank.fuel_id);    // last purchase cost (reference only; COGS uses the tank average)
    L.post(db, { org_id: user.org_id, station_id: sid, date, source: 'delivery', source_id: id, user_id: user.id, lines: [
      { a: 'inventory', dr: moved }, { a: 'vat_in', dr: vat },
      { a: payType === 'credit' ? 'ap' : payType, cr: net + vat, party_type: sup ? 'supplier' : null, party_id: sup ? sup.id : null }, ...L.inventoryFix(net, moved)] });
    db.prepare("UPDATE journals SET ref=? WHERE source='delivery' AND source_id=?").run(ref, id);
    audit(db, user, sid, 'delivery.create', 'delivery', id, { qty_ml: qty, net, vat, pay_type: payType });
    return db.prepare('SELECT * FROM deliveries WHERE id=?').get(id);
  });
}
function voidDelivery(db, user, sid, id, reason) {
  return voidRow(db, user, sid, 'deliveries', id, reason, 'delivery.void', (d) => {
    const t = db.prepare('SELECT * FROM tanks WHERE id=?').get(d.tank_id);
    if (t.level_ml < d.quantity_ml) throw conflict('STOCK_ALREADY_SOLD', 'Part of this delivery has already been sold. Use a stock count to correct the tank.');
    const moved = L.stockMove(db, t.id, { qty: -d.quantity_ml, value: -d.net, kind: 'void', ref_type: 'delivery', ref_id: d.id, date: d.business_date, user_id: user.id });
    L.post(db, { org_id: user.org_id, station_id: sid, date: d.business_date, source: 'stock_fix', source_id: d.id, user_id: user.id, memo: 'Stock value correction on delivery void', lines: L.inventoryFix(-d.net, moved) });
  }, { expectJournal: (d) => d.net + d.vat > 0 });
}
function listDeliveries(db, user, sid, q) {
  station(db, user, sid); const { limit, before } = pageArgs(q);
  return db.prepare('SELECT d.*, t.name tank_name FROM deliveries d JOIN tanks t ON t.id=d.tank_id WHERE d.station_id=? AND d.id<? ORDER BY d.id DESC LIMIT ?').all(sid, before, limit);
}
function createAdjustment(db, user, sid, b) {
  need(user, 'adjust.create'); const st = station(db, user, sid); V.obj(b, 'body');
  const note = V.str(b.note, 'note', { min: 3, max: 200 });
  return tx(db, () => {
    const tank = scoped(db, 'tanks', V.int(b.tank_id, 'tank_id', { min: 1 }), sid, 'Tank');
    const after = V.int(b.after_ml, 'after_ml', { min: 0, max: tank.capacity_ml }), date = tzToday(st.timezone);
    L.assertOpen(db, user.org_id, date);
    const id = Number(db.prepare('INSERT INTO adjustments(station_id,tank_id,business_date,before_ml,after_ml,note,user_id) VALUES(?,?,?,?,?,?,?)').run(sid, tank.id, date, tank.level_ml, after, note, user.id).lastInsertRowid);
    const diff = after - tank.level_ml;
    const moved = diff ? L.stockMove(db, tank.id, { qty: diff, kind: 'count', ref_type: 'adjustment', ref_id: id, date, user_id: user.id }) : 0;
    /* a shortage can be charged to the supplier who delivered short (as the old books did for gas) instead of the station's own loss */
    const sup = b.charge_supplier_id && moved < 0 ? scoped(db, 'suppliers', V.int(b.charge_supplier_id, 'charge_supplier_id', { min: 1 }), sid, 'Supplier') : null;
    L.post(db, { org_id: user.org_id, station_id: sid, date, source: 'stock_count', source_id: id, user_id: user.id, memo: note,
      lines: moved < 0 ? [sup ? { a: 'ap', dr: -moved, party_type: 'supplier', party_id: sup.id, memo: note } : { a: 'stock_loss', dr: -moved }, { a: 'inventory', cr: -moved }] : [{ a: 'inventory', dr: moved }, { a: 'other_income', cr: moved }] });
    audit(db, user, sid, 'tank.adjust', 'tank', tank.id, { before_ml: tank.level_ml, after_ml: after, value: moved, note });
    return { id, before_ml: tank.level_ml, after_ml: after, diff_ml: diff, value: moved };
  });
}

/* ---------- expenses & payments ---------- */
function createExpense(db, user, sid, b) {
  need(user, 'expense.create'); const st = station(db, user, sid); V.obj(b, 'body');
  const date = V.date(b.date, 'date', { optional: true }) || tzToday(st.timezone);
  if (date > tzToday(st.timezone)) throw bad('FUTURE_DATE', 'The date cannot be in the future');
  const gross = V.int(b.gross, 'gross', { min: 1, max: 10 ** 13 }), vat = V.int(b.vat ?? 0, 'vat', { min: 0, max: gross });
  const method = V.oneOf(b.method || 'cash', 'method', ['cash', 'bank']), cat = V.str(b.category, 'category', { max: 40 });
  return tx(db, () => {
    L.assertOpen(db, user.org_id, date);
    const shift = method === 'cash' ? openShift(db, st, true) : null;
    const id = Number(db.prepare('INSERT INTO expenses(station_id,business_date,category,gross,vat,note,user_id,method,shift_id) VALUES(?,?,?,?,?,?,?,?,?)').run(sid, date, cat, gross, vat, V.str(b.note, 'note', { max: 200, optional: true }) || null, user.id, method, shift ? shift.id : null).lastInsertRowid);
    L.post(db, { org_id: user.org_id, station_id: sid, date, source: 'expense', source_id: id, user_id: user.id, memo: cat,
      lines: [{ a: L.expenseKey(cat), dr: gross - vat }, { a: 'vat_in', dr: vat }, { a: method, cr: gross }] });
    audit(db, user, sid, 'expense.create', 'expense', id, { gross, vat, method }); return { id };
  });
}
function voidExpense(db, user, sid, id, reason) { return voidRow(db, user, sid, 'expenses', id, reason, 'expense.void'); }
function listExpenses(db, user, sid, q) {
  station(db, user, sid); const { limit, before } = pageArgs(q);
  const from = V.date(q.from, 'from', { optional: true }) || '0000-01-01', to = V.date(q.to, 'to', { optional: true }) || '9999-12-31';
  return db.prepare('SELECT * FROM expenses WHERE station_id=? AND business_date BETWEEN ? AND ? AND id<? ORDER BY business_date DESC, id DESC LIMIT ?').all(sid, from, to, before, limit);
}
function createPayment(db, user, sid, b) {
  need(user, 'payment.create'); const st = station(db, user, sid); V.obj(b, 'body');
  const amount = V.int(b.amount, 'amount', { min: 1, max: 10 ** 13 }), method = V.oneOf(b.method || 'cash', 'method', ['cash', 'bank']);
  const date = tzToday(st.timezone);
  return tx(db, () => {
    const c = scoped(db, 'customers', V.int(b.customer_id, 'customer_id', { min: 1 }), sid, 'Customer');
    const bal = customerBalance(db, c.id);
    if (amount > bal) throw conflict('OVERPAYMENT', 'The payment is larger than the customer balance', { balance: bal });
    const shift = method === 'cash' ? openShift(db, st, true) : null;
    const id = Number(db.prepare('INSERT INTO payments(station_id,customer_id,business_date,amount,note,user_id,method,shift_id) VALUES(?,?,?,?,?,?,?,?)').run(sid, c.id, date, amount, V.str(b.note, 'note', { max: 200, optional: true }) || null, user.id, method, shift ? shift.id : null).lastInsertRowid);
    L.post(db, { org_id: user.org_id, station_id: sid, date, source: 'payment', source_id: id, user_id: user.id,
      lines: [{ a: method, dr: amount }, { a: 'ar', cr: amount, party_type: 'customer', party_id: c.id }] });
    audit(db, user, sid, 'payment.create', 'payment', id, { customer_id: c.id, amount, method }); return { id, balance: bal - amount };
  });
}
function voidPayment(db, user, sid, id, reason) { return voidRow(db, user, sid, 'payments', id, reason, 'payment.void'); }

/* ---------- reports ---------- */
function dashboard(db, user, sid) {
  const st = station(db, user, sid), today = tzToday(st.timezone);
  const t = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(quantity_ml),0) qty, COALESCE(SUM(gross),0) gross,
      COALESCE(SUM(CASE WHEN pay_type='cash' THEN gross END),0) cash FROM sales WHERE station_id=? AND business_date=? AND voided_at IS NULL`).get(sid, today);
  const exp = db.prepare('SELECT COALESCE(SUM(gross),0) v FROM expenses WHERE station_id=? AND business_date=? AND voided_at IS NULL').get(sid, today).v;
  const from = addDays(today, -6);
  const days = db.prepare(`SELECT business_date d, SUM(gross) gross, SUM(quantity_ml) qty FROM sales WHERE station_id=? AND business_date>=? AND voided_at IS NULL GROUP BY business_date`).all(sid, from);
  const tanks = db.prepare('SELECT t.id,t.name,t.fuel_id,f.name fuel_name,t.capacity_ml,t.level_ml,t.min_ml FROM tanks t JOIN fuels f ON f.id=t.fuel_id WHERE t.station_id=? AND t.active=1').all(sid).map(k => {
    const sold = db.prepare('SELECT COALESCE(SUM(quantity_ml),0) v FROM sales WHERE tank_id=? AND business_date>=? AND voided_at IS NULL').get(k.id, from).v;
    const daily = sold / 7;
    return { ...k, pct: Math.round(k.level_ml * 1000 / k.capacity_ml) / 10, low: k.min_ml > 0 ? k.level_ml <= k.min_ml : k.level_ml < k.capacity_ml * 0.2, days_left: daily > 0 ? Math.round(k.level_ml / daily * 10) / 10 : null };
  });
  const receivables = db.prepare('SELECT id FROM customers WHERE station_id=?').all(sid).reduce((a, c) => a + Math.max(0, customerBalance(db, c.id)), 0);
  const series = []; for (let i = 6; i >= 0; i--) { const d = addDays(today, -i), r = days.find(x => x.d === d); series.push({ date: d, gross: r ? r.gross : 0, qty_ml: r ? r.qty : 0 }); }
  return { today, currency: st.currency, cur_dec: st.cur_dec, sales: t, expenses: exp, receivables, tanks, series };
}
function summary(db, user, sid, q) {
  need(user, 'report.read'); const st = station(db, user, sid);
  const from = V.date(q.from, 'from'), to = V.date(q.to, 'to');
  if (from > to) throw bad('VALIDATION', 'from must not be after to');
  if (addDays(from, 366) < to) throw bad('VALIDATION', 'The period cannot exceed one year');
  const rows = db.prepare(`SELECT s.business_date d, s.fuel_id, s.pump_id, s.quantity_ml, s.cost_e4, s.cogs, s.net, s.vat, s.gross, s.pay_type FROM sales s WHERE s.station_id=? AND s.business_date BETWEEN ? AND ? AND s.voided_at IS NULL`).all(sid, from, to);
  let noCost = 0; const tot = { qty_ml: 0, net: 0, vat: 0, gross: 0, cash: 0, credit: 0, cogs: 0 }, byFuel = {}, byPump = {}, byDay = {};
  for (const r of rows) {
    const cogs = r.cogs ?? amountMinor(r.quantity_ml, r.cost_e4); if (!cogs) noCost++;
    for (const o of [tot, byFuel[r.fuel_id] ||= { qty_ml: 0, net: 0, vat: 0, gross: 0, cogs: 0 }, byPump[r.pump_id] ||= { qty_ml: 0, gross: 0 }, byDay[r.d] ||= { qty_ml: 0, gross: 0 }]) {
      o.qty_ml += r.quantity_ml; o.gross += r.gross; if ('net' in o) { o.net += r.net; o.vat += r.vat; o.cogs += cogs; }
    }
    if (r.pay_type === 'cash') tot.cash += r.gross; else tot.credit += r.gross;
  }
  const ex = db.prepare('SELECT COALESCE(SUM(gross),0) g, COALESCE(SUM(vat),0) v FROM expenses WHERE station_id=? AND business_date BETWEEN ? AND ? AND voided_at IS NULL').get(sid, from, to);
  const dl = db.prepare('SELECT COALESCE(SUM(net),0) n, COALESCE(SUM(vat),0) v FROM deliveries WHERE station_id=? AND business_date BETWEEN ? AND ? AND voided_at IS NULL').get(sid, from, to);
  const margin = tot.net - tot.cogs, expNet = ex.g - ex.v;
  return {
    currency: st.currency, cur_dec: st.cur_dec, from, to, totals: tot, gross_margin: margin, expenses: ex.g, expenses_net: expNet, net_profit: margin - expNet,
    purchases_net: dl.n, rows_without_cost: noCost, vat: { output: tot.vat, input: ex.v + dl.v, payable: tot.vat - (ex.v + dl.v) },
    by_fuel: byFuel, by_pump: byPump, by_day: Object.fromEntries(Object.entries(byDay).sort())
  };
}
/* newest first by the time the event happened (old-system events carry their own time); filters: from, to (dates), origin = fp | m7, q = action prefix */
function auditLog(db, user, sid, q) {
  need(user, 'audit.read'); if (sid) station(db, user, sid); const { limit, before } = pageArgs(q);
  const where = ['a.org_id=?', '(? IS NULL OR a.station_id=? OR a.station_id IS NULL)', 'a.id<?'], args = [user.org_id, sid || null, sid || null, before];
  if (q.from) { where.push('a.created_at>=?'); args.push(V.date(q.from, 'from')); }
  if (q.to) { where.push('a.created_at<?'); args.push(addDays(V.date(q.to, 'to'), 1)); }
  if (q.origin === 'm7') where.push("a.action LIKE 'm7.%'"); else if (q.origin === 'fp') where.push("a.action NOT LIKE 'm7.%'");
  if (q.q) { where.push('a.action LIKE ?'); args.push(V.str(q.q, 'q', { max: 40 }).replace(/[%_]/g, '') + '%'); }
  const offset = Math.max(parseInt(q.offset, 10) || 0, 0);
  return db.prepare(`SELECT a.id,a.station_id,a.action,a.entity,a.entity_id,a.detail,a.created_at,u.name user_name FROM audit a LEFT JOIN users u ON u.id=a.user_id
    WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
}

function statement(db, user, sid, cid, q) {
  station(db, user, sid);
  const c = scoped(db, 'customers', cid, sid, 'Customer');
  const sales = db.prepare(`SELECT s.id, s.business_date date, s.created_at, s.gross debit, s.quantity_ml, s.note, s.ref, s.bill, f.name fuel_name, s.voided_at FROM sales s JOIN fuels f ON f.id=s.fuel_id WHERE s.customer_id=?`).all(cid)
    .map(r => ({ kind: 'sale', id: r.id, date: r.date, created_at: r.created_at, debit: r.debit, credit: 0, quantity_ml: r.quantity_ml, fuel_name: r.fuel_name, note: r.note || undefined, ref_no: r.ref || undefined, doc_ref: r.bill || undefined, voided: !!r.voided_at }));
  const pays = db.prepare('SELECT id, business_date date, created_at, amount credit, note, voided_at FROM payments WHERE customer_id=?').all(cid)
    .map(r => ({ kind: 'payment', id: r.id, date: r.date, created_at: r.created_at, debit: 0, credit: r.credit, note: r.note, voided: !!r.voided_at }));
  const entries = sales.concat(pays).sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at) || (a.kind === b.kind ? a.id - b.id : (a.kind === 'sale' ? -1 : 1)));   // by business date; same-second ties: a sale precedes the payment that settles it
  if (c.opening_balance) entries.unshift({ kind: 'opening', id: 0, date: c.created_on, created_at: '', debit: Math.max(c.opening_balance, 0), credit: Math.max(-c.opening_balance, 0), voided: false });
  const extras = require('./books').partyExtras(db, 'customer', cid);   // vouchers, journals and imported history
  if (extras.length) { entries.push(...extras); entries.sort((a, b) => (b.kind === 'opening') - (a.kind === 'opening') || (a.date || '').localeCompare(b.date || '') || (a.created_at || '').localeCompare(b.created_at || '')); }
  let bal = 0;
  for (const e of entries) { if (!e.voided) bal += e.debit - e.credit; e.balance = bal; }
  return require('./books').periodize({ customer: { id: c.id, name: c.name, phone: c.phone, credit_limit: c.credit_limit, terms_days: c.terms_days, ref: c.ref }, balance: bal, entries }, q);
}
function exportSales(db, user, sid, q) {
  need(user, 'report.read'); station(db, user, sid);
  const from = V.date(q.from, 'from'), to = V.date(q.to, 'to');
  if (from > to) throw bad('VALIDATION', 'from must not be after to');
  if (addDays(from, 366) < to) throw bad('VALIDATION', 'The period cannot exceed one year');
  return db.prepare(`SELECT s.id, s.business_date, s.created_at, p.name pump_name, f.name fuel_name, s.quantity_ml, s.price_e4, s.net, s.vat, s.gross, s.pay_type, c.name customer_name
    FROM sales s JOIN pumps p ON p.id=s.pump_id JOIN fuels f ON f.id=s.fuel_id LEFT JOIN customers c ON c.id=s.customer_id
    WHERE s.station_id=? AND s.business_date BETWEEN ? AND ? AND s.voided_at IS NULL ORDER BY s.id LIMIT 20000`).all(sid, from, to);
}
function changePassword(db, user, b) {
  V.obj(b, 'body');
  const row = db.prepare('SELECT pw_hash FROM users WHERE id=?').get(user.id);
  if (!auth.verifyPassword(String(b.current || ''), row.pw_hash)) throw new HttpError(403, 'BAD_CREDENTIALS', 'Current password is incorrect');
  auth.checkPasswordPolicy(b.new);
  return tx(db, () => {
    db.prepare('UPDATE users SET pw_hash=? WHERE id=?').run(auth.hashPassword(b.new), user.id);
    db.prepare('DELETE FROM sessions WHERE user_id=? AND id<>?').run(user.id, user.sid);   // sign out every other device
    db.prepare('DELETE FROM reset_tokens WHERE user_id=?').run(user.id);
    audit(db, user, null, 'user.password', 'user', user.id);
    return { ok: true };
  });
}

/* ---------- second factor ---------- */
/** Checks a 6-digit TOTP (replay-safe) or a one-time recovery code. Returns 'totp' | 'recovery' | null. */
function secondFactor(db, u, input) {
  const code = String(input).trim();
  if (/^\d{6}$/.test(code)) {
    if (!u.totp_secret) return null;
    const step = TOTP.verifyTotp(TOTP.unseal(u.totp_secret), code, u.totp_last_step);
    if (step === null) return null;
    // conditional update: two concurrent logins with the same code cannot both win
    const r = db.prepare('UPDATE users SET totp_last_step=? WHERE id=? AND totp_last_step<?').run(step, u.id, step);
    return r.changes === 1 ? 'totp' : null;
  }
  if (TOTP.normCode(code).length !== 10) return null;
  const r = db.prepare("UPDATE recovery_codes SET used_at=datetime('now') WHERE user_id=? AND code_hash=? AND used_at IS NULL").run(u.id, TOTP.hashCode(code));
  return r.changes === 1 ? 'recovery' : null;
}
function requirePassword(db, user, pw) {
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
  if (!auth.verifyPassword(String(pw || ''), row.pw_hash)) throw new HttpError(403, 'BAD_CREDENTIALS', 'Current password is incorrect');
  return row;
}
function storeRecoveryCodes(db, userId) {
  const codes = TOTP.newRecoveryCodes();
  db.prepare('DELETE FROM recovery_codes WHERE user_id=?').run(userId);
  const ins = db.prepare('INSERT INTO recovery_codes(user_id,code_hash) VALUES(?,?)');
  for (const c of codes) ins.run(userId, TOTP.hashCode(c));
  return codes;
}
function twoFactorSetup(db, user, b) {
  V.obj(b, 'body'); const row = requirePassword(db, user, b.password);
  if (row.totp_enabled) throw conflict('TOTP_ALREADY_ON', 'Two-factor authentication is already on');
  const key = require('node:crypto').randomBytes(20), secret = TOTP.b32encode(key);
  db.prepare('UPDATE users SET totp_secret=?, totp_last_step=0 WHERE id=?').run(TOTP.seal(key), user.id);
  const label = encodeURIComponent('FuelPro:' + row.email);
  return { secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=FuelPro&algorithm=SHA1&digits=6&period=30` };
}
function twoFactorEnable(db, user, b) {
  V.obj(b, 'body');
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
  if (row.totp_enabled) throw conflict('TOTP_ALREADY_ON', 'Two-factor authentication is already on');
  if (!row.totp_secret) throw bad('TOTP_NOT_STARTED', 'Start the setup first');
  auth.assertTfNotLocked(user.id);
  const step = TOTP.verifyTotp(TOTP.unseal(row.totp_secret), String(b.code || '').trim(), 0);
  if (step === null) { auth.recordTfFail(user.id); throw bad('BAD_TOTP', 'The verification code is incorrect'); }
  return tx(db, () => {
    db.prepare('UPDATE users SET totp_enabled=1, totp_last_step=? WHERE id=?').run(step, user.id);
    const codes = storeRecoveryCodes(db, user.id);
    db.prepare('DELETE FROM sessions WHERE user_id=? AND id<>?').run(user.id, user.sid);
    audit(db, user, null, 'user.2fa.on', 'user', user.id);
    return { recovery_codes: codes };
  });
}
function checkBoth(db, user, b) {
  V.obj(b, 'body'); const row = requirePassword(db, user, b.password);
  if (!row.totp_enabled) throw conflict('TOTP_NOT_ON', 'Two-factor authentication is not on');
  auth.assertTfNotLocked(user.id);
  if (!b.code || !secondFactor(db, row, b.code)) { auth.recordTfFail(user.id); throw new HttpError(403, 'BAD_TOTP', 'The verification code is incorrect'); }
  return row;
}
function twoFactorDisable(db, user, b) {
  checkBoth(db, user, b);
  return tx(db, () => {
    db.prepare('UPDATE users SET totp_enabled=0, totp_secret=NULL, totp_last_step=0 WHERE id=?').run(user.id);
    db.prepare('DELETE FROM recovery_codes WHERE user_id=?').run(user.id);
    audit(db, user, null, 'user.2fa.off', 'user', user.id);
    return { ok: true };
  });
}
function twoFactorNewCodes(db, user, b) {
  checkBoth(db, user, b);
  return tx(db, () => { const codes = storeRecoveryCodes(db, user.id); audit(db, user, null, 'user.2fa.codes', 'user', user.id); return { recovery_codes: codes }; });
}
function recoveryLeft(db, user) { return db.prepare('SELECT COUNT(*) n FROM recovery_codes WHERE user_id=? AND used_at IS NULL').get(user.id).n; }

/* ---------- password reset ---------- */
const RESET_TTL_MS = 30 * 60 * 1000;
const RESET_MAIL = {
  ar: (n, link) => ({ subject: 'إعادة تعيين كلمة المرور — FuelPro', text: `مرحباً ${n}،\n\nوصلنا طلب لإعادة تعيين كلمة مرور حسابك في FuelPro. افتح الرابط التالي خلال 30 دقيقة لاختيار كلمة مرور جديدة:\n\n${link}\n\nالرابط يعمل مرة واحدة فقط. إذا لم تطلب ذلك فتجاهل هذه الرسالة، ولن تتغير كلمة مرورك.` }),
  en: (n, link) => ({ subject: 'Reset your FuelPro password', text: `Hello ${n},\n\nWe received a request to reset the password for your FuelPro account. Open this link within 30 minutes to choose a new password:\n\n${link}\n\nThe link works once. If you did not ask for this, ignore this email; your password will not change.` }),
  fr: (n, link) => ({ subject: 'Réinitialiser votre mot de passe FuelPro', text: `Bonjour ${n},\n\nNous avons reçu une demande de réinitialisation du mot de passe de votre compte FuelPro. Ouvrez ce lien dans les 30 minutes pour choisir un nouveau mot de passe :\n\n${link}\n\nLe lien ne fonctionne qu'une fois. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message ; votre mot de passe ne changera pas.` })
};
/** Always answers { ok: true } so the response never reveals whether an address is registered. */
function forgotPassword(db, input, ip, { mailer, appUrl }) {
  const b = V.obj(input, 'body'); const email = V.email(b.email);
  const lang = RESET_MAIL[b.lang] ? b.lang : 'en';
  auth.assertResetAllowed(ip, email);
  const u = db.prepare('SELECT id, org_id, name, email, active FROM users WHERE email=?').get(email);
  if (u && u.active) {
    const token = require('node:crypto').randomBytes(32).toString('base64url'), now = Date.now();
    tx(db, () => {
      db.prepare('DELETE FROM reset_tokens WHERE user_id=?').run(u.id);           // only the newest link works
      db.prepare('INSERT INTO reset_tokens(id,user_id,created_at,expires_at,ip) VALUES(?,?,?,?,?)').run(auth.sha(token), u.id, now, now + RESET_TTL_MS, ip || null);
      audit(db, { id: u.id, org_id: u.org_id }, null, 'user.reset.request', 'user', u.id);
    });
    const m = RESET_MAIL[lang](u.name, `${appUrl}/#reset=${token}`);
    Promise.resolve().then(() => mailer.send({ to: u.email, ...m })).catch((e) => console.error('[mail] reset email failed:', e.message));
  }
  return { ok: true };
}
function resetPassword(db, input, ip) {
  const b = V.obj(input, 'body'); const token = String(b.token || '');
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw bad('RESET_INVALID', 'This reset link is invalid or has expired');
  const r = db.prepare('SELECT r.*, u.active, u.org_id, u.email FROM reset_tokens r JOIN users u ON u.id=r.user_id WHERE r.id=?').get(auth.sha(token));
  if (!r || r.used_at || r.expires_at < Date.now() || !r.active) throw bad('RESET_INVALID', 'This reset link is invalid or has expired');
  auth.checkPasswordPolicy(b.password);
  return tx(db, () => {
    const upd = db.prepare('UPDATE reset_tokens SET used_at=? WHERE id=? AND used_at IS NULL').run(Date.now(), r.id);
    if (upd.changes !== 1) throw bad('RESET_INVALID', 'This reset link is invalid or has expired');
    db.prepare('UPDATE users SET pw_hash=? WHERE id=?').run(auth.hashPassword(b.password), r.user_id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(r.user_id);           // sign out everywhere
    db.prepare('DELETE FROM reset_tokens WHERE user_id=? AND id<>?').run(r.user_id, r.id);
    audit(db, { id: r.user_id, org_id: r.org_id }, null, 'user.reset.done', 'user', r.user_id);
    auth.clearFails(ip, r.email);
    return { ok: true };
  });
}

module.exports = { openShift, customerBalance, scoped, need, audit, tzToday, addDays, resolveDate, pageArgs, voidRow, forgotPassword, resetPassword, twoFactorSetup, twoFactorEnable, twoFactorDisable, twoFactorNewCodes, recoveryLeft, statement, exportSales, changePassword, registerOrg, login, listUsers, createUser, updateUser, listStations, createStation, updateStation, station, listFuels, createFuel, updateFuelPrice, listTanks, createTank, listPumps, createPump, correctMeter,
  listCustomers, createCustomer, createSale, voidSale, listSales, createDelivery, voidDelivery, listDeliveries, createAdjustment, createExpense, voidExpense, listExpenses, createPayment, voidPayment, dashboard, summary, auditLog };
