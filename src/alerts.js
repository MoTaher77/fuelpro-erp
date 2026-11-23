'use strict';
/* «التنبيهات الذكية» — what needs the owner's attention right now, derived from the live books; nothing is stored.
   Each alert: { id, severity: critical|warning|info, kind, tab (screen to open), n, amount?, items[] }. Read-only. */
const S = require('./services');
const O = require('./ops');
const { need, station, tzToday, addDays } = S;

const SEV = { critical: 0, warning: 1, info: 2 };
const hoursSince = (sqlUtc) => (Date.now() - Date.parse(sqlUtc.replace(' ', 'T') + 'Z')) / 3600000;

function alerts(db, user, sid) {
  need(user, 'report.read'); const st = station(db, user, sid); const today = tzToday(st.timezone);
  const out = []; const add = (a) => out.push({ n: 1, items: [], ...a });
  const safe = (fn) => { try { fn(); } catch { /* one failing check must not hide the others */ } };

  /* 1. stock: below the tank's minimum, or less than a week of sales left */
  safe(() => {
    const since = addDays(today, -29);
    const low = [], soon = [];
    for (const t of db.prepare('SELECT t.id, t.name, t.level_ml, t.min_ml, f.name fuel FROM tanks t JOIN fuels f ON f.id=t.fuel_id WHERE t.station_id=? AND t.active=1').all(sid)) {
      const sold = db.prepare('SELECT COALESCE(SUM(quantity_ml),0) v FROM sales WHERE tank_id=? AND voided_at IS NULL AND business_date BETWEEN ? AND ?').get(t.id, since, today).v;
      const perDay = Math.round(sold / 30), cover = perDay ? Math.floor(t.level_ml / perDay) : null;
      const item = { name: t.name, fuel: t.fuel, level_ml: t.level_ml, min_ml: t.min_ml, days_cover: cover };
      if ((t.min_ml > 0 && t.level_ml <= t.min_ml) || (cover != null && cover <= 3)) low.push(item); else if (cover != null && cover <= 7) soon.push(item);
    }
    if (low.length) add({ id: 'stock_low', severity: 'critical', kind: 'stock_low', tab: 'stock', n: low.length, items: low });
    if (soon.length) add({ id: 'stock_soon', severity: 'warning', kind: 'stock_soon', tab: 'stock', n: soon.length, items: soon });
  });

  /* 2. a shift left open for too long */
  safe(() => {
    const sh = db.prepare("SELECT id, business_date, opened_at FROM shifts WHERE station_id=? AND status='open'").get(sid);
    if (sh) { const h = Math.floor(hoursSince(sh.opened_at)); if (h >= 16) add({ id: 'shift_open', severity: h >= 30 ? 'critical' : 'warning', kind: 'shift_open', tab: 'shift', items: [{ id: sh.id, date: sh.business_date, hours: h }] }); }
  });

  /* 3. shifts closed in the last 7 days with a cash variance */
  safe(() => {
    const rows = db.prepare("SELECT id, business_date, variance FROM shifts WHERE station_id=? AND status IN('closed','approved') AND variance<>0 AND business_date>=? ORDER BY business_date DESC").all(sid, addDays(today, -6));
    if (rows.length) add({ id: 'shift_variance', severity: 'warning', kind: 'shift_variance', tab: 'shift', n: rows.length, amount: rows.reduce((t, r) => t + r.variance, 0), items: rows.slice(0, 5) });
  });

  /* 4/5. customers: over the credit limit; debts more than 90 days late */
  safe(() => {
    const rows = O.ageing(db, user, sid, { type: 'customer' }).rows;
    const over = rows.filter(r => r.credit_limit > 0 && r.balance > r.credit_limit).sort((a, b) => (b.balance - b.credit_limit) - (a.balance - a.credit_limit));
    if (over.length) add({ id: 'credit_limit', severity: 'warning', kind: 'credit_limit', tab: 'cust', n: over.length, amount: over.reduce((t, r) => t + r.balance - r.credit_limit, 0), items: over.slice(0, 5).map(r => ({ id: r.id, name: r.name, balance: r.balance, credit_limit: r.credit_limit })) });
    const late = rows.filter(r => r.over90 > 0).sort((a, b) => b.over90 - a.over90);
    if (late.length) add({ id: 'late_customers', severity: 'warning', kind: 'late_customers', tab: 'stm', n: late.length, amount: late.reduce((t, r) => t + r.over90, 0), items: late.slice(0, 5).map(r => ({ id: r.id, name: r.name, amount: r.over90 })) });
  });

  /* 6. suppliers: something already past its due date */
  safe(() => {
    const rows = O.ageing(db, user, sid, { type: 'supplier' }).rows.map(r => ({ ...r, late: r.d30 + r.d60 + r.d90 + r.over90 })).filter(r => r.late > 0).sort((a, b) => b.late - a.late);
    if (rows.length) add({ id: 'late_suppliers', severity: 'info', kind: 'late_suppliers', tab: 'supp', n: rows.length, amount: rows.reduce((t, r) => t + r.late, 0), items: rows.slice(0, 5).map(r => ({ id: r.id, name: r.name, amount: r.late })) });
  });

  /* 7. a cash box or bank account in the station currency that is below zero */
  safe(() => {
    const neg = db.prepare(`SELECT a.code, a.name_ar, a.name_en, COALESCE(SUM(l.debit-l.credit),0) bal FROM accounts a JOIN journal_lines l ON l.account_id=a.id JOIN journals j ON j.id=l.journal_id
      WHERE a.org_id=? AND (a.box IS NOT NULL OR a.sys IN('cash','bank')) AND (a.currency IS NULL OR a.currency=?) AND j.station_id=? AND j.status='posted' GROUP BY a.id HAVING bal<0 ORDER BY bal`).all(user.org_id, st.currency, sid);
    if (neg.length) add({ id: 'box_negative', severity: 'critical', kind: 'box_negative', tab: 'box', n: neg.length, amount: neg.reduce((t, r) => t + r.bal, 0), items: neg.slice(0, 5) });
  });

  /* 8. no sales yesterday although the station normally sells every day */
  safe(() => {
    const y = addDays(today, -1);
    const week = db.prepare("SELECT COUNT(DISTINCT business_date) d FROM sales WHERE station_id=? AND voided_at IS NULL AND business_date BETWEEN ? AND ?").get(sid, addDays(today, -8), addDays(today, -2)).d;
    const had = db.prepare("SELECT 1 FROM sales WHERE station_id=? AND voided_at IS NULL AND business_date=? LIMIT 1").get(sid, y);
    if (week >= 5 && !had) add({ id: 'no_sales', severity: 'warning', kind: 'no_sales', tab: 'sales', items: [{ date: y }] });
  });

  /* 9. a bank reconciliation left open for a month */
  safe(() => {
    const old = db.prepare("SELECT r.id, r.statement_date, a.code, a.name_ar, a.name_en FROM bank_recs r JOIN accounts a ON a.id=r.account_id WHERE r.station_id=? AND r.status='draft' AND r.created_at<=datetime('now','-30 days')").all(sid);
    if (old.length) add({ id: 'bank_open', severity: 'info', kind: 'bank_open', tab: 'bank', n: old.length, items: old.slice(0, 5) });
  });

  /* 10. the books fail their own integrity check */
  safe(() => {
    const r = O.integrity(db, user); const failed = (r.checks || []).filter(c => !c.ok);
    if (!r.ok) add({ id: 'integrity', severity: 'critical', kind: 'integrity', tab: 'fin', n: failed.length, items: failed.slice(0, 5).map(c => ({ name: c.name || c.id || c.key })) });
  });

  out.sort((a, b) => SEV[a.severity] - SEV[b.severity]);
  const counts = { critical: 0, warning: 0, info: 0 }; for (const a of out) counts[a.severity]++;
  return { as_of: today, currency: st.currency, cur_dec: st.cur_dec, counts, total: out.length, alerts: out };
}

module.exports = { alerts };
