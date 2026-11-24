'use strict';
/* Shifts & cash drawer, suppliers, transfers, stock reports, ageing, and the accounting module. */
const { tx } = require('./db');
const { divRound } = require('./money');
const { bad, conflict, notFound, forbidden } = require('./errors');
const V = require('./validate');
const auth = require('./auth');
const L = require('./ledger');
const S = require('./services');
const { need, audit, scoped, tzToday, addDays, pageArgs, voidRow, openShift, partyBalances } = S;
const station = S.station;

/* =============================== SHIFTS =============================== */
function shiftTotals(db, sh) {
  const one = (sql) => db.prepare(sql).get(sh.id).v;
  const t = {
    cash_sales: one("SELECT COALESCE(SUM(gross),0) v FROM sales WHERE shift_id=? AND pay_type='cash' AND voided_at IS NULL"),
    credit_sales: one("SELECT COALESCE(SUM(gross),0) v FROM sales WHERE shift_id=? AND pay_type='credit' AND voided_at IS NULL"),
    qty_ml: one('SELECT COALESCE(SUM(quantity_ml),0) v FROM sales WHERE shift_id=? AND voided_at IS NULL'),
    sales_count: one('SELECT COUNT(*) v FROM sales WHERE shift_id=? AND voided_at IS NULL'),
    collections_cash: one("SELECT COALESCE(SUM(amount),0) v FROM payments WHERE shift_id=? AND method='cash' AND voided_at IS NULL"),
    expenses_cash: one("SELECT COALESCE(SUM(gross),0) v FROM expenses WHERE shift_id=? AND method='cash' AND voided_at IS NULL"),
    purchases_cash: one("SELECT COALESCE(SUM(net+vat),0) v FROM deliveries WHERE shift_id=? AND pay_type='cash' AND voided_at IS NULL"),
    supplier_payments_cash: one("SELECT COALESCE(SUM(amount),0) v FROM supplier_payments WHERE shift_id=? AND method='cash' AND voided_at IS NULL"),
    withdrawals: one("SELECT COALESCE(SUM(amount),0) v FROM cash_moves WHERE shift_id=? AND kind='withdrawal' AND voided_at IS NULL"),
    deposits: one("SELECT COALESCE(SUM(amount),0) v FROM cash_moves WHERE shift_id=? AND kind='deposit' AND voided_at IS NULL")
  };
  Object.assign(t, require('./books').shiftVoucherCash(db, sh.id));
  t.payroll_cash = require('./payroll').shiftCash(db, sh.id);   // cash advances and salaries paid from the drawer
  // credit sales and bank receipts never enter the drawer
  t.expected_cash = sh.float_amount + t.cash_sales + t.collections_cash + t.deposits + t.voucher_receipts - t.expenses_cash - t.purchases_cash - t.supplier_payments_cash - t.withdrawals - t.voucher_payments - t.payroll_cash;
  return t;
}
function getShiftRow(db, sid, id) { const sh = db.prepare('SELECT * FROM shifts WHERE id=? AND station_id=?').get(id, sid); if (!sh) throw notFound('Shift'); return sh; }

function openShiftCmd(db, user, sid, b) {
  need(user, 'shift.open'); const st = station(db, user, sid); V.obj(b, 'body');
  const float = V.int(b.float_amount ?? 0, 'float_amount', { min: 0, max: 10 ** 13 });
  return tx(db, () => {
    if (openShift(db, st, false)) throw conflict('SHIFT_ALREADY_OPEN', 'A shift is already open at this station');
    const id = Number(db.prepare('INSERT INTO shifts(station_id,business_date,float_amount,opened_by) VALUES(?,?,?,?)').run(sid, tzToday(st.timezone), float, user.id).lastInsertRowid);
    const ins = db.prepare('INSERT INTO shift_meters(shift_id,pump_id,open_ml) VALUES(?,?,?)');
    for (const p of db.prepare('SELECT id, meter_ml FROM pumps WHERE station_id=? AND active=1').all(sid)) ins.run(id, p.id, p.meter_ml);
    audit(db, user, sid, 'shift.open', 'shift', id, { float_amount: float });
    return { id };
  });
}
function closeShift(db, user, sid, id, b) {
  need(user, 'shift.close'); station(db, user, sid); V.obj(b, 'body');
  const counted = V.int(b.counted_cash, 'counted_cash', { min: 0, max: 10 ** 13 });
  const note = V.str(b.note, 'note', { max: 300, optional: true }) || null;
  return tx(db, () => {
    const sh = getShiftRow(db, sid, id);
    if (sh.status !== 'open') throw conflict('SHIFT_NOT_OPEN', 'This shift is not open');
    const t = shiftTotals(db, sh), variance = counted - t.expected_cash;
    for (const m of db.prepare('SELECT sm.pump_id, p.meter_ml FROM shift_meters sm JOIN pumps p ON p.id=sm.pump_id WHERE sm.shift_id=?').all(id))
      db.prepare('UPDATE shift_meters SET close_ml=? WHERE shift_id=? AND pump_id=?').run(m.meter_ml, id, m.pump_id);
    db.prepare("UPDATE shifts SET status='closed', closed_by=?, closed_at=datetime('now'), counted_cash=?, expected_cash=?, variance=?, close_note=? WHERE id=?").run(user.id, counted, t.expected_cash, variance, note, id);
    audit(db, user, sid, 'shift.close', 'shift', id, { expected_cash: t.expected_cash, counted_cash: counted, variance });
    return { id, expected_cash: t.expected_cash, counted_cash: counted, variance };
  });
}
function approveShift(db, user, sid, id) {
  need(user, 'shift.approve'); station(db, user, sid);
  return tx(db, () => {
    const sh = getShiftRow(db, sid, id);
    if (sh.status !== 'closed') throw conflict('SHIFT_NOT_CLOSED', 'Only a closed shift can be approved');
    const v = sh.variance;
    L.post(db, { org_id: user.org_id, station_id: sid, date: sh.business_date, source: 'shift', source_id: id, user_id: user.id, memo: 'Cash drawer variance',
      lines: v < 0 ? [{ a: 'cash_short', dr: -v }, { a: 'cash', cr: -v }] : [{ a: 'cash', dr: v }, { a: 'other_income', cr: v }] });
    db.prepare("UPDATE shifts SET status='approved', approved_by=?, approved_at=datetime('now') WHERE id=?").run(user.id, id);
    audit(db, user, sid, 'shift.approve', 'shift', id, { variance: v });
    return { ok: true };
  });
}
function unapproveShift(db, user, sid, id, b) {
  need(user, 'shift.approve'); station(db, user, sid);
  const reason = V.str(b && b.reason, 'reason', { min: 3, max: 200 });
  return tx(db, () => {
    const sh = getShiftRow(db, sid, id);
    if (sh.status !== 'approved') throw conflict('SHIFT_NOT_APPROVED', 'This shift is not approved');
    L.assertOpen(db, user.org_id, sh.business_date);
    L.reverseSource(db, user.org_id, 'shift', id, user.id, 'Unapprove: ' + reason);
    db.prepare("UPDATE shifts SET status='closed', approved_by=NULL, approved_at=NULL WHERE id=?").run(id);
    audit(db, user, sid, 'shift.unapprove', 'shift', id, { reason });
    return { ok: true };
  });
}
function reopenShift(db, user, sid, id, b) {
  need(user, 'shift.approve'); const st = station(db, user, sid);
  const reason = V.str(b && b.reason, 'reason', { min: 3, max: 200 });
  return tx(db, () => {
    const sh = getShiftRow(db, sid, id);
    if (sh.status !== 'closed') throw conflict('SHIFT_NOT_CLOSED', 'Only a closed (not approved) shift can be reopened');
    if (openShift(db, st, false)) throw conflict('SHIFT_ALREADY_OPEN', 'Close the current shift first');
    db.prepare("UPDATE shifts SET status='open', closed_by=NULL, closed_at=NULL, counted_cash=NULL, expected_cash=NULL, variance=NULL WHERE id=?").run(id);
    db.prepare('UPDATE shift_meters SET close_ml=NULL WHERE shift_id=?').run(id);
    audit(db, user, sid, 'shift.reopen', 'shift', id, { reason });
    return { ok: true };
  });
}
function shiftDetail(db, user, sid, id) {
  station(db, user, sid);
  const sh = id === 'current' ? db.prepare("SELECT * FROM shifts WHERE station_id=? AND status='open'").get(sid) : getShiftRow(db, sid, id);
  if (!sh) return null;
  const totals = shiftTotals(db, sh);
  const meters = db.prepare(`SELECT sm.pump_id, p.name pump_name, f.name fuel_name, sm.open_ml, COALESCE(sm.close_ml, p.meter_ml) close_ml,
      (SELECT COALESCE(SUM(quantity_ml),0) FROM sales WHERE shift_id=sm.shift_id AND pump_id=sm.pump_id AND voided_at IS NULL) sold_ml
    FROM shift_meters sm JOIN pumps p ON p.id=sm.pump_id JOIN fuels f ON f.id=p.fuel_id WHERE sm.shift_id=? ORDER BY p.id`).all(sh.id)
    .map(m => ({ ...m, meter_ml: m.close_ml - m.open_ml, unrecorded_ml: m.close_ml - m.open_ml - m.sold_ml }));
  const names = db.prepare('SELECT id, name FROM users WHERE id IN (?,?,?)').all(sh.opened_by, sh.closed_by || 0, sh.approved_by || 0);
  const nm = (i) => (names.find(n => n.id === i) || {}).name || null;
  const moves = db.prepare('SELECT * FROM cash_moves WHERE shift_id=? ORDER BY id').all(sh.id);
  return { ...sh, opened_by_name: nm(sh.opened_by), closed_by_name: nm(sh.closed_by), approved_by_name: nm(sh.approved_by), totals, meters, cash_moves: moves,
    live_variance: sh.status === 'open' ? null : sh.counted_cash - sh.expected_cash };
}
function listShifts(db, user, sid, q) {
  station(db, user, sid); const { limit, before } = pageArgs(q);
  return db.prepare(`SELECT s.*, u.name opened_by_name FROM shifts s JOIN users u ON u.id=s.opened_by WHERE s.station_id=? AND s.id<? ORDER BY s.id DESC LIMIT ?`).all(sid, before, limit);
}
function cashMove(db, user, sid, b) {
  need(user, 'cash.move'); const st = station(db, user, sid); V.obj(b, 'body');
  const kind = V.oneOf(b.kind, 'kind', ['withdrawal', 'deposit']), cp = V.oneOf(b.counterpart || 'bank', 'counterpart', ['bank', 'owner']);
  const amount = V.int(b.amount, 'amount', { min: 1, max: 10 ** 13 }), note = V.str(b.note, 'note', { max: 200, optional: true }) || null;
  return tx(db, () => {
    const sh = openShift(db, st, false);
    if (!sh) throw conflict('NO_OPEN_SHIFT', 'Open a shift first');
    if (kind === 'withdrawal') { const exp = shiftTotals(db, sh).expected_cash; if (amount > exp) throw conflict('CASH_INSUFFICIENT', 'The drawer does not hold that much cash', { expected_cash: exp }); }
    const date = tzToday(st.timezone);
    const id = Number(db.prepare('INSERT INTO cash_moves(station_id,shift_id,business_date,kind,counterpart,amount,note,user_id) VALUES(?,?,?,?,?,?,?,?)').run(sid, sh.id, date, kind, cp, amount, note, user.id).lastInsertRowid);
    const other = cp === 'bank' ? 'bank' : (kind === 'withdrawal' ? 'drawings' : 'capital');
    L.post(db, { org_id: user.org_id, station_id: sid, date, source: 'cash_move', source_id: id, user_id: user.id, memo: note,
      lines: kind === 'withdrawal' ? [{ a: other, dr: amount }, { a: 'cash', cr: amount }] : [{ a: 'cash', dr: amount }, { a: other, cr: amount }] });
    audit(db, user, sid, 'cash.' + kind, 'cash_move', id, { amount, counterpart: cp });
    return { id };
  });
}
const voidCashMove = (db, user, sid, id, reason) => voidRow(db, user, sid, 'cash_moves', id, reason, 'cash.move');

/* =============================== SUPPLIERS =============================== */
/* What we owe the supplier, from the ledger (positive = payable). */
function supplierBalance(db, id, asOf) {
  return db.prepare(`SELECT COALESCE(SUM(l.credit-l.debit),0) v FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id
    WHERE l.party_type='supplier' AND l.party_id=? AND a.sys='ap' AND j.status='posted' AND j.business_date<=?`).get(id, asOf || '9999-12-31').v;
}
function listSuppliers(db, user, sid) {
  station(db, user, sid);
  const bal = partyBalances(db, 'supplier', sid);
  return db.prepare('SELECT * FROM suppliers WHERE station_id=? AND active=1 ORDER BY name').all(sid).map(s => ({ ...s, balance: bal.get(s.id) || 0 }));
}
function createSupplier(db, user, sid, b) {
  need(user, 'supplier.manage'); const st = station(db, user, sid); V.obj(b, 'body');
  const opening = V.int(b.opening_balance ?? 0, 'opening_balance', { min: -(10 ** 13), max: 10 ** 13 }), terms = V.int(b.terms_days ?? 30, 'terms_days', { min: 0, max: 365 });
  const date = tzToday(st.timezone);
  return tx(db, () => {
    const id = Number(db.prepare('INSERT INTO suppliers(station_id,name,phone,opening_balance,terms_days,created_on) VALUES(?,?,?,?,?,?)')
      .run(sid, V.str(b.name, 'name', { max: 120 }), V.str(b.phone, 'phone', { max: 40, optional: true }) || null, opening, terms, date).lastInsertRowid);
    if (opening) L.post(db, { org_id: user.org_id, station_id: sid, date, source: 'supplier_opening', source_id: id, user_id: user.id, memo: 'Supplier opening balance',
      lines: [{ a: 'capital', dr: Math.max(opening, 0), cr: Math.max(-opening, 0) }, { a: 'ap', dr: Math.max(-opening, 0), cr: Math.max(opening, 0), party_type: 'supplier', party_id: id }] });
    audit(db, user, sid, 'supplier.create', 'supplier', id, { opening_balance: opening });
    return { id };
  });
}
function updateSupplier(db, user, sid, id, b) {
  need(user, 'supplier.manage'); station(db, user, sid); V.obj(b, 'body');
  const s = scoped(db, 'suppliers', id, sid, 'Supplier');
  return tx(db, () => {
    db.prepare('UPDATE suppliers SET name=?, phone=?, terms_days=?, active=? WHERE id=?').run(
      b.name === undefined ? s.name : V.str(b.name, 'name', { max: 120 }), b.phone === undefined ? s.phone : (V.str(b.phone, 'phone', { max: 40, optional: true }) || null),
      b.terms_days === undefined ? s.terms_days : V.int(b.terms_days, 'terms_days', { min: 0, max: 365 }), b.active === undefined ? s.active : (V.bool(b.active) ? 1 : 0), id);
    audit(db, user, sid, 'supplier.update', 'supplier', id, { fields: Object.keys(b) }); return { ok: true };
  });
}
function supplierPayment(db, user, sid, b) {
  need(user, 'supplier.pay'); const st = station(db, user, sid); V.obj(b, 'body');
  const amount = V.int(b.amount, 'amount', { min: 1, max: 10 ** 13 }), method = V.oneOf(b.method || 'bank', 'method', ['cash', 'bank']);
  const date = tzToday(st.timezone);
  return tx(db, () => {
    const s = scoped(db, 'suppliers', V.int(b.supplier_id, 'supplier_id', { min: 1 }), sid, 'Supplier');
    const bal = supplierBalance(db, s.id);
    if (amount > bal) throw conflict('OVERPAYMENT', 'The payment is larger than the amount owed', { balance: bal });
    const sh = method === 'cash' ? openShift(db, st, true) : null;
    const id = Number(db.prepare('INSERT INTO supplier_payments(station_id,supplier_id,shift_id,business_date,amount,method,note,user_id) VALUES(?,?,?,?,?,?,?,?)')
      .run(sid, s.id, sh ? sh.id : null, date, amount, method, V.str(b.note, 'note', { max: 200, optional: true }) || null, user.id).lastInsertRowid);
    L.post(db, { org_id: user.org_id, station_id: sid, date, source: 'supplier_payment', source_id: id, user_id: user.id,
      lines: [{ a: 'ap', dr: amount, party_type: 'supplier', party_id: s.id }, { a: method, cr: amount }] });
    audit(db, user, sid, 'supplier.payment', 'supplier_payment', id, { supplier_id: s.id, amount, method });
    return { id, balance: bal - amount };
  });
}
const voidSupplierPayment = (db, user, sid, id, reason) => voidRow(db, user, sid, 'supplier_payments', id, reason, 'supplier.pay');
function supplierStatement(db, user, sid, id, q) {
  station(db, user, sid); const s = scoped(db, 'suppliers', id, sid, 'Supplier');
  const e = [];
  if (s.opening_balance) e.push({ kind: 'opening', id: 0, date: s.created_on, created_at: '', debit: Math.max(-s.opening_balance, 0), credit: Math.max(s.opening_balance, 0), voided: false });
  for (const d of db.prepare("SELECT d.*, t.name tank_name FROM deliveries d JOIN tanks t ON t.id=d.tank_id WHERE d.supplier_id=? AND d.pay_type='credit'").all(id))
    e.push({ kind: 'purchase', id: d.id, date: d.business_date, created_at: d.created_at, debit: 0, credit: d.payable ?? (d.net + d.vat), quantity_ml: d.quantity_ml, due_date: d.due_date, tank_name: d.tank_name, note: d.note || undefined, ref_no: (db.prepare("SELECT ref FROM journals WHERE source='delivery' AND source_id=? AND reversal_of IS NULL").get(d.id) || {}).ref || d.ref || undefined, doc_ref: d.ref || undefined, voided: !!d.voided_at });
  for (const p of db.prepare('SELECT * FROM supplier_payments WHERE supplier_id=?').all(id))
    e.push({ kind: 'payment', id: p.id, date: p.business_date, created_at: p.created_at, debit: p.amount, credit: 0, method: p.method, note: p.note, voided: !!p.voided_at });
  e.push(...require('./books').partyExtras(db, 'supplier', id));
  e.sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.created_at.localeCompare(b.created_at));
  let bal = 0; for (const x of e) { if (!x.voided) bal += x.credit - x.debit; x.balance = bal; }
  return require('./books').periodize({ supplier: s, balance: bal, entries: e }, q);
}

/* =============================== AGEING =============================== */
function ageing(db, user, sid, q) {
  need(user, 'report.read'); const st = station(db, user, sid);
  const type = V.oneOf(q.type || 'customer', 'type', ['customer', 'supplier']);
  const asOf = V.date(q.as_of, 'as_of', { optional: true }) || tzToday(st.timezone);
  const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  const rows = [], tot = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0, advance: 0, balance: 0 };
  const parties = db.prepare(`SELECT * FROM ${type === 'customer' ? 'customers' : 'suppliers'} WHERE station_id=? AND active=1 ORDER BY name`).all(sid);
  /* everything for all parties at once (one query per kind instead of three per party), grouped by party in the same order */
  const group = (rows) => { const m = new Map(); for (const r of rows) { const a = m.get(r.pid); if (a) a.push(r); else m.set(r.pid, [r]); } return m; };
  const tbl = type === 'customer' ? 'customers' : 'suppliers';
  const docs = group(type === 'customer'
    ? db.prepare(`SELECT customer_id pid, business_date d, gross amt FROM sales WHERE customer_id IN (SELECT id FROM customers WHERE station_id=? AND active=1) AND pay_type='credit' AND voided_at IS NULL AND business_date<=? ORDER BY customer_id, business_date, id`).all(sid, asOf)
    : db.prepare(`SELECT supplier_id pid, business_date d, due_date, COALESCE(payable, net+vat) amt FROM deliveries WHERE supplier_id IN (SELECT id FROM suppliers WHERE station_id=? AND active=1) AND pay_type='credit' AND voided_at IS NULL AND business_date<=? ORDER BY supplier_id, business_date, id`).all(sid, asOf));
  const paidBy = new Map(db.prepare(`SELECT ${type}_id pid, SUM(amount) v FROM ${type === 'customer' ? 'payments' : 'supplier_payments'} WHERE ${type}_id IN (SELECT id FROM ${tbl} WHERE station_id=? AND active=1) AND voided_at IS NULL AND business_date<=? GROUP BY 1`).all(sid, asOf).map(r => [r.pid, r.v]));
  const extras = require('./books').partyExtrasMany(db, type, sid, asOf);
  for (const p of parties) {
    const debts = [];   // amounts owed (to us for customers, by us for suppliers), oldest first, each with a due date
    if (p.opening_balance > 0) debts.push({ date: '', due: p.created_on || asOf, amt: p.opening_balance });   // the opening balance is the oldest debt
    let paid = p.opening_balance < 0 ? -p.opening_balance : 0;
    for (const d of docs.get(p.id) || []) debts.push({ date: d.d, due: (type === 'supplier' && d.due_date) || addDays(d.d, p.terms_days), amt: d.amt });
    paid += paidBy.get(p.id) || 0;
    for (const x of extras.get(p.id) || []) {   // vouchers, journals and imported history
      const owed = type === 'customer' ? x.debit - x.credit : x.credit - x.debit;
      if (owed > 0) debts.push({ date: x.date, due: addDays(x.date, p.terms_days), amt: owed }); else paid += -owed;
    }
    debts.sort((a, b) => a.date.localeCompare(b.date));
    const r = { id: p.id, name: p.name, terms_days: p.terms_days, credit_limit: p.credit_limit, current: 0, d30: 0, d60: 0, d90: 0, over90: 0, advance: 0, balance: 0, oldest_due: null };
    for (const d of debts) {               // payments settle the oldest debts first (FIFO)
      const use = Math.min(paid, d.amt); paid -= use; const left = d.amt - use; if (!left) continue;
      const late = days(d.due, asOf);
      r[late <= 0 ? 'current' : late <= 30 ? 'd30' : late <= 60 ? 'd60' : late <= 90 ? 'd90' : 'over90'] += left;
      if (!r.oldest_due) r.oldest_due = d.due;
    }
    r.advance = paid;
    r.balance = r.current + r.d30 + r.d60 + r.d90 + r.over90 - r.advance;
    if (r.balance || r.advance) { rows.push(r); for (const k in tot) tot[k] += r[k]; }
  }
  return { type, as_of: asOf, currency: st.currency, cur_dec: st.cur_dec, rows, totals: tot };
}

/* =============================== INVENTORY =============================== */
function updateTank(db, user, sid, tid, b) {
  need(user, 'config.edit'); station(db, user, sid); V.obj(b, 'body');
  const t = scoped(db, 'tanks', tid, sid, 'Tank');
  return tx(db, () => {
    const name = b.name === undefined ? t.name : V.str(b.name, 'name', { max: 60 });
    const minMl = b.min_ml === undefined ? t.min_ml : V.int(b.min_ml, 'min_ml', { min: 0, max: t.capacity_ml });
    db.prepare('UPDATE tanks SET name=?, min_ml=? WHERE id=?').run(name, minMl, tid);
    audit(db, user, sid, 'tank.update', 'tank', tid, { name, min_ml: minMl }); return { ok: true };
  });
}
const sameFuel = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
function createTransfer(db, user, sid, b) {
  need(user, 'transfer.create'); const st = station(db, user, sid); V.obj(b, 'body');
  const toSid = V.int(b.to_station_id ?? sid, 'to_station_id', { min: 1 }); const st2 = station(db, user, toSid);
  if (st2.currency !== st.currency) throw bad('CURRENCY_MISMATCH', 'Transfers between stations with different currencies are not supported');
  const qty = V.int(b.quantity_ml, 'quantity_ml', { min: 1, max: 100_000_000 }), note = V.str(b.note, 'note', { max: 200, optional: true }) || null;
  const date = tzToday(st.timezone);
  return tx(db, () => {
    L.assertOpen(db, user.org_id, date);
    const from = scoped(db, 'tanks', V.int(b.from_tank_id, 'from_tank_id', { min: 1 }), sid, 'Tank');
    const to = scoped(db, 'tanks', V.int(b.to_tank_id, 'to_tank_id', { min: 1 }), toSid, 'Tank');
    if (from.id === to.id) throw bad('VALIDATION', 'Choose two different tanks');
    const f1 = db.prepare('SELECT name FROM fuels WHERE id=?').get(from.fuel_id).name, f2 = db.prepare('SELECT name FROM fuels WHERE id=?').get(to.fuel_id).name;
    if (!sameFuel(f1, f2)) throw conflict('FUEL_MISMATCH', 'Both tanks must hold the same fuel', { from: f1, to: f2 });
    if (qty > from.level_ml) throw conflict('INSUFFICIENT_STOCK', 'Quantity exceeds the source tank stock', { available_ml: from.level_ml });
    if (to.level_ml + qty > to.capacity_ml) throw conflict('EXCEEDS_CAPACITY', 'The destination tank does not have room', { free_ml: to.capacity_ml - to.level_ml });
    const id = Number(db.prepare('INSERT INTO transfers(org_id,from_station_id,to_station_id,from_tank_id,to_tank_id,business_date,quantity_ml,value,note,user_id) VALUES(?,?,?,?,?,?,?,0,?,?)')
      .run(user.org_id, sid, toSid, from.id, to.id, date, qty, note, user.id).lastInsertRowid);
    const value = -L.stockMove(db, from.id, { qty: -qty, kind: 'transfer_out', ref_type: 'transfer', ref_id: id, date, user_id: user.id });
    L.stockMove(db, to.id, { qty, value, kind: 'transfer_in', ref_type: 'transfer', ref_id: id, date, user_id: user.id });
    db.prepare('UPDATE transfers SET value=? WHERE id=?').run(value, id);
    if (toSid !== sid) {   // each branch's books stay balanced through the inter-branch account
      L.post(db, { org_id: user.org_id, station_id: sid, date, source: 'transfer', source_id: id, user_id: user.id, memo: 'Transfer out to ' + st2.name, lines: [{ a: 'interbranch', dr: value }, { a: 'inventory', cr: value }] });
      L.post(db, { org_id: user.org_id, station_id: toSid, date, source: 'transfer', source_id: id, user_id: user.id, memo: 'Transfer in from ' + st.name, lines: [{ a: 'inventory', dr: value }, { a: 'interbranch', cr: value }] });
    }
    audit(db, user, sid, 'transfer.create', 'transfer', id, { qty_ml: qty, to_station_id: toSid, value });
    return { id, value };
  });
}
function voidTransfer(db, user, sid, id, b) {
  need(user, 'transfer.void'); station(db, user, sid);
  const reason = V.str(b && b.reason, 'reason', { min: 3, max: 200 });
  return tx(db, () => {
    const t = db.prepare('SELECT * FROM transfers WHERE id=? AND org_id=? AND (from_station_id=? OR to_station_id=?)').get(id, user.org_id, sid, sid);
    if (!t) throw notFound('Transfer');
    station(db, user, t.from_station_id); station(db, user, t.to_station_id);
    if (t.voided_at) throw conflict('ALREADY_VOIDED', 'This record is already voided');
    L.assertOpen(db, user.org_id, t.business_date);
    const to = db.prepare('SELECT * FROM tanks WHERE id=?').get(t.to_tank_id), from = db.prepare('SELECT * FROM tanks WHERE id=?').get(t.from_tank_id);
    if (to.level_ml < t.quantity_ml) throw conflict('STOCK_ALREADY_SOLD', 'Part of the transferred fuel has been sold already');
    if (from.level_ml + t.quantity_ml > from.capacity_ml) throw conflict('EXCEEDS_CAPACITY', 'The source tank has no room to take the fuel back');
    L.reverseSource(db, user.org_id, 'transfer', id, user.id, 'Void: ' + reason);
    const out = L.stockMove(db, to.id, { qty: -t.quantity_ml, value: -t.value, kind: 'void', ref_type: 'transfer', ref_id: id, date: t.business_date, user_id: user.id });
    const back = L.stockMove(db, from.id, { qty: t.quantity_ml, value: -out, kind: 'void', ref_type: 'transfer', ref_id: id, date: t.business_date, user_id: user.id });
    if (t.from_station_id !== t.to_station_id) {
      L.post(db, { org_id: user.org_id, station_id: t.to_station_id, date: t.business_date, source: 'stock_fix', source_id: id, user_id: user.id, lines: L.inventoryFix(-t.value, out) });
      L.post(db, { org_id: user.org_id, station_id: t.from_station_id, date: t.business_date, source: 'stock_fix', source_id: id, user_id: user.id, lines: L.inventoryFix(t.value, back) });
    }
    db.prepare("UPDATE transfers SET voided_at=datetime('now'), void_reason=?, void_by=? WHERE id=?").run(reason, user.id, id);
    audit(db, user, sid, 'transfer.void', 'transfer', id, { reason });
    return { ok: true };
  });
}
function listTransfers(db, user, sid, q) {
  station(db, user, sid); const { limit, before } = pageArgs(q);
  return db.prepare(`SELECT t.*, fs.name from_station, ts.name to_station, ft.name from_tank, tt.name to_tank FROM transfers t
    JOIN stations fs ON fs.id=t.from_station_id JOIN stations ts ON ts.id=t.to_station_id JOIN tanks ft ON ft.id=t.from_tank_id JOIN tanks tt ON tt.id=t.to_tank_id
    WHERE t.org_id=? AND (t.from_station_id=? OR t.to_station_id=?) AND t.id<? ORDER BY t.id DESC LIMIT ?`).all(user.org_id, sid, sid, before, limit);
}
function stockMoves(db, user, sid, q) {
  station(db, user, sid); const { limit, before } = pageArgs(q);
  const tank = q.tank_id ? V.int(Number(q.tank_id), 'tank_id', { min: 1 }) : undefined;
  const from = V.date(q.from, 'from', { optional: true }) || '0000-01-01', to = V.date(q.to, 'to', { optional: true }) || '9999-12-31';
  return db.prepare(`SELECT m.*, t.name tank_name, u.name user_name FROM stock_moves m JOIN tanks t ON t.id=m.tank_id LEFT JOIN users u ON u.id=m.user_id
    WHERE m.station_id=? AND (? IS NULL OR m.tank_id=?) AND m.business_date BETWEEN ? AND ? AND m.id<? ORDER BY m.id DESC LIMIT ?`).all(sid, tank || null, tank || null, from, to, before, limit);
}
/** Tank reconciliation: book movement from documents vs. physical counts, per tank, for a period. */
function stockReconciliation(db, user, sid, q) {
  need(user, 'report.read'); const st = station(db, user, sid);
  const to = V.date(q.to, 'to', { optional: true }) || tzToday(st.timezone), from = V.date(q.from, 'from', { optional: true }) || to.slice(0, 8) + '01';
  if (from > to) throw bad('VALIDATION', 'from must not be after to');
  const tanks = db.prepare('SELECT t.*, f.name fuel_name FROM tanks t JOIN fuels f ON f.id=t.fuel_id WHERE t.station_id=? ORDER BY t.id').all(sid);
  const rows = tanks.map(t => {
    const sum = (where, ...a) => db.prepare(`SELECT COALESCE(SUM(qty_ml),0) q, COALESCE(SUM(value),0) v FROM stock_moves WHERE tank_id=? AND ${where}`).get(t.id, ...a);
    const open = sum('business_date<?', from), close = sum('business_date<=?', to);
    const by = {}; for (const r of db.prepare('SELECT kind, SUM(qty_ml) q, SUM(value) v FROM stock_moves WHERE tank_id=? AND business_date BETWEEN ? AND ? GROUP BY kind').all(t.id, from, to)) by[r.kind] = r;
    const g = (k) => (by[k] ? by[k].q : 0);
    const meterSales = db.prepare('SELECT COALESCE(SUM(quantity_ml),0) v FROM sales WHERE tank_id=? AND business_date BETWEEN ? AND ? AND voided_at IS NULL').get(t.id, from, to).v;
    const book = open.q + g('opening') + g('delivery') + g('transfer_in') + g('transfer_out') + g('sale') + g('void');
    const variance = g('count');
    return { tank_id: t.id, tank_name: t.name, fuel_name: t.fuel_name, min_ml: t.min_ml, capacity_ml: t.capacity_ml,
      opening_ml: open.q, opening_value: open.v, received_ml: g('delivery') + g('opening'), transfer_in_ml: g('transfer_in'), transfer_out_ml: -g('transfer_out'),
      sales_ml: -(g('sale') + g('void')), meter_sales_ml: meterSales, book_closing_ml: book, count_variance_ml: variance, closing_ml: close.q, closing_value: close.v,
      variance_pct: meterSales ? Math.round(variance * 10000 / meterSales) / 100 : null,
      consistent: book + variance === close.q };
  });
  return { from, to, rows };
}

/* =============================== CUSTOMERS =============================== */
function updateCustomer(db, user, sid, id, b) {
  need(user, 'customer.edit'); station(db, user, sid); V.obj(b, 'body');
  const c = scoped(db, 'customers', id, sid, 'Customer');
  return tx(db, () => {
    db.prepare('UPDATE customers SET name=?, phone=?, credit_limit=?, terms_days=?, active=? WHERE id=?').run(
      b.name === undefined ? c.name : V.str(b.name, 'name', { max: 120 }), b.phone === undefined ? c.phone : (V.str(b.phone, 'phone', { max: 40, optional: true }) || null),
      b.credit_limit === undefined ? c.credit_limit : V.int(b.credit_limit, 'credit_limit', { min: 0, max: 10 ** 13 }),
      b.terms_days === undefined ? c.terms_days : V.int(b.terms_days, 'terms_days', { min: 0, max: 365 }), b.active === undefined ? c.active : (V.bool(b.active) ? 1 : 0), id);
    audit(db, user, sid, 'customer.update', 'customer', id, { fields: Object.keys(b) }); return { ok: true };
  });
}

/* =============================== ACCOUNTING =============================== */
const NORMAL_DEBIT = new Set(['asset', 'expense']);
function listAccounts(db, user) {
  need(user, 'report.read'); L.ensureChart(db, user.org_id);
  return db.prepare('SELECT * FROM accounts WHERE org_id=? ORDER BY code').all(user.org_id);
}
function createAccount(db, user, b) {
  need(user, 'account.edit'); V.obj(b, 'body');
  const code = V.str(b.code, 'code', { max: 12 }); if (!/^[0-9]{3,8}$/.test(code)) throw bad('VALIDATION', 'Account code must be 3 to 8 digits');
  const type = V.oneOf(b.type, 'type', ['asset', 'liability', 'equity', 'income', 'expense']);
  return tx(db, () => {
    if (db.prepare('SELECT 1 FROM accounts WHERE org_id=? AND code=?').get(user.org_id, code)) throw conflict('CODE_TAKEN', 'This account code is already used');
    const id = Number(db.prepare('INSERT INTO accounts(org_id,code,type,name_ar,name_en) VALUES(?,?,?,?,?)').run(user.org_id, code, type, V.str(b.name_ar, 'name_ar', { max: 120 }), V.str(b.name_en || b.name_ar, 'name_en', { max: 120 })).lastInsertRowid);
    audit(db, user, null, 'account.create', 'account', id, { code, type }); return { id };
  });
}
function updateAccount(db, user, id, b) {
  need(user, 'account.edit'); V.obj(b, 'body');
  const a = db.prepare('SELECT * FROM accounts WHERE id=? AND org_id=?').get(id, user.org_id); if (!a) throw notFound('Account');
  if (a.sys && b.active === false) throw conflict('SYSTEM_ACCOUNT', 'System accounts cannot be deactivated');
  return tx(db, () => {
    db.prepare('UPDATE accounts SET name_ar=?, name_en=?, active=? WHERE id=?').run(b.name_ar === undefined ? a.name_ar : V.str(b.name_ar, 'name_ar', { max: 120 }),
      b.name_en === undefined ? a.name_en : V.str(b.name_en, 'name_en', { max: 120 }), b.active === undefined ? a.active : (V.bool(b.active) ? 1 : 0), id);
    audit(db, user, null, 'account.update', 'account', id, { fields: Object.keys(b) }); return { ok: true };
  });
}
function journalWithLines(db, j) {
  return { ...j, lines: db.prepare(`SELECT l.*, a.code, a.name_ar, a.name_en, CASE l.party_type WHEN 'customer' THEN (SELECT name FROM customers WHERE id=l.party_id) WHEN 'supplier' THEN (SELECT name FROM suppliers WHERE id=l.party_id) END party_name FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE l.journal_id=? ORDER BY l.id`).all(j.id) };
}
function listJournals(db, user, sid, q) {
  need(user, 'journal.read'); station(db, user, sid); const { limit, before } = pageArgs(q);
  const from = V.date(q.from, 'from', { optional: true }) || '0000-01-01', to = V.date(q.to, 'to', { optional: true }) || '9999-12-31';
  const src = q.source ? V.str(q.source, 'source', { max: 30 }) : null, status = q.status ? V.oneOf(q.status, 'status', ['draft', 'posted']) : null;
  const term = q.q ? '%' + V.str(q.q, 'q', { max: 60 }) + '%' : null;
  const acc = q.account_id ? V.int(Number(q.account_id), 'account_id', { min: 1 }) : null;
  /* the next page starts after the last journal shown, in the list's own order (date, then id): an entry dated earlier
     but typed later (larger id) used to fall between two pages and never appear */
  const bDate = S.beforeDate(db, 'journals', before, 'org_id=?', user.org_id);
  return db.prepare(`SELECT j.*, u.name user_name FROM journals j LEFT JOIN users u ON u.id=j.user_id WHERE j.org_id=? AND j.station_id=? AND j.business_date BETWEEN ? AND ?
    AND (? IS NULL OR j.source=?) AND (? IS NULL OR j.status=?)
    AND (? IS NULL OR j.memo LIKE ? OR j.ref = ? OR CAST(j.id AS TEXT) = ? OR EXISTS(SELECT 1 FROM journal_lines l WHERE l.journal_id=j.id AND l.memo LIKE ?))
    AND (? IS NULL OR EXISTS(SELECT 1 FROM journal_lines l WHERE l.journal_id=j.id AND l.account_id=?))
    AND (j.business_date<? OR (j.business_date=? AND j.id<?)) ORDER BY j.business_date DESC, j.id DESC LIMIT ?`)
    .all(user.org_id, sid, from, to, src, src, status, status, term, term, q.q || null, q.q || null, term, acc, acc, bDate, bDate, before, limit).map(j => journalWithLines(db, j));
}
function getJournal(db, user, id) {
  need(user, 'journal.read');
  const j = db.prepare('SELECT * FROM journals WHERE id=? AND org_id=?').get(id, user.org_id); if (!j) throw notFound('Journal');
  station(db, user, j.station_id); return journalWithLines(db, j);
}
function createJournal(db, user, sid, b) {
  need(user, 'journal.create'); const st = station(db, user, sid); V.obj(b, 'body');
  const date = V.date(b.date, 'date', { optional: true }) || tzToday(st.timezone);
  if (date > tzToday(st.timezone)) throw bad('FUTURE_DATE', 'The date cannot be in the future');
  const memo = V.str(b.memo, 'memo', { min: 3, max: 300 });
  if (!Array.isArray(b.lines) || b.lines.length < 2 || b.lines.length > 100) throw bad('VALIDATION', 'A journal needs between 2 and 100 lines');
  const lines = b.lines.map((l, i) => {
    V.obj(l, `lines[${i}]`);
    const dr = V.int(l.debit ?? 0, `lines[${i}].debit`, { min: 0, max: 10 ** 14 }), cr = V.int(l.credit ?? 0, `lines[${i}].credit`, { min: 0, max: 10 ** 14 });
    if ((dr > 0) === (cr > 0)) throw bad('VALIDATION', `Line ${i + 1} needs either a debit or a credit`);
    const r = require('./books').checkLine(db, user.org_id, sid, l.account_id, l.party_type, l.party_id, `lines[${i}]`);
    return { a: r.a.id, dr, cr, party_type: r.party_type, party_id: r.party_id, memo: V.str(l.memo, 'memo', { max: 200, optional: true }) || null };
  });
  const postNow = b.post === true;
  if (postNow) need(user, 'journal.post');
  return tx(db, () => {
    const id = L.post(db, { org_id: user.org_id, station_id: sid, date, source: 'manual', memo, user_id: user.id, lines, status: postNow ? 'posted' : 'draft' });
    audit(db, user, sid, postNow ? 'journal.post' : 'journal.draft', 'journal', id, { memo });
    return { id, status: postNow ? 'posted' : 'draft' };
  });
}
function postJournal(db, user, id) {
  need(user, 'journal.post');
  return tx(db, () => {
    const j = getJournal(db, user, id);
    if (j.status !== 'draft') throw conflict('NOT_DRAFT', 'Only drafts can be posted');
    L.assertOpen(db, user.org_id, j.business_date);
    const d = j.lines.reduce((s, l) => s + l.debit, 0), c = j.lines.reduce((s, l) => s + l.credit, 0);
    if (d !== c) throw bad('JOURNAL_UNBALANCED', 'Total debit must equal total credit', { debit: d, credit: c });
    db.prepare("UPDATE journals SET status='posted', posted_at=datetime('now') WHERE id=?").run(id);
    audit(db, user, j.station_id, 'journal.post', 'journal', id); return { ok: true };
  });
}
function deleteDraft(db, user, id) {
  need(user, 'journal.create');
  return tx(db, () => {
    const j = getJournal(db, user, id); if (j.status !== 'draft') throw conflict('NOT_DRAFT', 'Only drafts can be deleted');
    db.prepare('DELETE FROM journal_lines WHERE journal_id=?').run(id); db.prepare('DELETE FROM journals WHERE id=?').run(id);
    audit(db, user, j.station_id, 'journal.delete', 'journal', id); return { ok: true };
  });
}
function reverseJournal(db, user, id, b) {
  need(user, 'journal.reverse'); const reason = V.str(b && b.reason, 'reason', { min: 3, max: 200 });
  return tx(db, () => {
    const j = db.prepare('SELECT * FROM journals WHERE id=? AND org_id=?').get(id, user.org_id); if (!j) throw notFound('Journal');
    station(db, user, j.station_id);
    if (j.source !== 'manual' && j.source !== 'import') throw conflict('USE_DOCUMENT_VOID', 'This entry comes from an operation; void the operation instead');
    const rid = L.reverse(db, j, user.id, 'Reversal: ' + reason);
    audit(db, user, j.station_id, 'journal.reverse', 'journal', id, { reason, reversal_id: rid }); return { id: rid };
  });
}

/* which stations a report covers; never adds different currencies together */
function scope(db, user, q) {
  if (q.station_id) { const s = station(db, user, V.int(Number(q.station_id), 'station_id', { min: 1 })); return { ids: [s.id], currency: s.currency, cur_dec: s.cur_dec, stations: [s] }; }
  let sts = S.listStations(db, user);
  const curs = [...new Set(sts.map(s => s.currency))];
  const cur = q.currency ? V.str(q.currency, 'currency', { min: 3, max: 3 }).toUpperCase() : (curs.length === 1 ? curs[0] : null);
  if (!cur) throw bad('MIXED_CURRENCY', 'Your stations use different currencies; choose one currency or one station', { currencies: curs });
  sts = sts.filter(s => s.currency === cur); if (!sts.length) throw notFound('Station');
  return { ids: sts.map(s => s.id), currency: cur, cur_dec: sts[0].cur_dec, stations: sts };
}
const inList = (ids) => ids.map(() => '?').join(',');
function balances(db, user, ids, from, to, noClose) {
  /* add the lines up per account first, then name the accounts: half the work of joining every line to its account (same rows, same order) */
  return db.prepare(`SELECT a.id, a.code, a.name_ar, a.name_en, a.type, t.debit, t.credit FROM (SELECT l.account_id id, SUM(l.debit) debit, SUM(l.credit) credit
    FROM journals j JOIN journal_lines l ON l.journal_id=j.id
    WHERE j.org_id=? AND j.status='posted' AND j.station_id IN (${inList(ids)}) AND j.business_date BETWEEN ? AND ?${noClose ? " AND j.source<>'year_close'" : ''}
    GROUP BY l.account_id) t JOIN accounts a ON a.id=t.id ORDER BY a.code`).all(user.org_id, ...ids, from, to);
}
function trialBalance(db, user, q) {
  need(user, 'report.read'); const sc = scope(db, user, q);
  const to = V.date(q.to, 'to'), from = V.date(q.from, 'from', { optional: true }) || to.slice(0, 4) + '-01-01';
  if (from > to) throw bad('VALIDATION', 'from must not be after to');
  const before = new Map(balances(db, user, sc.ids, '0000-01-01', addDays(from, -1)).map(r => [r.id, r]));
  const period = new Map(balances(db, user, sc.ids, from, to, q.pre_close === '1' || q.pre_close === true).map(r => [r.id, r]));
  const ids = new Set([...before.keys(), ...period.keys()]);
  const accts = db.prepare('SELECT * FROM accounts WHERE org_id=? ORDER BY code').all(user.org_id).filter(a => ids.has(a.id));
  const tot = { opening_dr: 0, opening_cr: 0, debit: 0, credit: 0, closing_dr: 0, closing_cr: 0 };
  const rows = accts.map(a => {
    const o = before.get(a.id) || { debit: 0, credit: 0 }, p = period.get(a.id) || { debit: 0, credit: 0 };
    const ob = o.debit - o.credit, cb = ob + p.debit - p.credit;
    const r = { account_id: a.id, code: a.code, name_ar: a.name_ar, name_en: a.name_en, type: a.type,
      opening_dr: Math.max(ob, 0), opening_cr: Math.max(-ob, 0), debit: p.debit, credit: p.credit, closing_dr: Math.max(cb, 0), closing_cr: Math.max(-cb, 0) };
    for (const k in tot) tot[k] += r[k]; return r;
  });
  return { from, to, currency: sc.currency, cur_dec: sc.cur_dec, stations: sc.stations.map(s => ({ id: s.id, name: s.name })), rows, totals: tot,
    balanced: tot.debit === tot.credit && tot.closing_dr === tot.closing_cr && tot.opening_dr === tot.opening_cr };
}
function incomeStatement(db, user, q) {
  need(user, 'report.read'); const sc = scope(db, user, q);
  const to = V.date(q.to, 'to'), from = V.date(q.from, 'from', { optional: true }) || to.slice(0, 8) + '01';
  const rows = balances(db, user, sc.ids, from, to, true).filter(r => r.type === 'income' || r.type === 'expense')
    .map(r => ({ ...r, amount: r.type === 'income' ? r.credit - r.debit : r.debit - r.credit }));
  const sum = (f) => rows.filter(f).reduce((s, r) => s + r.amount, 0);
  /* FuelPro chart: 4xxx revenue, 49xx other income, 5xxx cost of sales. Imported charts that follow the Yemeni layout: 42x other income, 31x cost of activity. */
  const isOther = (r) => r.code.startsWith('49') || (r.code.startsWith('42') && r.code.length > 4), isCos = (r) => r.code.startsWith('5') || (r.code.startsWith('31') && r.code.length !== 4);
  const revenue = sum(r => r.type === 'income' && !isOther(r)), other = sum(r => r.type === 'income' && isOther(r));
  const cogs = sum(r => r.type === 'expense' && isCos(r)), opex = sum(r => r.type === 'expense' && !isCos(r));
  for (const r of rows) r.sec = r.type === 'income' ? (isOther(r) ? 'other' : 'revenue') : (isCos(r) ? 'cos' : 'opex');
  return { from, to, currency: sc.currency, cur_dec: sc.cur_dec, rows, revenue, cost_of_sales: cogs, gross_profit: revenue - cogs, operating_expenses: opex, other_income: other,
    net_profit: revenue + other - cogs - opex };
}
function balanceSheet(db, user, q) {
  need(user, 'report.read'); const sc = scope(db, user, q);
  const asOf = V.date(q.as_of || q.to, 'as_of');
  const rows = balances(db, user, sc.ids, '0000-01-01', asOf).map(r => ({ ...r, amount: NORMAL_DEBIT.has(r.type) ? r.debit - r.credit : r.credit - r.debit }));
  const pick = (t) => rows.filter(r => r.type === t && r.amount !== 0);
  const total = (t) => rows.filter(r => r.type === t).reduce((s, r) => s + r.amount, 0);
  const earnings = total('income') - total('expense');   // not yet closed to retained earnings
  const assets = total('asset'), liabilities = total('liability'), equity = total('equity') + earnings;
  return { as_of: asOf, currency: sc.currency, cur_dec: sc.cur_dec, assets: pick('asset'), liabilities: pick('liability'), equity: pick('equity'), current_earnings: earnings,
    total_assets: assets, total_liabilities: liabilities, total_equity: equity, balanced: assets === liabilities + equity };
}
/* Cash-flow statement, direct method.
   Cash = every account marked as a box (cash or bank). For each posted journal that touches a box, each of its
   non-box lines contributes (credit − debit) to the class of its account; because the journal balances, the
   contributions add up exactly to the change in the boxes. Box-to-box journals contribute nothing. The cost-of-sales pair
   inside a sale journal (Dr 5010 / Cr 1200, equal amounts) moves no cash and is left out; `reconciled` proves the result.
   Class: opening entries and FX revaluation are shown apart; fixed assets (register, accumulated depreciation,
   imported groups 11 / 214) = investing; equity, inter-branch, imported 216 / 217 / 224 / 227 = financing; else operating. */
const CF_SYS = { capital: 'financing', drawings: 'financing', retained: 'financing', interbranch: 'financing', accum_dep: 'investing' };
const CF_GROUPS = { '11': 'investing', '214': 'investing', '216': 'financing', '217': 'financing', '224': 'financing', '227': 'financing' };
function cashFlow(db, user, q) {
  need(user, 'report.read'); const sc = scope(db, user, q);
  const to = V.date(q.to, 'to'), from = V.date(q.from, 'from', { optional: true }) || to.slice(0, 8) + '01';
  if (from > to) throw bad('VALIDATION', 'from must not be after to');
  const accts = db.prepare('SELECT id, code, name_ar, name_en, type, sys, box, parent_id, is_group FROM accounts WHERE org_id=?').all(user.org_id);
  const byId = new Map(accts.map(a => [a.id, a]));
  const isBox = (a) => !!(a.box || a.sys === 'cash' || a.sys === 'bank');
  const fixed = new Set(db.prepare('SELECT account_id, accum_account_id FROM fixed_assets WHERE org_id=?').all(user.org_id).flatMap(f => [f.account_id, f.accum_account_id]));
  const classOf = (a) => {
    if (a.sys && CF_SYS[a.sys]) return CF_SYS[a.sys];
    if (a.sys) return 'operating';
    if (fixed.has(a.id)) return 'investing';
    for (let p = a, guard = 0; p && guard < 20; p = byId.get(p.parent_id), guard++) if (p.is_group && CF_GROUPS[p.code]) return CF_GROUPS[p.code];
    return a.type === 'equity' ? 'financing' : 'operating';
  };
  const boxIds = accts.filter(isBox).map(a => a.id);
  const ph = inList(sc.ids);
  /* `+l.account_id`: walk the period's journals and filter their lines, rather than probe the account index once per journal and box (3-5x slower) */
  const boxBal = (cond, ...args) => boxIds.length ? db.prepare(`SELECT l.account_id id, COALESCE(SUM(l.debit-l.credit),0) v FROM journal_lines l JOIN journals j ON j.id=l.journal_id
      WHERE j.org_id=? AND j.status='posted' AND j.station_id IN (${ph}) AND +l.account_id IN (${inList(boxIds)}) AND ${cond} GROUP BY l.account_id`).all(user.org_id, ...sc.ids, ...boxIds, ...args) : [];
  const openMap = new Map(boxBal('j.business_date<?', from).map(r => [r.id, r.v]));
  const moveMap = new Map(boxBal('j.business_date BETWEEN ? AND ?', from, to).map(r => [r.id, r.v]));
  const contrib = boxIds.length ? db.prepare(`SELECT l.account_id id, CASE WHEN j.source LIKE '%opening%' OR j.source='migration' THEN 'opening' WHEN j.source='fx_reval' THEN 'fx' ELSE '' END k,
      SUM(l.credit-l.debit) v FROM journal_lines l JOIN journals j ON j.id=l.journal_id
      WHERE j.org_id=? AND j.status='posted' AND j.station_id IN (${ph}) AND j.business_date BETWEEN ? AND ? AND l.account_id NOT IN (${inList(boxIds)})
        AND EXISTS (SELECT 1 FROM journal_lines b WHERE b.journal_id=j.id AND b.account_id IN (${inList(boxIds)}))
        AND NOT (j.source='sale' AND l.account_id IN (SELECT id FROM accounts WHERE org_id=j.org_id AND sys IN('cogs','inventory')))
      GROUP BY l.account_id, k HAVING SUM(l.credit-l.debit)<>0`).all(user.org_id, ...sc.ids, from, to, ...boxIds, ...boxIds) : [];
  const sec = () => ({ rows: [], inflow: 0, outflow: 0, total: 0 });
  const out = { operating: sec(), investing: sec(), financing: sec(), opening: sec(), fx: sec() };
  for (const c of contrib) {
    const a = byId.get(c.id), s = out[c.k || classOf(a)];
    s.rows.push({ account_id: a.id, code: a.code, name_ar: a.name_ar, name_en: a.name_en, amount: c.v });
    if (c.v > 0) s.inflow += c.v; else s.outflow += c.v; s.total += c.v;
  }
  for (const k in out) out[k].rows.sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount) || x.code.localeCompare(y.code));
  const opening = [...openMap.values()].reduce((t, v) => t + v, 0), change = [...moveMap.values()].reduce((t, v) => t + v, 0);
  const flows = out.operating.total + out.investing.total + out.financing.total + out.opening.total + out.fx.total;
  const boxes = boxIds.filter(id => openMap.get(id) || moveMap.get(id)).map(id => { const a = byId.get(id), o = openMap.get(id) || 0, m = moveMap.get(id) || 0;
    return { account_id: id, code: a.code, name_ar: a.name_ar, name_en: a.name_en, box: a.box || a.sys, opening: o, change: m, closing: o + m }; }).sort((x, y) => x.code.localeCompare(y.code));
  return { from, to, currency: sc.currency, cur_dec: sc.cur_dec, stations: sc.stations.map(s => ({ id: s.id, name: s.name })),
    opening_cash: opening, ...out, net_change: change, closing_cash: opening + change, reconciled: flows === change, boxes };
}
function accountLedger(db, user, q) {
  need(user, 'report.read'); const sc = scope(db, user, q);
  const a = db.prepare('SELECT * FROM accounts WHERE id=? AND org_id=?').get(V.int(Number(q.account_id), 'account_id', { min: 1 }), user.org_id); if (!a) throw notFound('Account');
  const to = V.date(q.to, 'to'), from = V.date(q.from, 'from', { optional: true }) || to.slice(0, 8) + '01';
  const sign = NORMAL_DEBIT.has(a.type) ? 1 : -1;
  const ob = db.prepare(`SELECT COALESCE(SUM(l.debit-l.credit),0) v FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE l.account_id=? AND j.status='posted' AND j.station_id IN (${inList(sc.ids)}) AND j.business_date<?`).get(a.id, ...sc.ids, from).v * sign;
  let bal = ob;
  /* one primary-key join per source table instead of five correlated look-ups per line (the same values) */
  const lines = db.prepare(`SELECT l.*, j.business_date, j.source, j.source_id, j.memo jmemo, j.station_id, j.created_at,
      COALESCE(v.ref_no, s.ref, j.ref) ref, s.note sale_note, j.doc_type, COALESCE(j.doc_ref, s.bill) doc_ref,
      CASE l.party_type WHEN 'customer' THEN c.name WHEN 'supplier' THEN su.name END party_name
    FROM journal_lines l JOIN journals j ON j.id=l.journal_id
      LEFT JOIN vouchers v ON j.source='voucher' AND v.id=j.source_id LEFT JOIN sales s ON j.source='sale' AND s.id=j.source_id
      LEFT JOIN customers c ON l.party_type='customer' AND c.id=l.party_id LEFT JOIN suppliers su ON l.party_type='supplier' AND su.id=l.party_id
    WHERE l.account_id=? AND j.status='posted' AND j.station_id IN (${inList(sc.ids)}) AND j.business_date BETWEEN ? AND ? ORDER BY j.business_date, j.created_at, j.id, l.id LIMIT 30000`).all(a.id, ...sc.ids, from, to);
  for (const l of lines) { bal += (l.debit - l.credit) * sign; l.balance = bal; }
  return { account: a, from, to, currency: sc.currency, cur_dec: sc.cur_dec, opening: ob, closing: bal, lines };
}
function lockPeriod(db, user, b) {
  need(user, 'period.lock'); V.obj(b, 'body');
  const through = b.through === null ? null : V.date(b.through, 'through');
  const cur = L.lockedThrough(db, user.org_id);
  if ((through === null || (cur && through < cur)) && !auth.ORG_WIDE.has(user.role)) throw forbidden('Only the owner or an administrator can reopen a closed period');
  if (through && through > new Date().toISOString().slice(0, 10)) throw bad('FUTURE_DATE', 'A period in the future cannot be closed');
  return tx(db, () => {
    if (through) { const d = db.prepare("SELECT COUNT(*) n FROM journals WHERE org_id=? AND status='draft' AND business_date<=?").get(user.org_id, through).n; if (d) throw conflict('DRAFTS_PENDING', 'Post or delete draft journals in this period first', { drafts: d }); }
    db.prepare('UPDATE orgs SET locked_through=? WHERE id=?').run(through, user.org_id);
    audit(db, user, null, 'period.lock', 'org', user.org_id, { from: cur, to: through }); return { locked_through: through };
  });
}
/** Self-check used by tests, the demo seeder and the UI: the books must agree with the operational data. */
function integrity(db, user) {
  need(user, 'report.read'); const checks = [];
  const add = (name, ok, detail, name_ar) => checks.push({ name, name_ar: name_ar || name, ok, detail });
  /* per journal, one probe of the covering index (no sort of every line of the org): 2x faster, same journals */
  const unbalanced = db.prepare(`SELECT j.id FROM journals j WHERE j.org_id=? AND j.status='posted'
    AND (SELECT SUM(l.debit)-SUM(l.credit) FROM journal_lines l WHERE l.journal_id=j.id)<>0 ORDER BY j.id`).all(user.org_id);
  add('every posted journal balances', !unbalanced.length, { unbalanced: unbalanced.map(r => r.id) }, 'كل القيود المرحّلة متوازنة (المدين = الدائن)');
  for (const st of S.listStations(db, user)) {
    const gl = (sys, party) => db.prepare(`SELECT COALESCE(SUM(l.debit-l.credit),0) v FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id WHERE j.org_id=? AND j.station_id=? AND j.status='posted' AND a.sys=?`).get(user.org_id, st.id, sys).v;
    const tanks = db.prepare('SELECT id, level_ml, value FROM tanks WHERE station_id=?').all(st.id);
    const stockValue = tanks.reduce((s, t) => s + t.value, 0);
    const glInv = gl('inventory'), glAr = gl('ar'), glAp = gl('ap');
    add(`${st.name}: GL inventory = stock value`, glInv === stockValue, { gl: glInv, stock: stockValue }, `${st.name}: رصيد حساب المخزون = قيمة المخزون في الخزانات`);
    const mv = new Map(db.prepare('SELECT tank_id id, SUM(qty_ml) q, SUM(value) v FROM stock_moves WHERE tank_id IN (SELECT id FROM tanks WHERE station_id=?) GROUP BY tank_id').all(st.id).map(r => [r.id, r]));
    const ledgerOk = tanks.every(t => { const m = mv.get(t.id) || { q: 0, v: 0 }; return m.q === t.level_ml && m.v === t.value; });
    add(`${st.name}: stock ledger = tank levels`, ledgerOk, null, `${st.name}: سجل حركة المادة = أرصدة الخزانات`);
    let ar = 0; for (const v of partyBalances(db, 'customer', st.id).values()) ar += v;
    add(`${st.name}: GL receivables = customer balances`, glAr === ar, { gl: glAr, customers: ar }, `${st.name}: حساب ذمم العملاء = مجموع أرصدة العملاء`);
    let ap = 0; for (const v of partyBalances(db, 'supplier', st.id).values()) ap += v;
    add(`${st.name}: GL payables = supplier balances`, -glAp === ap, { gl: -glAp, suppliers: ap }, `${st.name}: حساب ذمم الموردين = مجموع أرصدة الموردين`);
  }
  return { ok: checks.every(c => c.ok), checks };
}

module.exports = { shiftTotals, openShiftCmd, closeShift, approveShift, unapproveShift, reopenShift, shiftDetail, listShifts, cashMove, voidCashMove,
  listSuppliers, createSupplier, updateSupplier, supplierPayment, voidSupplierPayment, supplierStatement, supplierBalance, ageing,
  updateTank, createTransfer, voidTransfer, listTransfers, stockMoves, stockReconciliation, updateCustomer,
  listAccounts, createAccount, updateAccount, listJournals, getJournal, createJournal, postJournal, deleteDraft, reverseJournal,
  trialBalance, incomeStatement, balanceSheet, cashFlow, accountLedger, lockPeriod, integrity };
