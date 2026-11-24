'use strict';
/* «الموظفون والرواتب» (0.28.0): employees, monthly payroll, advances and salary payments, employee statement.
   Every amount and balance comes from the server (src/payroll.js); this file only shows and collects them. */
(function () {
  const F = window.FP; if (!F) return;
  const { h, T, S, api, sp, guard, toast, field, sel, table, sec, cd, money, parseDec, dec, fdate, todayIso, askReason } = F;
  const tabs = (key, list) => { S[key] = S[key] || list[0][0]; return h('div', { class: 'tabs', role: 'tablist' }, list.map(([k, label]) => h('button', { role: 'tab', 'aria-selected': S[key] === k ? 'true' : 'false', onclick: () => { S[key] = k; F.render(); } }, label))); };
  const amt = (id, v) => h('input', { id, inputmode: 'decimal', value: v ? String(v / 10 ** dec()) : '' });
  const toMinor = (el, err = 'err.BAD_NUMBER') => { const s = el.value.trim(); if (!s) return 0; const v = parseDec(s, dec()); if (v == null) throw new Error(T(err)); return v; };
  const nm = (e) => e.name + (e.job_title ? ' · ' + e.job_title : '');
  const canManage = () => cd('payroll.manage'), canPay = () => cd('payroll.pay');
  const print = (title, sub, node) => F.printDoc(title, h('div', { class: 'a4 xdoc' }, F.letterhead ? F.letterhead(title, sub) : h('h2', null, title), node));

  F.VIEWS.emp = async (main) => {
    const opts = [['list', T('empList')], ['run', T('payrollRun')], ['moves', T('empMoves')], ['stmt', T('empStmt')]];
    main.append(tabs('empTab', opts));
    const box = h('div', { class: 'stack' }); main.append(box);
    if (S.empTab === 'list') return listTab(box);
    if (S.empTab === 'run') return runTab(box);
    if (S.empTab === 'moves') return movesTab(box);
    return stmtTab(box);
  };

  /* ------------------------------ employees ------------------------------ */
  async function listTab(box) {
    const all = !!S.empAll;
    const emps = await api('GET', sp('/employees' + (all ? '?all=1' : '')));
    const totals = emps.reduce((t, e) => ({ salary: t.salary + (e.active ? e.salary : 0), advance: t.advance + e.advance, payable: t.payable + e.payable }), { salary: 0, advance: 0, payable: 0 });
    const form = canManage() ? empForm(null) : null;
    const carry = canManage() && S.user && ['owner', 'admin'].includes(S.user.role) ? await carryCard() : null;
    box.append(carry || '',
      h('div', { class: 'grid' }, F.statN(T('empCount'), emps.filter(e => e.active).length, (v) => String(v)), F.statN(T('monthlySalaries'), totals.salary, money), F.statN(T('advancesOut'), totals.advance, money), F.statN(T('salariesOwed'), totals.payable, money)),
      form,
      sec(T('empList'), h('div', { class: 'row' }, h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: all, onchange: (e) => { S.empAll = e.target.checked; F.render(); } }), ' ', T('showInactive'))),
        emps.length ? table([T('name'), T('jobTitle'), T('phone'), T('salary'), T('empAdvance'), T('salaryOwed'), ''], emps.map(e => [
          e.active ? h('b', null, e.name) : h('span', { class: 'muted' }, e.name, ' (', T('inactive'), ')'), e.job_title || '', e.phone || '', money(e.salary),
          e.advance ? h('b', { class: 'neg' }, money(e.advance)) : '0', e.payable ? h('b', null, money(e.payable)) : '0',
          h('div', { class: 'row' },
            h('button', { class: 'btn ghost sm', onclick: () => { S.empStmtId = e.id; S.empTab = 'stmt'; F.render(); } }, T('statement')),
            canPay() && e.active ? h('button', { class: 'btn ghost sm', onclick: () => { S.empMoveFor = e.id; S.empTab = 'moves'; F.render(); } }, T('advanceOrPay')) : null,
            canManage() ? h('button', { class: 'btn ghost sm', onclick: () => { box.prepend(empForm(e)); window.scrollTo(0, 0); } }, T('edit')) : null)])) : h('p', { class: 'muted' }, T('noEmployees'))));
  }
  /* «نقل حسابات الموظفين القديمة»: one account per employee in an imported chart (e.g. 125) → this module, after a preview */
  async function carryCard() {
    const groups = await api('GET', sp('/payroll/carry-groups'));
    const pick = groups.find(g => g.suggested); if (!pick) return null;
    const st = await api('GET', sp('/payroll/carry?group_account_id=' + pick.id));
    if (st.done) return h('p', { class: 'hint' }, T('carryDone'), ' ', fdate(st.date), ' · ',
      h('button', { class: 'linkbtn', onclick: () => askReason(guard(async (reason) => { await api('POST', sp('/payroll/carry/undo'), { reason }); toast(T('saved')); F.render(); })) }, T('carryUndo')));
    if (!st.rows.length) return null;
    const g = sel('carryGroup', groups.map(x => [x.id, x.code + ' · ' + x.name_ar]), pick.id);
    const out = h('div');
    const show = (p) => out.replaceChildren(
      table([T('code'), T('name'), T('balance'), T('carryTo'), ''], p.rows.map(r => [r.code, r.name, money(Math.abs(r.balance)), T(r.to === 'advance' ? 'empAdvance' : r.to === 'payable' ? 'salaryOwed' : 'carryNoBalance'), r.employee_id ? T('carryLink') : T('carryNew')])),
      h('p', null, T('advancesOut'), ': ', h('b', null, money(p.totals.advance)), ' · ', T('salariesOwed'), ': ', h('b', null, money(p.totals.payable)), p.skipped.length ? ' · ' + T('carrySkipped', { n: p.skipped.length }) : ''),
      h('p', { class: 'hint' }, T('carryHelp2')),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: guard(async (ev) => {
        if (!window.confirm(T('carryConfirm'))) return;
        const r = await api('POST', sp('/payroll/carry'), { group_account_id: +g.value });
        toast(T('saved') + ' · ' + r.employees + ' ' + T('empList')); F.render(); void ev;
      }) }, T('carryRun'))));
    g.onchange = guard(async () => { const p = await api('GET', sp('/payroll/carry?group_account_id=' + g.value)); if (p.done) return F.render(); show(p); });
    show(st);
    return h('div', { class: 'card' }, h('h2', null, T('carryTitle')), h('p', { class: 'hint' }, T('carryHelp')), h('div', { class: 'row' }, field(T('accountGroup'), g)), out);
  }
  function empForm(e) {
    const name = h('input', { id: 'emName', value: e ? e.name : '' }), job = h('input', { id: 'emJob', value: e ? e.job_title || '' : '' }), phone = h('input', { id: 'emPhone', type: 'tel', dir: 'ltr', value: e ? e.phone || '' : '' });
    const salary = amt('emSalary', e ? e.salary : 0), hired = h('input', { id: 'emHired', type: 'date', value: e ? e.hired_on || '' : '', max: todayIso() }), note = h('input', { id: 'emNote', value: e ? e.note || '' : '' });
    const active = e ? h('select', { id: 'emActive' }, h('option', { value: '1', selected: !!e.active }, T('active')), h('option', { value: '0', selected: !e.active }, T('inactive'))) : null;
    const form = h('form', { class: 'card', autocomplete: 'off', onsubmit: guard(async (ev) => {
      ev.preventDefault();
      const b = { name: name.value.trim(), job_title: job.value.trim() || null, phone: phone.value.trim() || null, salary: toMinor(salary), hired_on: hired.value || null, note: note.value.trim() || null };
      if (e) { b.active = active.value === '1'; await api('PATCH', sp('/employees/' + e.id), b); } else await api('POST', sp('/employees'), b);
      toast(T('saved')); F.render();
    }) }, h('h2', null, e ? T('editEmployee') + ' — ' + e.name : T('newEmployee')),
      h('div', { class: 'grid' }, field(T('name'), name), field(T('jobTitle'), job), field(T('phone'), phone), field(T('monthlySalary'), salary), field(T('hiredOn'), hired), field(T('note'), note), active && field(T('status'), active)),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('save')), e ? h('button', { class: 'btn ghost', type: 'button', onclick: () => form.remove() }, T('cancel')) : null));
    return form;
  }

  /* ------------------------------ monthly payroll ------------------------------ */
  async function runTab(box) {
    const month = h('input', { id: 'prMonth', type: 'month', value: S.prMonth || todayIso().slice(0, 7), max: todayIso().slice(0, 7) });
    const out = h('div', { class: 'stack' });
    const runs = await api('GET', sp('/payroll'));
    const load = guard(async () => {
      S.prMonth = month.value; if (!month.value) return;
      const d = await api('GET', sp('/payroll/draft?month=' + month.value));
      if (d.existing_run_id) return showRun(out, await api('GET', sp('/payroll/' + d.existing_run_id)));
      if (!d.lines.length) { out.replaceChildren(h('p', { class: 'note' }, T('noEmployees'))); return; }
      if (!canManage()) { out.replaceChildren(h('p', { class: 'note' }, T('payrollNotPosted'))); return; }
      const rows = d.lines.map((l) => ({ l, base: amt('', l.base), allow: amt('', 0), ded: amt('', 0), rec: amt('', l.recovered), net: h('b'), noteIn: h('input', { class: 'compact' }) }));
      const totalEl = h('b');
      const recalc = () => { let t = 0; for (const r of rows) { try { const earned = toMinor(r.base) + toMinor(r.allow) - toMinor(r.ded), n = earned - toMinor(r.rec); r.net.textContent = money(n); r.net.className = n < 0 ? 'neg' : ''; t += n; } catch { r.net.textContent = '?'; } } totalEl.textContent = money(t); };
      for (const r of rows) for (const el of [r.base, r.allow, r.ded, r.rec]) el.oninput = recalc;
      recalc();
      const post = h('button', { class: 'btn', type: 'submit' }, T('postPayroll'));
      out.replaceChildren(h('form', { class: 'card', onsubmit: guard(async (ev) => {
        ev.preventDefault();
        const lines = rows.map(r => ({ employee_id: r.l.employee_id, base: toMinor(r.base), allowances: toMinor(r.allow), deductions: toMinor(r.ded), recovered: toMinor(r.rec), note: r.noteIn.value.trim() || undefined }));
        const res = await api('POST', sp('/payroll'), { month: month.value, lines });
        toast(T('saved') + ' · ' + money(res.net)); F.render();
      }) }, h('h2', null, T('payrollOf'), ' ', month.value), h('p', { class: 'hint' }, T('payrollHelp')),
        table([T('name'), T('salary'), T('allowances'), T('deductions'), T('empAdvance'), T('recovered'), T('netPay'), T('note')], rows.map(r => [nm(r.l), r.base, r.allow, r.ded, money(r.l.advance), r.rec, r.net, r.noteIn])),
        h('p', null, T('totalNet'), ': ', totalEl), h('div', { class: 'row' }, post)));
    });
    month.onchange = load;
    box.append(sec(T('payrollRun'), h('div', { class: 'row' }, field(T('month'), month), h('button', { class: 'btn ghost', onclick: load }, T('run')))), out,
      sec(T('payrollHistory'), runs.length ? table([T('month'), T('date'), T('empCount'), T('salaryExpense'), T('recovered'), T('netPay'), ''], runs.map(r => [r.month, fdate(r.business_date), String(r.employees), money(r.total_expense), money(r.total_recovered), r.voided_at ? h('span', { class: 'struck' }, money(r.total_net)) : h('b', null, money(r.total_net)),
        h('div', { class: 'row' }, r.voided_at ? h('span', { class: 'muted' }, T('voided')) : null, h('button', { class: 'btn ghost sm', onclick: guard(async () => showRun(out, await api('GET', sp('/payroll/' + r.id)))) }, T('open')))])) : h('p', { class: 'muted' }, T('noData'))));
    await load();
  }
  function showRun(out, r) {
    const tbl = () => table([T('name'), T('salary'), T('allowances'), T('deductions'), T('recovered'), T('netPay'), T('note')],
      [...r.lines.map(l => [nm(l), money(l.base), money(l.allowances), money(l.deductions), money(l.recovered), h('b', null, money(l.net)), l.note || '']),
        [h('b', null, T('total')), money(r.lines.reduce((t, l) => t + l.base, 0)), money(r.lines.reduce((t, l) => t + l.allowances, 0)), money(r.lines.reduce((t, l) => t + l.deductions, 0)), money(r.total_recovered), h('b', null, money(r.total_net)), '']]);
    out.replaceChildren(h('div', { class: 'card' },
      h('div', { class: 'row between' }, h('h2', null, T('payrollOf'), ' ', r.month, r.voided_at ? [' — ', h('span', { class: 'neg' }, T('voided'))] : ''),
        h('div', { class: 'row' }, h('button', { class: 'btn gold-btn', onclick: () => print(T('payrollOf') + ' ' + r.month, fdate(r.business_date), tbl()) }, '⎙ ', T('print')),
          !r.voided_at && canManage() ? h('button', { class: 'btn danger sm', onclick: () => askReason(guard(async (reason) => { await api('POST', sp(`/payroll/${r.id}/void`), { reason }); toast(T('voided')); F.render(); })) }, T('void')) : null)),
      h('p', { class: 'muted small' }, fdate(r.business_date), r.voided_at ? ' · ' + T('reason') + ': ' + r.void_reason : '', ' · ', T('salaryExpense'), ': ', money(r.total_expense)),
      tbl(), h('p', { class: 'hint' }, T('payrollPayHint'))));
  }

  /* ------------------------------ advances & salary payments ------------------------------ */
  async function movesTab(box) {
    const emps = await api('GET', sp('/employees'));
    const moves = await api('GET', sp('/employee-moves'));
    if (canPay() && emps.length) {
      const who = sel('mvEmp', emps.map(e => [e.id, nm(e)]), S.empMoveFor || emps[0].id);
      const kind = sel('mvKind', [['advance', T('empAdvance')], ['salary_pay', T('salaryPayment')]], 'advance');
      const amount = amt('mvAmt', 0), method = sel('mvMethod', [['cash', T('mCash')], ['bank', T('mBank')]], 'cash');
      const date = h('input', { id: 'mvDate', type: 'date', value: todayIso(), max: todayIso() }), note = h('input', { id: 'mvNote' });
      const info = h('p', { class: 'hint' });
      const showInfo = () => { const e = emps.find(x => String(x.id) === String(who.value)); if (!e) return; info.replaceChildren(T('empAdvance'), ': ', h('b', null, money(e.advance)), ' · ', T('salaryOwed'), ': ', h('b', null, money(e.payable)));
        if (kind.value === 'salary_pay' && !amount.value && e.payable) amount.value = String(e.payable / 10 ** dec()); };
      who.onchange = showInfo; kind.onchange = showInfo; showInfo();
      box.append(h('form', { class: 'card', autocomplete: 'off', onsubmit: guard(async (ev) => {
        ev.preventDefault();
        const v = toMinor(amount); if (!v) throw new Error(T('err.BAD_NUMBER'));
        await api('POST', sp('/employee-moves'), { employee_id: +who.value, kind: kind.value, amount: v, method: method.value, date: date.value, note: note.value.trim() || undefined });
        S.empMoveFor = +who.value; toast(T('saved')); F.render();
      }) }, h('h2', null, T('empMoves')), h('div', { class: 'grid' }, field(T('employee'), who), field(T('type'), kind), field(T('amount'), amount), field(T('method'), method), field(T('date'), date), field(T('note'), note)), info,
        h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('save')))));
    } else if (!emps.length) box.append(h('p', { class: 'note' }, T('noEmployees')));
    box.append(sec(T('lastMoves'), moves.length ? table([T('date'), T('employee'), T('type'), T('method'), T('amount'), T('note'), ''], moves.map(m => [fdate(m.business_date), m.employee_name, T(m.kind === 'advance' ? 'empAdvance' : 'salaryPayment'), T(m.method === 'cash' ? 'mCash' : 'mBank'),
      m.voided_at ? h('span', { class: 'struck' }, money(m.amount)) : h('b', null, money(m.amount)), m.note || '',
      m.voided_at ? h('span', { class: 'muted' }, T('voided')) : canPay() ? h('button', { class: 'btn danger sm', onclick: () => askReason(guard(async (reason) => { await api('POST', sp(`/employee-moves/${m.id}/void`), { reason }); toast(T('voided')); F.render(); })) }, T('void')) : ''])) : h('p', { class: 'muted' }, T('noData'))));
  }

  /* ------------------------------ employee statement ------------------------------ */
  async function stmtTab(box) {
    const emps = await api('GET', sp('/employees?all=1'));
    if (!emps.length) { box.append(h('p', { class: 'note' }, T('noEmployees'))); return; }
    const who = sel('stEmp', emps.map(e => [e.id, nm(e)]), S.empStmtId || emps[0].id);
    const from = h('input', { type: 'date', value: S.empFrom || todayIso().slice(0, 5) + '01-01', max: todayIso() }), to = h('input', { type: 'date', value: S.empTo || todayIso(), max: todayIso() });
    const out = h('div', { class: 'stack' });
    const SRC = { emp_advance: 'empAdvance', salary_pay: 'salaryPayment', payroll: 'payrollShort' };
    const run = guard(async () => {
      S.empStmtId = +who.value; S.empFrom = from.value; S.empTo = to.value;
      const r = await api('GET', sp(`/employees/${who.value}/statement?from=${from.value}&to=${to.value}`));
      const bal = (v) => h('b', { class: v < 0 ? 'neg' : '' }, money(Math.abs(v)), ' ', v ? h('small', null, T(v > 0 ? 'owedToHim' : 'owedByHim')) : '');
      const tbl = () => table([T('date'), T('type'), T('note'), T('owedToHim'), T('owedByHim'), T('balance')],
        [[fdate(r.from || from.value), T('openingCol'), '', '', '', bal(r.opening)],
          ...r.lines.map(l => [fdate(l.date), T(SRC[l.source] || ('src.' + l.source)) + (l.sys === 'emp_adv' && l.source === 'payroll' ? ' · ' + T('recovered') : ''), l.memo || l.jmemo || '', l.amount > 0 ? money(l.amount) : '', l.amount < 0 ? money(-l.amount) : '', bal(l.balance)]),
          ['', h('b', null, T('closingBal')), '', '', '', bal(r.closing)]]);
      out.replaceChildren(h('div', { class: 'grid' }, F.statN(T('empAdvance'), r.advance, money), F.statN(T('salaryOwed'), r.payable, money)),
        h('div', { class: 'row' }, h('button', { class: 'btn gold-btn', onclick: () => print(T('empStmt') + ' — ' + r.employee.name, fdate(from.value) + ' — ' + fdate(to.value), tbl()) }, '⎙ ', T('print'))), tbl());
    });
    who.onchange = run;
    box.append(sec(T('empStmt'), h('div', { class: 'row' }, field(T('employee'), who), field(T('from'), from), field(T('to'), to), h('button', { class: 'btn', onclick: run }, T('run')))), out);
    await run();
  }
})();
