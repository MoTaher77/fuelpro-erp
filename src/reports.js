'use strict';
/* FuelPro reports added after the import: cash & bank box movement, customer collections follow-up,
   the daily station report, and the year-end closing entry. None of them changes the schema. */
const L = require('./ledger');
const V = require('./validate');
const { tx } = require('./db');
const { bad, conflict, forbidden } = require('./errors');
const S = require('./services');
const B = require('./books');
const auth = require('./auth');
const { need, audit, tzToday, addDays, station } = S;

const period = (st, q, maxDays = 1100) => {
  const to = V.date(q.to, 'to', { optional: true }) || tzToday(st.timezone), from = V.date(q.from, 'from', { optional: true }) || to;
  if (from > to) throw bad('VALIDATION', 'from must not be after to');
  if (addDays(from, maxDays) < to) throw bad('VALIDATION', 'The period is too long');
  return { from, to };
};

/* ============================== CASH & BANK BOXES (حركة الصناديق والبنوك) ============================== */
/**
 * Every box (cash drawer, foreign-currency box, bank or exchange account) with its opening balance, money in, money out and closing balance.
 * Foreign-currency boxes are also shown in their own currency. With box_account_id, the day-by-day movement of that box as well.
 */
function boxReport(db, user, sid, q) {
  need(user, 'report.read'); const st = station(db, user, sid); const { from, to } = period(st, q);
  const list = B.boxes(db, user);
  const agg = db.prepare(`SELECT COALESCE(SUM(CASE WHEN j.business_date<? THEN l.debit-l.credit END),0) ob,
      COALESCE(SUM(CASE WHEN j.business_date>=? THEN l.debit END),0) dr, COALESCE(SUM(CASE WHEN j.business_date>=? THEN l.credit END),0) cr,
      COALESCE(SUM(CASE WHEN j.business_date<? AND l.fc_code=? THEN CASE WHEN l.debit>0 THEN l.fc_amount ELSE -l.fc_amount END END),0) fob,
      COALESCE(SUM(CASE WHEN j.business_date>=? AND l.fc_code=? AND l.debit>0 THEN l.fc_amount END),0) fdr,
      COALESCE(SUM(CASE WHEN j.business_date>=? AND l.fc_code=? AND l.credit>0 THEN l.fc_amount END),0) fcr,
      COUNT(CASE WHEN j.business_date>=? THEN 1 END) n
    FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE l.account_id=? AND +j.station_id=? AND +j.status='posted' AND +j.business_date<=?`);
  /* `+j.…`: read this box's own lines (account index), not every journal of the station up to `to` (1.4x slower at 20 years) */
  const boxes = list.map(a => {
    const fc = a.currency && a.currency !== st.currency ? a.currency : null;
    const r = agg.get(from, from, from, from, fc, from, fc, from, fc, from, a.id, sid, to);
    return { account_id: a.id, code: a.code, name_ar: a.name_ar, name_en: a.name_en, kind: a.box || a.sys, currency: fc, opening: r.ob, debit: r.dr, credit: r.cr, closing: r.ob + r.dr - r.cr, moves: r.n,
      fc: fc ? { opening: r.fob, debit: r.fdr, credit: r.fcr, closing: r.fob + r.fdr - r.fcr } : null };
  }).filter(b => b.opening || b.moves || b.closing);
  const sum = (k) => boxes.reduce((s, b) => s + b[k], 0);
  const out = { from, to, currency: st.currency, cur_dec: st.cur_dec, boxes, totals: { opening: sum('opening'), debit: sum('debit'), credit: sum('credit'), closing: sum('closing') } };
  if (q.box_account_id) {
    const id = V.int(Number(q.box_account_id), 'box_account_id', { min: 1 }); const b = boxes.find(x => x.account_id === id) || list.find(x => x.id === id);
    if (!b) throw bad('NOT_A_BOX', 'Choose a cash box or bank account');
    const days = db.prepare(`SELECT j.business_date d, SUM(l.debit) dr, SUM(l.credit) cr, COUNT(*) n FROM journal_lines l JOIN journals j ON j.id=l.journal_id
      WHERE l.account_id=? AND j.station_id=? AND j.status='posted' AND j.business_date BETWEEN ? AND ? GROUP BY j.business_date ORDER BY j.business_date`).all(id, sid, from, to);
    let bal = (boxes.find(x => x.account_id === id) || { opening: 0 }).opening;
    out.days = days.map(d => { bal += d.dr - d.cr; return { date: d.d, debit: d.dr, credit: d.cr, moves: d.n, balance: bal }; });
    out.box_account_id = id;
  }
  return out;
}

/* ============================== COLLECTIONS FOLLOW-UP (متابعة التحصيل والحسابات الراكدة) ============================== */
/**
 * Customers who owe the station: balance, credit limit, last sale on credit, last payment received, and how many days since money last came in.
 * days = only customers with no payment for at least that many days (0 = everyone who owes).
 */
function collections(db, user, sid, q) {
  need(user, 'report.read'); const st = station(db, user, sid);
  const asOf = V.date(q.as_of, 'as_of', { optional: true }) || tzToday(st.timezone);
  const minDays = q.days ? V.int(Number(q.days), 'days', { min: 0, max: 3650 }) : 0;
  const rows = db.prepare(`SELECT c.id, c.name, c.ref, c.phone, c.credit_limit, c.terms_days,
      COALESCE(SUM(l.debit-l.credit),0) balance,
      MAX(CASE WHEN l.debit>0 THEN j.business_date END) last_debit,
      MAX(CASE WHEN l.credit>0 AND j.reversal_of IS NULL AND j.reversed_by IS NULL THEN j.business_date END) last_credit,
      MAX(j.business_date) last_move
    FROM customers c LEFT JOIN journal_lines l ON l.party_type='customer' AND l.party_id=c.id
      LEFT JOIN journals j ON j.id=l.journal_id AND j.status='posted' AND j.business_date<=?
      LEFT JOIN accounts a ON a.id=l.account_id
    WHERE c.station_id=? AND (l.id IS NULL OR (a.sys='ar' AND j.id IS NOT NULL)) GROUP BY c.id`).all(asOf, sid);
  const lastPay = db.prepare(`SELECT l.credit amount FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id
    WHERE l.party_type='customer' AND l.party_id=? AND a.sys='ar' AND l.credit>0 AND j.status='posted' AND j.business_date=? AND j.reversal_of IS NULL AND j.reversed_by IS NULL ORDER BY j.id DESC LIMIT 1`);
  const since = (d) => d ? Math.round((Date.parse(asOf) - Date.parse(d)) / 864e5) : null;
  const list = rows.filter(r => r.balance > 0).map(r => {
    const ref = r.last_credit || null, days = since(ref || r.last_debit);
    return { ...r, last_credit_amount: ref ? lastPay.get(r.id, ref).amount : 0, days_since_payment: days, idle_days: since(r.last_move), over_limit: r.credit_limit > 0 && r.balance > r.credit_limit, never_paid: !ref };
  }).filter(r => (r.days_since_payment ?? 99999) >= minDays).sort((a, b) => (b.days_since_payment ?? 99999) - (a.days_since_payment ?? 99999) || b.balance - a.balance);
  const band = (d) => d == null ? 'b4' : d <= 30 ? 'b1' : d <= 60 ? 'b2' : d <= 90 ? 'b3' : 'b4';
  const bands = { b1: 0, b2: 0, b3: 0, b4: 0 }; for (const r of list) { r.band = band(r.days_since_payment); bands[r.band] += r.balance; }
  return { as_of: asOf, days: minDays, currency: st.currency, cur_dec: st.cur_dec, rows: list, total: list.reduce((s, r) => s + r.balance, 0), over_limit: list.filter(r => r.over_limit).length, bands };
}

/* ============================== DAILY STATION REPORT (التقرير اليومي للمحطة) ============================== */
function dailyReport(db, user, sid, q) {
  need(user, 'report.read'); const st = station(db, user, sid);
  const date = V.date(q.date, 'date', { optional: true }) || tzToday(st.timezone);
  const meters = B.meterSheet(db, user, sid, { from: date, to: date });
  const fuels = db.prepare(`SELECT f.name fuel_name, SUM(s.quantity_ml) qty_ml, SUM(s.gross) amount, SUM(CASE s.pay_type WHEN 'cash' THEN s.gross ELSE 0 END) cash,
      SUM(CASE s.pay_type WHEN 'credit' THEN s.gross ELSE 0 END) credit, SUM(s.cogs) cogs, MAX(s.price_e4) price_e4
    FROM sales s JOIN fuels f ON f.id=s.fuel_id WHERE s.station_id=? AND s.business_date=? AND s.voided_at IS NULL GROUP BY f.id ORDER BY f.id`).all(sid, date);
  const credit = db.prepare(`SELECT c.name customer_name, c.ref, f.name fuel_name, SUM(s.quantity_ml) qty_ml, SUM(s.gross) amount, GROUP_CONCAT(DISTINCT s.note) note
    FROM sales s JOIN customers c ON c.id=s.customer_id JOIN fuels f ON f.id=s.fuel_id WHERE s.station_id=? AND s.business_date=? AND s.voided_at IS NULL AND s.pay_type='credit'
    GROUP BY c.id, f.id ORDER BY amount DESC`).all(sid, date);
  /* money that went in or out of a box that day, other than cash sales: vouchers, collections, payments, imported entries */
  const boxIds = B.boxes(db, user).map(a => a.id);
  const inB = boxIds.map(() => '?').join(',');
  const moves = boxIds.length ? db.prepare(`SELECT o.credit amount_in, o.debit amount_out, oa.code, oa.name_ar account_name, COALESCE(c.name, s.name) party_name, COALESCE(o.memo, j.memo) memo, j.doc_type, j.source,
      COALESCE(j.ref, (SELECT ref_no FROM vouchers v WHERE j.source='voucher' AND v.id=j.source_id)) ref,
      COALESCE((SELECT va.name_ar FROM vouchers v JOIN accounts va ON va.id=v.box_account_id WHERE j.source='voucher' AND v.id=j.source_id), (SELECT GROUP_CONCAT(DISTINCT ba.name_ar) FROM journal_lines bl JOIN accounts ba ON ba.id=bl.account_id WHERE bl.journal_id=j.id AND bl.account_id IN (${inB}))) box_name
    FROM journals j JOIN journal_lines o ON o.journal_id=j.id JOIN accounts oa ON oa.id=o.account_id
      LEFT JOIN customers c ON o.party_type='customer' AND c.id=o.party_id LEFT JOIN suppliers s ON o.party_type='supplier' AND s.id=o.party_id
    WHERE j.station_id=? AND j.business_date=? AND j.status='posted' AND j.source<>'sale' AND j.reversal_of IS NULL AND j.reversed_by IS NULL
      AND o.account_id NOT IN (${inB}) AND EXISTS(SELECT 1 FROM journal_lines bl WHERE bl.journal_id=j.id AND bl.account_id IN (${inB}))
    ORDER BY j.id, o.id`).all(...boxIds, sid, date, ...boxIds, ...boxIds) : [];
  const expenses = db.prepare(`SELECT category, gross amount, note memo FROM expenses WHERE station_id=? AND business_date=? AND voided_at IS NULL ORDER BY id`).all(sid, date);
  const deliveries = db.prepare(`SELECT d.ref, f.name fuel_name, d.quantity_ml, d.net+d.vat total, s.name supplier_name FROM deliveries d JOIN fuels f ON f.id=d.fuel_id LEFT JOIN suppliers s ON s.id=d.supplier_id
    WHERE d.station_id=? AND d.business_date=? AND d.voided_at IS NULL ORDER BY d.id`).all(sid, date);
  const boxes = boxReport(db, user, sid, { from: date, to: date }).boxes;
  /* stock: book level at the end of the day = today's level minus everything that moved after that day */
  const tanks = db.prepare('SELECT t.id, t.name, f.name fuel_name, t.capacity_ml, t.level_ml FROM tanks t JOIN fuels f ON f.id=t.fuel_id WHERE t.station_id=? AND t.active=1 ORDER BY t.id').all(sid).map(t => {
    const after = db.prepare('SELECT COALESCE(SUM(qty_ml),0) v FROM stock_moves WHERE tank_id=? AND business_date>?').get(t.id, date).v;
    const day = db.prepare("SELECT COALESCE(SUM(CASE WHEN qty_ml>0 THEN qty_ml END),0) inq, COALESCE(SUM(CASE WHEN qty_ml<0 THEN -qty_ml END),0) outq FROM stock_moves WHERE tank_id=? AND business_date=?").get(t.id, date);
    const close = t.level_ml - after;
    return { tank_name: t.name, fuel_name: t.fuel_name, capacity_ml: t.capacity_ml, opening_ml: close - day.inq + day.outq, in_ml: day.inq, out_ml: day.outq, closing_ml: close };
  });
  const sum = (a, k) => a.reduce((s, r) => s + (r[k] || 0), 0);
  return { date, currency: st.currency, cur_dec: st.cur_dec, meters: meters.days[0] || null, fuels, credit, moves, expenses, deliveries, boxes, tanks,
    totals: { qty_ml: sum(fuels, 'qty_ml'), amount: sum(fuels, 'amount'), cash: sum(fuels, 'cash'), credit: sum(fuels, 'credit'), gross_profit: sum(fuels, 'amount') - sum(fuels, 'cogs'),
      receipts: sum(moves, 'amount_in'), payments: sum(moves, 'amount_out'), expenses: sum(expenses, 'amount'), deliveries: sum(deliveries, 'total') } };
}

/* ============================== YEAR-END CLOSING (إقفال السنة المالية) ============================== */
/* The closing entry moves each income and expense balance of the year into retained earnings, one entry per station, dated 31 December.
   Income statements leave it out so a closed year still shows its profit; balances carried into the next year start from zero. */
function yearState(db, user, year) {
  const sts = S.listStations(db, user);
  const retId = L.acct(db, user.org_id, 'retained'), ret = db.prepare('SELECT id, code, name_ar FROM accounts WHERE id=?').get(retId);
  return sts.map(st => {
    const rows = db.prepare(`SELECT a.id, a.code, a.name_ar, a.name_en, a.type, COALESCE(SUM(l.debit),0) debit, COALESCE(SUM(l.credit),0) credit
      FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id
      WHERE j.org_id=? AND j.station_id=? AND j.status='posted' AND j.source<>'year_close' AND j.business_date BETWEEN ? AND ? AND a.type IN('income','expense')
      GROUP BY a.id HAVING SUM(l.debit)<>SUM(l.credit) ORDER BY a.code`).all(user.org_id, st.id, `${year}-01-01`, `${year}-12-31`)
      .map(r => ({ ...r, balance: r.debit - r.credit }));
    const income = rows.filter(r => r.type === 'income').reduce((s, r) => s - r.balance, 0), expense = rows.filter(r => r.type === 'expense').reduce((s, r) => s + r.balance, 0);
    const closed = db.prepare("SELECT id, business_date, posted_at FROM journals WHERE org_id=? AND station_id=? AND source='year_close' AND source_id=? AND status='posted' AND reversal_of IS NULL AND reversed_by IS NULL").get(user.org_id, st.id, year);
    return { station_id: st.id, station_name: st.name, currency: st.currency, cur_dec: st.cur_dec, rows, income, expense, net_profit: income - expense, retained_account: ret, closed: closed || null };
  });
}
function yearClose(db, user, b, doPost) {
  need(user, doPost ? 'period.lock' : 'report.read'); V.obj(b, 'body');
  const year = V.int(Number(b.year), 'year', { min: 2000, max: 2100 });
  if (!doPost) return { year, locked_through: L.lockedThrough(db, user.org_id), stations: yearState(db, user, year) };
  if (!auth.ORG_WIDE.has(user.role)) throw forbidden('Only the owner or an administrator can close a financial year');
  const end = `${year}-12-31`;
  const today = S.tzToday((S.listStations(db, user)[0] || {}).timezone || 'UTC');
  if (today < end) throw bad('YEAR_NOT_ENDED', 'A year can be closed on or after 31 December');
  return tx(db, () => {
    const sts = yearState(db, user, year); let posted = 0;
    if (sts.some(s => s.closed)) throw conflict('ALREADY_CLOSED', 'This year is already closed');
    const drafts = db.prepare("SELECT COUNT(*) n FROM journals WHERE org_id=? AND status='draft' AND business_date<=?").get(user.org_id, end).n;
    if (drafts) throw conflict('DRAFTS_PENDING', 'Post or delete draft journals in this period first', { drafts });
    for (const s of sts) {
      if (!s.rows.length) continue;
      const lines = s.rows.map(r => ({ a: r.id, dr: r.balance < 0 ? -r.balance : 0, cr: r.balance > 0 ? r.balance : 0, memo: 'إقفال ' + year }));
      const net = s.net_profit;
      if (net) lines.push({ a: s.retained_account.id, dr: net < 0 ? -net : 0, cr: net > 0 ? net : 0, memo: (net > 0 ? 'صافي ربح ' : 'صافي خسارة ') + year });
      const jid = L.post(db, { org_id: user.org_id, station_id: s.station_id, date: end, source: 'year_close', source_id: year, user_id: user.id, memo: 'قيد إقفال السنة المالية ' + year, lines });
      db.prepare("UPDATE journals SET doc_type='قيد إقفال', ref=? WHERE id=?").run('YC' + year, jid); posted++;
    }
    if (b.lock) { const cur = L.lockedThrough(db, user.org_id); if (!cur || cur < end) db.prepare('UPDATE orgs SET locked_through=? WHERE id=?').run(end, user.org_id); }
    audit(db, user, null, 'year.close', 'org', user.org_id, { year, stations: posted, lock: !!b.lock });
    return { year, posted, locked_through: L.lockedThrough(db, user.org_id) };
  });
}
function yearReopen(db, user, b) {
  need(user, 'period.lock'); V.obj(b, 'body');
  if (!auth.ORG_WIDE.has(user.role)) throw forbidden('Only the owner or an administrator can reopen a financial year');
  const year = V.int(Number(b.year), 'year', { min: 2000, max: 2100 }), r = V.str(b.reason, 'reason', { min: 3, max: 200 });
  return tx(db, () => {
    const n = db.prepare("SELECT COUNT(*) n FROM journals WHERE org_id=? AND source='year_close' AND source_id=? AND status='posted' AND reversal_of IS NULL AND reversed_by IS NULL").get(user.org_id, year).n;
    if (!n) throw conflict('NOT_CLOSED', 'This year is not closed');
    L.assertOpen(db, user.org_id, `${year}-12-31`);
    L.reverseSource(db, user.org_id, 'year_close', year, user.id, 'إلغاء إقفال ' + year + ': ' + r);
    audit(db, user, null, 'year.reopen', 'org', user.org_id, { year, reason: r });
    return { ok: true, year };
  });
}

module.exports = { boxReport, collections, dailyReport, yearClose, yearReopen };
