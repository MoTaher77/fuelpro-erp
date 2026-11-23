'use strict';
/* Fill an EXISTING account (found by its owner's e-mail) with one year of realistic activity, through the real
   business logic (stock ledger, journals, shifts, credit limits). Use it to try the system with your own account.

   Usage:  DB_PATH=./data/demo.db node scripts/fill-year.js --email you@example.com [--days 365] [--currency YER]
   Refuses to run on a station that already has sales. Safe while the server is running (short transactions). */
const path = require('node:path');
const crypto = require('node:crypto');
const { openDb } = require('../src/db');
const S = require('../src/services');
const O = require('../src/ops');
const { currencyDecimals } = require('../src/money');
const L = require('../src/ledger');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const EMAIL = arg('email'), DAYS = Number(arg('days', 365)), CUR = arg('currency');
if (!EMAIL) { console.error('Usage: node scripts/fill-year.js --email you@example.com [--days 365] [--currency YER]'); process.exit(1); }
const db = openDb(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'demo.db'));

const u = db.prepare("SELECT * FROM users WHERE email=? AND role='owner'").get(EMAIL);
if (!u) { console.error(`No owner account with e-mail ${EMAIL}`); process.exit(1); }
const owner = { id: u.id, org_id: u.org_id, role: 'owner' };
const stations = db.prepare('SELECT * FROM stations WHERE org_id=? ORDER BY id').all(u.org_id);
if (!stations.length) { console.error('This account has no station'); process.exit(1); }
const st0 = stations[0];
if (db.prepare('SELECT COUNT(*) n FROM sales WHERE station_id=?').get(st0.id).n > 0) { console.error(`${st0.name} already has sales; refusing to add a second year on top.`); process.exit(1); }

/* currency: only while the station has no money movements yet */
if (CUR && CUR.toUpperCase() !== st0.currency) {
  const used = db.prepare('SELECT (SELECT COUNT(*) FROM deliveries WHERE station_id=?)+(SELECT COUNT(*) FROM expenses WHERE station_id=?)+(SELECT COUNT(*) FROM journals WHERE station_id=?) n').get(st0.id, st0.id, st0.id).n;
  if (used) { console.error('The station already has money movements; its currency cannot be changed.'); process.exit(1); }
  const dec = currencyDecimals(CUR.toUpperCase()); if (dec === null) { console.error('Unknown currency ' + CUR); process.exit(1); }
  db.prepare('UPDATE stations SET currency=?, cur_dec=? WHERE id=?').run(CUR.toUpperCase(), dec, st0.id);
  const f = 10 ** (st0.cur_dec - dec);   // keep the number the user typed: 570 USD -> 570 YER
  if (f !== 1) for (const r of db.prepare('SELECT id, price_e4, cost_e4 FROM fuels WHERE station_id=?').all(st0.id))
    db.prepare('UPDATE fuels SET price_e4=?, cost_e4=? WHERE id=?').run(Math.round(r.price_e4 / f), Math.round(r.cost_e4 / f), r.id);
  console.log(`Currency of ${st0.name}: ${st0.currency} -> ${CUR.toUpperCase()}`);
}
/* an empty open shift (no transactions) would block the history; remove it */
for (const sh of db.prepare("SELECT id FROM shifts WHERE station_id=? AND status='open'").all(st0.id)) {
  const busy = db.prepare('SELECT (SELECT COUNT(*) FROM sales WHERE shift_id=?)+(SELECT COUNT(*) FROM payments WHERE shift_id=?)+(SELECT COUNT(*) FROM expenses WHERE shift_id=?)+(SELECT COUNT(*) FROM cash_moves WHERE shift_id=?) n').get(sh.id, sh.id, sh.id, sh.id).n;
  if (busy) { console.error('An open shift with transactions exists; close it first.'); process.exit(1); }
  db.prepare('DELETE FROM shift_meters WHERE shift_id=?').run(sh.id); db.prepare('DELETE FROM shifts WHERE id=?').run(sh.id);
}
const sid = st0.id, tz = st0.timezone;

/* ---- controlled clock ---- */
const RealDate = Date; let NOW = 0;
global.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(NOW); } static now() { return NOW; } };
const offset = (() => { const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(new RealDate()).find(x => x.type === 'timeZoneName').value; const m = /GMT([+-]\d\d):?(\d\d)?/.exec(p); return m ? `${m[1]}:${m[2] || '00'}` : '+00:00'; })();
const setLocal = (day, hh, mm = 0) => { NOW = RealDate.parse(`${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00${offset}`); };
let seed = 7_2026; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1)); const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const L_ = (l) => Math.round(l * 1000);
const st = db.prepare('SELECT * FROM stations WHERE id=?').get(sid);
const M = 10 ** st.cur_dec;                                  // currency major unit in minor units
const E4 = (perLitre) => Math.round(perLitre * M * 10_000);  // price per litre -> price_e4
const AMT = (v) => Math.round(v * M);
if (st.currency === 'YER') for (const r of db.prepare('SELECT id, price_e4, cost_e4 FROM fuels WHERE station_id=?').all(sid))
  if (r.price_e4 / 10_000 / M > 20_000) db.prepare('UPDATE fuels SET price_e4=?, cost_e4=? WHERE id=?').run(Math.round(r.price_e4 / 100), Math.round(r.cost_e4 / 100), r.id);
const todayLocal = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new RealDate());
const addDays = (d, k) => { const x = new RealDate(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
const startDay = addDays(todayLocal, -DAYS);
const yer = st.currency === 'YER';
const P = { gas: yer ? 1250 : 1.05, dsl: yer ? 1150 : 0.95, gasCost: yer ? 1100 : 0.92, dslCost: yer ? 1000 : 0.83, step: yer ? 25 : 0.02 };
setLocal(startDay, 5);

const count = {}; const did = (k) => { count[k] = (count[k] || 0) + 1; };
const safe = (k, fn) => { try { const r = fn(); did(k); return r; } catch (e) { did(k + ':refused:' + (e.code || e.message)); return null; } };
const t0 = RealDate.now();

/* ---- setup (only what is missing) ---- */
S.updateStation(db, owner, sid, { require_shift: true });
let fuels = db.prepare('SELECT * FROM fuels WHERE station_id=? AND active=1 ORDER BY id').all(sid);
const GAS_RE = /بترول|بنزين|gasoline|petrol|essence/i, DSL_RE = /ديزل|سولار|diesel|gasoil|gazole/i;
const gasF = fuels.find(f => GAS_RE.test(f.name)), dslF = fuels.find(f => DSL_RE.test(f.name));
if (gasF && gasF.price_e4 > 0) { P.gas = gasF.price_e4 / 10_000 / M; P.gasCost = P.gas * 0.88; P.dsl = P.gas * 0.92; P.dslCost = P.dsl * 0.88; P.step = P.gas * 0.02; }
const gas = gasF ? gasF.id : S.createFuel(db, owner, sid, { name: 'بنزين', price_e4: E4(P.gas), cost_e4: E4(P.gasCost) }).id;
const dsl = dslF ? dslF.id : S.createFuel(db, owner, sid, { name: 'ديزل', price_e4: E4(P.dsl), cost_e4: E4(P.dslCost) }).id;
if (!gasF || !gasF.cost_e4) db.prepare('UPDATE fuels SET cost_e4=? WHERE id=?').run(E4(P.gasCost), gas);
// a duplicate petrol fuel left by an interrupted run (no tank uses it) is hidden
for (const f of fuels) if (f.id !== gas && f.id !== dsl && GAS_RE.test(f.name) && !db.prepare('SELECT 1 FROM tanks WHERE fuel_id=?').get(f.id)) db.prepare('UPDATE fuels SET active=0 WHERE id=?').run(f.id);
let tanks = db.prepare('SELECT * FROM tanks WHERE station_id=? AND active=1 ORDER BY id').all(sid);
/* opening stock entered without a cost: value it at the fuel cost (opening-balance entry: Dr inventory / Cr capital) */
for (const t of tanks) if (t.level_ml > 0 && t.value === 0) {
  const cost = db.prepare('SELECT cost_e4 FROM fuels WHERE id=?').get(t.fuel_id).cost_e4, v = L.atCost(t.level_ml, cost);
  if (v > 0) { const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
    L.stockMove(db, t.id, { qty: 0, value: v, kind: 'count', ref_type: 'revaluation', ref_id: t.id, date: day, user_id: owner.id });
    L.post(db, { org_id: owner.org_id, station_id: sid, date: day, source: 'tank_opening', source_id: t.id, user_id: owner.id, memo: 'تقييم رصيد الخزان الافتتاحي بالتكلفة', lines: [{ a: 'inventory', dr: v }, { a: 'capital', cr: v }] }); }
}
if (!tanks.some(t => t.fuel_id === gas)) {
  S.createTank(db, owner, sid, { name: 'خزان بنزين 1', fuel_id: gas, capacity_ml: L_(40000), level_ml: L_(30000), min_ml: L_(8000), cost_e4: E4(P.gasCost) });
  S.createTank(db, owner, sid, { name: 'خزان بنزين 2', fuel_id: gas, capacity_ml: L_(30000), level_ml: L_(20000), min_ml: L_(6000), cost_e4: E4(P.gasCost) });
}
if (!tanks.some(t => t.fuel_id === dsl)) S.createTank(db, owner, sid, { name: 'خزان ديزل', fuel_id: dsl, capacity_ml: L_(40000), level_ml: L_(30000), min_ml: L_(8000), cost_e4: E4(P.dslCost) });
tanks = db.prepare('SELECT * FROM tanks WHERE station_id=? AND active=1 ORDER BY id').all(sid);
let pumps = db.prepare('SELECT p.*, f.name fuel FROM pumps p JOIN fuels f ON f.id=p.fuel_id WHERE p.station_id=?').all(sid);
if (!pumps.length) {
  const tg = tanks.filter(t => t.fuel_id === gas), td = tanks.filter(t => t.fuel_id === dsl);
  S.createPump(db, owner, sid, { name: 'مضخة 1', tank_id: tg[0].id, meter_ml: L_(ri(100000, 900000)) });
  S.createPump(db, owner, sid, { name: 'مضخة 2', tank_id: tg[0].id, meter_ml: L_(ri(100000, 900000)) });
  S.createPump(db, owner, sid, { name: 'مضخة 3', tank_id: (tg[1] || tg[0]).id, meter_ml: L_(ri(100000, 900000)) });
  S.createPump(db, owner, sid, { name: 'مضخة 4 (ديزل)', tank_id: td[0].id, meter_ml: L_(ri(100000, 900000)) });
  pumps = db.prepare('SELECT p.*, f.name fuel FROM pumps p JOIN fuels f ON f.id=p.fuel_id WHERE p.station_id=?').all(sid);
}
const isDsl = (p) => p.fuel_id === dsl;
const custNames = ['شركة النقل السريع', 'مؤسسة البناء الحديث', 'مستشفى الأمل', 'شركة المياه', 'أسطول الأجرة', 'مزرعة الوادي'];
const existingCust = db.prepare('SELECT id FROM customers WHERE station_id=? AND active=1').all(sid).map(r => ({ id: r.id, payDays: 10 }));
const customers = existingCust.length ? existingCust : custNames.map((n, i) => ({ id: S.createCustomer(db, owner, sid, { name: n + ' (تجريبي)', phone: `77${ri(1000000, 9999999)}`, credit_limit: AMT([3, 5, 2, 4, 1.5, 2.5][i] * (yer ? 1_000_000 : 2_000)), terms_days: [30, 30, 15, 45, 7, 30][i] }).id, payDays: [7, 10, 14, 20, 5, 12][i] }));
const suppliers = ['شركة النفط الوطنية (تجريبي)', 'الموزع الأهلي للمحروقات (تجريبي)'].map((n, i) => O.createSupplier(db, owner, sid, { name: n, terms_days: [30, 15][i] }).id);
const prices = (d, kind) => { const step = [0, 2, 4, 3][Math.floor(d / 91) % 4] * P.step; const j = (rnd() - .5) * P.step * .4;
  return kind === 'gas' ? { price: P.gas + step, cost: P.gasCost + step + j } : { price: P.dsl + step, cost: P.dslCost + step + j }; };
const CID = () => 'fill-' + crypto.randomBytes(8).toString('hex');

/* ---- one year, day by day ---- */
for (let d = 0; d < DAYS; d++) {
  const day = addDays(startDay, d);
  if (d % 91 === 0) { setLocal(day, 5, 30); S.updateFuelPrice(db, owner, sid, gas, { price_e4: E4(prices(d, 'gas').price) }); S.updateFuelPrice(db, owner, sid, dsl, { price_e4: E4(prices(d, 'dsl').price) }); }
  for (let shiftNo = 0; shiftNo < 2; shiftNo++) {
    const openH = shiftNo ? 14 : 6; setLocal(day, openH);
    const sh = O.openShiftCmd(db, owner, sid, { float_amount: AMT(yer ? 20000 : 50) }).id; did('shift');
    const n = ri(11, 17);
    for (let i = 0; i < n; i++) {
      setLocal(day, openH + Math.floor(i * 8 / n), ri(0, 59));
      const p = pick(pumps); const truck = isDsl(p) && rnd() < 0.5; const litres = truck ? ri(150, 600) : ri(15, 120);
      const credit = rnd() < 0.15; const c = credit ? pick(customers) : null;
      const r = safe('sale', () => S.createSale(db, owner, sid, { client_id: CID(), pump_id: p.id, quantity_ml: L_(litres) + ri(0, 999), pay_type: credit ? 'credit' : 'cash', customer_id: c ? c.id : undefined }));
      if (r && rnd() < 0.004) safe('sale_void', () => S.voidSale(db, owner, sid, r.id, 'خطأ في إدخال المضخة'));
    }
    setLocal(day, openH + 3);
    if (rnd() < 0.5) safe('expense', () => S.createExpense(db, owner, sid, { category: pick(['power', 'power', 'maint', 'transport', 'other']), gross: AMT(ri(5, 40) * (yer ? 1000 : 2)), note: 'مصروف تشغيلي' }));
    if (shiftNo === 0) for (const c of customers) if ((d + c.id) % c.payDays === 0) {
      const bal = S.customerBalance(db, c.id); if (bal <= 0) continue;
      const amt = rnd() < 0.7 ? bal : Math.max(1, Math.floor(bal / 2));
      safe('collection', () => S.createPayment(db, owner, sid, { customer_id: c.id, amount: amt, method: rnd() < 0.6 ? 'cash' : 'bank' }));
    }
    setLocal(day, openH + 7, 50);
    const exp = O.shiftTotals(db, db.prepare('SELECT * FROM shifts WHERE id=?').get(sh)).expected_cash;
    if (exp > AMT(yer ? 220000 : 500)) safe('bank_deposit', () => O.cashMove(db, owner, sid, { kind: 'withdrawal', counterpart: 'bank', amount: exp - AMT(yer ? 20000 : 50), note: 'إيداع بنكي' }));
    const expected = O.shiftTotals(db, db.prepare('SELECT * FROM shifts WHERE id=?').get(sh)).expected_cash;
    const variance = rnd() < 0.8 ? 0 : pick([-1000, -500, -200, 200, 500].map(v => AMT(yer ? v : v / 500)));
    O.closeShift(db, owner, sid, sh, { counted_cash: Math.max(0, expected + variance), note: variance ? 'فرق صندوق' : null });
    O.approveShift(db, owner, sid, sh); did('shift_approved');
  }
  setLocal(day, 21);
  for (const t of db.prepare('SELECT * FROM tanks WHERE station_id=?').all(sid)) {
    if (t.level_ml < t.capacity_ml * 0.35) {
      const kind = t.fuel_id === gas ? 'gas' : 'dsl'; const qty = Math.floor((t.capacity_ml * 0.92 - t.level_ml) / 1000) * 1000;
      safe('delivery', () => S.createDelivery(db, owner, sid, { tank_id: t.id, quantity_ml: qty, cost_e4: E4(prices(d, kind).cost), pay_type: rnd() < 0.7 ? 'credit' : 'bank', supplier_id: pick(suppliers) }));
    }
  }
  if (d % 10 === 5) for (const sp of suppliers) { const b = O.supplierBalance(db, sp); if (b > 0) safe('supplier_payment', () => O.supplierPayment(db, owner, sid, { supplier_id: sp, amount: Math.round(b * 0.8), method: 'bank' })); }
  if (d % 7 === 6) for (const t of db.prepare('SELECT * FROM tanks WHERE station_id=?').all(sid))
    safe('stock_count', () => S.createAdjustment(db, owner, sid, { tank_id: t.id, after_ml: Math.max(0, t.level_ml - Math.round(t.level_ml * ri(0, 25) / 10000)), note: 'جرد أسبوعي بالمسطرة' }));
  if (day.endsWith('-28')) {
    setLocal(day, 20);
    safe('expense', () => S.createExpense(db, owner, sid, { category: 'salaries', gross: AMT(yer ? 1_200_000 : 2_400), method: 'bank', note: 'رواتب الشهر' }));
    safe('expense', () => S.createExpense(db, owner, sid, { category: 'rent', gross: AMT(yer ? 400_000 : 800), method: 'bank', note: 'إيجار' }));
  }
  if (d % 30 === 0) process.stdout.write(`  day ${d}/${DAYS}\r`);
}
NOW = RealDate.now(); global.Date = RealDate;
O.openShiftCmd(db, owner, sid, { float_amount: AMT(yer ? 20000 : 50) });   // today's shift, ready for live sales

const integ = O.integrity(db, owner);
const n = db.prepare('SELECT COUNT(*) n, MIN(business_date) a, MAX(business_date) b FROM sales WHERE station_id=?').get(sid);
console.log(`\nDone in ${Math.round((RealDate.now() - t0) / 1000)} s — ${st.name} (${st.currency})`);
console.log(`  sales ${n.n} from ${n.a} to ${n.b}`);
console.log('  operations:', JSON.stringify(count));
console.log('  books integrity:', integ.ok ? 'OK' : 'FAILED ' + integ.checks.filter(c => !c.ok).map(c => c.name).join('; '));
if (!integ.ok) process.exit(2);
