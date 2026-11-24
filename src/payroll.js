'use strict';
/* «الموظفون والرواتب» (0.28.0): employees of a station, cash advances (سلف), the monthly payroll and salary payments.
   Books (ACCOUNTING-RULES §15):
     advance          Dr emp_adv 1160 (party employee)           Cr cash/bank
     monthly payroll  Dr exp_salaries 6010 (base + allowances − deductions)
                      Cr salaries_payable 2200 (net, party employee)   Cr emp_adv 1160 (advance recovered, party employee)
     salary payment   Dr salaries_payable 2200 (party employee)  Cr cash/bank
   Every balance is derived from journal lines carrying party_type='employee' (never stored). Void = reason + reversing journal.
   Cash moves enter the open shift's expected cash (ops.shiftTotals). One payroll per station and month. */
const V = require('./validate');
const L = require('./ledger');
const { tx } = require('./db');
const { bad, conflict, notFound } = require('./errors');
const S = require('./services');
const { need, audit, scoped, tzToday, openShift, station } = S;

const MAX = 10 ** 13;
const monthEnd = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

/** Balances of the station's employees, as of a date: advance (owed BY the employee) and payable (owed TO the employee). */
function balances(db, sid, asOf) {
  const rows = db.prepare(`SELECT l.party_id id, a.sys, SUM(l.debit) d, SUM(l.credit) c FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id
    WHERE l.party_type='employee' AND l.party_id IN (SELECT id FROM employees WHERE station_id=?) AND a.sys IN('emp_adv','salaries_payable') AND j.status='posted' AND j.business_date<=?
    GROUP BY l.party_id, a.sys`).all(sid, asOf || '9999-12-31');
  const m = new Map();
  for (const r of rows) { const b = m.get(r.id) || { advance: 0, payable: 0 }; if (r.sys === 'emp_adv') b.advance += r.d - r.c; else b.payable += r.c - r.d; m.set(r.id, b); }
  return m;
}
const balanceOf = (db, sid, eid, asOf) => balances(db, sid, asOf).get(eid) || { advance: 0, payable: 0 };

/* ---------------------------- employees ---------------------------- */
function listEmployees(db, user, sid, q = {}) {
  need(user, 'read'); station(db, user, sid);
  const bal = balances(db, sid);
  const all = q.all === '1' || q.all === true;
  return db.prepare(`SELECT * FROM employees WHERE station_id=? ${all ? '' : 'AND active=1'} ORDER BY active DESC, name`).all(sid)
    .map(e => ({ ...e, ...(bal.get(e.id) || { advance: 0, payable: 0 }) }));
}
function employeeFields(b, partial) {
  const o = {};
  if (!partial || b.name !== undefined) o.name = V.str(b.name, 'name', { min: 2, max: 80 });
  if (!partial || b.job_title !== undefined) o.job_title = V.str(b.job_title, 'job_title', { max: 60, optional: true }) || null;
  if (!partial || b.phone !== undefined) o.phone = V.str(b.phone, 'phone', { max: 30, optional: true }) || null;
  if (!partial || b.salary !== undefined) o.salary = V.int(b.salary ?? 0, 'salary', { min: 0, max: MAX });
  if (!partial || b.hired_on !== undefined) o.hired_on = V.date(b.hired_on, 'hired_on', { optional: true }) || null;
  if (!partial || b.note !== undefined) o.note = V.str(b.note, 'note', { max: 200, optional: true }) || null;
  if (partial && b.active !== undefined) o.active = b.active ? 1 : 0;
  return o;
}
function createEmployee(db, user, sid, b) {
  need(user, 'payroll.manage'); station(db, user, sid); V.obj(b, 'body');
  const f = employeeFields(b, false);
  return tx(db, () => {
    if (db.prepare('SELECT 1 FROM employees WHERE station_id=? AND active=1 AND name=?').get(sid, f.name)) throw conflict('DUPLICATE_NAME', 'An active employee with this name already exists');
    const id = Number(db.prepare('INSERT INTO employees(org_id,station_id,name,job_title,phone,salary,hired_on,note) VALUES(?,?,?,?,?,?,?,?)')
      .run(user.org_id, sid, f.name, f.job_title, f.phone, f.salary, f.hired_on, f.note).lastInsertRowid);
    audit(db, user, sid, 'employee.create', 'employee', id, { name: f.name, salary: f.salary }); return { id };
  });
}
function updateEmployee(db, user, sid, id, b) {
  need(user, 'payroll.manage'); station(db, user, sid); V.obj(b, 'body');
  const e = scoped(db, 'employees', id, sid, 'Employee');
  const f = employeeFields(b, true);
  if (!Object.keys(f).length) return { ok: true };
  return tx(db, () => {
    if (f.active === 0) { const bl = balanceOf(db, sid, id); if (bl.advance || bl.payable) throw conflict('EMPLOYEE_HAS_BALANCE', 'Settle the advance and the unpaid salary before deactivating this employee', bl); }
    db.prepare(`UPDATE employees SET ${Object.keys(f).map(k => k + '=?').join(', ')} WHERE id=?`).run(...Object.values(f), e.id);
    audit(db, user, sid, 'employee.update', 'employee', id, f); return { ok: true };
  });
}

/* ---------------------------- advances and salary payments ---------------------------- */
const MOVE_SOURCE = { advance: 'emp_advance', salary_pay: 'salary_pay' };
function createMove(db, user, sid, b) {
  need(user, 'payroll.pay'); const st = station(db, user, sid); V.obj(b, 'body');
  const kind = V.oneOf(b.kind, 'kind', ['advance', 'salary_pay']);
  const e = scoped(db, 'employees', V.int(b.employee_id, 'employee_id', { min: 1 }), sid, 'Employee');
  if (!e.active) throw conflict('EMPLOYEE_INACTIVE', 'This employee is inactive');
  const amount = V.int(b.amount, 'amount', { min: 1, max: MAX });
  const method = V.oneOf(b.method || 'cash', 'method', ['cash', 'bank']);
  const date = V.date(b.date, 'date', { optional: true }) || tzToday(st.timezone);
  if (date > tzToday(st.timezone)) throw bad('FUTURE_DATE', 'The date cannot be in the future');
  const note = V.str(b.note, 'note', { max: 200, optional: true }) || null;
  return tx(db, () => {
    L.assertOpen(db, user.org_id, date);
    if (kind === 'salary_pay') { const owed = balanceOf(db, sid, e.id, date).payable; if (amount > owed) throw conflict('SALARY_OVERPAID', 'The payment is more than the salary owed to this employee', { owed }); }
    const shift = method === 'cash' ? openShift(db, st, true) : null;
    const id = Number(db.prepare('INSERT INTO employee_moves(station_id,employee_id,kind,business_date,amount,method,shift_id,note,user_id) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(sid, e.id, kind, date, amount, method, shift ? shift.id : null, note, user.id).lastInsertRowid);
    const party = { party_type: 'employee', party_id: e.id };
    L.post(db, { org_id: user.org_id, station_id: sid, date, source: MOVE_SOURCE[kind], source_id: id, user_id: user.id, memo: (kind === 'advance' ? 'سلفة: ' : 'صرف راتب: ') + e.name,
      lines: kind === 'advance' ? [{ a: 'emp_adv', dr: amount, ...party, memo: note }, { a: method, cr: amount }] : [{ a: 'salaries_payable', dr: amount, ...party, memo: note }, { a: method, cr: amount }] });
    audit(db, user, sid, 'employee.' + kind, 'employee_move', id, { employee: e.id, amount, method }); return { id };
  });
}
function voidMove(db, user, sid, id, reason) {
  need(user, 'payroll.pay'); station(db, user, sid);
  const r = V.str(reason, 'reason', { min: 3, max: 200 });
  return tx(db, () => {
    const m = scoped(db, 'employee_moves', id, sid, 'Employee move');
    if (m.voided_at) throw conflict('ALREADY_VOIDED', 'This record is already voided');
    if (m.shift_id) { const sh = db.prepare('SELECT status FROM shifts WHERE id=?').get(m.shift_id); if (sh.status !== 'open') throw conflict('SHIFT_CLOSED', 'This record belongs to a closed shift and cannot be changed'); }
    L.assertOpen(db, user.org_id, m.business_date);
    if (m.kind === 'advance') {   // an advance already recovered by a payroll cannot disappear (the employee's advance would go negative)
      const left = balanceOf(db, sid, m.employee_id).advance;
      if (left < m.amount) throw conflict('ADVANCE_RECOVERED', 'This advance was already deducted in a payroll; void that payroll first', { outstanding: left });
    }
    L.reverseSource(db, user.org_id, MOVE_SOURCE[m.kind], id, user.id, 'Void: ' + r);
    db.prepare("UPDATE employee_moves SET voided_at=datetime('now'), void_reason=?, void_by=? WHERE id=?").run(r, user.id, id);
    audit(db, user, sid, 'employee_moves.void', 'employee_move', id, { reason: r }); return { ok: true };
  });
}
function listMoves(db, user, sid, q) {
  need(user, 'read'); station(db, user, sid);
  const from = V.date(q.from, 'from', { optional: true }) || '0000-01-01', to = V.date(q.to, 'to', { optional: true }) || '9999-12-31';
  const eid = q.employee_id ? V.int(Number(q.employee_id), 'employee_id', { min: 1 }) : null;
  return db.prepare(`SELECT m.*, e.name employee_name FROM employee_moves m JOIN employees e ON e.id=m.employee_id
    WHERE m.station_id=? AND m.business_date BETWEEN ? AND ? AND (? IS NULL OR m.employee_id=?) ORDER BY m.business_date DESC, m.id DESC LIMIT 500`).all(sid, from, to, eid, eid);
}

/* ---------------------------- monthly payroll ---------------------------- */
/** A draft of the month: every active employee with the monthly salary and the outstanding advance (nothing is saved). */
function payrollDraft(db, user, sid, q) {
  need(user, 'payroll.manage'); const st = station(db, user, sid);
  const month = V.str(q.month, 'month', { min: 7, max: 7 }); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw bad('VALIDATION', 'month must be YYYY-MM');
  const date = monthEnd(month) < tzToday(st.timezone) ? monthEnd(month) : tzToday(st.timezone);
  const existing = db.prepare('SELECT id FROM payroll_runs WHERE station_id=? AND month=? AND voided_at IS NULL').get(sid, month);
  const bal = balances(db, sid, date);
  const lines = db.prepare('SELECT id, name, job_title, salary FROM employees WHERE station_id=? AND active=1 ORDER BY name').all(sid)
    .map(e => { const b = bal.get(e.id) || { advance: 0, payable: 0 }; return { employee_id: e.id, name: e.name, job_title: e.job_title, base: e.salary, allowances: 0, deductions: 0, advance: b.advance, recovered: Math.min(b.advance, e.salary), payable_before: b.payable }; });
  return { month, date, existing_run_id: existing ? existing.id : null, lines };
}
function createPayroll(db, user, sid, b) {
  need(user, 'payroll.manage'); const st = station(db, user, sid); V.obj(b, 'body');
  const month = V.str(b.month, 'month', { min: 7, max: 7 }); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw bad('VALIDATION', 'month must be YYYY-MM');
  if (`${month}-01` > tzToday(st.timezone)) throw bad('FUTURE_DATE', 'This month has not started yet');
  const date = V.date(b.date, 'date', { optional: true }) || (monthEnd(month) < tzToday(st.timezone) ? monthEnd(month) : tzToday(st.timezone));
  if (date > tzToday(st.timezone)) throw bad('FUTURE_DATE', 'The date cannot be in the future');
  if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > 500) throw bad('VALIDATION', 'A payroll needs between 1 and 500 lines');
  const note = V.str(b.note, 'note', { max: 200, optional: true }) || null;
  return tx(db, () => {
    L.assertOpen(db, user.org_id, date);
    if (db.prepare('SELECT 1 FROM payroll_runs WHERE station_id=? AND month=? AND voided_at IS NULL').get(sid, month)) throw conflict('PAYROLL_EXISTS', 'The payroll of this month is already posted; void it first to post it again');
    const bal = balances(db, sid, date), seen = new Set(), lines = [];
    b.lines.forEach((l, i) => {
      V.obj(l, `lines[${i}]`);
      const e = scoped(db, 'employees', V.int(l.employee_id, `lines[${i}].employee_id`, { min: 1 }), sid, 'Employee');
      if (seen.has(e.id)) throw bad('VALIDATION', `Employee ${e.name} appears twice`); seen.add(e.id);
      const base = V.int(l.base ?? e.salary, `lines[${i}].base`, { min: 0, max: MAX }), allowances = V.int(l.allowances ?? 0, `lines[${i}].allowances`, { min: 0, max: MAX });
      const deductions = V.int(l.deductions ?? 0, `lines[${i}].deductions`, { min: 0, max: base + allowances });
      const earned = base + allowances - deductions, outstanding = (bal.get(e.id) || { advance: 0 }).advance;
      const recovered = V.int(l.recovered ?? 0, `lines[${i}].recovered`, { min: 0, max: Math.min(earned, Math.max(outstanding, 0)) });
      lines.push({ e, base, allowances, deductions, earned, recovered, net: earned - recovered, note: V.str(l.note, `lines[${i}].note`, { max: 120, optional: true }) || null });
    });
    const tot = lines.reduce((t, l) => ({ expense: t.expense + l.earned, recovered: t.recovered + l.recovered, net: t.net + l.net }), { expense: 0, recovered: 0, net: 0 });
    if (!tot.expense) throw bad('VALIDATION', 'The payroll is empty (every amount is zero)');
    const id = Number(db.prepare('INSERT INTO payroll_runs(org_id,station_id,month,business_date,total_expense,total_recovered,total_net,note,user_id) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(user.org_id, sid, month, date, tot.expense, tot.recovered, tot.net, note, user.id).lastInsertRowid);
    const ins = db.prepare('INSERT INTO payroll_lines(run_id,employee_id,base,allowances,deductions,recovered,net,note) VALUES(?,?,?,?,?,?,?,?)');
    for (const l of lines) ins.run(id, l.e.id, l.base, l.allowances, l.deductions, l.recovered, l.net, l.note);
    const jl = [{ a: 'exp_salaries', dr: tot.expense, memo: 'رواتب ' + month }];
    for (const l of lines) {
      const party = { party_type: 'employee', party_id: l.e.id };
      jl.push({ a: 'salaries_payable', cr: l.net, ...party, memo: l.e.name }, { a: 'emp_adv', cr: l.recovered, ...party, memo: l.e.name });
    }
    L.post(db, { org_id: user.org_id, station_id: sid, date, source: 'payroll', source_id: id, user_id: user.id, memo: 'مسير رواتب ' + month, lines: jl });
    audit(db, user, sid, 'payroll.post', 'payroll_run', id, { month, ...tot, employees: lines.length });
    return { id, ...tot };
  });
}
function listPayrolls(db, user, sid) {
  need(user, 'read'); station(db, user, sid);
  return db.prepare('SELECT r.*, (SELECT COUNT(*) FROM payroll_lines WHERE run_id=r.id) employees FROM payroll_runs r WHERE r.station_id=? ORDER BY r.month DESC, r.id DESC LIMIT 120').all(sid);
}
function getPayroll(db, user, sid, id) {
  need(user, 'read'); station(db, user, sid);
  const r = scoped(db, 'payroll_runs', id, sid, 'Payroll');
  return { ...r, lines: db.prepare('SELECT l.*, e.name, e.job_title FROM payroll_lines l JOIN employees e ON e.id=l.employee_id WHERE l.run_id=? ORDER BY e.name').all(id) };
}
function voidPayroll(db, user, sid, id, reason) {
  need(user, 'payroll.manage'); station(db, user, sid);
  const rs = V.str(reason, 'reason', { min: 3, max: 200 });
  return tx(db, () => {
    const r = scoped(db, 'payroll_runs', id, sid, 'Payroll');
    if (r.voided_at) throw conflict('ALREADY_VOIDED', 'This payroll is already voided');
    L.assertOpen(db, user.org_id, r.business_date);
    const bal = balances(db, sid);
    for (const l of db.prepare('SELECT l.*, e.name FROM payroll_lines l JOIN employees e ON e.id=l.employee_id WHERE run_id=?').all(id)) {
      if ((bal.get(l.employee_id) || { payable: 0 }).payable < l.net) throw conflict('PAYROLL_PAID', 'Salaries of this payroll were already paid; void those payments first', { employee: l.name });
    }
    L.reverseSource(db, user.org_id, 'payroll', id, user.id, 'Void: ' + rs);
    db.prepare("UPDATE payroll_runs SET voided_at=datetime('now'), void_reason=?, void_by=? WHERE id=?").run(rs, user.id, id);
    audit(db, user, sid, 'payroll_runs.void', 'payroll_run', id, { reason: rs }); return { ok: true };
  });
}

/* ---------------------------- employee statement ---------------------------- */
/** Every posted movement of one employee with a running balance: + = the station owes the employee, − = the employee owes the station. */
function statement(db, user, sid, id, q) {
  need(user, 'report.read'); station(db, user, sid);
  const e = scoped(db, 'employees', id, sid, 'Employee');
  const from = V.date(q.from, 'from', { optional: true }) || '0000-01-01', to = V.date(q.to, 'to', { optional: true }) || '9999-12-31';
  const rows = db.prepare(`SELECT j.id journal_id, j.business_date date, j.source, j.source_id, j.memo jmemo, l.memo, a.sys, l.debit, l.credit FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id
    WHERE l.party_type='employee' AND l.party_id=? AND a.sys IN('emp_adv','salaries_payable') AND j.status='posted' AND j.business_date<=? ORDER BY j.business_date, j.id, l.id`).all(e.id, to);
  let open = 0, bal = 0; const lines = [];
  for (const r of rows) {
    const v = r.credit - r.debit;   // both accounts read the same way: credit = owed to the employee
    if (r.date < from) { open += v; continue; }
    if (!lines.length) bal = open;
    bal += v; lines.push({ ...r, amount: v, balance: bal });
  }
  if (!lines.length) bal = open;
  const b = balanceOf(db, sid, e.id, to);
  return { employee: e, from: from === '0000-01-01' ? null : from, to: to === '9999-12-31' ? null : to, opening: open, closing: bal, advance: b.advance, payable: b.payable, lines };
}

/* ---------------------------- carry-over of old per-employee accounts (KI-20) ----------------------------
   Imported charts (M7) kept one ledger account per employee under a group (محطة التميز: 125 «حسابات الموظفين»).
   carryOver moves each account's balance at this station into the payroll module with ONE journal (source 'emp_carry'):
     balance > 0 (the employee owes):  Dr 1160 emp_adv (employee) / Cr the old account
     balance < 0 (the station owes):   Dr the old account / Cr 2200 salaries_payable (employee)
   The books' totals do not change; each old account ends at 0, keeps its history, and is deactivated so nothing posts to it
   by mistake. Undo reverses that journal and puts everything back while the carried balances are untouched. */
const ORG_WIDE = require('./auth').ORG_WIDE;
function carryPlan(db, user, sid, groupId, today) {
  const g = db.prepare('SELECT * FROM accounts WHERE id=? AND org_id=?').get(groupId, user.org_id);
  if (!g) throw notFound('Account');
  if (!g.is_group) throw bad('VALIDATION', 'Choose the group that holds one account per employee');
  const leaves = db.prepare(`WITH RECURSIVE t(id) AS (SELECT id FROM accounts WHERE id=? UNION ALL SELECT c.id FROM accounts c JOIN t ON c.parent_id=t.id)
    SELECT a.* FROM accounts a JOIN t ON t.id=a.id WHERE a.id<>? AND a.is_group=0 ORDER BY a.code`).all(g.id, g.id);
  const yearAgo = (() => { const d = new Date(today + 'T12:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() - 1); return d.toISOString().slice(0, 10); })();
  const stat = db.prepare(`SELECT COALESCE(SUM(l.debit-l.credit),0) bal, COUNT(*) n, MAX(j.business_date) last FROM journal_lines l JOIN journals j ON j.id=l.journal_id
    WHERE l.account_id=? AND j.station_id=? AND j.status='posted'`);
  const rows = [], skipped = [];
  for (const a of leaves) {
    const s = stat.get(a.id, sid);
    if (a.currency) { skipped.push({ account_id: a.id, code: a.code, name: a.name_ar, reason: 'foreign_currency', balance: s.bal }); continue; }
    if (!a.active) { skipped.push({ account_id: a.id, code: a.code, name: a.name_ar, reason: 'inactive', balance: s.bal }); continue; }
    if (!s.bal && !(s.last && s.last >= yearAgo)) { skipped.push({ account_id: a.id, code: a.code, name: a.name_ar, reason: 'no_balance_no_recent_moves', balance: 0 }); continue; }
    const linked = db.prepare('SELECT id FROM employees WHERE station_id=? AND legacy_account_id=?').get(sid, a.id)
      || db.prepare('SELECT id FROM employees WHERE station_id=? AND active=1 AND legacy_account_id IS NULL AND name=?').get(sid, a.name_ar);
    rows.push({ account_id: a.id, code: a.code, name: a.name_ar, balance: s.bal, last_move: s.last, to: s.bal > 0 ? 'advance' : s.bal < 0 ? 'payable' : 'none', employee_id: linked ? linked.id : null });
  }
  const tot = rows.reduce((t, r) => ({ advance: t.advance + Math.max(r.balance, 0), payable: t.payable + Math.max(-r.balance, 0) }), { advance: 0, payable: 0 });
  return { group: { id: g.id, code: g.code, name_ar: g.name_ar, name_en: g.name_en }, date: today, rows, skipped, totals: tot };
}
const activeCarry = (db, orgId, sid) => db.prepare("SELECT * FROM journals WHERE org_id=? AND source='emp_carry' AND source_id=? AND status='posted' AND reversed_by IS NULL AND reversal_of IS NULL").get(orgId, sid);
function carryGroups(db, user, sid) {
  need(user, 'payroll.manage'); station(db, user, sid);
  return db.prepare('SELECT id, code, name_ar, name_en FROM accounts WHERE org_id=? AND is_group=1 AND active=1 ORDER BY code').all(user.org_id)
    .map(g => ({ ...g, suggested: /موظف|employee|staff|salar/i.test(g.name_ar + ' ' + g.name_en) }));
}
function carryPreview(db, user, sid, q) {
  need(user, 'payroll.manage'); const st = station(db, user, sid);
  const done = activeCarry(db, user.org_id, sid);
  if (done) return { done: true, journal_id: done.id, date: done.business_date };
  return { done: false, ...carryPlan(db, user, sid, V.int(Number(q.group_account_id), 'group_account_id', { min: 1 }), tzToday(st.timezone)) };
}
function carryOver(db, user, sid, b) {
  need(user, 'payroll.manage'); const st = station(db, user, sid); V.obj(b, 'body');
  if (!ORG_WIDE.has(user.role)) throw require('./errors').forbidden('Only the owner or an administrator can carry old accounts over');
  const groupId = V.int(b.group_account_id, 'group_account_id', { min: 1 });
  return tx(db, () => {
    if (activeCarry(db, user.org_id, sid)) throw conflict('CARRY_DONE', 'The old employee accounts of this station were already carried over (undo it first)');
    const today = tzToday(st.timezone); L.assertOpen(db, user.org_id, today);
    const plan = carryPlan(db, user, sid, groupId, today);
    if (!plan.rows.length) throw bad('VALIDATION', 'Nothing to carry over in this group');
    const created = [], linked = [], lines = [];
    const ins = db.prepare('INSERT INTO employees(org_id,station_id,name,salary,note,legacy_account_id) VALUES(?,?,?,0,?,?)');
    for (const r of plan.rows) {
      let eid = r.employee_id;
      if (eid) {   // an employee already tied to this account (or with the same name) continues; one undone earlier is active again
        const was = db.prepare('SELECT legacy_account_id FROM employees WHERE id=?').get(eid).legacy_account_id;
        db.prepare('UPDATE employees SET legacy_account_id=?, active=1 WHERE id=?').run(r.account_id, eid); (was === r.account_id ? created : linked).push(eid);
      }
      else { eid = Number(ins.run(user.org_id, sid, r.name, 'من الحساب ' + r.code, r.account_id).lastInsertRowid); created.push(eid); }
      const party = { party_type: 'employee', party_id: eid };
      if (r.balance > 0) lines.push({ a: 'emp_adv', dr: r.balance, ...party, memo: r.code }, { a: r.account_id, cr: r.balance, memo: 'نقل إلى سلف الموظفين' });
      else if (r.balance < 0) lines.push({ a: r.account_id, dr: -r.balance, memo: 'نقل إلى رواتب مستحقة' }, { a: 'salaries_payable', cr: -r.balance, ...party, memo: r.code });
    }
    const accounts = plan.rows.map(r => r.account_id);
    let journal_id = null;
    if (lines.length) journal_id = L.post(db, { org_id: user.org_id, station_id: sid, date: today, source: 'emp_carry', source_id: sid, user_id: user.id, memo: `نقل حسابات الموظفين ${plan.group.code} إلى شاشة الرواتب`, lines });
    db.prepare(`UPDATE accounts SET active=0 WHERE id IN (${accounts.map(() => '?').join(',')})`).run(...accounts);
    audit(db, user, sid, 'payroll.carry', 'account', plan.group.id, { group: plan.group.code, journal_id, accounts, created, linked, ...plan.totals });
    return { journal_id, employees: plan.rows.length, created: created.length, linked: linked.length, ...plan.totals, skipped: plan.skipped.length };
  });
}
function carryUndo(db, user, sid, b) {
  need(user, 'payroll.manage'); station(db, user, sid);
  if (!ORG_WIDE.has(user.role)) throw require('./errors').forbidden('Only the owner or an administrator can undo the carry-over');
  const reason = V.str(b && b.reason, 'reason', { min: 3, max: 200 });
  return tx(db, () => {
    const j = activeCarry(db, user.org_id, sid); if (!j) throw conflict('NOTHING_TO_UNDO', 'There is no carry-over to undo');
    L.assertOpen(db, user.org_id, j.business_date);
    const a = db.prepare("SELECT detail FROM audit WHERE org_id=? AND action='payroll.carry' AND station_id=? ORDER BY id DESC LIMIT 1").get(user.org_id, sid);
    const d = JSON.parse(a.detail);
    /* only while every carried balance is exactly as the carry-over left it (no advance, payroll or payment since) */
    const carried = new Map(); for (const l of db.prepare("SELECT l.party_id id, a.sys, l.debit, l.credit FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE l.journal_id=? AND l.party_type='employee'").all(j.id)) {
      const c = carried.get(l.id) || { advance: 0, payable: 0 }; if (l.sys === 'emp_adv') c.advance += l.debit - l.credit; else c.payable += l.credit - l.debit; carried.set(l.id, c); }
    const bal = balances(db, sid);
    for (const id of [...d.created, ...d.linked]) {
      const now = bal.get(id) || { advance: 0, payable: 0 }, was = carried.get(id) || { advance: 0, payable: 0 };
      if (now.advance !== was.advance || now.payable !== was.payable || db.prepare('SELECT 1 FROM employee_moves WHERE employee_id=? AND voided_at IS NULL').get(id) || db.prepare('SELECT 1 FROM payroll_lines l JOIN payroll_runs r ON r.id=l.run_id WHERE l.employee_id=? AND r.voided_at IS NULL').get(id))
        throw conflict('CARRY_IN_USE', 'Employees carried over already have new movements; the carry-over can no longer be undone');
    }
    L.reverseSource(db, user.org_id, 'emp_carry', sid, user.id, 'Undo: ' + reason);
    if (d.accounts.length) db.prepare(`UPDATE accounts SET active=1 WHERE id IN (${d.accounts.map(() => '?').join(',')})`).run(...d.accounts);
    if (d.created.length) db.prepare(`UPDATE employees SET active=0 WHERE id IN (${d.created.map(() => '?').join(',')})`).run(...d.created);   // kept tied to their account, so a later carry-over finds them
    if (d.linked.length) db.prepare(`UPDATE employees SET legacy_account_id=NULL WHERE id IN (${d.linked.map(() => '?').join(',')})`).run(...d.linked);
    audit(db, user, sid, 'payroll.carry_undo', 'journal', j.id, { reason }); return { ok: true };
  });
}

/** Cash taken from the drawer during a shift for advances and salaries (ops.shiftTotals). */
function shiftCash(db, shiftId) {
  return db.prepare("SELECT COALESCE(SUM(amount),0) v FROM employee_moves WHERE shift_id=? AND method='cash' AND voided_at IS NULL").get(shiftId).v;
}

module.exports = { carryGroups, carryPreview, carryOver, carryUndo, listEmployees, createEmployee, updateEmployee, createMove, voidMove, listMoves, payrollDraft, createPayroll, listPayrolls, getPayroll, voidPayroll, statement, shiftCash, balances };
