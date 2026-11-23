'use strict';
/* Builds a separate DEMO tenant with one year of fictional, connected activity for two stations
   (محطة التميز and محطة المرتضى). Every record goes through the real business logic: stock ledger,
   journals, shifts, credit limits. Nothing here is real data.

   Usage:  DB_PATH=./data/demo.db node scripts/seed-demo.js [--days 365] [--email demo@fuelpro.demo]
   The owner password is random and printed once (set DEMO_PASSWORD to choose it). */
const path = require('node:path');
const crypto = require('node:crypto');
const { openDb } = require('../src/db');
const S = require('../src/services');
const O = require('../src/ops');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const DAYS = Number(arg('days', 365)), EMAIL = arg('email', 'demo@fuelpro.demo');
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'demo.db');
const db = openDb(dbPath);

const others = db.prepare("SELECT name FROM orgs WHERE name NOT LIKE 'DEMO%'").all();
if (others.length && !process.argv.includes('--force')) { console.error(`Refusing: ${dbPath} holds non-demo organisations. Use a separate DEMO database.`); process.exit(1); }
if (db.prepare('SELECT 1 FROM users WHERE email=?').get(EMAIL)) { console.error(`${EMAIL} already exists in ${dbPath}. Delete the demo database to rebuild it.`); process.exit(1); }

/* ---- controlled clock: every service call sees the simulated "now" ---- */
const RealDate = Date; let NOW = 0;
global.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(NOW); } static now() { return NOW; } };
const setLocal = (day, hh, mm = 0) => { NOW = RealDate.parse(`${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+03:00`); };

/* ---- deterministic randomness ---- */
let seed = 20261121; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1)); const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const L_ = (litres) => Math.round(litres * 1000);   // ml
const E4 = (yerPerLitre) => yerPerLitre * 10_000;   // YER has no minor unit

const startDay = (() => { const d = new RealDate(); d.setUTCDate(d.getUTCDate() - DAYS); return d.toISOString().slice(0, 10); })();
const addDays = (d, k) => { const x = new RealDate(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
setLocal(startDay, 6);

const t0 = RealDate.now(); const count = {};
const did = (k) => { count[k] = (count[k] || 0) + 1; };
const password = process.env.DEMO_PASSWORD || crypto.randomBytes(9).toString('base64url');

/* ---- tenant ---- */
const reg = S.registerOrg(db, { org_name: 'DEMO شركة الوقود التجريبية', name: 'مالك تجريبي', email: EMAIL, password, station: { name: 'محطة التميز (DEMO)', currency: 'YER', timezone: 'Asia/Aden' } }, '127.0.0.1');
const owner = { id: reg.user_id, org_id: reg.org_id, role: 'owner' };
const sid2 = S.createStation(db, owner, { name: 'محطة المرتضى (DEMO)', currency: 'YER', timezone: 'Asia/Aden' }).id;
const STATIONS = [{ id: reg.station_id, code: 'tamayuz' }, { id: sid2, code: 'murtada' }];
const staffPw = process.env.DEMO_PASSWORD || password;
const mkUser = (name, email, role, sids) => ({ id: S.createUser(db, owner, { name, email, role, password: staffPw, station_ids: sids }).id, org_id: owner.org_id, role });
const accountant = mkUser('محاسب تجريبي', 'accountant@fuelpro.demo', 'accountant', [reg.station_id, sid2]);
mkUser('مستخدم عرض', 'viewer@fuelpro.demo', 'viewer', [reg.station_id, sid2]);

for (const st of STATIONS) {
  const sid = st.id;
  S.updateStation(db, owner, sid, { require_shift: true });
  st.manager = mkUser(`مدير ${st.code}`, `manager.${st.code}@fuelpro.demo`, 'manager', [sid]);
  st.supervisor = mkUser(`مشرف ${st.code}`, `supervisor.${st.code}@fuelpro.demo`, 'supervisor', [sid]);
  st.cashiers = [mkUser(`كاشير صباحي ${st.code}`, `cashier1.${st.code}@fuelpro.demo`, 'cashier', [sid]), mkUser(`كاشير مسائي ${st.code}`, `cashier2.${st.code}@fuelpro.demo`, 'cashier', [sid])];
  st.gas = S.createFuel(db, owner, sid, { name: 'بنزين', price_e4: E4(1250), cost_e4: E4(1100) }).id;
  st.dsl = S.createFuel(db, owner, sid, { name: 'ديزل', price_e4: E4(1150), cost_e4: E4(1000) }).id;
  st.tanks = [
    S.createTank(db, owner, sid, { name: 'خزان بنزين 1', fuel_id: st.gas, capacity_ml: L_(40000), level_ml: L_(30000), min_ml: L_(8000), cost_e4: E4(1100) }).id,
    S.createTank(db, owner, sid, { name: 'خزان بنزين 2', fuel_id: st.gas, capacity_ml: L_(30000), level_ml: L_(20000), min_ml: L_(6000), cost_e4: E4(1100) }).id,
    S.createTank(db, owner, sid, { name: 'خزان ديزل', fuel_id: st.dsl, capacity_ml: L_(40000), level_ml: L_(30000), min_ml: L_(8000), cost_e4: E4(1000) }).id];
  st.pumps = [
    { id: S.createPump(db, owner, sid, { name: 'مضخة 1', tank_id: st.tanks[0], meter_ml: L_(ri(100000, 900000)) }).id, kind: 'gas' },
    { id: S.createPump(db, owner, sid, { name: 'مضخة 2', tank_id: st.tanks[0], meter_ml: L_(ri(100000, 900000)) }).id, kind: 'gas' },
    { id: S.createPump(db, owner, sid, { name: 'مضخة 3', tank_id: st.tanks[1], meter_ml: L_(ri(100000, 900000)) }).id, kind: 'gas' },
    { id: S.createPump(db, owner, sid, { name: 'مضخة 4 (ديزل)', tank_id: st.tanks[2], meter_ml: L_(ri(100000, 900000)) }).id, kind: 'dsl' }];
  const cnames = ['DEMO شركة النقل السريع', 'DEMO مؤسسة البناء الحديث', 'DEMO مستشفى الأمل', 'DEMO شركة المياه', 'DEMO أسطول الأجرة', 'DEMO مزرعة الوادي'];
  st.customers = cnames.map((n, i) => ({ id: S.createCustomer(db, st.manager, sid, { name: n, phone: `77${ri(1000000, 9999999)}`, credit_limit: [3, 5, 2, 4, 1.5, 2.5][i] * 1_000_000, terms_days: [30, 30, 15, 45, 7, 30][i], opening_balance: i < 2 ? ri(50, 300) * 1000 : 0 }).id, payDays: [7, 10, 14, 20, 5, 12][i] }));
  st.suppliers = ['DEMO شركة النفط الوطنية', 'DEMO الموزع الأهلي للمحروقات'].map((n, i) => O.createSupplier(db, st.manager, sid, { name: n, terms_days: [30, 15][i], opening_balance: i === 0 ? 2_500_000 : 0 }).id);
}

/* ---- price schedule (YER per litre, sale / purchase) ---- */
const priceAt = (dayIdx, kind) => {
  const q = Math.floor(dayIdx / 91); const step = [0, 50, 100, 75][q % 4];
  return kind === 'gas' ? { price: 1250 + step, cost: 1100 + step + ri(-10, 10) } : { price: 1150 + step, cost: 1000 + step + ri(-10, 10) };
};
const CID = () => 'seed-' + crypto.randomBytes(8).toString('hex');
const safe = (k, fn) => { try { const r = fn(); did(k); return r; } catch (e) { did(k + ':refused:' + (e.code || e.message)); return null; } };

/* ---- one year, day by day ---- */
for (let d = 0; d < DAYS; d++) {
  const day = addDays(startDay, d);
  for (const st of STATIONS) {
    const sid = st.id;
    // quarterly price change by the manager (keeps price history in the audit log)
    if (d % 91 === 0) { setLocal(day, 5, 30); for (const [fid, k] of [[st.gas, 'gas'], [st.dsl, 'dsl']]) S.updateFuelPrice(db, st.manager, sid, fid, { price_e4: E4(priceAt(d, k).price) }); }

    for (let shiftNo = 0; shiftNo < 2; shiftNo++) {
      const cashier = st.cashiers[shiftNo], openH = shiftNo ? 14 : 6;
      setLocal(day, openH);
      const sh = O.openShiftCmd(db, st.supervisor, sid, { float_amount: 20_000 }).id; did('shift');
      const nSales = ri(11, 17);
      for (let i = 0; i < nSales; i++) {
        setLocal(day, openH + Math.floor(i * 8 / nSales), ri(0, 59));
        const p = pick(st.pumps); const truck = p.kind === 'dsl' && rnd() < 0.5;
        const litres = truck ? ri(150, 600) : ri(15, 120);
        const credit = rnd() < 0.15; const c = credit ? pick(st.customers) : null;
        const r = safe('sale', () => S.createSale(db, cashier, sid, { client_id: CID(), pump_id: p.id, quantity_ml: L_(litres) + ri(0, 999), pay_type: credit ? 'credit' : 'cash', customer_id: c ? c.id : undefined }));
        if (r && rnd() < 0.004) safe('sale_void', () => S.voidSale(db, st.supervisor, sid, r.id, 'DEMO: خطأ في إدخال المضخة'));
      }
      setLocal(day, openH + 3);
      if (rnd() < 0.5) safe('expense', () => S.createExpense(db, st.supervisor, sid, { category: pick(['power', 'power', 'maint', 'transport', 'other']), gross: ri(5, 40) * 1000, note: 'DEMO مصروف تشغيلي' }));
      for (const c of st.customers) if ((d + c.id) % c.payDays === 0 && shiftNo === 0) {
        const bal = S.customerBalance(db, c.id);
        const amt = rnd() < 0.7 ? bal : Math.min(bal, Math.max(1000, Math.floor(bal / 2000) * 1000));
        if (bal > 0) safe('collection', () => S.createPayment(db, cashier, sid, { customer_id: c.id, amount: amt, method: rnd() < 0.6 ? 'cash' : 'bank' }));
      }
      setLocal(day, openH + 7, 50);
      const exp = O.shiftTotals(db, db.prepare('SELECT * FROM shifts WHERE id=?').get(sh)).expected_cash;
      if (exp > 220_000) safe('bank_deposit', () => O.cashMove(db, st.supervisor, sid, { kind: 'withdrawal', counterpart: 'bank', amount: Math.floor((exp - 20_000) / 1000) * 1000, note: 'DEMO إيداع بنكي' }));
      const expected = O.shiftTotals(db, db.prepare('SELECT * FROM shifts WHERE id=?').get(sh)).expected_cash;
      const variance = rnd() < 0.8 ? 0 : pick([-1000, -500, -200, 200, 500]);
      O.closeShift(db, cashier, sid, sh, { counted_cash: Math.max(0, expected + variance), note: variance ? 'DEMO فرق صندوق' : null });
      O.approveShift(db, st.manager, sid, sh); did('shift_approved');
    }

    // deliveries when a tank runs low
    setLocal(day, 21);
    for (const tid of st.tanks) {
      const t = db.prepare('SELECT * FROM tanks WHERE id=?').get(tid);
      if (t.level_ml < t.capacity_ml * 0.35) {
        const kind = t.fuel_id === st.gas ? 'gas' : 'dsl'; const qty = Math.floor((t.capacity_ml * 0.92 - t.level_ml) / 1000) * 1000;
        const credit = rnd() < 0.7;
        safe('delivery', () => S.createDelivery(db, st.manager, sid, { tank_id: tid, quantity_ml: qty, cost_e4: E4(priceAt(d, kind).cost), pay_type: credit ? 'credit' : 'bank', supplier_id: pick(st.suppliers) }));
      }
    }
    // supplier payments every 10 days
    if (d % 10 === 5) for (const sp of st.suppliers) { const b = O.supplierBalance(db, sp); if (b > 0) safe('supplier_payment', () => O.supplierPayment(db, accountant, sid, { supplier_id: sp, amount: Math.round(b * 0.8), method: 'bank' })); }
    // weekly dip: small evaporation / meter variance
    if (d % 7 === 6) for (const tid of st.tanks) {
      const t = db.prepare('SELECT level_ml FROM tanks WHERE id=?').get(tid);
      safe('stock_count', () => S.createAdjustment(db, st.supervisor, sid, { tank_id: tid, after_ml: Math.max(0, t.level_ml - Math.round(t.level_ml * ri(0, 25) / 10000)), note: 'DEMO جرد أسبوعي بالمسطرة' }));
    }
    // monthly: salaries and rent
    if (day.endsWith('-28')) {
      setLocal(day, 20);
      safe('expense', () => S.createExpense(db, accountant, sid, { category: 'salaries', gross: 1_200_000, method: 'bank', note: 'DEMO رواتب الشهر' }));
      safe('expense', () => S.createExpense(db, accountant, sid, { category: 'rent', gross: 400_000, method: 'bank', note: 'DEMO إيجار' }));
    }
  }
  // monthly diesel transfer from التميز to المرتضى
  if (d % 30 === 15) { setLocal(day, 22); const a = STATIONS[0], b = STATIONS[1]; safe('transfer', () => O.createTransfer(db, owner, a.id, { from_tank_id: a.tanks[2], to_station_id: b.id, to_tank_id: b.tanks[2], quantity_ml: L_(3000), note: 'DEMO تحويل ديزل بين المحطات' })); }
  if (d % 30 === 0) process.stdout.write(`  day ${d}/${DAYS}\r`);
}
// leave today's morning shift open so the demo has a live shift
NOW = RealDate.now(); global.Date = RealDate;
for (const st of STATIONS) O.openShiftCmd(db, st.supervisor, st.id, { float_amount: 20_000 });

/* ---- verification ---- */
const integ = O.integrity(db, owner);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Aden' }).format(new RealDate());
const timed = (label, fn) => { const a = performance.now(); const r = fn(); return [label, Math.round(performance.now() - a) + ' ms', r]; };
const perf = [
  timed('dashboard', () => S.dashboard(db, owner, STATIONS[0].id)),
  timed('summary (1 year)', () => S.summary(db, owner, STATIONS[0].id, { from: startDay, to: today })),
  timed('trial balance (org, 1 year)', () => O.trialBalance(db, owner, { from: startDay, to: today })),
  timed('balance sheet', () => O.balanceSheet(db, owner, { as_of: today })),
  timed('customer ageing', () => O.ageing(db, owner, STATIONS[0].id, { type: 'customer' })),
  timed('stock reconciliation (1 year)', () => O.stockReconciliation(db, owner, STATIONS[0].id, { from: startDay, to: today }))
];
const n = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
console.log('\nDEMO tenant created in', dbPath, `(${Math.round((RealDate.now() - t0) / 1000)} s)`);
console.log('  operations:', JSON.stringify(count));
console.log(`  rows: sales ${n('sales')}, journals ${n('journals')}, journal lines ${n('journal_lines')}, stock moves ${n('stock_moves')}, shifts ${n('shifts')}`);
console.log('  integrity:', integ.ok ? 'OK' : 'FAILED', integ.checks.filter(c => !c.ok).map(c => c.name).join('; '));
const tb = perf[2][2], bs = perf[3][2];
console.log(`  trial balance balanced: ${tb.balanced}; balance sheet balanced: ${bs.balanced}; net profit to date: ${bs.current_earnings.toLocaleString('en')} YER`);
for (const [l, t] of perf) console.log(`  ${l}: ${t}`);
console.log(`\nSign in as ${EMAIL} (owner). Password: ${password}`);
console.log('Staff accounts (same password): accountant@, viewer@, manager.tamayuz@, supervisor.tamayuz@, cashier1.tamayuz@, … @fuelpro.demo');
if (!integ.ok) process.exit(2);
