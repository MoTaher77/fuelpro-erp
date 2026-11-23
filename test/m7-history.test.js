'use strict';
/* Old-system (M7) history carried into FuelPro's own tables: EXP dump converter, no duplicates, screens' endpoints, isolation. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { createApp } = require('../src/server');
const M7 = require('../src/m7archive');

let base, server, appDb, n = 0;
test.before(async () => {
  const app = createApp({ dbPath: ':memory:', mailer: { send: async () => {} } }); server = app.server; appDb = app.db;
  await new Promise(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise(r => server.close(r)));
function client() {
  let cookie = '';
  const call = async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await res.text(); let j; try { j = t ? JSON.parse(t) : undefined; } catch { j = t; }
    return { status: res.status, body: j };
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), patch: (p, b) => call('PATCH', p, b) };
}
const ok = (r, code = 200) => { assert.equal(r.status, code, JSON.stringify(r.body)); return r.body; };
async function org() {
  const c = client();
  const r = ok(await c.post('/api/auth/register', { org_name: 'M7 test', name: 'Owner', email: `m7${Date.now()}-${++n}@ex.com`, password: 'correct horse battery', station: { name: 'A', currency: 'YER', timezone: 'Asia/Aden' } }), 201);
  return { c, sid: r.station_id, org: r.org_id, p: `/api/stations/${r.station_id}` };
}

/* a tiny M7 copy, the shape scripts/exp2sqlite.js produces (all TEXT) */
function fakeM7() {
  const src = new DatabaseSync(':memory:');
  const mk = (t, cols, rows) => { src.exec(`CREATE TABLE ${t}(${cols.map(c => `"${c}" TEXT`).join(',')})`); const s = src.prepare(`INSERT INTO ${t} VALUES(${cols.map(() => '?').join(',')})`); for (const r of rows) s.run(...r); };
  mk('ACCOUNT', ['ACID', 'ACNO', 'ATID', 'ACNA'], [['1', '4', '1', 'ايرادات'], ['10', '411001', '2', 'مبيعات'], ['11', '311001', '2', 'مشتريات'], ['12', '331001', '2', 'رواتب'], ['13', '414001', '2', 'مجمل الربح']]);
  mk('BON_KIN', ['BKID', 'BKNA'], [['2', 'سند قبض']]);
  const res = (d, acno, kind, dr, cr, saved = d + 'T20:00:00') => ['x', acno, '1', dr, cr, saved, 'المدير', d + 'T00:00:00', '1', kind];
  const months = []; for (let m = 1; m <= 11; m++) { const d = `2023-${String(m).padStart(2, '0')}-${[31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30][m - 1]}`;
    months.push(res(d, '411001', '3', '0', '1000'), res(d, '311001', '3', '800', '0'), res(d, '414001', '2', '0', '200'), res(d, '331001', '2', '50', '0')); }
  mk('BAL_ACC', ['ACID', 'ACNO', 'SCID', 'BAMD', 'BADA', 'BADO', 'SUID', 'BADC', 'BAST', 'BATY'], [
    ...months,
    res('2023-01-31', '411001', '3', '0', '900', '2023-01-30T08:00:00'),                                        // an earlier save of January: the later one wins
    res('2023-12-31', '411001', '3', '0', '12100'), res('2023-12-31', '311001', '3', '9700', '0'),                // a whole-year run on 31 Dec
    res('2023-12-31', '414001', '2', '0', '2400'), res('2023-12-31', '331001', '2', '600', '0'),
    res('2023-12-31', '4', '3', '0', '99999')]);                                                                   // group account: ignored
  mk('ENTRY_CPY', ['CPYID', 'CPYST', 'BKID', 'ENNO', 'UTOID', 'ENDO', 'ENAM', 'ENIN', 'ENST', 'SUID', 'ENDA'], [['501', '5', '2', '7', 'R-77', '2026-01-04T00:00:00', '300', 'قبض', '1', 'M', '2026-01-04T15:00:00']]);
  mk('ACC_MOV_CPY', ['CPYID', 'ACID', 'AMMD', 'AMDA', 'AMIN'], [['501', '10', '300', '0', null], ['501', '11', '0', '300', null]]);
  mk('STO_INF', ['SIID', 'SINA'], [['1', 'T1']]);
  mk('STO_AMN', ['SADO', 'SIID', 'SAAM', 'SAST', 'SADA'], [['2026-01-31T00:00:00', '1', '1234.56', '1', '2026-02-02T00:00:00']]);
  mk('BAL_INF', ['BIID', 'YAID', 'SUID', 'BIST', 'BIFD', 'BITD', 'BIIN', 'BIDO'], [['1', '7', 'M', '1', '2025-12-31T00:00:00', '2026-01-31T00:00:00', ' حساب المتاجرة', '2026-02-02T17:20:11']]);
  mk('APP_ENT_M', ['AEMID', 'AEMDO', 'SUID'], [['1', '2026-01-05T09:00:00', 'M']]);
  mk('APP_ENT_D', ['AEMID', 'BKID', 'ENID'], [['1', '2', 'R-77'], ['1', '1', '999']]);
  mk('SYS_USR', ['SUID', 'SUNA', 'SUNE', 'SUPA', 'SUEM', 'SUST', 'SUDA'], [['M', 'المدير', 'Manager', 'secret-hash', 'x@y.z', '1', '2006-06-18T00:00:00']]);
  mk('USR_ARC', ['SUID', 'UADO', 'UATY', 'UAIN', 'UAST'], [['M', '2026-01-03T17:04:48', 'I', ' دخول', '1'], ['M', '2026-01-03T17:12:52', 'O', ' خروج', '1']]);
  mk('SYS_LOG', ['SLID', 'SUID', 'SUNA', 'SLDO', 'SLIN'], [['5', 'M', 'المدير', '2026-01-03T17:04:53', ' صيانة']]);
  mk('SYS_CUR_ARC', ['SCID', 'SCER', 'SCDA', 'SCDO'], [['2', '144.5', '2023-04-02T12:17:31', '2023-04-21T00:00:00'], ['3', '544', '2023-04-02T12:20:58', '2023-04-21T00:00:00']]);
  return src;
}

test('toMinor converts exact decimal strings without floats', () => {
  assert.equal(M7.toMinor('1234.56', 3), 1_234_560); assert.equal(M7.toMinor('651.', 2), 65_100);
  assert.equal(M7.toMinor('-0.0005', 3), -1); assert.equal(M7.toMinor('144.5', 6), 144_500_000); assert.equal(M7.toMinor(null, 2), 0);
});

test('old history lands in the normal tables once, never in the books, and shows in the existing screens', async () => {
  const s = await org();
  ok(await s.c.post('/api/currencies', { code: 'USD', name_ar: 'دولار', name_en: 'US dollar', decimals: 2 }));
  const f = ok(await s.c.post(`${s.p}/fuels`, { name: 'Petrol', price_e4: 5_000_000, cost_e4: 4_000_000 }), 201).id;
  ok(await s.c.post(`${s.p}/tanks`, { name: 'T1', fuel_id: f, capacity_ml: 20_000_000, level_ml: 0 }), 201);
  /* a FuelPro journal carrying the old document number, as scripts/import-m7.js leaves it */
  const cash = ok(await s.c.get('/api/accounts')).find(a => a.sys === 'cash').id, rent = ok(await s.c.get('/api/accounts')).find(a => a.sys === 'exp_rent').id;
  const v = ok(await s.c.post(`${s.p}/vouchers`, { kind: 'payment', box_account_id: cash, ref_no: 'R-77', lines: [{ account_id: rent, amount: 300 }] }), 201);
  const jid = appDb.prepare("SELECT id FROM journals WHERE source='voucher' AND source_id=?").get(v.id).id;
  const books = () => appDb.prepare('SELECT (SELECT COUNT(*) FROM journals) j, (SELECT COUNT(*) FROM journal_lines) l, (SELECT COUNT(*) FROM stock_moves) m').get();
  const before = books();
  const owner = appDb.prepare("SELECT id FROM users WHERE org_id=? AND role='owner'").get(s.org).id;
  const dec = appDb.prepare('SELECT cur_dec FROM stations WHERE id=?').get(s.sid).cur_dec; const mu = (x) => M7.toMinor(x, dec);
  const src = fakeM7();
  const first = M7.load(appDb, src, { orgId: s.org, stationId: s.sid, userId: owner });
  assert.equal(first.users.added, 1); assert.equal(first.doc_edits.added, 1); assert.equal(first.approvals.added, 2); assert.equal(first.closing_runs.added, 1);
  assert.equal(first.user_log.added, 3); assert.equal(first.stock_months.added, 1); assert.equal(first.exchange_rates.added, 1, 'only currencies the organisation has');
  const again = M7.load(appDb, src, { orgId: s.org, stationId: s.sid, userId: owner });
  for (const [k, x] of Object.entries(again)) assert.equal(x.added, 0, k + ' duplicated');
  assert.deepEqual(books(), before, 'journals and stock are not touched');

  /* users: inactive, no old password kept, cannot sign in until given a real e-mail */
  const u = appDb.prepare("SELECT * FROM users WHERE org_id=? AND email LIKE '%@old-system.invalid'").get(s.org);
  assert.equal(u.active, 0); assert.equal(u.name, 'المدير'); assert.ok(!JSON.stringify(u).includes('secret-hash'));
  assert.equal((await s.c.patch(`/api/users/${u.id}`, { active: true })).body.error.code, 'EMAIL_REQUIRED');
  ok(await s.c.patch(`/api/users/${u.id}`, { email: `old${n}@ex.com`, password: 'a long new password 1', active: true, station_ids: [s.sid] }));

  /* audit screen: old events by their own time, filterable by origin */
  const old = ok(await s.c.get(`${s.p}/audit?origin=m7&limit=50`));
  assert.ok(old.length >= 7 && old.every(x => x.action.startsWith('m7.')));
  assert.equal(old.find(x => x.action === 'm7.login').user_name, 'المدير');
  assert.equal(ok(await s.c.get(`${s.p}/audit?origin=m7&from=2026-01-03&to=2026-01-03`)).length, 3);
  assert.ok(ok(await s.c.get(`${s.p}/audit?origin=fp`)).every(x => !x.action.startsWith('m7.')));

  /* journal history: the old edit copy with its lines and the approval, next to FuelPro's own events */
  const hist = ok(await s.c.get(`/api/journals/${jid}/history`));
  const copy = hist.find(x => x.action === 'm7.doc_edit'); assert.equal(copy.detail.lines.length, 2); assert.equal(copy.detail.amount, mu('300'));
  assert.ok(hist.find(x => x.action === 'm7.approve')); assert.ok(hist.find(x => x.action === 'voucher.create' || x.action.startsWith('voucher')));

  /* earlier-year results: latest save of a month wins, groups ignored, December derived from the whole-year run */
  const y = ok(await s.c.get(`${s.p}/reports/old-results?year=2023`));
  assert.equal(y.months.length, 12); assert.equal(y.months[0].revenue, mu('1000'));
  assert.equal(y.months[0].gross_profit, mu('200')); assert.equal(y.months[0].net_profit, mu('150'));
  const d = y.months[11]; assert.ok(d.derived); assert.equal(d.revenue, mu('1100')); assert.equal(d.net_profit, mu('1800') - mu('1650'));
  assert.equal(y.year_run.revenue, mu('12100')); assert.deepEqual(y.years, [2023]);

  /* stock count screen: old month value next to FuelPro's */
  const sv = ok(await s.c.get(`${s.p}/stock/old-values?year=2026`)); assert.equal(sv.rows[0].value, mu('1234.56')); assert.ok(sv.rows[0].tank_id);

  /* exchange rates: the old rate is in the normal table */
  assert.ok(appDb.prepare("SELECT 1 FROM exchange_rates WHERE org_id=? AND code='USD' AND rate_date='2023-04-02'").get(s.org));

  /* another organisation sees none of it */
  const o = await org();
  assert.equal((await o.c.get(`${s.p}/reports/old-results?year=2023`)).status, 404);
  assert.equal((await o.c.get(`/api/journals/${jid}/history`)).status, 404);
  assert.equal(ok(await o.c.get(`${o.p}/reports/old-results?year=2023`)).months.length, 0);
});

test('exp2sqlite reads a classic EXP dump: numbers, Arabic text, dates and NULLs', () => {
  const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
  const col = (b) => Buffer.concat([u16(b.length), b]);
  const parts = [Buffer.from('\x03\x00EXPORT:V11.02.00\nDM7\nRUSERS\n', 'latin1'),
    Buffer.from('TABLE "T1"\nCREATE TABLE "T1" ("A" NUMBER, "B" VARCHAR2(20), "C" DATE)\nINSERT INTO "T1" ("A", "B", "C") VALUES (:1, :2, :3)\n', 'latin1'),
    u16(3), u16(2), u16(22), u16(1), u16(20), u16(0x0230), u16(1), u16(12), u16(7), Buffer.alloc(4),
    col(Buffer.from([0xc2, 0x02, 0x18, 0x33])), col(Buffer.from([0xd1, 0xc6, 0xed, 0xd3, 0xed])), col(Buffer.from([120, 126, 1, 31, 1, 1, 1])), u16(0),   // 123.5 | رئيسي | 2026-01-31
    col(Buffer.from([0x3e, 0x63, 0x66])), u16(0xfffe), u16(0xfffe), u16(0),                                                                      // -2 | NULL | NULL
    u16(0xffff), Buffer.from('\nEXIT\n', 'latin1')];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-')); const dmp = path.join(dir, 't.DMP'), out = path.join(dir, 't.sqlite');
  try {
    fs.writeFileSync(dmp, Buffer.concat(parts));
    execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'scripts', 'exp2sqlite.js'), dmp, out]);
    const d = new DatabaseSync(out, { readOnly: true });
    assert.deepEqual(d.prepare('SELECT * FROM T1').all().map(r => ({ ...r })), [{ A: '123.5', B: 'رئيسي', C: '2026-01-31T00:00:00' }, { A: '-2', B: null, C: null }]);
    d.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
