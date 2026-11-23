'use strict';
/* Carry the old M7 system's history into FuelPro's normal tables, without duplicates.
   - document edit copies, entry approvals, closing runs, login/activity log -> audit (actions m7.*), linked to the journal when found
   - old users -> users (inactive until the owner gives them an e-mail and a password)
   - exchange-rate history -> exchange_rates (an existing day is kept)
   - saved period results (trading account / P&L) -> m7_results, shown in «الأرباح الشهرية» for earlier years
   - monthly store values -> m7_stock_month, shown in «الجرد الشهري» next to FuelPro's value
   Every source row has a key (src_key / detail.k), so running it again adds only what is new. Journals and stock are never touched.
   Source = the SQLite copy of an M7 export (scripts/exp2sqlite.js). */
const crypto = require('node:crypto');
const V = require('./validate');
const { tx } = require('./db');
const auth = require('./auth');
const S = require('./services');
const { notFound } = require('./errors');
const { need, station } = S;

const CUR_OF = { 2: 'SAR', 3: 'USD' };            // old currency ids, as in scripts/import-m7.js
const OLD_MAIL = '@old-system.invalid';           // placeholder address of an imported, inactive user
const day = (v) => (v ? String(v).slice(0, 10) : null);
const ts = (v) => (v ? String(v).replace('T', ' ').slice(0, 19) : null);
const txt = (v) => (v == null ? null : String(v).trim() || null);
const int = (v) => (v == null || v === '' ? null : Number.parseInt(v, 10));
/* the old system kept local wall-clock times; FuelPro's audit keeps UTC */
function toUtc(local, tz) {
  if (!local) return null;
  const guess = Date.parse(local.replace(' ', 'T') + 'Z'); if (Number.isNaN(guess)) return local;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(guess)).map(x => [x.type, x.value]));
  const offset = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - guess;
  return new Date(guess - offset).toISOString().slice(0, 19).replace('T', ' ');
}
const key = (table, row) => table + ':' + crypto.createHash('sha1').update(JSON.stringify(row)).digest('hex').slice(0, 20);

/** Exact decimal string -> integer minor units (half away from zero). No floats. */
function toMinor(v, dec) {
  if (v == null || v === '') return 0;
  const s = String(v).trim(); const neg = s.startsWith('-');
  const [ip, fp = ''] = s.replace(/^[-+]/, '').split('.');
  const digits = BigInt((ip || '0') + fp.padEnd(dec + 1, '0').slice(0, dec + 1));
  const n = Number((digits + 5n) / 10n); return neg ? -n : n;
}

function load(db, src, { orgId, stationId, userId = null } = {}) {
  const st = db.prepare('SELECT * FROM stations WHERE id=? AND org_id=?').get(stationId, orgId);
  if (!st) throw new Error('Station not found in this organisation');
  const dec = st.cur_dec;
  const has = (t) => !!src.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
  const Q = (t, sql) => (has(t) ? src.prepare(sql).all() : []);
  const acctId = new Map(db.prepare('SELECT code, id FROM accounts WHERE org_id=?').all(orgId).map(r => [r.code, r.id]));
  const oldAcc = Q('ACCOUNT', 'SELECT * FROM ACCOUNT');
  const acnoOf = new Map(oldAcc.map(r => [String(r.ACID), String(r.ACNO)]));
  const nameOf = new Map(oldAcc.map(r => [String(r.ACNO), txt(r.ACNA) || txt(r.ACNE)]));
  const groupCode = new Set(oldAcc.filter(r => String(r.ATID) === '1').map(r => String(r.ACNO)));
  const bookName = new Map(Q('BON_KIN', 'SELECT BKID, BKNA FROM BON_KIN').map(r => [int(r.BKID), txt(r.BKNA)]));
  const byRef = new Map();
  for (const j of db.prepare('SELECT id, business_date, ref FROM journals WHERE org_id=? AND station_id=? AND ref IS NOT NULL').all(orgId, stationId)) {
    if (!byRef.has(j.ref)) byRef.set(j.ref, []); byRef.get(j.ref).push(j);
  }
  const journalOf = (ref, date) => {
    const js = ref ? byRef.get(String(ref)) || [] : [];
    if (js.length === 1) return js[0].id;
    const same = js.filter(j => j.business_date === date); return same.length === 1 ? same[0].id : null;
  };
  const counts = {};
  const tally = (name, source, added) => { counts[name] = { source, added }; };

  return tx(db, () => {
    /* ---- users first, so the log and edit copies can name them ---- */
    const users = Q('SYS_USR', 'SELECT SUID, SUNA, SUNE, SUST, SUDA FROM SYS_USR');
    const userByOld = new Map(); let added = 0;
    const insUser = db.prepare("INSERT INTO users(org_id,email,name,pw_hash,role,active,created_at) VALUES(?,?,?,?,'viewer',0,?)");
    for (const u of users) {
      const code = txt(u.SUID) || txt(u.SUNA); if (!code) continue;
      const email = `m7-${crypto.createHash('sha1').update(orgId + ':' + code).digest('hex').slice(0, 10)}${OLD_MAIL}`;
      let row = db.prepare('SELECT id FROM users WHERE email=?').get(email);
      if (!row) { row = { id: Number(insUser.run(orgId, email, txt(u.SUNA) || code, auth.hashPassword(crypto.randomBytes(24).toString('base64')), (day(u.SUDA) || '2020-01-01') + ' 00:00:00').lastInsertRowid) }; added++; }
      for (const n of [txt(u.SUID), txt(u.SUNA), txt(u.SUNE)]) if (n) userByOld.set(n, row.id);
    }
    tally('users', users.length, added);
    const uid = (name) => (name && userByOld.get(String(name).trim())) || null;

    /* ---- audit rows (actions m7.*), keyed by detail.k ---- */
    const seen = new Set(db.prepare("SELECT detail FROM audit WHERE org_id=? AND action LIKE 'm7.%'").all(orgId).map(r => { try { return JSON.parse(r.detail).k; } catch { return null; } }));
    const insA = db.prepare('INSERT INTO audit(org_id,station_id,user_id,action,entity,entity_id,detail,created_at) VALUES(?,?,?,?,?,?,?,?)');
    const addAudit = (k, who, action, entity, entityId, detail, at) => { if (seen.has(k)) return 0; seen.add(k);
      insA.run(orgId, stationId, uid(who), action, entity, entityId, JSON.stringify({ k, ...detail }), toUtc(at, st.timezone || 'UTC') || '2020-01-01 00:00:00'); return 1; };

    /* document edit copies: the version saved before each change, with its lines */
    const copies = Q('ENTRY_CPY', 'SELECT * FROM ENTRY_CPY');
    const linesOf = new Map();
    for (const l of Q('ACC_MOV_CPY', 'SELECT * FROM ACC_MOV_CPY')) {
      const acno = l.ACNO != null ? String(l.ACNO) : acnoOf.get(String(l.ACID)) || null;
      if (!linesOf.has(String(l.CPYID))) linesOf.set(String(l.CPYID), []);
      linesOf.get(String(l.CPYID)).push({ acno, name: acno ? nameOf.get(acno) || null : null, debit: toMinor(l.AMMD, dec), credit: toMinor(l.AMDA, dec), memo: txt(l.AMIN) });
    }
    added = 0;
    for (const c of copies) {
      const ref = txt(c.UTOID) || txt(c.ENNO), jid = journalOf(txt(c.UTOID), day(c.ENDO));
      added += addAudit(key('ENTRY_CPY', c), txt(c.SUID), 'm7.doc_edit', 'journal', jid,
        { book: bookName.get(int(c.BKID)) || null, ref, doc_date: day(c.ENDO), amount: toMinor(c.ENAM, dec), memo: txt(c.ENIN), state: int(c.CPYST), lines: linesOf.get(String(c.CPYID)) || [] }, ts(c.ENDA));
    }
    tally('doc_edits', copies.length, added);

    /* entry approvals */
    const batches = new Map(Q('APP_ENT_M', 'SELECT * FROM APP_ENT_M').map(r => [String(r.AEMID), r]));
    const appr = Q('APP_ENT_D', 'SELECT * FROM APP_ENT_D'); added = 0;
    for (const a of appr) { const m = batches.get(String(a.AEMID)) || {};
      added += addAudit(key('APP_ENT_D', a), txt(m.SUID), 'm7.approve', 'journal', journalOf(txt(a.ENID), null), { batch: int(a.AEMID), book: bookName.get(int(a.BKID)) || null, ref: txt(a.ENID) }, ts(m.AEMDO)); }
    tally('approvals', appr.length, added);

    /* month-end closing / valuation runs */
    const runs = Q('BAL_INF', 'SELECT * FROM BAL_INF'); added = 0;
    for (const r of runs) added += addAudit(key('BAL_INF', r), txt(r.SUID), 'm7.period_run', 'period', int(r.BIID), { title: txt(r.BIIN), from: day(r.BIFD), to: day(r.BITD) }, ts(r.BIDO));
    tally('closing_runs', runs.length, added);

    /* sign-in / sign-out and activity log */
    const logs = [...Q('USR_ARC', 'SELECT * FROM USR_ARC').map(r => ['USR_ARC', r]), ...Q('SYS_LOG', 'SELECT * FROM SYS_LOG').map(r => ['SYS_LOG', r])]; added = 0;
    for (const [t, r] of logs) {
      if (t === 'USR_ARC') added += addAudit(key(t, r), txt(r.SUID), r.UATY === 'I' ? 'm7.login' : r.UATY === 'O' ? 'm7.logout' : 'm7.action', 'user', null, { user: txt(r.SUID), text: txt(r.UAIN) }, ts(r.UADO));
      else added += addAudit(key(t, r), txt(r.SUNA) || txt(r.SUID), 'm7.action', 'user', null, { user: txt(r.SUNA) || txt(r.SUID), text: txt(r.SLIN) }, ts(r.SLDO));
    }
    tally('user_log', logs.length, added);

    /* ---- saved period results (trading account = kind 3, profit & loss = kind 2; kind 1 = currency valuation snapshots) ---- */
    const res = Q('BAL_ACC', 'SELECT * FROM BAL_ACC');
    const insR = db.prepare('INSERT OR IGNORE INTO m7_results(org_id,station_id,account_id,acno,acname,as_of,kind,status,debit,credit,made_at,src_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
    added = 0;
    for (const r of res) { if (r.ACNO == null || groupCode.has(String(r.ACNO))) continue; const acno = String(r.ACNO);
      added += insR.run(orgId, stationId, acctId.get(acno) ?? null, acno, nameOf.get(acno) || txt(r.ACNA), day(r.BADC), int(r.BATY), int(r.BAST),
        toMinor(r.BAMD, dec), toMinor(r.BADA, dec), ts(r.BADO), key('BAL_ACC', r)).changes; }
    tally('period_results', res.length, added);

    /* ---- monthly store values ---- */
    const stores = new Map(Q('STO_INF', 'SELECT SIID, SINA FROM STO_INF').map(r => [String(r.SIID), txt(r.SINA)]));
    const tankByName = new Map(db.prepare('SELECT id, name FROM tanks WHERE station_id=?').all(stationId).map(t => [t.name.trim(), t.id]));
    const insS = db.prepare('INSERT OR IGNORE INTO m7_stock_month(org_id,station_id,tank_id,store_no,store_name,month_end,value,entered_at,src_key) VALUES(?,?,?,?,?,?,?,?,?)');
    const sm = Q('STO_AMN', 'SELECT * FROM STO_AMN'); added = 0;
    for (const r of sm) { if (!r.SADO) continue;
      added += insS.run(orgId, stationId, tankByName.get(stores.get(String(r.SIID))) ?? null, int(r.SIID), stores.get(String(r.SIID)) || null, day(r.SADO), toMinor(r.SAAM, dec), ts(r.SADA), key('STO_AMN', r)).changes; }
    tally('stock_months', sm.length, added);

    /* ---- exchange-rate history: the day each old rate took effect; the latest save of a day wins, an existing day is kept ---- */
    const rates = Q('SYS_CUR_ARC', 'SELECT SCID, SCER, SCDA, SCDO FROM SYS_CUR_ARC ORDER BY SCDA, SCDO DESC');
    const insX = db.prepare('INSERT OR IGNORE INTO exchange_rates(org_id,code,rate_date,rate_e6,user_id) VALUES(?,?,?,?,?)'); added = 0;
    for (const r of rates) { const code = CUR_OF[int(r.SCID)]; if (!code || !r.SCDA || !(Number(r.SCER) > 0)) continue;
      if (!db.prepare('SELECT 1 FROM currencies WHERE org_id=? AND code=?').get(orgId, code)) continue;
      added += insX.run(orgId, code, day(r.SCDA), toMinor(r.SCER, 6), userId).changes; }
    tally('exchange_rates', rates.length, added);

    db.prepare("INSERT INTO audit(org_id,station_id,user_id,action,entity,detail) VALUES(?,?,?,'m7.load','station',?)").run(orgId, stationId, userId, JSON.stringify(counts));
    return counts;
  });
}

/* ----------------------------------------- reads ----------------------------------------- */

/** The old system's saved results for one year, one row per month (the run dated at the month's end, else its latest run).
    A 31-Dec run that covers the whole year (revenue well above any single month) is kept as the year, and December is derived from it. */
function oldResults(db, user, sid, q) {
  need(user, 'report.read'); station(db, user, sid);
  const year = V.int(Number(q.year), 'year', { min: 2000, max: 2100 });
  const rows = db.prepare(`SELECT r.* FROM m7_results r WHERE r.station_id=? AND r.kind IN (2,3) AND r.as_of BETWEEN ? AND ?
    AND r.id = (SELECT y.id FROM m7_results y WHERE y.station_id=r.station_id AND y.acno=r.acno AND y.as_of=r.as_of AND y.kind=r.kind ORDER BY y.made_at DESC, y.id DESC LIMIT 1)`)
    .all(sid, `${year}-01-01`, `${year}-12-31`);
  const byDate = new Map();
  for (const r of rows) { if (!byDate.has(r.as_of)) byDate.set(r.as_of, []); byDate.get(r.as_of).push(r); }
  const K = ['revenue', 'cost_of_sales', 'gross_profit', 'operating_expenses', 'other_income', 'net_profit'];
  const figures = (list) => {
    const f = { revenue: 0, cost_of_sales: 0, gross_profit: 0, operating_expenses: 0, other_income: 0, net_profit: 0 };
    for (const r of list) { const cr = r.credit - r.debit;
      if (r.kind === 3) { if (r.acno.startsWith('41')) f.revenue += cr; else f.cost_of_sales -= cr; f.gross_profit += cr; }
      else { if (r.acno.startsWith('414')) continue; if (r.acno.startsWith('3')) f.operating_expenses -= cr; else f.other_income += cr; } }
    f.net_profit = f.gross_profit + f.other_income - f.operating_expenses; return f;
  };
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const mm = `${year}-${String(m).padStart(2, '0')}`;
    const ds = [...byDate.keys()].filter(d => d.startsWith(mm)).sort();
    if (!ds.length) continue;
    const ends = ds.filter(d => new Date(Date.UTC(year, m - 1, +d.slice(8) + 1)).getUTCMonth() !== m - 1);   // dated on the month's last day
    const d = (ends.length ? ends : ds).at(-1);
    months.push({ month: mm, as_of: d, ...figures(byDate.get(d)) });
  }
  let year_run = null;
  const dec = months.find(x => x.month === `${year}-12`);
  const others = months.filter(x => x !== dec);
  if (dec && others.length && dec.revenue > 2.5 * Math.max(...others.map(x => x.revenue))) {
    year_run = { ...dec };
    if (others.length === 11) { for (const k of K) dec[k] = year_run[k] - others.reduce((s, x) => s + x[k], 0); dec.derived = true; }
    else months.splice(months.indexOf(dec), 1);
  }
  const years = db.prepare("SELECT DISTINCT substr(as_of,1,4) y FROM m7_results WHERE station_id=? AND kind IN (2,3) AND as_of IS NOT NULL ORDER BY 1").all(sid).map(r => +r.y);
  return { year, months, year_run, years };
}

/** Old monthly store values next to FuelPro's stock value on the same date. */
function oldStockValues(db, user, sid, q) {
  need(user, 'report.read'); station(db, user, sid);
  const year = q.year ? V.int(Number(q.year), 'year', { min: 2000, max: 2100 }) : null;
  const fp = db.prepare('SELECT balance_value v FROM stock_moves WHERE tank_id=? AND business_date<=? ORDER BY business_date DESC, id DESC LIMIT 1');
  return { rows: db.prepare(`SELECT * FROM m7_stock_month WHERE station_id=?${year ? ' AND month_end LIKE ?' : ''} ORDER BY month_end, store_no`).all(sid, ...(year ? [year + '-%'] : []))
    .map(r => { const v = r.tank_id ? (fp.get(r.tank_id, r.month_end) || { v: 0 }).v : null; return { tank_id: r.tank_id, store_name: r.store_name, month_end: r.month_end, value: r.value, fuelpro_value: v, difference: v == null ? null : v - r.value }; }) };
}

/** Everything recorded about one journal: FuelPro's own audit rows and the old system's edit copies and approvals. */
function journalHistory(db, user, journalId) {
  need(user, 'journal.read');
  const j = db.prepare('SELECT id, station_id, source, source_id FROM journals WHERE id=? AND org_id=?').get(journalId, user.org_id);
  if (!j) throw notFound('Journal');
  station(db, user, j.station_id);
  return db.prepare(`SELECT a.id, a.action, a.detail, a.created_at, u.name user_name FROM audit a LEFT JOIN users u ON u.id=a.user_id
    WHERE a.org_id=? AND ((a.entity='journal' AND a.entity_id=?) OR (a.entity=? AND a.entity_id=?)) ORDER BY a.created_at, a.id`)
    .all(user.org_id, j.id, j.source, j.source_id ?? -1).map(r => ({ ...r, detail: (() => { try { return JSON.parse(r.detail || '{}'); } catch { return {}; } })() }));
}

module.exports = { load, toMinor, oldResults, oldStockValues, journalHistory, OLD_MAIL };
