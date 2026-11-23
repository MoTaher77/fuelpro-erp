'use strict';
/* «لوحة التحليلات» — one call that answers how the station is doing for a period, compared with the period before
   and the same period last year: headline figures from the books, sales trend, fuel margins, pumps, weekdays,
   payment mix, top credit customers, receivables ageing, stock cover, cash, and a multi-year view that includes
   the old system's results. Read-only; integers only. */
const V = require('./validate');
const S = require('./services');
const O = require('./ops');
const M7 = require('./m7archive');
const { need, station, tzToday, addDays } = S;
const { bad } = require('./errors');

const days = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000) + 1;
const shiftYear = (d, n) => { const y = +d.slice(0, 4) + n; const md = d.slice(5); return md === '02-29' ? `${y}-02-28` : `${y}-${md}`; };

function figures(db, user, sid, from, to) {
  const is = O.incomeStatement(db, user, { station_id: sid, from, to });
  const s = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(quantity_ml),0) ml, COALESCE(SUM(net),0) net, COALESCE(SUM(gross),0) gross, COALESCE(SUM(cogs),0) cogs
    FROM sales WHERE station_id=? AND voided_at IS NULL AND business_date BETWEEN ? AND ?`).get(sid, from, to);
  return { from, to, revenue: is.revenue, gross_profit: is.gross_profit, operating_expenses: is.operating_expenses, net_profit: is.net_profit,
    sales_count: s.n, litres_ml: s.ml, sales_net: s.net, sales_gross: s.gross, fuel_margin: s.net - s.cogs,
    avg_price_e4: s.ml ? Math.round(s.net * 1e7 / s.ml) : 0 };          // average price per litre (minor units ×10⁴)
}

function dashboard(db, user, sid, q) {
  need(user, 'report.read'); const st = station(db, user, sid);
  const today = tzToday(st.timezone);
  const to = q.to ? V.date(q.to, 'to') : today;
  const from = q.from ? V.date(q.from, 'from') : to.slice(0, 8) + '01';
  if (from > to) throw bad('VALIDATION', 'from must not be after to');
  const n = days(from, to); if (n > 3700) throw bad('VALIDATION', 'Choose ten years or less');
  const prevTo = addDays(from, -1), prevFrom = addDays(prevTo, -(n - 1));
  const cur = figures(db, user, sid, from, to);
  const prev = figures(db, user, sid, prevFrom, prevTo);
  const lastYear = figures(db, user, sid, shiftYear(from, -1), shiftYear(to, -1));

  /* trend: daily up to 92 days, else monthly; the same buckets one year earlier for comparison */
  const monthly = n > 92;
  const bucket = monthly ? "substr(business_date,1,7)" : 'business_date';
  const trendRows = (a, b) => db.prepare(`SELECT ${bucket} k, COALESCE(SUM(net),0) revenue, COALESCE(SUM(quantity_ml),0) ml, COALESCE(SUM(net-cogs),0) margin
    FROM sales WHERE station_id=? AND voided_at IS NULL AND business_date BETWEEN ? AND ? GROUP BY 1 ORDER BY 1`).all(sid, a, b);
  const keys = []; if (monthly) { for (let d = from.slice(0, 7); d <= to.slice(0, 7);) { keys.push(d); const [y, m] = d.split('-').map(Number); d = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; } }
  else for (let d = from; d <= to; d = addDays(d, 1)) keys.push(d);
  const curT = new Map(trendRows(from, to).map(r => [r.k, r]));
  const lyT = new Map(trendRows(shiftYear(from, -1), shiftYear(to, -1)).map(r => [monthly ? shiftYear(r.k + '-01', 1).slice(0, 7) : shiftYear(r.k, 1), r]));
  const trend = keys.map(k => ({ key: k, revenue: curT.get(k)?.revenue || 0, litres_ml: curT.get(k)?.ml || 0, margin: curT.get(k)?.margin || 0, last_year_revenue: lyT.get(k)?.revenue || 0 }));

  const sum = (sql, ...a) => db.prepare(sql).all(sid, from, to, ...a);
  const fuels = sum(`SELECT f.id fuel_id, f.name, COALESCE(SUM(s.quantity_ml),0) litres_ml, COALESCE(SUM(s.net),0) revenue, COALESCE(SUM(s.cogs),0) cogs
    FROM fuels f LEFT JOIN sales s ON s.fuel_id=f.id AND s.voided_at IS NULL AND s.station_id=? AND s.business_date BETWEEN ? AND ? GROUP BY f.id ORDER BY f.id`)
    .map(f => ({ ...f, margin: f.revenue - f.cogs, margin_per_litre_e4: f.litres_ml ? Math.round((f.revenue - f.cogs) * 1e7 / f.litres_ml) : 0 }));
  const pumps = sum(`SELECT p.id pump_id, p.name, p.fuel_id, COALESCE(SUM(s.quantity_ml),0) litres_ml, COALESCE(SUM(s.net),0) revenue
    FROM pumps p LEFT JOIN sales s ON s.pump_id=p.id AND s.voided_at IS NULL AND s.station_id=? AND s.business_date BETWEEN ? AND ? GROUP BY p.id ORDER BY litres_ml DESC`);
  const wd = new Map(sum(`SELECT CAST(strftime('%w', business_date) AS INTEGER) d, COALESCE(SUM(net),0) revenue, COUNT(DISTINCT business_date) n FROM sales
    WHERE station_id=? AND voided_at IS NULL AND business_date BETWEEN ? AND ? GROUP BY 1`).map(r => [r.d, r]));
  const weekdays = [6, 0, 1, 2, 3, 4, 5].map(d => ({ weekday: d, avg_revenue: wd.get(d) ? Math.round(wd.get(d).revenue / wd.get(d).n) : 0 }));   // Saturday first
  const payMix = sum(`SELECT pay_type, COUNT(*) n, COALESCE(SUM(gross),0) amount FROM sales WHERE station_id=? AND voided_at IS NULL AND business_date BETWEEN ? AND ? GROUP BY pay_type ORDER BY amount DESC`);
  const topCustomers = sum(`SELECT c.id, c.name, COUNT(*) n, COALESCE(SUM(s.gross),0) amount, COALESCE(SUM(s.quantity_ml),0) litres_ml FROM sales s JOIN customers c ON c.id=s.customer_id
    WHERE s.station_id=? AND s.voided_at IS NULL AND s.business_date BETWEEN ? AND ? GROUP BY c.id ORDER BY amount DESC LIMIT 10`)
    .map(c => ({ ...c, balance: S.customerBalance(db, c.id) }));
  const age = O.ageing(db, user, sid, { type: 'customer' }).totals;

  /* stock cover: litres in the tank ÷ average litres sold per day over the last 30 days */
  const since = addDays(today, -29);
  const tanks = db.prepare('SELECT t.id, t.name, t.capacity_ml, t.level_ml, t.min_ml, t.value, f.name fuel_name FROM tanks t JOIN fuels f ON f.id=t.fuel_id WHERE t.station_id=? AND t.active=1 ORDER BY t.id').all(sid)
    .map(t => { const s = db.prepare('SELECT COALESCE(SUM(quantity_ml),0) ml FROM sales WHERE tank_id=? AND voided_at IS NULL AND business_date BETWEEN ? AND ?').get(t.id, since, today).ml;
      const perDay = Math.round(s / 30); const cover = perDay ? Math.floor(t.level_ml / perDay) : null;
      return { ...t, sold_per_day_ml: perDay, days_cover: cover, status: cover == null ? 'idle' : cover <= 3 ? 'critical' : cover <= 7 ? 'warning' : 'good' }; });

  const cf = O.cashFlow(db, user, { station_id: sid, from, to });

  /* every year on record: FuelPro's books, and the old system's saved results for earlier years */
  const years = [];
  const fpYears = db.prepare("SELECT DISTINCT substr(business_date,1,4) y FROM journals WHERE station_id=? AND status='posted' AND source NOT IN ('year_close') ORDER BY 1").all(sid).map(r => +r.y);
  let oldYears = []; try { oldYears = M7.oldResults(db, user, sid, { year: 2000 }).years; } catch { oldYears = []; }
  for (const y of [...new Set([...oldYears, ...fpYears])].sort()) {
    if (fpYears.includes(y)) { const f = figures(db, user, sid, `${y}-01-01`, y === +today.slice(0, 4) ? today : `${y}-12-31`);
      if (f.revenue || f.net_profit) { years.push({ year: y, source: 'fuelpro', revenue: f.revenue, gross_profit: f.gross_profit, net_profit: f.net_profit, partial: y === +today.slice(0, 4) }); continue; } }
    const o = M7.oldResults(db, user, sid, { year: y }); if (!o.months.length) continue;
    const t = (k) => o.months.reduce((s, m) => s + m[k], 0);
    years.push({ year: y, source: 'old', revenue: t('revenue'), gross_profit: t('gross_profit'), net_profit: t('net_profit'), months: o.months.length, partial: o.months.length < 12 });
  }

  return { station: { id: st.id, name: st.name }, currency: st.currency, cur_dec: st.cur_dec, from, to, days: n, granularity: monthly ? 'month' : 'day',
    current: cur, previous: prev, last_year: lastYear, trend, fuels, pumps, weekdays, pay_mix: payMix, top_customers: topCustomers,
    ageing: age, tanks, cash: { opening: cf.opening_cash, closing: cf.closing_cash, operating: cf.operating.total, investing: cf.investing.total, financing: cf.financing.total }, years };
}

module.exports = { dashboard };
