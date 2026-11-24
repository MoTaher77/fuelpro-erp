'use strict';
/* Employees & payroll (0.28.0, ACCOUNTING-RULES §15). Amounts in YER minor units (0 decimals in this test org). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/server');

let base, server, db, n = 0;
test.before(async () => {
  const app = createApp({ dbPath: ':memory:', mailer: { send: async () => {} } }); server = app.server; db = app.db;
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
const uniq = () => `${Date.now()}-${++n}`;
const ok = (r, code = 200) => { assert.equal(r.status, code, JSON.stringify(r.body)); return r.body; };
async function org() {
  const c = client();
  const r = ok(await c.post('/api/auth/register', { org_name: 'DEMO Org', name: 'Owner', email: `o${uniq()}@ex.com`, password: 'correct horse battery', station: { name: 'A', currency: 'YER', timezone: 'Asia/Aden' } }), 201);
  return { c, sid: r.station_id, p: `/api/stations/${r.station_id}`, org_id: r.org_id };
}
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Aden' }).format(new Date());
/* every journal of the payroll sources balances, and the employee accounts are fully explained by employee lines */
function booksBalanced(orgId) {
  const bad = db.prepare(`SELECT j.id FROM journals j JOIN journal_lines l ON l.journal_id=j.id WHERE j.org_id=? AND j.status='posted' GROUP BY j.id HAVING SUM(l.debit)<>SUM(l.credit)`).all(orgId);
  assert.deepEqual(bad, [], 'every journal balances');
  const loose = db.prepare(`SELECT COUNT(*) n FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE a.org_id=? AND a.sys IN('emp_adv','salaries_payable') AND (l.party_type IS NOT 'employee' OR l.party_id IS NULL)`).get(orgId).n;
  assert.equal(loose, 0, 'every line on 1160/2200 names an employee');
}
const gl = (orgId, sys) => db.prepare(`SELECT COALESCE(SUM(l.debit-l.credit),0) v FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id WHERE j.org_id=? AND j.status='posted' AND a.sys=?`).get(orgId, sys).v;

test('advance → monthly payroll (allowances, deductions, recovery) → salary payment; balances, books and the shift agree', async () => {
  const s = await org();
  const emp = ok(await s.c.post(`${s.p}/employees`, { name: 'Ali', job_title: 'Pump attendant', salary: 300_000 }), 201).id;
  ok(await s.c.post(`${s.p}/shifts`, { float_amount: 100_000 }), 201);
  /* cash advance from the drawer */
  ok(await s.c.post(`${s.p}/employee-moves`, { kind: 'advance', employee_id: emp, amount: 50_000, method: 'cash' }), 201);
  let e = ok(await s.c.get(`${s.p}/employees`))[0];
  assert.equal(e.advance, 50_000); assert.equal(e.payable, 0);
  assert.equal(gl(s.org_id, 'emp_adv'), 50_000); assert.equal(gl(s.org_id, 'cash'), -50_000);
  let sh = ok(await s.c.get(`${s.p}/shifts/current`)).shift;
  assert.equal(sh.totals.payroll_cash, 50_000); assert.equal(sh.totals.expected_cash, 100_000 - 50_000, 'the advance left the drawer');

  /* payroll of this month: draft proposes the salary and recovering the advance */
  const month = today().slice(0, 7);
  const draft = ok(await s.c.get(`${s.p}/payroll/draft?month=${month}`));
  assert.equal(draft.lines.length, 1); assert.equal(draft.lines[0].base, 300_000); assert.equal(draft.lines[0].recovered, 50_000);
  const run = ok(await s.c.post(`${s.p}/payroll`, { month, lines: [{ employee_id: emp, base: 300_000, allowances: 20_000, deductions: 10_000, recovered: 50_000 }] }), 201);
  assert.deepEqual([run.expense, run.recovered, run.net], [310_000, 50_000, 260_000]);
  e = ok(await s.c.get(`${s.p}/employees`))[0];
  assert.equal(e.advance, 0); assert.equal(e.payable, 260_000);
  assert.equal(gl(s.org_id, 'exp_salaries'), 310_000); assert.equal(-gl(s.org_id, 'salaries_payable'), 260_000);
  assert.equal(ok(await s.c.post(`${s.p}/payroll`, { month, lines: [{ employee_id: emp, base: 1 }] }), 409).error.code, 'PAYROLL_EXISTS');

  /* pay the salary: more than owed is refused, the exact amount clears it */
  assert.equal(ok(await s.c.post(`${s.p}/employee-moves`, { kind: 'salary_pay', employee_id: emp, amount: 260_001, method: 'cash' }), 409).error.code, 'SALARY_OVERPAID');
  const pay = ok(await s.c.post(`${s.p}/employee-moves`, { kind: 'salary_pay', employee_id: emp, amount: 260_000, method: 'cash' }), 201).id;
  e = ok(await s.c.get(`${s.p}/employees`))[0]; assert.equal(e.payable, 0); assert.equal(gl(s.org_id, 'salaries_payable'), 0);
  sh = ok(await s.c.get(`${s.p}/shifts/current`)).shift; assert.equal(sh.totals.expected_cash, 100_000 - 50_000 - 260_000);

  /* statement: +owed to the employee, −owed by him; ends at 0 */
  const stt = ok(await s.c.get(`${s.p}/employees/${emp}/statement`));
  assert.deepEqual(stt.lines.map(l => l.amount), [-50_000, 260_000, 50_000, -260_000], 'advance, salary owed, advance recovered, salary paid');
  assert.equal(stt.closing, 0); assert.equal(stt.lines.reduce((t, l) => t + l.amount, 0), 0);

  /* void: a paid payroll cannot be voided; void the payment first (reason required), then the payroll */
  assert.equal(ok(await s.c.post(`${s.p}/payroll/${run.id}/void`, { reason: 'wrong month' }), 409).error.code, 'PAYROLL_PAID');
  assert.equal((await s.c.post(`${s.p}/employee-moves/${pay}/void`, { reason: 'x' })).status, 400, 'a reason is required');
  ok(await s.c.post(`${s.p}/employee-moves/${pay}/void`, { reason: 'paid twice by mistake' }));
  assert.equal(ok(await s.c.post(`${s.p}/employee-moves/${pay}/void`, { reason: 'again please' }), 409).error.code, 'ALREADY_VOIDED');
  ok(await s.c.post(`${s.p}/payroll/${run.id}/void`, { reason: 'wrong month' }));
  e = ok(await s.c.get(`${s.p}/employees`))[0];
  assert.equal(e.advance, 50_000, 'the recovered advance is owed again'); assert.equal(e.payable, 0);
  assert.equal(gl(s.org_id, 'exp_salaries'), 0, 'expense reversed exactly');
  /* the month can be posted again after the void */
  ok(await s.c.post(`${s.p}/payroll`, { month, lines: [{ employee_id: emp, base: 300_000, recovered: 50_000 }] }), 201);
  booksBalanced(s.org_id);
  const integ = ok(await s.c.get('/api/accounting/integrity')); assert.ok(integ.ok, JSON.stringify(integ.checks.filter(c => !c.ok)));
  const tb = ok(await s.c.get(`/api/accounting/trial-balance?to=${today()}`)); assert.ok(tb.balanced);
  /* nothing is deleted: the voided documents stay with their reason */
  assert.equal(db.prepare('SELECT COUNT(*) n FROM payroll_runs WHERE station_id=?').get(s.sid).n, 2);
  assert.ok(db.prepare('SELECT void_reason FROM employee_moves WHERE id=?').get(pay).void_reason);
});

test('payroll rules: deductions and recovery limits, an advance already recovered cannot be voided, inactive employees, no manual journals on 1160/2200', async () => {
  const s = await org();
  const emp = ok(await s.c.post(`${s.p}/employees`, { name: 'Saleh', salary: 100_000 }), 201).id;
  assert.equal(ok(await s.c.post(`${s.p}/employees`, { name: 'Saleh', salary: 1 }), 409).error.code, 'DUPLICATE_NAME');
  const month = today().slice(0, 7);
  assert.equal((await s.c.post(`${s.p}/payroll`, { month, lines: [{ employee_id: emp, base: 100_000, deductions: 100_001 }] })).status, 400, 'deductions cannot exceed the salary');
  assert.equal((await s.c.post(`${s.p}/payroll`, { month, lines: [{ employee_id: emp, base: 100_000, recovered: 1 }] })).status, 400, 'nothing to recover without an advance');
  const adv = ok(await s.c.post(`${s.p}/employee-moves`, { kind: 'advance', employee_id: emp, amount: 30_000, method: 'bank' }), 201).id;
  ok(await s.c.post(`${s.p}/payroll`, { month, lines: [{ employee_id: emp, base: 100_000, recovered: 30_000 }] }), 201);
  assert.equal(ok(await s.c.post(`${s.p}/employee-moves/${adv}/void`, { reason: 'typed twice' }), 409).error.code, 'ADVANCE_RECOVERED');
  assert.equal(ok(await s.c.patch(`${s.p}/employees/${emp}`, { active: false }), 409).error.code, 'EMPLOYEE_HAS_BALANCE', 'salary still owed');
  ok(await s.c.post(`${s.p}/employee-moves`, { kind: 'salary_pay', employee_id: emp, amount: 70_000, method: 'bank' }), 201);
  ok(await s.c.patch(`${s.p}/employees/${emp}`, { active: false }));
  assert.equal(ok(await s.c.post(`${s.p}/employee-moves`, { kind: 'advance', employee_id: emp, amount: 1, method: 'bank' }), 409).error.code, 'EMPLOYEE_INACTIVE');
  /* a manual journal cannot move salaries payable behind the payroll screens' back */
  const A = ok(await s.c.get('/api/accounts')); const pay = A.find(a => a.sys === 'salaries_payable'), bank = A.find(a => a.sys === 'bank');
  const mj = await s.c.post(`${s.p}/journals`, { memo: 'hand-made salary', lines: [{ account_id: pay.id, debit: 5 }, { account_id: bank.id, credit: 5 }] });
  assert.equal(mj.status, 400); assert.equal(mj.body.error.code, 'USE_PAYROLL_SCREENS');
  booksBalanced(s.org_id);
});

test('payroll isolation and permissions: another organisation gets 404, a cashier gets 403', async () => {
  const a = await org(), b = await org();
  const emp = ok(await a.c.post(`${a.p}/employees`, { name: 'Omar', salary: 1000 }), 201).id;
  assert.equal((await b.c.get(`${a.p}/employees`)).status, 404, 'foreign station');
  assert.equal((await b.c.post(`${b.p}/employee-moves`, { kind: 'advance', employee_id: emp, amount: 1, method: 'bank' })).status, 404, 'foreign employee id');
  assert.equal((await b.c.get(`${b.p}/employees/${emp}/statement`)).status, 404);
  const email = `c${uniq()}@e.com`;
  ok(await a.c.post('/api/users', { name: 'C', email, password: 'cashier password 1', role: 'cashier', station_ids: [a.sid] }), 201);
  const cashier = client(); ok(await cashier.post('/api/auth/login', { email, password: 'cashier password 1' }));
  assert.equal((await cashier.post(`${a.p}/employees`, { name: 'X', salary: 1 })).status, 403);
  assert.equal((await cashier.post(`${a.p}/employee-moves`, { kind: 'advance', employee_id: emp, amount: 1, method: 'bank' })).status, 403);
  assert.equal((await cashier.post(`${a.p}/payroll`, { month: today().slice(0, 7), lines: [{ employee_id: emp }] })).status, 403);
});

test('carry-over of old per-employee accounts (KI-20): balances move to 1160/2200, totals unchanged, old accounts closed; undo puts everything back', async () => {
  const s = await org();
  const accts = ok(await s.c.get('/api/accounts')); const cash = accts.find(a => a.sys === 'cash');
  const grp = ok(await s.c.post('/api/accounts', { code: '125', type: 'asset', name_ar: 'حسابات الموظفين', is_group: true }), 201).id;
  const mk = async (code, name) => ok(await s.c.post('/api/accounts', { code, type: 'asset', name_ar: name, parent_id: grp }), 201).id;
  const a1 = await mk('125001', 'Ahmed'), a2 = await mk('125002', 'Badr'), a3 = await mk('125003', 'Old one');
  /* history like the imported books: a payment voucher gives an advance, a receipt voucher records what the station owes */
  ok(await s.c.post(`${s.p}/vouchers`, { kind: 'payment', box_account_id: cash.id, lines: [{ account_id: a1, amount: 40_000 }] }), 201);
  ok(await s.c.post(`${s.p}/vouchers`, { kind: 'receipt', box_account_id: cash.id, lines: [{ account_id: a2, amount: 15_000 }] }), 201);
  const tbBefore = ok(await s.c.get(`/api/accounting/trial-balance?to=${today()}`));
  const groups = ok(await s.c.get(`${s.p}/payroll/carry-groups`)); assert.ok(groups.find(g => g.id === grp).suggested, 'the employees group is suggested');
  const pre = ok(await s.c.get(`${s.p}/payroll/carry?group_account_id=${grp}`));
  assert.equal(pre.done, false);
  assert.deepEqual(pre.rows.map(r => [r.code, r.balance, r.to]), [['125001', 40_000, 'advance'], ['125002', -15_000, 'payable']]);
  assert.deepEqual(pre.skipped.map(r => r.code), ['125003'], 'no balance and no movement: left alone');
  assert.deepEqual(pre.totals, { advance: 40_000, payable: 15_000 });
  const r = ok(await s.c.post(`${s.p}/payroll/carry`, { group_account_id: grp }), 201);
  assert.equal(r.employees, 2); assert.equal(r.created, 2);
  const emps = ok(await s.c.get(`${s.p}/employees`));
  assert.deepEqual(emps.map(e => [e.name, e.advance, e.payable]).sort(), [['Ahmed', 40_000, 0], ['Badr', 0, 15_000]]);
  assert.equal(gl(s.org_id, 'emp_adv'), 40_000); assert.equal(-gl(s.org_id, 'salaries_payable'), 15_000);
  const old = (id) => db.prepare("SELECT COALESCE(SUM(l.debit-l.credit),0) v FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE l.account_id=? AND j.status='posted'").get(id).v;
  assert.equal(old(a1), 0); assert.equal(old(a2), 0);
  assert.equal(db.prepare('SELECT active FROM accounts WHERE id=?').get(a1).active, 0, 'old account closed for new postings');
  assert.equal(db.prepare('SELECT active FROM accounts WHERE id=?').get(a3).active, 1, 'skipped account untouched');
  const tbAfter = ok(await s.c.get(`/api/accounting/trial-balance?to=${today()}`));
  assert.ok(tbAfter.balanced); assert.equal(tbAfter.totals.closing_dr - tbAfter.totals.closing_cr, tbBefore.totals.closing_dr - tbBefore.totals.closing_cr);
  assert.equal(ok(await s.c.post(`${s.p}/payroll/carry`, { group_account_id: grp }), 409).error.code, 'CARRY_DONE');
  assert.equal(ok(await s.c.get(`${s.p}/payroll/carry?group_account_id=${grp}`)).done, true);
  /* the carried employee continues in the module: the payroll recovers the carried advance */
  booksBalanced(s.org_id);
  assert.ok(ok(await s.c.get('/api/accounting/integrity')).ok);
  /* undo while untouched: everything back */
  ok(await s.c.post(`${s.p}/payroll/carry/undo`, { reason: 'try again later' }));
  assert.equal(old(a1), 40_000); assert.equal(old(a2), -15_000); assert.equal(gl(s.org_id, 'emp_adv'), 0); assert.equal(gl(s.org_id, 'salaries_payable'), 0);
  assert.equal(db.prepare('SELECT active FROM accounts WHERE id=?').get(a1).active, 1);
  assert.equal(ok(await s.c.get(`${s.p}/employees`)).length, 0, 'employees created by the carry-over are inactive again');
  /* carry again, then a new movement makes undo impossible */
  ok(await s.c.post(`${s.p}/payroll/carry`, { group_account_id: grp }), 201);
  const ahmed = ok(await s.c.get(`${s.p}/employees`)).find(e => e.name === 'Ahmed');
  assert.equal(ahmed.advance, 40_000, 'the same employee is linked again, not duplicated');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM employees WHERE station_id=? AND name='Ahmed'").get(s.sid).n, 1);
  ok(await s.c.post(`${s.p}/employee-moves`, { kind: 'advance', employee_id: ahmed.id, amount: 1_000, method: 'bank' }), 201);
  assert.equal(ok(await s.c.post(`${s.p}/payroll/carry/undo`, { reason: 'too late now' }), 409).error.code, 'CARRY_IN_USE');
  booksBalanced(s.org_id);
});
