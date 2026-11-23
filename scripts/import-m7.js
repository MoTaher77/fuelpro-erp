'use strict';
/* Import a year of real data from the old "M7" Oracle accounting system into a NEW FuelPro database.
   Input is the SQLite copy of the Oracle export (made by scripts/exp2sqlite.py). Nothing is written to the source.

   Usage: node scripts/import-m7.js --src m7.sqlite --db data/fuelpro.db --email you@x.com --name "..." [--pw-hash <hash> | --password <pw>]

   What becomes what:
     chart of accounts (443)      -> account tree; customers 123*, suppliers 221*, stores 124*, POS 128004* map onto FuelPro's own ledger accounts
     stores 124001..3             -> tanks, opening stock from the year-opening entry
     machines x counters          -> pumps with their last meter readings
     daily meter bills            -> sales by pump (cash) and by customer (credit) with their meter ranges
     purchase invoices            -> deliveries (credit, with freight to drivers' accounts where the invoice had it)
     shortage issues, revaluation -> stock counts / revaluation
     receipt & payment vouchers   -> vouchers against the right cash box or bank
     other journal entries        -> imported journals
   Entries the old system marked cancelled (ENST=3) and its month-end closing entries are skipped; FuelPro closes the books itself. */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openDb, tx } = require('../src/db');
const S = require('../src/services');
const L = require('../src/ledger');
const B = require('../src/books');
const auth = require('../src/auth');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const SRC = arg('src'), OUT = arg('db'), EMAIL = arg('email'), NAME = arg('name', 'المدير');
if (!SRC || !OUT || !EMAIL) { console.error('Usage: node scripts/import-m7.js --src m7.sqlite --db out.db --email you@x.com [--pw-hash h | --password p]'); process.exit(1); }
if (fs.existsSync(OUT)) { console.error(`${OUT} already exists; the importer only writes a new database.`); process.exit(1); }
const old = new DatabaseSync(SRC, { readOnly: true });
const Q = (sql, ...a) => old.prepare(sql).all(...a);
const Q1 = (sql, ...a) => old.prepare(sql).get(...a);
const day = (ts) => String(ts).slice(0, 10);
const M = 1000;                                              // the old books keep amounts to the thousandth of a rial; keep them so, show them to the fils
const R = (v) => { const x = Number(v) || 0; return Math.sign(x) * Math.round(Math.abs(x) * M + 1e-6); };
const ML = (litres) => Math.round(Number(litres) * 1000);
const E4 = (perLitre) => Math.round(Number(perLitre) * M * 10_000);
const warn = []; const W = (m) => { warn.push(m); };

const db = openDb(OUT);
const owner0 = Q1('SELECT * FROM SYS_OWN') || {};
const tmpPw = 'Imp0rt-' + Math.random().toString(36).slice(2) + '!A9';
const reg = S.registerOrg(db, { org_name: (owner0.SONA || 'محطة').trim(), name: NAME, email: EMAIL, password: arg('password') || tmpPw,
  station: { name: (owner0.SONA || 'المحطة').trim(), currency: 'YER', timezone: 'Asia/Aden' } }, '127.0.0.1');
if (arg('pw-hash')) db.prepare('UPDATE users SET pw_hash=? WHERE id=?').run(arg('pw-hash'), reg.user_id);
const user = { id: reg.user_id, org_id: reg.org_id, role: 'owner' };
const sid = reg.station_id, org = reg.org_id;
db.prepare('UPDATE stations SET allow_negative=0, require_shift=0, cur_dec=3, disp_dec=2 WHERE id=?').run(sid);   // stored to 1/1000, shown with fils, like the old system
/* letterhead from the old system's owner record, with the station's logo */
{
  const o = owner0; const j = (...p) => p.map(x => (x || '').trim()).filter(Boolean);
  const phones = (o.HEA6 || '').replace(/^[^0-9]*/, '').split(/[-–,]/).map(x => x.trim()).filter(Boolean).join(' - ');
  const logoFile = path.join(__dirname, '..', 'public', 'brand', 'tamayuz-logo.svg');
  const logo = fs.existsSync(logoFile) ? 'data:image/svg+xml;base64,' + fs.readFileSync(logoFile).toString('base64') : null;
  db.prepare('INSERT INTO org_brand(org_id,name,activity,address,phones,footer,logo) VALUES(?,?,?,?,?,?,?)').run(org, (o.SONA || '').trim(), j(o.HEA2, o.HEA3).join(' '),
    j(o.SONE && o.SONE.replace(/\s*\/\s*/g, ' - '), o.HEA5 && o.HEA5.replace(/\s*\/\s*/g, ' / ')).join(' - '), phones, '', logo);
}
const sysId = (k) => db.prepare('SELECT id FROM accounts WHERE org_id=? AND sys=?').get(org, k).id;

/* =============================== CHART OF ACCOUNTS =============================== */
const oacc = Q('SELECT * FROM ACCOUNT ORDER BY ACNO');
for (const a of oacc) a.ACNA = (a.ACNA || a.ACNE || ("حساب " + a.ACNO)).trim();
const byAcid = new Map(oacc.map(a => [a.ACID, a]));
const typeOf = (no) => no[0] === '1' ? 'asset' : no[0] === '3' ? 'expense' : no[0] === '4' ? 'income' : /^21[123]/.test(no) ? 'equity' : 'liability';
/* role of every old account: which FuelPro ledger account (and party) it becomes */
const SYS_MAP = [[/^128004/, 'cash'], [/^41100[12]$/, 'sales'], [/^33805$/, 'stock_loss'], [/^311/, 'cogs']];
const role = new Map();                      // ACID -> { kind: 'customer'|'supplier'|'store'|'sys'|'acct', ... }
for (const a of oacc) {
  const no = a.ACNO;
  if (a.ATID === 1) { role.set(a.ACID, { kind: 'group' }); continue; }
  if (/^123/.test(no)) { role.set(a.ACID, { kind: 'customer' }); continue; }
  if (/^221/.test(no)) { role.set(a.ACID, { kind: 'supplier' }); continue; }
  if (/^124/.test(no)) { role.set(a.ACID, { kind: 'store' }); continue; }
  const m = SYS_MAP.find(([re]) => re.test(no));
  role.set(a.ACID, m ? { kind: 'sys', sys: m[1] } : { kind: 'acct' });
}
const newId = new Map();                     // old ACID -> FuelPro account id (groups and plain accounts)
const insAcct = db.prepare('INSERT INTO accounts(org_id,code,type,name_ar,name_en,parent_id,is_group,box) VALUES(?,?,?,?,?,?,?,?)');
const groups = oacc.filter(a => a.ATID === 1);
for (let pass = 0; pass < 12; pass++) for (const a of groups) {        // parents first
  if (newId.has(a.ACID)) continue;
  const p = a.ACFN ? byAcid.get(a.ACFN) : null;
  if (p && !newId.has(p.ACID)) continue;
  newId.set(a.ACID, Number(insAcct.run(org, a.ACNO, typeOf(a.ACNO), a.ACNA.trim(), (a.ACNE || a.ACNA).trim(), p ? newId.get(p.ACID) : null, 1, null).lastInsertRowid));
}
const groupByCode = (code) => { const g = oacc.find(a => a.ACNO === code && a.ATID === 1); return g ? newId.get(g.ACID) : null; };
for (const a of oacc) {
  if (role.get(a.ACID).kind !== 'acct') continue;
  const box = /^121/.test(a.ACNO) ? 'cash' : /^122/.test(a.ACNO) ? 'bank' : null;
  const p = a.ACFN ? newId.get(a.ACFN) : null;
  newId.set(a.ACID, Number(insAcct.run(org, a.ACNO, typeOf(a.ACNO), a.ACNA.trim(), (a.ACNE || a.ACNA).trim(), p || null, 0, box).lastInsertRowid));
}
/* FuelPro's own accounts take their place in the old tree */
const PLACE = { cash: '128004', bank: '122', ar: '123', vat_in: '129', interbranch: '128', inventory: '124', ap: '221', vat_out: '229', capital: '211', drawings: '211',
  retained: '212', sales: '411', other_income: '42', cogs: '311', stock_loss: '338', cash_short: '338', exp_salaries: '331', exp_power: '322', exp_maint: '322',
  exp_transport: '312', exp_rent: '334', exp_fees: '332', exp_other: '33' };
for (const [k, code] of Object.entries(PLACE)) { const g = groupByCode(code); if (g) db.prepare('UPDATE accounts SET parent_id=? WHERE org_id=? AND sys=?').run(g, org, k); }
db.prepare("UPDATE accounts SET name_ar='صندوق المبيعات اليومية (نقاط البيع)', name_en='Daily sales drawer (points of sale)' WHERE org_id=? AND sys='cash'").run(org);
db.prepare("UPDATE accounts SET name_ar='العملاء (ذمم)', name_en='Customers (receivables)' WHERE org_id=? AND sys='ar'").run(org);
db.prepare("UPDATE accounts SET name_ar='الموردون (ذمم)', name_en='Suppliers (payables)' WHERE org_id=? AND sys='ap'").run(org);
db.prepare("UPDATE accounts SET name_ar='المبيعات (نقداً وآجل)', name_en='Fuel sales (cash & credit)' WHERE org_id=? AND sys='sales'").run(org);
db.prepare("UPDATE accounts SET name_ar='العجز في المخزون', name_en='Stock shortage' WHERE org_id=? AND sys='stock_loss'").run(org);

/* =============================== CURRENCIES =============================== */
const CUR_OF = { 2: 'SAR', 3: 'USD' };   // old currency ids
db.prepare("INSERT INTO currencies(org_id,code,name_ar,name_en,decimals) VALUES(?,?,?,?,2),(?,?,?,?,2)").run(org, 'USD', 'دولار أمريكي', 'US dollar', org, 'SAR', 'ريال سعودي', 'Saudi riyal');
{ /* the rate each day the old books used it, plus the rate on file today */
  const insR = db.prepare('INSERT OR REPLACE INTO exchange_rates(org_id,code,rate_date,rate_e6,user_id) VALUES(?,?,?,?,?)');
  for (const r of Q(`SELECT substr(e.ENDO,1,10) d, m.AMCR c, m.SCER r FROM ACC_MOV m JOIN ENTRY e USING(BKID,ENID) WHERE m.AMCR IN (2,3) AND e.ENST IN (1,2) AND m.SCER>1 ORDER BY e.ENDO`)) insR.run(org, CUR_OF[r.c], r.d, Math.round(r.r * 1e6), reg.user_id);
  for (const c of Q('SELECT SCID, SCER FROM SYS_CUR WHERE SCID IN (2,3)')) if (!db.prepare('SELECT 1 FROM exchange_rates WHERE org_id=? AND code=?').get(org, CUR_OF[c.SCID])) insR.run(org, CUR_OF[c.SCID], '2026-01-01', Math.round(c.SCER * 1e6), reg.user_id);
}
for (const a of oacc) if (role.get(a.ACID).kind === 'acct' && /^12[12]/.test(a.ACNO)) {
  const c = /دولار/.test(a.ACNA) ? 'USD' : /سعودي/.test(a.ACNA) ? 'SAR' : null;
  if (c) db.prepare('UPDATE accounts SET currency=? WHERE id=?').run(c, newId.get(a.ACID));
}

/* =============================== PARTIES =============================== */
const ocust = new Map(Q('SELECT * FROM CUSTOMERS').map(c => [c.ACID, c]));
const oimp = new Map(Q('SELECT * FROM IMP_INF').map(c => [c.ACID, c]));
const party = new Map();                     // old ACID -> { party_type, party_id }
for (const a of oacc) {
  const r = role.get(a.ACID);
  if (r.kind === 'customer') {
    const c = ocust.get(a.ACID);
    const id = Number(db.prepare('INSERT INTO customers(station_id,name,phone,credit_limit,terms_days,opening_balance,created_on,ref,active) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(sid, a.ACNA.trim(), (c && (c.CUTL || c.CUPA && null)) || null, 0, 30, 0, '2026-01-01', a.ACNO, 1).lastInsertRowid);
    party.set(a.ACID, { party_type: 'customer', party_id: id });
  } else if (r.kind === 'supplier') {
    const c = oimp.get(a.ACID);
    const id = Number(db.prepare('INSERT INTO suppliers(station_id,name,phone,opening_balance,terms_days,created_on,ref) VALUES(?,?,?,?,?,?,?)')
      .run(sid, a.ACNA.trim(), (c && c.IITL) || null, 0, 30, '2026-01-01', a.ACNO).lastInsertRowid);
    party.set(a.ACID, { party_type: 'supplier', party_id: id });
  }
}

/* =============================== FUELS, TANKS, PUMPS =============================== */
const stores = Q('SELECT * FROM STO_INF ORDER BY SIID');
const mats = new Map(Q('SELECT * FROM MAT_KIN').map(m => [m.MKID, m]));
const lastPrice = (siid) => Q1('SELECT MKPR FROM MAC_BIL_M WHERE SIID=? ORDER BY MBMDO DESC, MBMID DESC LIMIT 1', siid);
const tankOf = new Map(), fuelOfStore = new Map(), storeAcct = new Map();
for (const s of stores) {
  const mk = s.SIID;                                         // store n holds material n (البترول/الديزل/الغاز)
  const m = mats.get(mk); const lp = lastPrice(s.SIID);
  const fid = Number(db.prepare('INSERT INTO fuels(station_id,name,price_e4,cost_e4) VALUES(?,?,?,?)').run(sid, m ? m.MKNA.trim() : s.SINA.trim(), lp ? E4(lp.MKPR) : 0, 0).lastInsertRowid);
  const tid = Number(db.prepare('INSERT INTO tanks(station_id,name,fuel_id,capacity_ml,level_ml) VALUES(?,?,?,?,0)').run(sid, s.SINA.trim(), fid, ML(500_000)).lastInsertRowid);
  tankOf.set(s.SIID, tid); fuelOfStore.set(s.SIID, fid); storeAcct.set(s.ACID, s.SIID);
}
/* price history: the old price archive saves every edit; keep the moments the litre price actually changed */
for (const s0 of stores) {
  let last = null;
  for (const r of Q("SELECT IKPP, KICP, KIDO, SUID FROM KIN_INF_ARC WHERE MKID=? AND SCID=1 AND UKID=1 ORDER BY KIDO", s0.SIID)) {
    if (last !== null && Number(r.IKPP) === last) continue;
    db.prepare('INSERT INTO price_history(station_id,fuel_id,effective_at,price_e4,cost_e4,old_price_e4,user_id,note) VALUES(?,?,?,?,?,?,?,?)')
      .run(sid, fuelOfStore.get(s0.SIID), String(r.KIDO).replace('T', ' ').slice(0, 19), E4(r.IKPP), E4(r.KICP), last === null ? null : E4(last), reg.user_id, last === null ? 'السعر في بداية السنة' : null);
    last = Number(r.IKPP);
  }
}
const machines = new Map(Q('SELECT * FROM MACHINE').map(m => [m.MAID, m]));
const pumpOf = new Map();                    // `${MAID}-${COU}` -> pump id
for (const r of Q('SELECT MAID, COU_NO, MAX(NEW_RED) last, MAX(MMMDO) lastday FROM MAC_MOV_D JOIN MAC_MOV_M USING(MMMID) GROUP BY MAID, COU_NO ORDER BY MAID, COU_NO')) {
  const m = machines.get(r.MAID); const siid = m.SIID;
  const multi = Q1('SELECT COUNT(DISTINCT COU_NO) n FROM MAC_MOV_D WHERE MAID=?', r.MAID).n > 1;
  const id = Number(db.prepare('INSERT INTO pumps(station_id,name,tank_id,fuel_id,meter_ml,active) VALUES(?,?,?,?,?,?)')
    .run(sid, m.MANA.trim() + (multi ? ` — عداد ${r.COU_NO}` : ''), tankOf.get(siid), fuelOfStore.get(siid), 0, 1).lastInsertRowid);
  pumpOf.set(`${r.MAID}-${r.COU_NO}`, id);
}

/* =============================== HELPERS =============================== */
const ENTRY_OK = "e.ENST IN (1,2)";
const entryLines = (bk, en) => Q(`SELECT m.ACID, m.AMTY, m.AMEQ, m.AMIN, m.AMCR, m.AMDA, m.AMMD, m.SCER FROM ACC_MOV m WHERE m.BKID=? AND m.ENID=? ORDER BY m.AMID`, bk, en)
  .map(l => ({ acid: l.ACID, dr: l.AMTY === 2 ? Number(l.AMEQ) : 0, cr: l.AMTY === 1 ? Number(l.AMEQ) : 0, memo: (l.AMIN || '').trim() || null,
    ...(CUR_OF[l.AMCR] ? { fc_code: CUR_OF[l.AMCR], fc_amount: Math.round((Number(l.AMDA) + Number(l.AMMD)) * 100), fc_rate_e6: Math.round(Number(l.SCER) * 1e6) } : {}) }));
/** an old account as a FuelPro journal line target */
function target(acid) {
  const r = role.get(acid); if (!r) throw new Error('Unknown old account ' + acid);
  if (r.kind === 'customer' || r.kind === 'supplier') return { a: r.kind === 'customer' ? 'ar' : 'ap', ...party.get(acid) };
  if (r.kind === 'sys') return { a: r.sys };
  if (r.kind === 'store') return { a: 'inventory', store: storeAcct.get(acid) };
  if (r.kind === 'acct') return { a: newId.get(acid) };
  throw new Error('Posting to a group account ' + byAcid.get(acid).ACNO);
}
const keyOf = (t) => `${t.a}|${t.party_type || ''}|${t.party_id || ''}`;
/** round each line to whole rials and push the residue onto the largest line so the entry still balances */
/* Carry rounding per account / party: each posting rounds the running exact total, so a customer's balance after
   a year of half-rial amounts still matches the old books to the rial instead of drifting. */
const exactSum = new Map(), postedSum = new Map();
/* every amount is rounded to the fils exactly as the old system prints it (half away from zero),
   so each statement row reads the same; the residue of a whole entry, if any, goes to a non-party line */
function carry(key, v) {
  const x = Number(v || 0), n = Math.sign(x) * Math.round(Math.abs(x) * M + 1e-6);
  postedSum.set(key, (postedSum.get(key) || 0) + n); return n;
}
const nudge = (key, d) => postedSum.set(key, (postedSum.get(key) || 0) + d);
function roundLines(lines) {
  const out = lines.map(l => { const k = keyOf(l); const n = l.minor ? (l.dr || 0) - (l.cr || 0) : carry(k, (l.dr || 0) - (l.cr || 0)); return { ...l, _k: k, dr: Math.max(n, 0), cr: Math.max(-n, 0) }; }).filter(l => l.dr || l.cr);
  const diff = out.reduce((s, l) => s + l.dr - l.cr, 0);
  if (diff) {   // residue goes to the largest line that is not a customer or supplier
    const pool = out.filter(l => !l.party_type && !l.minor && l.a !== 'inventory'); const big = (pool.length ? pool : out).reduce((m, l) => (l.dr + l.cr > m.dr + m.cr ? l : m));
    if (big.dr) big.dr -= diff; else big.cr += diff; if (big.dr < 0 || big.cr < 0) throw new Error('rounding'); nudge(big._k, -diff);
  }
  return out.map(({ _k, minor, ...l }) => l);
}
const counts = {};
const inc = (k, n = 1) => { counts[k] = (counts[k] || 0) + n; };
const tsOf = (v) => String(v).replace('T', ' ').slice(0, 19);
const BK_NAME = Object.fromEntries(Q('SELECT BKID, BKNA FROM BON_KIN').map(r => [r.BKID, (r.BKNA || '').trim()]));   // نوع الحركة as the old books print it
function postImport(date, memo, lines, source = 'import', sourceId = null, ref = null, at = null, meta = {}) {
  const jl = roundLines(lines).map(l => ({ ...l }));
  const id = L.post(db, { org_id: org, station_id: sid, date, source, source_id: sourceId, memo, user_id: user.id, lines: jl });
  if (id) { inc('journals'); db.prepare('UPDATE journals SET ref=COALESCE(?,ref), created_at=COALESCE(?,created_at), doc_type=?, doc_ref=? WHERE id=?').run(ref, at, meta.doc_type || null, meta.doc_ref || null, id); }
  return id;
}

/* =============================== EVENTS, IN DATE ORDER =============================== */
const events = [];
const openingEntry = Q1("SELECT * FROM ENTRY e WHERE BKID=8 AND ENST IN (1,2) ORDER BY ENDO LIMIT 1");
const billEntryIds = new Set(Q('SELECT ENID FROM MAC_BIL_M').map(r => r.ENID));
for (const b of Q('SELECT * FROM MAC_BIL_M ORDER BY MBMDO, MBMID')) events.push({ date: day(b.MBMDO), ord: 3, t: String(b.MBMID).padStart(8, '0'), kind: 'bill', b });
for (const m of Q(`SELECT m.*, e.ENID, e.ENST FROM BIL_MAS m JOIN ENTRY e ON e.BKID=3 AND e.BKMID=m.BKID AND e.BMID=m.BMID AND ${ENTRY_OK} WHERE m.BKID=1 ORDER BY m.BMDO`))
  events.push({ date: day(m.BMDO), ord: 1, t: m.BMDO, kind: 'purchase', m });
for (const m of Q(`SELECT m.*, e.BKID EBK, e.ENID FROM BIL_MAS m JOIN ENTRY e ON e.BKID IN (25,26) AND e.BKMID=m.BKID AND e.BMID=m.BMID AND ${ENTRY_OK} WHERE m.BKID IN (21,23) ORDER BY m.BMDO`)) {
  if (m.BKID === 21 && m.BMID <= stores.length) continue;      // year-opening stock (taken from the opening entry)
  events.push({ date: day(m.BMDO), ord: m.BKID === 21 ? 2.6 : 2.5, t: m.BMDO, kind: 'stock', m });
}
for (const e of Q(`SELECT * FROM ENTRY e WHERE ${ENTRY_OK} AND BKID NOT IN (3,8,25,26) ORDER BY ENDO`)) {
  if (e.BKID === 10 && billEntryIds.has(e.ENID)) continue;                       // posted with its bill
  if (e.BKID === 10) { inc('skipped_closing'); continue; }                         // month-end trading / P&L closing
  events.push({ date: day(e.ENDO), ord: 4, t: e.ENDO, kind: 'entry', e });
}
events.sort((a, b) => a.date.localeCompare(b.date) || a.ord - b.ord || String(a.t).localeCompare(String(b.t)));
console.log(`events: ${events.length}`);

const tankRow = (tid) => db.prepare('SELECT * FROM tanks WHERE id=?').get(tid);
let shortSales = 0;

function doOpening() {
  const lines = entryLines(8, openingEntry.ENID);
  const out = [];
  for (const l of lines) {
    const t = target(l.acid);
    if (t.store) {                                             // opening stock: quantity from the opening stock order, value from the books
      const siid = t.store, tid = tankOf.get(siid);
      const q = Q1("SELECT d.BDNO q FROM BIL_MAS m JOIN BIL_DET d USING(BKID,BMID) WHERE m.BKID=21 AND m.SIID=? ORDER BY m.BMDO LIMIT 1", siid);
      const value = R(l.dr - l.cr);
      L.stockMove(db, tid, { qty: ML(q.q), value, kind: 'opening', ref_type: 'import', date: '2026-01-01', user_id: user.id });
      out.push({ a: 'inventory', dr: Math.max(value, 0), cr: Math.max(-value, 0), minor: true });
      continue;
    }
    out.push({ ...t, dr: l.dr, cr: l.cr, memo: l.memo, ...(l.fc_code ? { fc_code: l.fc_code, fc_amount: l.fc_amount, fc_rate_e6: l.fc_rate_e6 } : {}) });
  }
  postImport('2026-01-01', 'رصيد افتتاحي 2026 — منقول من النظام السابق', out, 'import_opening', null, String(openingEntry.ENID), '2026-01-01 00:00:00', { doc_type: BK_NAME[8] });
}

function doPurchase(m) {
  const det = Q1('SELECT * FROM BIL_DET WHERE BKID=? AND BMID=?', m.BKID, m.BMID);
  const siid = m.SIID, tid = tankOf.get(siid), fid = fuelOfStore.get(siid);
  const lines = entryLines(3, m.ENID);
  const out = []; let value = 0, payable = 0; const sup = party.get(m.ACID);
  for (const l of lines) {
    const t = target(l.acid);
    if (t.a === 'cogs') continue;                                      // cost of purchases -> stock (value = what the other lines owe)
    const n = carry(keyOf(t), l.dr - l.cr);                              // fils, rounded on the party's running total
    if (t.party_type === 'supplier' && sup && t.party_id === sup.party_id) payable -= n;
    value -= n;
    out.push({ ...t, dr: Math.max(n, 0), cr: Math.max(-n, 0), memo: l.memo, minor: true });
  }
  const qty = ML(det.BDNO);
  const did = Number(db.prepare(`INSERT INTO deliveries(station_id,tank_id,fuel_id,business_date,created_at,quantity_ml,cost_e4,net,vat,supplier,user_id,supplier_id,pay_type,payable,ref,note)
    VALUES(?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?)`).run(sid, tid, fid, day(m.BMDO), String(m.BMDO).replace('T', ' ').slice(0, 19), qty, E4(det.BDPU), value, sup ? byAcid.get(m.ACID).ACNA : null, user.id, sup ? sup.party_id : null, 'credit', payable, String(m.BMID), (m.BMIN || '').trim() || null).lastInsertRowid);
  const moved = L.stockMove(db, tid, { qty, value, kind: 'delivery', ref_type: 'delivery', ref_id: did, date: day(m.BMDO), user_id: user.id });
  out.push({ a: 'inventory', dr: moved, minor: true });
  if (moved !== value) out.push({ a: 'cogs', dr: value - moved, minor: true });
  postImport(day(m.BMDO), (m.BMIN || 'فاتورة مشتريات').trim(), out, 'delivery', did, String(m.ENID), tsOf(m.BMDO), { doc_type: BK_NAME[3], doc_ref: String(m.BMID) });
  inc('deliveries');
}

function doStock(m) {
  const det = Q1('SELECT * FROM BIL_DET WHERE BKID=? AND BMID=?', m.BKID, m.BMID);
  const tid = tankOf.get(m.SIID); const date = day(m.BMDO);
  const lines = entryLines(m.EBK, m.ENID);
  const revalLine = lines.find(l => byAcid.get(l.acid).ACNO === '33807');            // cost revaluation pair (issue at old cost, receive at new)
  const isReval = !!revalLine;
  const acct = isReval ? revalLine : lines.find(l => l.dr > 0);                       // who bears a shortage (the debit side)
  if (isReval) {
    if (m.BKID === 23) return;                                     // the issue half; the receipt half below sets the new cost
    const t = tankRow(tid); const target = Math.round(t.level_ml * Number(det.BDPU) * M / 1000);
    const moved = L.stockMove(db, tid, { qty: 0, value: target - t.value, kind: 'count', ref_type: 'revaluation', date, user_id: user.id });
    postImport(date, `إعادة تقييم مخزون ${t.name} بسعر تكلفة ${det.BDPU}`, [{ a: 'inventory', dr: Math.max(moved, 0), cr: Math.max(-moved, 0), minor: true }, { a: newId.get(acct.acid), dr: Math.max(-moved, 0), cr: Math.max(moved, 0), minor: true }], 'stock_count', null, String(m.ENID), tsOf(m.BMDO), { doc_type: BK_NAME[m.EBK], doc_ref: String(m.BMID) });
    inc('revaluations'); return;
  }
  /* a shortage issue: stock goes down at FuelPro's average cost; the old document says who bears it */
  const before = tankRow(tid);
  const qty = Math.min(ML(det.BDNO), before.level_ml);
  if (qty < ML(det.BDNO)) W(`shortage ${m.BMID}: tank had only ${before.level_ml / 1000} L`);
  const aid = Number(db.prepare("INSERT INTO adjustments(station_id,tank_id,business_date,before_ml,after_ml,note,user_id) VALUES(?,?,?,?,?,?,?)").run(sid, tid, date, before.level_ml, before.level_ml - qty, (m.BMIN || 'ترحيل عجز').trim(), user.id).lastInsertRowid);
  const v = -L.stockMove(db, tid, { qty: -qty, kind: 'count', ref_type: 'adjustment', ref_id: aid, date, user_id: user.id });
  const t = target(acct.acid); const oldAmt = R(acct.dr);
  const out = [{ a: 'inventory', cr: v, minor: true }];
  if (t.a === 'stock_loss') out.push({ a: 'stock_loss', dr: v, minor: true });
  else { out.push({ ...t, dr: oldAmt, minor: true }); if (oldAmt !== v) out.push({ a: 'stock_loss', dr: Math.max(v - oldAmt, 0), cr: Math.max(oldAmt - v, 0), minor: true }); }
  postImport(date, (m.BMIN || 'ترحيل عجز').trim(), out, 'stock_count', aid, String(m.ENID), tsOf(m.BMDO), { doc_type: BK_NAME[m.EBK], doc_ref: String(m.BMID) });
  inc('shortages');
}

const insSale = db.prepare(`INSERT INTO sales(station_id,client_id,pump_id,fuel_id,tank_id,business_date,created_at,quantity_ml,price_e4,cost_e4,net,vat,gross,vat_bp,vat_included,pay_type,customer_id,open_ml,close_ml,user_id,shift_id,cogs,note,ref,bill)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,0,?,0,1,?,?,?,?,?,NULL,0,?,?,?)`);
function sale(b, n, seg, qty, gross, custId, memoAcct, note = null, at = null) {
  const pump = db.prepare('SELECT * FROM pumps WHERE id=?').get(seg.pump);
  const t = tankRow(pump.tank_id); const date = day(b.MBMDO);
  const price = qty ? Math.round(gross * 1000 / qty * 10_000) : E4(b.MKPR);
  const id = Number(insSale.run(sid, `m7-${b.MBMID}-${n}`, pump.id, pump.fuel_id, pump.tank_id, date, at || date + ' 20:00:00', qty, price || 1, t.avg_cost_e4, gross, gross, custId ? 'credit' : 'cash', custId, seg.open, seg.close, user.id, note, String(b.ENID), String(b.MBMID)).lastInsertRowid);
  const take = Math.min(qty, t.level_ml); if (take < qty) shortSales += qty - take;
  const cogs = -L.stockMove(db, pump.tank_id, { qty: -take, kind: 'sale', ref_type: 'sale', ref_id: id, date, user_id: user.id });
  db.prepare('UPDATE sales SET cogs=? WHERE id=?').run(cogs, id);
  L.post(db, { org_id: org, station_id: sid, date, source: 'sale', source_id: id, user_id: user.id, lines: [
    { a: custId ? 'ar' : 'cash', dr: gross, party_type: custId ? 'customer' : null, party_id: custId }, { a: 'sales', cr: gross }, { a: 'cogs', dr: cogs }, { a: 'inventory', cr: cogs }] });
  if (memoAcct) postImport(date, note || `وقود محسوب على حساب ${memoAcct.name}`, [{ ...memoAcct.t, dr: gross, memo: note, minor: true }, { a: 'cash', cr: gross, minor: true }], 'import', null, String(b.ENID), at, { doc_type: BK_NAME[10], doc_ref: String(b.MBMID) });
  db.prepare('UPDATE pumps SET meter_ml=? WHERE id=? AND meter_ml<?').run(seg.close, pump.id, seg.close);
  inc(custId ? 'sales_credit' : 'sales_cash');
}
function doBill(b) {
  const pumps = Q('SELECT * FROM MAC_MOV_D WHERE MBMID=? AND MMDST=1 ORDER BY MMDID', b.MBMID).filter(p => p.MMDNO > 0);
  const Qb = ML(b.MBMNO), A = carry('bills', b.MBMAM);
  if (!pumps.length) { W(`bill ${b.MBMID} has no pump readings; booked on the first pump of its store`); }
  const segs = pumps.length ? pumps.map(p => ({ pump: pumpOf.get(`${p.MAID}-${p.COU_NO}`), from: ML(p.LST_RED), to: ML(p.NEW_RED), q: ML(p.NEW_RED) - ML(p.LST_RED) }))
    : [{ pump: db.prepare('SELECT id FROM pumps WHERE tank_id=? ORDER BY id LIMIT 1').get(tankOf.get(b.SIID)).id, from: 0, to: Qb, q: Qb }];
  const P = segs.reduce((s, x) => s + x.q, 0) || 1;
  const scale = Qb / P;                                            // bill quantity is what was charged; spread it over the meters
  let si = 0, used = 0, n = 0;
  const cut = (qty) => {                                           // consume qty litres (ml) from the meter segments, in order
    const parts = []; let left = qty;
    while (left > 0 && si < segs.length) {
      const s = segs[si], cap = Math.round(s.q * scale) - used;
      const take = si === segs.length - 1 ? left : Math.min(left, cap);
      const a = s.from + Math.round(used / scale), z = s.from + Math.round((used + take) / scale);
      parts.push({ pump: s.pump, q: take, open: a, close: Math.max(z, a + 1) });
      used += take; left -= take;
      if (si < segs.length - 1 && used >= cap) { si++; used = 0; }
    }
    return parts;
  };
  const credit = Q('SELECT * FROM MAC_BIL_D WHERE MBMID=? ORDER BY MBDID', b.MBMID);
  /* the old books' own wording for each line ("كرت96551قيمة 40 * 475"), taken from the bill's posted entry in the same order */
  const be = Q1('SELECT ENDO FROM ENTRY WHERE BKID=10 AND ENID=?', b.ENID); const at = be ? tsOf(be.ENDO) : null;
  const words = new Map();
  for (const l of Q('SELECT ACID, AMEQ, AMIN FROM ACC_MOV WHERE BKID=10 AND ENID=? AND AMTY=2 ORDER BY AMID', b.ENID)) { if (!words.has(l.ACID)) words.set(l.ACID, []); words.get(l.ACID).push(l); }
  const wordFor = (d) => { const q = words.get(d.ACID) || []; let i = q.findIndex(x => Math.abs(x.AMEQ - d.MBMAM) < 0.01); if (i < 0) i = 0; const w = q.splice(i, 1)[0]; return ((w && w.AMIN) || d.MBMIN || '').trim() || null; };
  let cq = 0, ca = 0;
  for (const d of credit) {
    const qty = ML(d.MBMNO), gross = carry('credit|' + d.ACID, d.MBMAM); if (!qty || !gross) { if (gross) W(`bill ${b.MBMID} line ${d.MBDID}: amount without quantity`); continue; }
    cq += qty; ca += gross;
    const r = role.get(d.ACID); const p = party.get(d.ACID);
    const parts = cut(qty); const note = wordFor(d);
    const seg = { pump: parts[0].pump, open: parts[0].open, close: parts.filter(x => x.pump === parts[0].pump).pop().close };   // one row per document line, like the old statement
    if (p && p.party_type === 'customer') sale(b, ++n, seg, qty, gross, p.party_id, null, note, at);
    else sale(b, ++n, seg, qty, gross, null, { name: byAcid.get(d.ACID).ACNA.trim(), t: target(d.ACID) }, note, at);
    if (r.kind !== 'customer') inc('sales_charged_to_accounts');
  }
  const restQ = Qb - cq, restA = A - ca;
  if (restQ < 0 || restA < 0) { W(`bill ${b.MBMID}: credit lines exceed the bill (${restQ / 1000} L, ${restA})`); }
  if (restQ > 0) { const parts = cut(restQ); let given = 0;
    parts.forEach((x, i) => { const g = i === parts.length - 1 ? restA - given : Math.round(restA * x.q / restQ); given += g; if (g > 0) sale(b, ++n, x, x.q, g, null, null, null, at); }); }
  for (const s of segs) db.prepare('UPDATE pumps SET meter_ml=? WHERE id=? AND meter_ml<?').run(s.to, s.pump, s.to);
}

function doEntry(e) {
  const lines = entryLines(e.BKID, e.ENID);
  if (!lines.length) return;
  const fcOf = (l) => l.fc_code ? { fc_code: l.fc_code, fc_amount: l.fc_amount, fc_rate_e6: l.fc_rate_e6 } : {};
  const mapped = lines.map(l => ({ ...target(l.acid), dr: l.dr, cr: l.cr, memo: l.memo, acid: l.acid, ...fcOf(l) }));
  if (mapped.some(l => l.store)) { W(`entry ${e.BKID}/${e.ENID} touches a store account; booked to inventory`); }
  const memo = (e.ENIN || '').trim() || mapped.map(l => l.memo).find(Boolean) || `قيد ${e.ENID}`;
  const date = day(e.ENDO);
  /* receipt (2) / payment (1) vouchers: exactly one box on the money side */
  if (e.BKID === 1 || e.BKID === 2) {
    const rec = e.BKID === 2;
    const boxSide = mapped.filter(l => rec ? l.dr > 0 : l.cr > 0), other = mapped.filter(l => rec ? l.cr > 0 : l.dr > 0);
    const boxAcct = boxSide.length && new Set(boxSide.map(l => l.a)).size === 1 ? boxSide[0].a : null;
    const isBox = boxAcct && (typeof boxAcct === 'number' ? db.prepare('SELECT box FROM accounts WHERE id=?').get(boxAcct).box : boxAcct === 'cash');
    const boxCur = typeof boxAcct === 'number' ? db.prepare('SELECT currency FROM accounts WHERE id=?').get(boxAcct).currency : null;
    const boxFc = boxCur ? boxSide[0] : null;
    if (isBox && other.length && other.every(l => !l.store) && (boxCur ? boxFc.fc_code === boxCur : mapped.every(l => !l.fc_code))) {
      const ls = other.map(l => { const n = carry(keyOf(l), l.dr - l.cr); return { ...l, dr: Math.max(n, 0), cr: Math.max(-n, 0) }; }).map(l => ({ account_id: typeof l.a === 'number' ? l.a : sysId(l.a), party_type: l.party_type || undefined, party_id: l.party_id || undefined, amount: rec ? l.cr - l.dr : l.dr - l.cr, memo: l.memo || undefined,
        ...(boxCur ? { fc_amount: l.fc_code === boxCur ? l.fc_amount : Math.max(1, Math.round((l.dr + l.cr) * 1e6 / boxFc.fc_rate_e6 * 100 / M)) } : {}) }));
      const good = ls.filter(l => l.amount > 0), back = ls.filter(l => l.amount < 0);
      if (!back.length && good.length) {
        const memoV = memo.length > 300 ? memo.slice(0, 297) + '…' : memo;
        B.createVoucher(db, user, sid, { kind: rec ? 'receipt' : 'payment', box_account_id: typeof boxAcct === 'number' ? boxAcct : sysId(boxAcct), ref_no: String(e.ENID), memo: memoV,
          ...(boxCur ? { fc_rate_e6: boxFc.fc_rate_e6 } : {}),
          lines: good.map(l => ({ ...l, memo: l.memo ? l.memo.slice(0, 200) : undefined })) }, { date, keepBase: true });
        const vid = db.prepare('SELECT MAX(id) id FROM vouchers').get().id; const at = tsOf(e.ENDO);
        db.prepare('UPDATE vouchers SET created_at=? WHERE id=?').run(at, vid);
        db.prepare("UPDATE journals SET created_at=?, ref=?, doc_type=?, doc_ref=? WHERE source='voucher' AND source_id=?").run(at, String(e.ENID), BK_NAME[e.BKID], e.ENRE ? String(e.ENRE).trim() : null, vid);
        inc(rec ? 'vouchers_receipt' : 'vouchers_payment'); return;
      }
    }
  }
  postImport(date, memo.slice(0, 300), mapped.map(l => ({ a: l.a, dr: l.dr, cr: l.cr, party_type: l.party_type, party_id: l.party_id, memo: l.memo ? l.memo.slice(0, 300) : null, ...fcOf(l) })), 'import', null, String(e.ENID), tsOf(e.ENDO), { doc_type: BK_NAME[e.BKID], doc_ref: e.ENRE ? String(e.ENRE).trim() : null });
  inc('entries_as_journals');
}

const t0 = Date.now();
tx(db, () => doOpening());
let cur = null, batch = [];
const flush = () => { if (!batch.length) return; const b = batch; batch = []; tx(db, () => { for (const ev of b) run(ev); }); };
function run(ev) {
  try {
    if (ev.kind === 'bill') doBill(ev.b); else if (ev.kind === 'purchase') doPurchase(ev.m); else if (ev.kind === 'stock') doStock(ev.m); else doEntry(ev.e);
  } catch (err) { err.message = `${ev.kind} ${ev.date} ${JSON.stringify(ev.b ? { bill: ev.b.MBMID } : ev.m ? { bk: ev.m.BKID, bm: ev.m.BMID } : { e: `${ev.e.BKID}/${ev.e.ENID}` })}: ${err.message}`; throw err; }
}
for (const ev of events) { if (ev.date !== cur) { flush(); cur = ev.date; } batch.push(ev); }
flush();

/* fixed assets: every old asset account (11*) that holds a cost becomes an asset in the register; set its life to start depreciating */
tx(db, () => {
  L.ensureChart(db, org);
  for (const a of oacc) {
    if (role.get(a.ACID).kind !== 'acct' || !/^11/.test(a.ACNO)) continue;
    const id = newId.get(a.ACID);
    const b = db.prepare("SELECT COALESCE(SUM(l.debit-l.credit),0) v, MIN(j.business_date) d FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE l.account_id=? AND j.status='posted'").get(id);
    if (b.v <= 0) continue;
    db.prepare('INSERT INTO fixed_assets(org_id,station_id,name,ref,account_id,accum_account_id,expense_account_id,acquired_on,cost,life_months,note) VALUES(?,?,?,?,?,?,?,?,?,0,?)')
      .run(org, sid, a.ACNA, a.ACNO, id, sysId('accum_dep'), sysId('exp_dep'), b.d, b.v, 'منقول من النظام السابق — حدّد العمر الإنتاجي لبدء الإهلاك');
    inc('fixed_assets');
  }
});

/* tank capacities: room for the largest stock the year saw, rounded up */
for (const t of db.prepare('SELECT id FROM tanks WHERE station_id=?').all(sid)) {
  const mx = db.prepare('SELECT MAX(balance_ml) m FROM stock_moves WHERE tank_id=?').get(t.id).m || 0;
  db.prepare('UPDATE tanks SET capacity_ml=? WHERE id=?').run(Math.max(Math.ceil(mx * 1.15 / 5_000_000) * 5_000_000, 10_000_000), t.id);
}
/* fuels: current cost from the tank */
for (const f of db.prepare('SELECT f.id, t.avg_cost_e4 FROM fuels f JOIN tanks t ON t.fuel_id=f.id WHERE f.station_id=?').all(sid)) db.prepare('UPDATE fuels SET cost_e4=? WHERE id=?').run(f.avg_cost_e4, f.id);
/* pumps never used in the last 30 days of the data are switched off (they stay in the history) */
const lastDay = db.prepare('SELECT MAX(business_date) d FROM sales WHERE station_id=?').get(sid).d;
db.prepare("UPDATE pumps SET active=0 WHERE station_id=? AND id NOT IN (SELECT DISTINCT pump_id FROM sales WHERE business_date>=date(?, '-30 days'))").run(sid, lastDay);
db.prepare("INSERT INTO audit(org_id,station_id,user_id,action,entity,detail) VALUES(?,?,?,?,?,?)").run(org, sid, user.id, 'import.m7', 'station', JSON.stringify({ src: path.basename(SRC), counts }));

const integ = require('../src/ops').integrity(db, user);
console.log('counts', counts);
console.log('stock taken beyond tank level (litres):', shortSales / 1000);
console.log('integrity', integ.ok, integ.checks.filter(c => !c.ok));
console.log('warnings', warn.length); for (const w of warn.slice(0, 30)) console.log('  -', w);
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
db.close();
