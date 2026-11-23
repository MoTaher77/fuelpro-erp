'use strict';
/* FuelPro books: account tree with rolled-up balances, cash & bank boxes, receipt / payment vouchers,
   ledger lines that touch a customer or supplier outside their usual documents, and the daily meter sheet. */
const L = require('./ledger');
const V = require('./validate');
const { tx } = require('./db');
const { bad, conflict, notFound } = require('./errors');
const S = require('./services');
const { need, audit, scoped, tzToday, resolveDate, pageArgs, openShift, station } = S;

/* documents that already appear on a party statement by themselves */
const DOC_SOURCES = { customer: ['sale', 'payment', 'customer_opening', 'migration'], supplier: ['delivery', 'supplier_payment', 'supplier_opening', 'migration'] };
const PARTY_SYS = { customer: 'ar', supplier: 'ap' };

/** Ledger lines naming the party that come from anything other than its own documents (vouchers, journals, imported history). */
function partyExtras(db, type, id, asOf) {
  const src = DOC_SOURCES[type];
  return db.prepare(`SELECT j.id, j.business_date date, j.created_at, j.source, j.memo, l.memo lmemo, l.debit, l.credit, j.doc_type, j.doc_ref,
      COALESCE((SELECT ref_no FROM vouchers v WHERE j.source='voucher' AND v.id=j.source_id), j.ref) ref_no
    FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id
    WHERE l.party_type=? AND l.party_id=? AND a.sys=? AND j.status='posted' AND j.business_date<=? AND j.source NOT IN (${src.map(() => '?').join(',')})
    ORDER BY j.business_date, j.id, l.id`).all(type, id, PARTY_SYS[type], asOf || '9999-12-31', ...src)
    .map(r => ({ kind: 'journal', id: r.id, date: r.date, created_at: r.created_at, debit: r.debit, credit: r.credit, source: r.source, note: r.lmemo || r.memo || '', ref_no: r.ref_no || null, doc_type: r.doc_type || null, doc_ref: r.doc_ref || null, exact: !!r.lmemo, voided: false }));
}

/* ============================== ACCOUNT TREE ============================== */
const NORMAL_DEBIT = new Set(['asset', 'expense']);
function accountTree(db, user, q) {
  need(user, 'report.read'); L.ensureChart(db, user.org_id);
  const to = V.date(q.to, 'to', { optional: true }) || '9999-12-31';
  const sid = q.station_id ? station(db, user, V.int(Number(q.station_id), 'station_id', { min: 1 })).id : null;
  const accts = db.prepare('SELECT * FROM accounts WHERE org_id=? ORDER BY code').all(user.org_id);
  const bal = new Map(db.prepare(`SELECT l.account_id id, SUM(l.debit) d, SUM(l.credit) c FROM journal_lines l JOIN journals j ON j.id=l.journal_id
    WHERE j.org_id=? AND j.status='posted' AND j.business_date<=? AND (? IS NULL OR j.station_id=?) GROUP BY l.account_id`).all(user.org_id, to, sid, sid).map(r => [r.id, r]));
  const byId = new Map(accts.map(a => [a.id, { ...a, debit: 0, credit: 0, children: 0 }]));
  for (const a of byId.values()) {
    const b = bal.get(a.id); if (!b) continue;
    for (let n = a, guard = 0; n && guard < 20; n = byId.get(n.parent_id), guard++) { n.debit += b.d; n.credit += b.c; }   // roll the balance up to every ancestor
  }
  for (const a of byId.values()) if (a.parent_id && byId.has(a.parent_id)) byId.get(a.parent_id).children++;
  const rows = [...byId.values()].map(a => ({ ...a, balance: (a.debit - a.credit) * (NORMAL_DEBIT.has(a.type) ? 1 : -1) }));
  return { to: to === '9999-12-31' ? null : to, rows };
}
const CODE_RE = /^[0-9]{1,12}$/;
function validParent(db, orgId, pid, selfId) {
  if (pid === null || pid === undefined) return null;
  const p = db.prepare('SELECT * FROM accounts WHERE id=? AND org_id=?').get(V.int(pid, 'parent_id', { min: 1 }), orgId);
  if (!p) throw notFound('Parent account');
  if (!p.is_group) throw bad('PARENT_NOT_GROUP', 'The parent must be a group account');
  for (let n = p, i = 0; n && i < 30; n = n.parent_id ? db.prepare('SELECT * FROM accounts WHERE id=?').get(n.parent_id) : null, i++) if (n.id === selfId) throw bad('PARENT_CYCLE', 'An account cannot be placed under itself');
  return p.id;
}
function createAccount(db, user, b) {
  need(user, 'account.edit'); V.obj(b, 'body');
  const code = V.str(b.code, 'code', { max: 12 }); if (!CODE_RE.test(code)) throw bad('VALIDATION', 'Account code must be 1 to 12 digits');
  const type = V.oneOf(b.type, 'type', ['asset', 'liability', 'equity', 'income', 'expense']);
  const isGroup = b.is_group ? 1 : 0;
  const box = b.box ? V.oneOf(b.box, 'box', ['cash', 'bank']) : null;
  if (box && (type !== 'asset' || isGroup)) throw bad('VALIDATION', 'Only an asset account that is not a group can be a cash box or bank');
  return tx(db, () => {
    if (db.prepare('SELECT 1 FROM accounts WHERE org_id=? AND code=?').get(user.org_id, code)) throw conflict('CODE_TAKEN', 'This account code is already used');
    const parent = validParent(db, user.org_id, b.parent_id ?? null, null);
    const currency = b.currency ? V.str(b.currency, 'currency', { min: 3, max: 3 }).toUpperCase() : null;
    if (currency && !db.prepare('SELECT 1 FROM currencies WHERE org_id=? AND code=?').get(user.org_id, currency)) throw notFound('Currency');
    const id = Number(db.prepare('INSERT INTO accounts(org_id,code,type,name_ar,name_en,parent_id,is_group,box,currency) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(user.org_id, code, type, V.str(b.name_ar, 'name_ar', { max: 120 }), V.str(b.name_en || b.name_ar, 'name_en', { max: 120 }), parent, isGroup, box, currency).lastInsertRowid);
    audit(db, user, null, 'account.create', 'account', id, { code, type, is_group: isGroup, box }); return { id };
  });
}
function updateAccount(db, user, id, b) {
  need(user, 'account.edit'); V.obj(b, 'body');
  const a = db.prepare('SELECT * FROM accounts WHERE id=? AND org_id=?').get(id, user.org_id); if (!a) throw notFound('Account');
  if (a.sys && b.active === false) throw conflict('SYSTEM_ACCOUNT', 'System accounts cannot be deactivated');
  return tx(db, () => {
    const parent = b.parent_id === undefined ? a.parent_id : validParent(db, user.org_id, b.parent_id, a.id);
    let box = a.box;
    if (b.box !== undefined && !(a.sys === 'cash' || a.sys === 'bank')) {
      box = b.box ? V.oneOf(b.box, 'box', ['cash', 'bank']) : null;
      if (box && (a.type !== 'asset' || a.is_group)) throw bad('VALIDATION', 'Only an asset account that is not a group can be a cash box or bank');
    }
    if (b.currency !== undefined) {
      const c = b.currency ? V.str(b.currency, 'currency', { min: 3, max: 3 }).toUpperCase() : null;
      if (c && !db.prepare('SELECT 1 FROM currencies WHERE org_id=? AND code=?').get(user.org_id, c)) throw notFound('Currency');
      db.prepare('UPDATE accounts SET currency=? WHERE id=?').run(c, id);
    }
    db.prepare('UPDATE accounts SET name_ar=?, name_en=?, active=?, parent_id=?, box=? WHERE id=?').run(b.name_ar === undefined ? a.name_ar : V.str(b.name_ar, 'name_ar', { max: 120 }),
      b.name_en === undefined ? a.name_en : V.str(b.name_en, 'name_en', { max: 120 }), b.active === undefined ? a.active : (V.bool(b.active) ? 1 : 0), parent, box, id);
    audit(db, user, null, 'account.update', 'account', id, { fields: Object.keys(b) }); return { ok: true };
  });
}

/** Validate one ledger line a person typed (journal or voucher): postable account, and a party where the account needs one. */
function checkLine(db, orgId, sid, accountId, partyType, partyId, label) {
  const a = db.prepare('SELECT * FROM accounts WHERE id=? AND org_id=?').get(V.int(accountId, label + '.account_id', { min: 1 }), orgId);
  if (!a || !a.active) throw notFound('Account');
  if (a.is_group) throw bad('GROUP_ACCOUNT', 'Group accounts only add up their children; choose a detail account', { code: a.code });
  if (a.sys === 'inventory') throw bad('USE_STOCK_SCREENS', 'Fuel stock moves only through deliveries, sales, counts and transfers', { code: a.code });
  const need = a.sys === 'ar' ? 'customer' : a.sys === 'ap' ? 'supplier' : null;
  if (need) {
    if (partyType && partyType !== need) throw bad('PARTY_MISMATCH', `This account needs a ${need}`);
    const pid = V.int(partyId, label + '.party_id', { min: 1 });
    const p = db.prepare(`SELECT id FROM ${need === 'customer' ? 'customers' : 'suppliers'} WHERE id=? AND station_id=?`).get(pid, sid);
    if (!p) throw notFound(need === 'customer' ? 'Customer' : 'Supplier');
    return { a, party_type: need, party_id: pid };
  }
  return { a, party_type: null, party_id: null };
}

/* ============================== VOUCHERS ============================== */
function boxes(db, user) {
  need(user, 'read'); L.ensureChart(db, user.org_id);
  return db.prepare("SELECT id, code, name_ar, name_en, box, sys, currency FROM accounts WHERE org_id=? AND active=1 AND is_group=0 AND (box IS NOT NULL OR sys IN('cash','bank')) ORDER BY code").all(user.org_id);
}
function voucherWithLines(db, v) {
  return { ...v, lines: db.prepare(`SELECT l.*, a.code, a.name_ar, a.name_en,
      CASE l.party_type WHEN 'customer' THEN (SELECT name FROM customers WHERE id=l.party_id) WHEN 'supplier' THEN (SELECT name FROM suppliers WHERE id=l.party_id) END party_name
    FROM voucher_lines l JOIN accounts a ON a.id=l.account_id WHERE l.voucher_id=? ORDER BY l.id`).all(v.id) };
}
function listVouchers(db, user, sid, q) {
  need(user, 'journal.read'); station(db, user, sid); const { limit, before } = pageArgs(q);
  const from = V.date(q.from, 'from', { optional: true }) || '0000-01-01', to = V.date(q.to, 'to', { optional: true }) || '9999-12-31';
  const kind = q.kind ? V.oneOf(q.kind, 'kind', ['receipt', 'payment']) : null;
  const box = q.box_account_id ? V.int(Number(q.box_account_id), 'box_account_id', { min: 1 }) : null;
  const term = q.q ? '%' + V.str(q.q, 'q', { max: 60 }) + '%' : null;
  const rows = db.prepare(`SELECT v.*, a.code box_code, a.name_ar box_name_ar, a.name_en box_name_en, u.name user_name FROM vouchers v JOIN accounts a ON a.id=v.box_account_id LEFT JOIN users u ON u.id=v.user_id
    WHERE v.station_id=? AND v.business_date BETWEEN ? AND ? AND (? IS NULL OR v.kind=?) AND (? IS NULL OR v.box_account_id=?)
      AND (? IS NULL OR v.memo LIKE ? OR v.ref_no LIKE ? OR EXISTS(SELECT 1 FROM voucher_lines l JOIN accounts la ON la.id=l.account_id LEFT JOIN customers c ON l.party_type='customer' AND c.id=l.party_id LEFT JOIN suppliers s ON l.party_type='supplier' AND s.id=l.party_id
        WHERE l.voucher_id=v.id AND (l.memo LIKE ? OR la.name_ar LIKE ? OR c.name LIKE ? OR s.name LIKE ?)))
      AND v.id<? ORDER BY v.business_date DESC, v.id DESC LIMIT ?`)
    .all(sid, from, to, kind, kind, box, box, term, term, term, term, term, term, term, before, limit);
  const totals = db.prepare(`SELECT kind, COUNT(*) n, SUM(amount) amount FROM vouchers WHERE station_id=? AND business_date BETWEEN ? AND ? AND voided_at IS NULL AND (? IS NULL OR box_account_id=?) GROUP BY kind`).all(sid, from, to, box, box);
  return { rows: rows.map(v => voucherWithLines(db, v)), totals: Object.fromEntries(totals.map(t => [t.kind, { count: t.n, amount: t.amount }])) };
}
function getVoucher(db, user, sid, id) { need(user, 'journal.read'); station(db, user, sid); return voucherWithLines(db, scoped(db, 'vouchers', id, sid, 'Voucher')); }

/**
 * Post a receipt (money into a box) or a payment (money out of a box) against one or more accounts.
 * Customer and supplier lines move the party's balance, so a receipt from a customer is the same as a collection.
 * opts.date / opts.ref_no / opts.user_id are used by the importer; people go through the API.
 */
function createVoucher(db, user, sid, b, opts = {}) {
  need(user, 'voucher.create'); const st = station(db, user, sid); V.obj(b, 'body');
  const kind = V.oneOf(b.kind, 'kind', ['receipt', 'payment']);
  const date = opts.date || resolveDate(st, user, b.date);
  const memo = V.str(b.memo, 'memo', { max: 300, optional: true }) || null;
  let refNo = V.str(b.ref_no, 'ref_no', { max: 30, optional: true }) || null;
  if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > 200) throw bad('VALIDATION', 'A voucher needs between 1 and 200 lines');
  return tx(db, () => {
    const box = db.prepare('SELECT * FROM accounts WHERE id=? AND org_id=?').get(V.int(b.box_account_id, 'box_account_id', { min: 1 }), user.org_id);
    if (!box || !box.active || box.is_group || !(box.box || box.sys === 'cash' || box.sys === 'bank')) throw bad('NOT_A_BOX', 'Choose a cash box or bank account');
    /* a box kept in a foreign currency takes its amounts in that currency at the rate given (or the latest rate on file) */
    const fcCode = box.currency && box.currency !== st.currency ? box.currency : null;
    let rate = null, fcDec = 2;
    if (fcCode) {
      const cur = db.prepare('SELECT * FROM currencies WHERE org_id=? AND code=?').get(user.org_id, fcCode); fcDec = cur ? cur.decimals : 2;
      rate = b.fc_rate_e6 ? V.int(b.fc_rate_e6, 'fc_rate_e6', { min: 1, max: 10 ** 13 }) : (rateOn(db, user.org_id, fcCode, date) || 0);
      if (!rate) throw bad('NO_RATE', 'Enter the exchange rate for ' + fcCode);
    }
    const toBase = (fc) => Math.round(fc * rate * 10 ** st.cur_dec / (1e6 * 10 ** fcDec));
    const lines = b.lines.map((l, i) => {
      V.obj(l, `lines[${i}]`);
      const r = checkLine(db, user.org_id, sid, l.account_id, l.party_type, l.party_id, `lines[${i}]`);
      if (r.a.id === box.id) throw bad('VALIDATION', 'A line cannot use the same box');
      const fc = fcCode ? V.int(l.fc_amount, `lines[${i}].fc_amount`, { min: 1, max: 10 ** 14 }) : null;
      return { ...r, fc, amount: fcCode && !opts.keepBase ? toBase(fc) : V.int(l.amount, `lines[${i}].amount`, { min: 1, max: 10 ** 14 }), memo: V.str(l.memo, 'memo', { max: 200, optional: true }) || null };
    });
    const amount = lines.reduce((s, l) => s + l.amount, 0), fcTotal = fcCode ? lines.reduce((s, l) => s + l.fc, 0) : null;
    if (!refNo && !opts.date) refNo = String(1 + (db.prepare("SELECT MAX(CAST(ref_no AS INTEGER)) m FROM vouchers WHERE station_id=? AND kind=? AND ref_no GLOB '[0-9]*'").get(sid, kind).m || 0));   // next number in its own series
    L.assertOpen(db, user.org_id, date);
    const shift = box.sys === 'cash' && !opts.date ? openShift(db, st, false) : null;
    const id = Number(db.prepare('INSERT INTO vouchers(station_id,kind,ref_no,business_date,box_account_id,amount,memo,shift_id,user_id,fc_code,fc_rate_e6,fc_amount) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(sid, kind, refNo, date, box.id, amount, memo, shift ? shift.id : null, opts.user_id || user.id, fcCode, rate, fcTotal).lastInsertRowid);
    const ins = db.prepare('INSERT INTO voucher_lines(voucher_id,account_id,party_type,party_id,amount,memo,fc_amount) VALUES(?,?,?,?,?,?,?)');
    for (const l of lines) ins.run(id, l.a.id, l.party_type, l.party_id, l.amount, l.memo, l.fc);
    const rec = kind === 'receipt';
    const fcOf = (v) => fcCode ? { fc_code: fcCode, fc_amount: v, fc_rate_e6: rate } : {};
    L.post(db, { org_id: user.org_id, station_id: sid, date, source: 'voucher', source_id: id, user_id: opts.user_id || user.id, memo: memo || (rec ? 'سند قبض' : 'سند صرف') + (refNo ? ' ' + refNo : ''),
      lines: [{ a: box.id, dr: rec ? amount : 0, cr: rec ? 0 : amount, ...fcOf(fcTotal) }, ...lines.map(l => ({ a: l.a.id, dr: rec ? 0 : l.amount, cr: rec ? l.amount : 0, party_type: l.party_type, party_id: l.party_id, memo: l.memo, ...fcOf(l.fc) }))] });
    db.prepare("UPDATE journals SET doc_type=?, ref=COALESCE(ref, ?) WHERE source='voucher' AND source_id=?").run(rec ? 'سند قبض' : 'سند صرف', refNo, id);
    audit(db, user, sid, 'voucher.' + kind, 'voucher', id, { amount, lines: lines.length });
    return { id, amount };
  });
}
function voidVoucher(db, user, sid, id, reason) {
  need(user, 'voucher.void'); station(db, user, sid);
  const r = V.str(reason, 'reason', { min: 3, max: 200 });
  return tx(db, () => {
    const v = scoped(db, 'vouchers', id, sid, 'Voucher');
    if (v.voided_at) throw conflict('ALREADY_VOIDED', 'This record is already voided');
    if (v.shift_id) { const sh = db.prepare('SELECT status FROM shifts WHERE id=?').get(v.shift_id); if (sh.status !== 'open') throw conflict('SHIFT_CLOSED', 'This record belongs to a closed shift and cannot be changed'); }
    L.assertOpen(db, user.org_id, v.business_date);
    L.reverseSource(db, user.org_id, 'voucher', id, user.id, 'Void: ' + r);
    db.prepare("UPDATE vouchers SET voided_at=datetime('now'), void_reason=?, void_by=? WHERE id=?").run(r, user.id, id);
    audit(db, user, sid, 'voucher.void', 'voucher', id, { reason: r });
    return { ok: true };
  });
}
/* cash that vouchers moved through the sales drawer during a shift */
function shiftVoucherCash(db, shiftId) {
  const r = db.prepare("SELECT COALESCE(SUM(CASE kind WHEN 'receipt' THEN amount END),0) rin, COALESCE(SUM(CASE kind WHEN 'payment' THEN amount END),0) rout FROM vouchers WHERE shift_id=? AND voided_at IS NULL").get(shiftId);
  return { voucher_receipts: r.rin, voucher_payments: r.rout };
}

/* ============================== DAILY METER SHEET ============================== */
function meterSheet(db, user, sid, q) {
  need(user, 'report.read'); const st = station(db, user, sid);
  const to = V.date(q.to, 'to', { optional: true }) || tzToday(st.timezone), from = V.date(q.from, 'from', { optional: true }) || to.slice(0, 8) + '01';
  if (from > to) throw bad('VALIDATION', 'from must not be after to');
  const rows = db.prepare(`SELECT s.business_date date, s.pump_id, p.name pump_name, f.name fuel_name, MIN(s.open_ml) open_ml, MAX(s.close_ml) close_ml,
      SUM(s.quantity_ml) qty_ml, SUM(s.gross) amount, SUM(CASE s.pay_type WHEN 'cash' THEN s.gross ELSE 0 END) cash, SUM(CASE s.pay_type WHEN 'credit' THEN s.gross ELSE 0 END) credit,
      SUM(s.cogs) cogs, COUNT(*) n, MAX(s.price_e4) price_e4
    FROM sales s JOIN pumps p ON p.id=s.pump_id JOIN fuels f ON f.id=s.fuel_id
    WHERE s.station_id=? AND s.business_date BETWEEN ? AND ? AND s.voided_at IS NULL
    GROUP BY s.business_date, s.pump_id ORDER BY s.business_date, p.name`).all(sid, from, to);
  const days = new Map();
  for (const r of rows) {
    const d = days.get(r.date) || { date: r.date, qty_ml: 0, amount: 0, cash: 0, credit: 0, pumps: [] };
    d.qty_ml += r.qty_ml; d.amount += r.amount; d.cash += r.cash; d.credit += r.credit; d.pumps.push(r); days.set(r.date, d);
  }
  const list = [...days.values()];
  const tot = list.reduce((t, d) => ({ qty_ml: t.qty_ml + d.qty_ml, amount: t.amount + d.amount, cash: t.cash + d.cash, credit: t.credit + d.credit }), { qty_ml: 0, amount: 0, cash: 0, credit: 0 });
  return { from, to, currency: st.currency, cur_dec: st.cur_dec, days: list, totals: tot };
}

/* ============================== LETTERHEAD ============================== */
const LOGO_RE = /^data:image\/(svg\+xml|png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
function getBrand(db, user) {
  need(user, 'read');
  const b = db.prepare('SELECT * FROM org_brand WHERE org_id=?').get(user.org_id) || {};
  const org = db.prepare('SELECT name FROM orgs WHERE id=?').get(user.org_id);
  return { name: b.name || org.name, activity: b.activity || '', address: b.address || '', phones: b.phones || '', footer: b.footer || '', logo: b.logo || null };
}
function setBrand(db, user, b) {
  need(user, 'config.edit'); V.obj(b, 'body');
  const cur = getBrand(db, user);
  const val = (k, max) => b[k] === undefined ? cur[k] : (V.str(b[k], k, { max, optional: true }) || '');
  let logo = cur.logo;
  if (b.logo !== undefined) {
    if (b.logo === null || b.logo === '') logo = null;
    else { if (typeof b.logo !== 'string' || b.logo.length > 600_000 || !LOGO_RE.test(b.logo)) throw bad('VALIDATION', 'The logo must be a PNG, JPEG, WEBP or SVG image under 400 KB'); logo = b.logo; }
  }
  return tx(db, () => {
    db.prepare(`INSERT INTO org_brand(org_id,name,activity,address,phones,footer,logo,updated_at) VALUES(?,?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(org_id) DO UPDATE SET name=excluded.name, activity=excluded.activity, address=excluded.address, phones=excluded.phones, footer=excluded.footer, logo=excluded.logo, updated_at=excluded.updated_at`)
      .run(user.org_id, val('name', 120), val('activity', 160), val('address', 200), val('phones', 120), val('footer', 200), logo);
    audit(db, user, null, 'brand.update', 'org', user.org_id, { fields: Object.keys(b) });
    return getBrand(db, user);
  });
}

/* ============================== MONTHLY STOCK RECONCILIATION (الجرد الشهري) ============================== */
/** For every tank and month of `year`: opening, received, sold, counted differences, closing; shortage as a share of sales
    against the station's tolerance (evaporation / handling). Read straight from the perpetual stock ledger. */
function stockMonthly(db, user, sid, q) {
  need(user, 'report.read'); const st = station(db, user, sid);
  const year = q.year ? V.int(Number(q.year), 'year', { min: 2000, max: 2100 }) : Number(tzToday(st.timezone).slice(0, 4));
  const tanks = db.prepare('SELECT t.*, f.name fuel_name FROM tanks t JOIN fuels f ON f.id=t.fuel_id WHERE t.station_id=? ORDER BY t.id').all(sid);
  const out = [];
  for (const t of tanks) {
    const months = [];
    for (let m = 1; m <= 12; m++) {
      const from = `${year}-${String(m).padStart(2, '0')}-01`, to = new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
      if (from > tzToday(st.timezone)) break;
      const open = db.prepare('SELECT COALESCE(SUM(qty_ml),0) q, COALESCE(SUM(value),0) v FROM stock_moves WHERE tank_id=? AND business_date<?').get(t.id, from);
      const k = Object.fromEntries(db.prepare(`SELECT kind || CASE WHEN kind='count' AND ref_type='revaluation' THEN '_reval' ELSE '' END k, SUM(qty_ml) q, SUM(value) v FROM stock_moves WHERE tank_id=? AND business_date BETWEEN ? AND ? GROUP BY 1`).all(t.id, from, to).map(r => [r.k, r]));
      const g = (x, f = 'q') => (k[x] ? k[x][f] : 0);
      const sold = -g('sale'), received = g('delivery') + g('transfer_in'), out_ = -g('transfer_out'), counted = g('count') + g('opening') + g('void');
      const closing = open.q + received - sold - out_ + counted;
      const shortage = Math.max(-g('count'), 0), surplus = Math.max(g('count'), 0);
      const adjs = db.prepare(`SELECT a.business_date, a.before_ml, a.after_ml, a.note FROM adjustments a WHERE a.tank_id=? AND a.business_date BETWEEN ? AND ? ORDER BY a.id`).all(t.id, from, to);
      months.push({ month: from.slice(0, 7), opening_ml: open.q, received_ml: received, sold_ml: sold, transfer_out_ml: out_, counted_ml: g('count'), shortage_ml: shortage, surplus_ml: surplus, closing_ml: closing,
        loss_value: -g('count', 'v'), loss_bp: sold ? Math.round(-g('count') * 10000 / sold) : 0, over_tolerance: sold > 0 && -g('count') * 10000 / sold > st.loss_tolerance_bp, counts: adjs });
    }
    const tot = months.reduce((a, x) => ({ sold_ml: a.sold_ml + x.sold_ml, received_ml: a.received_ml + x.received_ml, counted_ml: a.counted_ml + x.counted_ml, loss_value: a.loss_value + x.loss_value }), { sold_ml: 0, received_ml: 0, counted_ml: 0, loss_value: 0 });
    out.push({ tank_id: t.id, tank_name: t.name, fuel_name: t.fuel_name, level_ml: t.level_ml, capacity_ml: t.capacity_ml, avg_cost_e4: t.avg_cost_e4, months, totals: { ...tot, loss_bp: tot.sold_ml ? Math.round(-tot.counted_ml * 10000 / tot.sold_ml) : 0 } });
  }
  return { year, tolerance_bp: st.loss_tolerance_bp, currency: st.currency, cur_dec: st.cur_dec, tanks: out };
}

/* ============================== CURRENCIES & EXCHANGE RATES ============================== */
/** The rate (base units per 1 unit of `code`, x1e6) in force on `date`: the latest one on or before it. */
function rateOn(db, orgId, code, date) {
  const r = db.prepare('SELECT rate_e6 FROM exchange_rates WHERE org_id=? AND code=? AND rate_date<=? ORDER BY rate_date DESC LIMIT 1').get(orgId, code, date || '9999-12-31');
  return r ? r.rate_e6 : null;
}
function listCurrencies(db, user) {
  need(user, 'read');
  return db.prepare('SELECT * FROM currencies WHERE org_id=? ORDER BY code').all(user.org_id).map(c => ({ ...c, rate_e6: rateOn(db, user.org_id, c.code),
    rate_date: (db.prepare('SELECT rate_date FROM exchange_rates WHERE org_id=? AND code=? ORDER BY rate_date DESC LIMIT 1').get(user.org_id, c.code) || {}).rate_date || null,
    history: db.prepare('SELECT rate_date, rate_e6 FROM exchange_rates WHERE org_id=? AND code=? ORDER BY rate_date DESC LIMIT 30').all(user.org_id, c.code),
    accounts: db.prepare('SELECT id, code, name_ar, name_en FROM accounts WHERE org_id=? AND currency=? ORDER BY code').all(user.org_id, c.code) }));
}
function saveCurrency(db, user, b) {
  need(user, 'config.edit'); V.obj(b, 'body');
  const code = V.str(b.code, 'code', { min: 3, max: 3 }).toUpperCase(); if (!/^[A-Z]{3}$/.test(code)) throw bad('VALIDATION', 'Currency code must be 3 letters');
  return tx(db, () => {
    db.prepare(`INSERT INTO currencies(org_id,code,name_ar,name_en,decimals) VALUES(?,?,?,?,?) ON CONFLICT(org_id,code) DO UPDATE SET name_ar=excluded.name_ar, name_en=excluded.name_en, decimals=excluded.decimals`)
      .run(user.org_id, code, V.str(b.name_ar, 'name_ar', { max: 60 }), V.str(b.name_en || b.name_ar, 'name_en', { max: 60 }), V.int(b.decimals ?? 2, 'decimals', { min: 0, max: 3 }));
    if (b.rate_e6) setRate(db, user, { code, rate_e6: b.rate_e6, date: b.date });
    audit(db, user, null, 'currency.save', 'currency', null, { code }); return { ok: true };
  });
}
function setRate(db, user, b) {
  need(user, 'config.edit'); V.obj(b, 'body');
  const code = V.str(b.code, 'code', { min: 3, max: 3 }).toUpperCase();
  if (!db.prepare('SELECT 1 FROM currencies WHERE org_id=? AND code=?').get(user.org_id, code)) throw notFound('Currency');
  const date = V.date(b.date, 'date', { optional: true }) || new Date().toISOString().slice(0, 10), rate = V.int(b.rate_e6, 'rate_e6', { min: 1, max: 10 ** 13 });
  return tx(db, () => {
    db.prepare('INSERT INTO exchange_rates(org_id,code,rate_date,rate_e6,user_id) VALUES(?,?,?,?,?) ON CONFLICT(org_id,code,rate_date) DO UPDATE SET rate_e6=excluded.rate_e6, user_id=excluded.user_id').run(user.org_id, code, date, rate, user.id);
    audit(db, user, null, 'currency.rate', 'currency', null, { code, date, rate_e6: rate }); return { ok: true };
  });
}
/** Foreign-currency accounts: balance in the currency, book value in the base currency, and what it is worth at the rate of `date`. */
function revaluation(db, user, q, post = false) {
  need(user, post ? 'journal.post' : 'report.read');
  const sid = V.int(Number(q.station_id), 'station_id', { min: 1 }); const st = station(db, user, sid);
  const date = V.date(q.date, 'date', { optional: true }) || tzToday(st.timezone);
  const rows = [];
  for (const a of db.prepare("SELECT * FROM accounts WHERE org_id=? AND currency IS NOT NULL AND currency<>? AND is_group=0").all(user.org_id, st.currency)) {
    const b = db.prepare(`SELECT COALESCE(SUM(l.debit-l.credit),0) base, COALESCE(SUM(CASE WHEN l.fc_code=? THEN (CASE WHEN l.debit>0 THEN l.fc_amount ELSE -l.fc_amount END) ELSE 0 END),0) fc
      FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE l.account_id=? AND j.status='posted' AND j.station_id=? AND j.business_date<=?`).get(a.currency, a.id, sid, date);
    const cur = db.prepare('SELECT * FROM currencies WHERE org_id=? AND code=?').get(user.org_id, a.currency) || { decimals: 2 };
    const rate = rateOn(db, user.org_id, a.currency, date);
    const worth = rate ? Math.round(b.fc * rate * 10 ** st.cur_dec / (1e6 * 10 ** cur.decimals)) : null;
    rows.push({ account_id: a.id, code: a.code, name_ar: a.name_ar, name_en: a.name_en, currency: a.currency, fc_balance: b.fc, fc_decimals: cur.decimals, book: b.base, rate_e6: rate, worth, diff: worth === null ? null : worth - b.base });
  }
  if (!post) return { date, currency: st.currency, cur_dec: st.cur_dec, rows };
  const lines = [];
  for (const r of rows) if (r.diff) lines.push({ a: r.account_id, dr: Math.max(r.diff, 0), cr: Math.max(-r.diff, 0), memo: `${r.currency} @ ${(r.rate_e6 / 1e6)}` }, { a: 'fx', dr: Math.max(-r.diff, 0), cr: Math.max(r.diff, 0) });
  if (!lines.length) throw conflict('NOTHING_TO_POST', 'Every foreign-currency account is already at the rate of this date');
  return tx(db, () => { const id = L.post(db, { org_id: user.org_id, station_id: sid, date, source: 'fx_reval', memo: 'تقييم العملات بتاريخ ' + date, user_id: user.id, lines });
    audit(db, user, sid, 'fx.revalue', 'journal', id, { date }); return { id, rows }; });
}

/* ============================== FIXED ASSETS & DEPRECIATION ============================== */
function assetRow(db, a) {
  const dep = db.prepare(`SELECT COALESCE(SUM(l.credit-l.debit),0) v FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE j.source='depreciation' AND j.source_id=? AND l.account_id=? AND j.status='posted'`).get(a.id, a.accum_account_id).v;
  const accum = a.opening_accum + dep, base = a.cost - a.salvage;
  const monthly = a.life_months ? Math.floor(base / a.life_months) : 0;
  const last = db.prepare("SELECT MAX(ref) m FROM journals WHERE source='depreciation' AND source_id=? AND reversed_by IS NULL AND reversal_of IS NULL").get(a.id).m;
  return { ...a, accumulated: accum, book_value: a.cost - accum, monthly, remaining: Math.max(base - accum, 0), last_month: last || null };
}
function listAssets(db, user, sid) {
  need(user, 'report.read'); station(db, user, sid);
  return db.prepare(`SELECT f.*, a.code acct_code, a.name_ar acct_name FROM fixed_assets f JOIN accounts a ON a.id=f.account_id WHERE f.station_id=? ORDER BY a.code, f.id`).all(sid).map(a => assetRow(db, a));
}
function saveAsset(db, user, sid, b, id) {
  need(user, 'account.edit'); station(db, user, sid); V.obj(b, 'body');
  return tx(db, () => {
    const cur = id ? db.prepare('SELECT * FROM fixed_assets WHERE id=? AND station_id=?').get(id, sid) : null; if (id && !cur) throw notFound('Asset');
    const acct = (k, sys) => { const v = b[k] ?? (cur && cur[k]); const r = v ? db.prepare('SELECT * FROM accounts WHERE id=? AND org_id=?').get(V.int(v, k, { min: 1 }), user.org_id) : db.prepare('SELECT * FROM accounts WHERE org_id=? AND sys=?').get(user.org_id, sys);
      if (!r || r.is_group) throw bad('VALIDATION', 'Choose a detail account for ' + k); return r.id; };
    L.ensureChart(db, user.org_id);
    const f = { name: b.name === undefined ? cur.name : V.str(b.name, 'name', { max: 120 }), ref: b.ref === undefined ? (cur ? cur.ref : null) : (V.str(b.ref, 'ref', { max: 30, optional: true }) || null),
      account_id: acct('account_id', 'exp_other'), accum_account_id: acct('accum_account_id', 'accum_dep'), expense_account_id: acct('expense_account_id', 'exp_dep'),
      acquired_on: b.acquired_on === undefined ? cur.acquired_on : V.date(b.acquired_on, 'acquired_on'), cost: b.cost === undefined ? cur.cost : V.int(b.cost, 'cost', { min: 0, max: 10 ** 14 }),
      salvage: b.salvage === undefined ? (cur ? cur.salvage : 0) : V.int(b.salvage, 'salvage', { min: 0, max: 10 ** 14 }), life_months: b.life_months === undefined ? (cur ? cur.life_months : 0) : V.int(b.life_months, 'life_months', { min: 0, max: 1200 }),
      opening_accum: b.opening_accum === undefined ? (cur ? cur.opening_accum : 0) : V.int(b.opening_accum, 'opening_accum', { min: 0, max: 10 ** 14 }),
      disposed_on: b.disposed_on === undefined ? (cur ? cur.disposed_on : null) : (b.disposed_on ? V.date(b.disposed_on, 'disposed_on') : null), note: b.note === undefined ? (cur ? cur.note : null) : (V.str(b.note, 'note', { max: 200, optional: true }) || null) };
    if (f.salvage > f.cost) throw bad('VALIDATION', 'Salvage value cannot exceed the cost');
    if (cur) db.prepare('UPDATE fixed_assets SET name=?,ref=?,account_id=?,accum_account_id=?,expense_account_id=?,acquired_on=?,cost=?,salvage=?,life_months=?,opening_accum=?,disposed_on=?,note=? WHERE id=?')
      .run(f.name, f.ref, f.account_id, f.accum_account_id, f.expense_account_id, f.acquired_on, f.cost, f.salvage, f.life_months, f.opening_accum, f.disposed_on, f.note, id);
    else id = Number(db.prepare('INSERT INTO fixed_assets(org_id,station_id,name,ref,account_id,accum_account_id,expense_account_id,acquired_on,cost,salvage,life_months,opening_accum,disposed_on,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(user.org_id, sid, f.name, f.ref, f.account_id, f.accum_account_id, f.expense_account_id, f.acquired_on, f.cost, f.salvage, f.life_months, f.opening_accum, f.disposed_on, f.note).lastInsertRowid);
    audit(db, user, sid, cur ? 'asset.update' : 'asset.create', 'asset', id, { name: f.name }); return { id };
  });
}
/** Post one month's straight-line depreciation for every asset that is due it (once per asset and month). */
function runDepreciation(db, user, sid, b) {
  need(user, 'journal.post'); const st = station(db, user, sid); V.obj(b, 'body');
  const month = V.str(b.month, 'month', { min: 7, max: 7 }); if (!/^\d{4}-\d{2}$/.test(month)) throw bad('VALIDATION', 'month must be YYYY-MM');
  const end = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5), 0)).toISOString().slice(0, 10);
  const date = end > tzToday(st.timezone) ? tzToday(st.timezone) : end;
  if (month > tzToday(st.timezone).slice(0, 7)) throw bad('FUTURE_DATE', 'That month has not started');
  return tx(db, () => {
    const done = [];
    for (const a0 of db.prepare('SELECT * FROM fixed_assets WHERE station_id=? AND life_months>0').all(sid)) {
      const a = assetRow(db, a0);
      if (a.acquired_on > end || (a.disposed_on && a.disposed_on < month + '-01')) continue;
      if (db.prepare("SELECT 1 FROM journals WHERE source='depreciation' AND source_id=? AND ref=? AND reversed_by IS NULL AND reversal_of IS NULL").get(a.id, month)) continue;
      const amt = Math.min(a.monthly, a.remaining); if (amt <= 0) continue;
      const jid = L.post(db, { org_id: user.org_id, station_id: sid, date, source: 'depreciation', source_id: a.id, memo: `إهلاك ${a.name} لشهر ${month}`, user_id: user.id,
        lines: [{ a: a.expense_account_id, dr: amt }, { a: a.accum_account_id, cr: amt }] });
      db.prepare('UPDATE journals SET ref=? WHERE id=?').run(month, jid); done.push({ id: a.id, name: a.name, amount: amt });
    }
    audit(db, user, sid, 'asset.depreciate', 'station', sid, { month, assets: done.length });
    return { month, date, posted: done, total: done.reduce((s, x) => s + x.amount, 0) };
  });
}

/* ============================== SALES REGISTER (سجل المبيعات / فواتير العدادات) ============================== */
function salesRegister(db, user, sid, q) {
  need(user, 'report.read'); const st = station(db, user, sid);
  const to = V.date(q.to, 'to', { optional: true }) || tzToday(st.timezone), from = V.date(q.from, 'from', { optional: true }) || to.slice(0, 8) + '01';
  const fuel = q.fuel_id ? V.int(Number(q.fuel_id), 'fuel_id', { min: 1 }) : null, cust = q.customer_id ? V.int(Number(q.customer_id), 'customer_id', { min: 1 }) : null;
  const pay = q.pay_type ? V.oneOf(q.pay_type, 'pay_type', ['cash', 'credit']) : null, term = q.q ? '%' + V.str(q.q, 'q', { max: 60 }) + '%' : null;
  const where = `s.station_id=? AND s.business_date BETWEEN ? AND ? AND s.voided_at IS NULL AND (? IS NULL OR s.fuel_id=?) AND (? IS NULL OR s.customer_id=?) AND (? IS NULL OR s.pay_type=?)
    AND (? IS NULL OR s.note LIKE ? OR c.name LIKE ? OR s.ref = ?)`;
  const args = [sid, from, to, fuel, fuel, cust, cust, pay, pay, term, term, term, q.q || null];
  /* one row per bill: imported bills keep their number (ref); sales made here are one bill each */
  const bills = db.prepare(`SELECT COALESCE(s.ref, 'S' || s.id) bill, MIN(s.business_date) date, f.name fuel_name, GROUP_CONCAT(DISTINCT p.name) pumps,
      SUM(s.quantity_ml) qty_ml, SUM(s.gross) amount, SUM(CASE s.pay_type WHEN 'cash' THEN s.gross ELSE 0 END) cash, SUM(CASE s.pay_type WHEN 'credit' THEN s.gross ELSE 0 END) credit,
      SUM(s.cogs) cogs, COUNT(*) n, MAX(s.price_e4) price_e4, MIN(s.id) first_id
    FROM sales s JOIN fuels f ON f.id=s.fuel_id JOIN pumps p ON p.id=s.pump_id LEFT JOIN customers c ON c.id=s.customer_id
    WHERE ${where} GROUP BY COALESCE(s.ref, 'S' || s.id), s.fuel_id ORDER BY date DESC, first_id DESC LIMIT 2000`).all(...args);
  const t = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(s.quantity_ml),0) qty_ml, COALESCE(SUM(s.gross),0) amount, COALESCE(SUM(CASE s.pay_type WHEN 'cash' THEN s.gross END),0) cash,
      COALESCE(SUM(CASE s.pay_type WHEN 'credit' THEN s.gross END),0) credit, COALESCE(SUM(s.cogs),0) cogs FROM sales s LEFT JOIN customers c ON c.id=s.customer_id WHERE ${where}`).get(...args);
  const byFuel = db.prepare(`SELECT f.name fuel_name, SUM(s.quantity_ml) qty_ml, SUM(s.gross) amount, SUM(s.cogs) cogs FROM sales s JOIN fuels f ON f.id=s.fuel_id LEFT JOIN customers c ON c.id=s.customer_id
    WHERE ${where} GROUP BY s.fuel_id ORDER BY amount DESC`).all(...args);
  return { from, to, currency: st.currency, cur_dec: st.cur_dec, bills, totals: t, by_fuel: byFuel };
}
function salesBill(db, user, sid, bill) {
  need(user, 'report.read'); station(db, user, sid);
  const b = V.str(bill, 'bill', { max: 40 });
  const rows = db.prepare(`SELECT s.*, p.name pump_name, f.name fuel_name, c.name customer_name, c.ref customer_ref FROM sales s JOIN pumps p ON p.id=s.pump_id JOIN fuels f ON f.id=s.fuel_id LEFT JOIN customers c ON c.id=s.customer_id
    WHERE s.station_id=? AND (s.ref=? OR ('S' || s.id)=?) ORDER BY s.id`).all(sid, b, b);
  if (!rows.length) throw notFound('Bill');
  return { bill: b, date: rows[0].business_date, rows };
}

/* ============================== PURCHASE INVOICES (فواتير المشتريات) ============================== */
function purchases(db, user, sid, q) {
  need(user, 'report.read'); const st = station(db, user, sid);
  const to = V.date(q.to, 'to', { optional: true }) || tzToday(st.timezone), from = V.date(q.from, 'from', { optional: true }) || to.slice(0, 8) + '01';
  const sup = q.supplier_id ? V.int(Number(q.supplier_id), 'supplier_id', { min: 1 }) : null, fuel = q.fuel_id ? V.int(Number(q.fuel_id), 'fuel_id', { min: 1 }) : null;
  const term = q.q ? '%' + V.str(q.q, 'q', { max: 60 }) + '%' : null;
  const rows = db.prepare(`SELECT d.*, t.name tank_name, f.name fuel_name, s.name supplier_name, s.ref supplier_ref, u.name user_name FROM deliveries d JOIN tanks t ON t.id=d.tank_id JOIN fuels f ON f.id=d.fuel_id
      LEFT JOIN suppliers s ON s.id=d.supplier_id LEFT JOIN users u ON u.id=d.user_id
    WHERE d.station_id=? AND d.business_date BETWEEN ? AND ? AND (? IS NULL OR d.supplier_id=?) AND (? IS NULL OR d.fuel_id=?)
      AND (? IS NULL OR d.note LIKE ? OR d.ref = ? OR s.name LIKE ?) ORDER BY d.business_date DESC, d.id DESC LIMIT 2000`)
    .all(sid, from, to, sup, sup, fuel, fuel, term, term, q.q || null, term)
    .map(d => ({ ...d, total: d.net + d.vat, payable: d.pay_type === 'credit' ? (d.payable ?? d.net + d.vat) : 0, other_cost: d.pay_type === 'credit' ? (d.net + d.vat) - (d.payable ?? d.net + d.vat) : 0 }));
  const live = rows.filter(r => !r.voided_at);
  const sum = (k) => live.reduce((s, r) => s + r[k], 0);
  const byFuel = {}; for (const r of live) { const x = byFuel[r.fuel_name] || (byFuel[r.fuel_name] = { fuel_name: r.fuel_name, qty_ml: 0, total: 0, n: 0 }); x.qty_ml += r.quantity_ml; x.total += r.total; x.n++; }
  return { from, to, currency: st.currency, cur_dec: st.cur_dec, rows, totals: { n: live.length, qty_ml: sum('quantity_ml'), total: sum('total'), payable: sum('payable'), other_cost: sum('other_cost') }, by_fuel: Object.values(byFuel) };
}
function purchaseDetail(db, user, sid, id) {
  need(user, 'report.read'); station(db, user, sid);
  const d = db.prepare(`SELECT d.*, t.name tank_name, f.name fuel_name, s.name supplier_name, s.ref supplier_ref FROM deliveries d JOIN tanks t ON t.id=d.tank_id JOIN fuels f ON f.id=d.fuel_id LEFT JOIN suppliers s ON s.id=d.supplier_id WHERE d.id=? AND d.station_id=?`).get(id, sid);
  if (!d) throw notFound('Delivery');
  const lines = db.prepare(`SELECT l.*, a.code, a.name_ar, a.name_en, CASE l.party_type WHEN 'supplier' THEN (SELECT name FROM suppliers WHERE id=l.party_id) END party_name FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id
    WHERE j.source='delivery' AND j.source_id=? AND j.reversal_of IS NULL ORDER BY l.id`).all(id);
  return { ...d, lines };
}

/* ============================== MONTHLY PROFIT & LOSS (الأرباح والخسائر) ============================== */
function profitByMonth(db, user, q) {
  need(user, 'report.read');
  const sid = V.int(Number(q.station_id), 'station_id', { min: 1 }); const st = station(db, user, sid);
  const year = q.year ? V.int(Number(q.year), 'year', { min: 2000, max: 2100 }) : Number(tzToday(st.timezone).slice(0, 4));
  const O = require('./ops'); const months = [];
  for (let m = 1; m <= 12; m++) {
    const from = `${year}-${String(m).padStart(2, '0')}-01`; const to = new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
    if (from > tzToday(st.timezone)) break;
    const is = O.incomeStatement(db, user, { station_id: sid, from, to });
    const s = db.prepare('SELECT COALESCE(SUM(quantity_ml),0) q FROM sales WHERE station_id=? AND voided_at IS NULL AND business_date BETWEEN ? AND ?').get(sid, from, to);
    months.push({ month: from.slice(0, 7), qty_ml: s.q, revenue: is.revenue, cost_of_sales: is.cost_of_sales, gross_profit: is.gross_profit, operating_expenses: is.operating_expenses, other_income: is.other_income, net_profit: is.net_profit,
      expenses: is.rows.filter(r => r.sec === 'opex' && r.amount).map(r => ({ code: r.code, name_ar: r.name_ar, name_en: r.name_en, amount: r.amount })) });
  }
  const fuels = db.prepare(`SELECT f.name fuel_name, substr(s.business_date,1,7) month, SUM(s.quantity_ml) qty_ml, SUM(s.net) revenue, SUM(s.cogs) cogs FROM sales s JOIN fuels f ON f.id=s.fuel_id
    WHERE s.station_id=? AND s.voided_at IS NULL AND s.business_date BETWEEN ? AND ? GROUP BY f.id, month ORDER BY f.id, month`).all(sid, `${year}-01-01`, `${year}-12-31`);
  return { year, currency: st.currency, cur_dec: st.cur_dec, months, fuels };
}

/* ============================== PRICE HISTORY ============================== */
function priceHistory(db, user, sid) {
  need(user, 'read'); station(db, user, sid);
  return db.prepare(`SELECT h.*, f.name fuel_name, u.name user_name FROM price_history h JOIN fuels f ON f.id=h.fuel_id LEFT JOIN users u ON u.id=h.user_id
    WHERE h.station_id=? ORDER BY h.effective_at DESC, h.id DESC LIMIT 500`).all(sid);
}

/** Cut a running-balance statement to a period: opening balance before `from`, the rows inside, and the period totals. */
function periodize(st, q) {
  const from = q && q.from ? V.date(q.from, 'from') : null, to = q && q.to ? V.date(q.to, 'to') : null;
  if (from && to && from > to) throw bad('VALIDATION', 'from must not be after to');
  if (!from && !to) { const live = st.entries.filter(e => !e.voided); return { ...st, from: null, to: null, opening: 0, total_debit: live.reduce((s, e) => s + e.debit, 0), total_credit: live.reduce((s, e) => s + e.credit, 0) }; }
  let opening = 0; const rows = [];
  for (const e of st.entries) {
    const d = e.date || '';
    if (from && d < from) { if (!e.voided) opening = e.balance; continue; }
    if (to && d > to) continue;
    rows.push(e);
  }
  const live = rows.filter(e => !e.voided);
  const closing = live.length ? live[live.length - 1].balance : opening;
  return { ...st, from, to, opening, entries: rows, balance: closing, total_debit: live.reduce((s, e) => s + e.debit, 0), total_credit: live.reduce((s, e) => s + e.credit, 0) };
}

module.exports = { stockMonthly, rateOn, listCurrencies, saveCurrency, setRate, revaluation, listAssets, saveAsset, runDepreciation, salesRegister, salesBill, purchases, purchaseDetail, profitByMonth, priceHistory, getBrand, setBrand, periodize, DOC_SOURCES, partyExtras, accountTree, createAccount, updateAccount, checkLine, boxes, listVouchers, getVoucher, createVoucher, voidVoucher, shiftVoucherCash, meterSheet };
