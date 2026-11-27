'use strict';
/* FuelPro ERP screens: shift & cash drawer, inventory, suppliers, journal entries, financial statements, users.
   Uses the toolkit app.js exposes as window.FP; every action is checked again by the server. */
(function () {
  const F = window.FP; if (!F) return;
  const { h, T, D, S, P, api, sp, guard, toast, field, sel, table, stat, sec, modal, voidBtn, refresh, render, cd, money, vol, volNum, volMl, parseDec, dec, fdate, fdt, todayIso, num, priceShow, priceE4, uLbl, csv, printNode } = F;
  const amt = (v) => num(v, (x) => parseDec(x, dec()));
  const mf = (cur, d) => (v) => { const dd = Math.min(d, S.st && S.st.disp_dec != null ? S.st.disp_dec : d); try { return FPFMT.nf((P.lang === 'ar' ? 'ar' : P.lang) + '-u-nu-' + P.nums, { minimumFractionDigits: dd, maximumFractionDigits: dd }).format(v / 10 ** d); } catch { return String(v / 10 ** d); } };
  const pill = (cls, text) => h('span', { class: 'pill ' + cls }, text);
  const tabs = (key, list, onPick) => { S[key] = S[key] || list[0][0]; return h('div', { class: 'tabs', role: 'tablist' }, list.map(([k, label]) => h('button', { role: 'tab', 'aria-selected': S[key] === k ? 'true' : 'false', onclick: () => { S[key] = k; onPick ? onPick(k) : render(); } }, label))); };
  const dateIn = (id, v) => h('input', { id, type: 'date', value: v, max: todayIso() });
  const monthStart = () => todayIso().slice(0, 8) + '01';
  const signed = (v, f) => h('span', { class: v < 0 ? 'bad' : v > 0 ? 'ok' : '' }, f(v));
  const acctName = (a) => `${a.code} · ${P.lang === 'ar' ? a.name_ar : a.name_en}`;
  const ROLE_LIST = ['admin', 'manager', 'accountant', 'supervisor', 'cashier', 'viewer'];

  /* ================================ SHIFT & CASH ================================ */
  async function shiftCard(main) {
    const { shift } = await api('GET', sp('/shifts/current'));
    if (!shift) {
      const fl = h('input', { id: 'shFloat', inputmode: 'decimal', value: '0' });
      main.append(h('form', { class: 'card', onsubmit: guard(async (e) => { e.preventDefault(); await api('POST', sp('/shifts'), { float_amount: amt(fl.value || '0') }); toast(T('saved')); render(); }) },
        h('h2', null, T('noShift')), S.st.require_shift ? h('p', { class: 'note' }, T('err.SHIFT_REQUIRED')) : null,
        cd('shift.open') ? [h('div', { class: 'grid' }, field(T('float'), fl)), h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('openShift')))] : null));
      return;
    }
    const t = shift.totals;
    const head = h('div', { class: 'row between' }, h('div', null, h('h2', null, T('shift'), ' #', shift.id, ' ', pill(shift.status, T('st.' + shift.status))),
      h('div', { class: 'muted small' }, T('openedBy'), ': ', shift.opened_by_name, ' · ', fdt(shift.opened_at), ' · ', T('float'), ': ', money(shift.float_amount))));
    const card = h('section', { class: 'card' }, head,
      h('div', { class: 'grid' }, F.statN(T('expectedCash'), t.expected_cash, money), F.statN(T('cashSales'), t.cash_sales, money), F.statN(T('creditSales'), t.credit_sales, money), F.statN(T('collections'), t.collections_cash, money),
        stat(T('cashExp'), money(t.expenses_cash + t.purchases_cash + t.supplier_payments_cash)), stat(T('withdrawals'), money(t.withdrawals - t.deposits)), stat(T('salesCount'), String(t.sales_count)), stat(T('qty'), vol(t.qty_ml, 0))),
      h('p', { class: 'hint' }, T('shiftFormula')));
    main.append(card);
    main.append(sec(T('meters'), table([T('pump'), T('fuel'), T('openMeter'), T('closeMeterCol'), T('meterQty'), T('recorded'), T('unrecorded')],
      shift.meters.map(m => [m.pump_name, m.fuel_name, volNum(m.open_ml, 3), volNum(m.close_ml, 3), volNum(m.meter_ml, 3), volNum(m.sold_ml, 3), m.unrecorded_ml ? h('b', { class: 'bad' }, volNum(m.unrecorded_ml, 3)) : '0']))));
    const forms = h('div', { class: 'grid2' });
    if (cd('cash.move')) {
      const k = sel('cmKind', [['withdrawal', T('withdrawal')], ['deposit', T('deposit')]]), c = sel('cmTo', [['bank', T('toBank')], ['owner', T('toOwner')]]), a = h('input', { id: 'cmAmt', inputmode: 'decimal' }), n = h('input', { id: 'cmNote' });
      forms.append(h('form', { class: 'card', onsubmit: guard(async (e) => { e.preventDefault(); await api('POST', sp('/cash-moves'), { kind: k.value, counterpart: c.value, amount: amt(a.value), note: n.value || undefined }); toast(T('saved')); render(); }) },
        h('h2', null, T('cashMove')), h('div', { class: 'grid' }, field(T('kind'), k), field(T('counterpart'), c), field(T('amount'), a), field(T('note'), n)), h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('save'))),
        shift.cash_moves.length ? table([T('time'), T('kind'), T('counterpart'), T('amount'), ''], shift.cash_moves.map(m => [fdt(m.created_at), T(m.kind), T(m.counterpart === 'bank' ? 'toBank' : 'toOwner'), m.voided_at ? h('span', { class: 'struck' }, money(m.amount)) : money(m.amount), !m.voided_at ? voidBtn(() => `/cash-moves/${m.id}/void`) : ''])) : null));
    }
    if (cd('shift.close')) {
      const cc = h('input', { id: 'shCount', inputmode: 'decimal' }), note = h('input', { id: 'shNote' }), prev = h('div', { class: 'hint' });
      cc.oninput = () => { const v = parseDec(cc.value, dec()); if (v == null) { prev.textContent = ''; return; } const d = v - t.expected_cash; prev.replaceChildren(T('variance'), ': ', h('b', { class: d < 0 ? 'bad' : d > 0 ? 'ok' : '' }, money(d)), ' ', d < 0 ? T('short') : d > 0 ? T('over') : T('balancedCash')); };
      forms.append(h('form', { class: 'card', onsubmit: guard(async (e) => { e.preventDefault(); const r = await api('POST', sp(`/shifts/${shift.id}/close`), { counted_cash: amt(cc.value), note: note.value || undefined }); toast(T('variance') + ': ' + money(r.variance)); render(); }) },
        h('h2', null, T('closeShift')), h('div', { class: 'grid' }, field(T('countedCash'), cc), field(T('note'), note)), prev, h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('closeShift')))));
    }
    if (forms.childElementCount) main.append(forms);
  }
  function shiftModal(sh) {
    const t = sh.totals; const v = sh.status === 'open' ? null : sh.variance;
    const body = h('div', { class: 'stack' },
      h('dl', { class: 'kv' }, h('dt', null, T('status')), h('dd', null, pill(sh.status, T('st.' + sh.status))), h('dt', null, T('openedBy')), h('dd', null, sh.opened_by_name || ''), h('dt', null, T('openedAt')), h('dd', null, fdt(sh.opened_at)),
        h('dt', null, T('float')), h('dd', null, money(sh.float_amount)), h('dt', null, T('cashSales')), h('dd', null, money(t.cash_sales)), h('dt', null, T('creditSales')), h('dd', null, money(t.credit_sales)),
        h('dt', null, T('collections')), h('dd', null, money(t.collections_cash)), h('dt', null, T('cashExp')), h('dd', null, money(t.expenses_cash + t.purchases_cash + t.supplier_payments_cash)),
        h('dt', null, T('withdrawals')), h('dd', null, money(t.withdrawals - t.deposits)), h('dt', null, T('expectedCash')), h('dd', null, h('b', null, money(sh.expected_cash ?? t.expected_cash))),
        sh.counted_cash != null && [h('dt', null, T('countedCash')), h('dd', null, h('b', null, money(sh.counted_cash))), h('dt', null, T('variance')), h('dd', null, signed(v, money))]),
      table([T('pump'), T('openMeter'), T('closeMeterCol'), T('meterQty'), T('recorded')], sh.meters.map(m => [m.pump_name, volNum(m.open_ml, 3), volNum(m.close_ml, 3), volNum(m.meter_ml, 3), volNum(m.sold_ml, 3)])));
    const act = (path, label, needReason) => h('button', { class: 'btn ghost', type: 'button', onclick: guard(async () => {
      if (needReason) return F.askReason(guard(async (r) => { await api('POST', sp(`/shifts/${sh.id}/${path}`), { reason: r }); m.remove(); toast(T('saved')); render(); }));
      await api('POST', sp(`/shifts/${sh.id}/${path}`)); m.remove(); toast(T('saved')); render(); }) }, label);
    const m = modal(T('shift') + ' #' + sh.id + ' — ' + fdate(sh.business_date), h('div', null, body, h('div', { class: 'row' },
      cd('shift.approve') && sh.status === 'closed' ? [act('approve', T('approve')), act('reopen', T('reopen'), true)] : null,
      cd('shift.approve') && sh.status === 'approved' ? act('unapprove', T('unapprove'), true) : null,
      h('button', { class: 'btn ghost', type: 'button', onclick: () => printNode(T('shift') + ' #' + sh.id, body) }, T('print')))));
    m.classList.add('wide');
  }
  F.VIEWS.shift = async (main) => {
    await shiftCard(main);
    const list = await api('GET', sp('/shifts?limit=60'));
    main.append(sec(T('shiftHistory'), list.length ? table(['#', T('date'), T('openedBy'), T('status'), T('expectedCash'), T('countedCash'), T('variance')],
      list.map(s => [s.id, fdate(s.business_date), s.opened_by_name, pill(s.status, T('st.' + s.status)), s.expected_cash != null ? money(s.expected_cash) : '—', s.counted_cash != null ? money(s.counted_cash) : '—', s.variance != null ? signed(s.variance, money) : '—'])) : h('p', { class: 'muted' }, T('noData'))));
    main.querySelectorAll('section:last-child tbody tr').forEach((tr, i) => { tr.classList.add('click'); tr.onclick = guard(async () => shiftModal(await api('GET', sp('/shifts/' + list[i].id)))); });
  };

  /* ================================ INVENTORY ================================ */
  F.VIEWS.inv = async (main) => {
    main.append(tabs('invTab', [['tanks', T('tanks')], ['moves', T('moves')], ['transfers', T('transfers')], ['recon', T('reconciliation')]]));
    const box = h('div', { class: 'stack' }); main.append(box);
    if (S.invTab === 'tanks') {
      const tanks = await api('GET', sp('/tanks'));
      box.append(h('div', { class: 'grid3' }, tanks.map(t => {
        const mi = h('input', { id: 'min' + t.id, inputmode: 'decimal', value: t.min_ml ? F.volFree(t.min_ml) : '' });
        return h('section', { class: 'card' }, h('h2', null, t.name), h('div', { class: 'tanks' }, F.tankViz(t)),
          h('dl', { class: 'kv' }, h('dt', null, T('tankValue')), h('dd', null, h('b', null, money(t.value))), h('dt', null, T('avgCost')), h('dd', null, priceShow(t.avg_cost_e4), ' / ', uLbl()),
            h('dt', null, T('minLevel')), h('dd', null, t.min_ml ? vol(t.min_ml, 0) : '—')),
          cd('config.edit') ? h('form', { class: 'row', onsubmit: guard(async (e) => { e.preventDefault(); await api('PATCH', sp('/tanks/' + t.id), { min_ml: mi.value.trim() ? num(mi.value, volMl) : 0 }); toast(T('saved')); render(); }) }, field(T('minLevel') + ` (${uLbl()})`, mi), h('button', { class: 'btn ghost sm', type: 'submit' }, T('saveMin'))) : null);
      })));
    }
    if (S.invTab === 'moves') {
      const tk = sel('mvTank', [['', T('all')], ...S.tanks.map(t => [t.id, t.name])], S.mvTank || ''), from = dateIn('mvFrom', S.mvFrom || monthStart()), to = dateIn('mvTo', S.mvTo || todayIso());
      const out = h('div');
      const run = guard(async () => {
        S.mvTank = tk.value; S.mvFrom = from.value; S.mvTo = to.value;
        const rows = await api('GET', sp(`/stock/moves?from=${from.value}&to=${to.value}&limit=200${tk.value ? '&tank_id=' + tk.value : ''}`));
        out.replaceChildren(rows.length ? table([T('date'), T('tank'), T('kind'), T('qty') + ` (${uLbl()})`, T('valueCol'), T('balanceCol') + ` (${uLbl()})`, T('avgCost'), T('user')],
          rows.map(r => [fdate(r.business_date), r.tank_name, T('k.' + r.kind), signed(r.qty_ml, (v) => volNum(v, 3)), signed(r.value, money), volNum(r.balance_ml, 0), priceShow(r.avg_cost_e4), r.user_name || ''])) : h('p', { class: 'muted' }, T('noData')),
          rows.length === 200 ? h('p', { class: 'hint' }, '200+') : '');
      });
      box.append(sec(null, h('div', { class: 'row' }, field(T('tank'), tk), field(T('from'), from), field(T('to'), to), h('button', { class: 'btn', onclick: run }, T('run'))), out)); await run();
    }
    if (S.invTab === 'transfers') {
      if (cd('transfer.create')) {
        const ft = sel('trFrom', S.tanks.map(t => [t.id, `${t.name} — ${t.fuel_name} (${vol(t.level_ml, 0)})`])), ts = sel('trStation', S.stations.map(s => [s.id, s.name]), S.sid), tt = h('select', { id: 'trTo' }), q = h('input', { id: 'trQty', inputmode: 'decimal' }), n = h('input', { id: 'trNote' });
        const loadTo = guard(async () => { const list = +ts.value === S.sid ? S.tanks : await api('GET', `/api/stations/${ts.value}/tanks`); tt.replaceChildren(...list.filter(t => t.id !== +ft.value).map(t => h('option', { value: t.id }, `${t.name} — ${t.fuel_name}`))); });
        ts.onchange = loadTo; ft.onchange = loadTo; await loadTo();
        box.append(h('form', { class: 'card', onsubmit: guard(async (e) => { e.preventDefault(); const r = await api('POST', sp('/transfers'), { from_tank_id: +ft.value, to_station_id: +ts.value, to_tank_id: +tt.value, quantity_ml: num(q.value, volMl), note: n.value || undefined }); toast(T('saved') + ' · ' + money(r.value)); await refresh(); }) },
          h('h2', null, T('newTransfer')), h('div', { class: 'grid' }, field(T('fromTank'), ft), field(T('toStation'), ts), field(T('toTank'), tt), field(T('qty') + ` (${uLbl()})`, q), field(T('note'), n)), h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('save')))));
      }
      const list = await api('GET', sp('/transfers?limit=100'));
      box.append(sec(T('transfers'), list.length ? table([T('date'), T('fromTank'), T('toTank'), T('qty') + ` (${uLbl()})`, T('valueCol'), T('note'), ''], list.map(x => [fdate(x.business_date), `${x.from_station} · ${x.from_tank}`, `${x.to_station} · ${x.to_tank}`, volNum(x.quantity_ml, 0),
        x.voided_at ? h('span', { class: 'struck' }, money(x.value)) : money(x.value), x.note || '', !x.voided_at && cd('transfer.void') ? h('button', { class: 'btn danger sm', onclick: () => F.askReason(guard(async (r) => { await api('POST', sp(`/transfers/${x.id}/void`), { reason: r }); await refresh(); })) }, T('void')) : (x.voided_at ? T('voided') : '')])) : h('p', { class: 'muted' }, T('noData'))));
    }
    if (S.invTab === 'recon') {
      const from = dateIn('rcFrom', S.rcFrom || monthStart()), to = dateIn('rcTo', S.rcTo || todayIso()), out = h('div');
      const run = guard(async () => {
        S.rcFrom = from.value; S.rcTo = to.value; const r = await api('GET', sp(`/stock/reconciliation?from=${from.value}&to=${to.value}`));
        out.replaceChildren(table([T('tank'), T('opening'), T('received'), T('transferIn'), T('transferOut'), T('salesMeters'), T('bookClosing'), T('countVar'), T('closing'), T('varPct'), ''],
          r.rows.map(x => [h('span', null, h('b', null, x.tank_name), h('div', { class: 'muted small' }, x.fuel_name)), volNum(x.opening_ml, 0), volNum(x.received_ml, 0), volNum(x.transfer_in_ml, 0), volNum(x.transfer_out_ml, 0), volNum(x.sales_ml, 0),
            volNum(x.book_closing_ml, 0), signed(x.count_variance_ml, (v) => volNum(v, 0)), h('b', null, volNum(x.closing_ml, 0)), x.variance_pct == null ? '—' : signed(x.variance_pct, (v) => v + '%'), x.consistent ? pill('approved', T('consistent')) : pill('closed', T('mismatch'))])),
          h('p', { class: 'hint' }, `${T('qty')} (${uLbl()})`));
      });
      box.append(sec(null, h('div', { class: 'row' }, field(T('from'), from), field(T('to'), to), h('button', { class: 'btn', onclick: run }, T('run')), h('button', { class: 'btn ghost sm', onclick: () => printNode(T('reconciliation') + ' ' + from.value + ' → ' + to.value, out) }, T('print'))), out)); await run();
    }
  };

  /* ================================ SUPPLIERS ================================ */
  F.VIEWS.supp = async (main) => {
    const sups = await api('GET', sp('/suppliers'));
    if (S.suppStmt && sups.find(s => s.id === S.suppStmt) && await F.partyStatement(main, 'supplier')) return;
    const stm = null;
    main.append(sups.length && F.partyList ? F.partyList('supplier', sups, (id) => { S.suppStmt = id; render(); }) : sec(T('supp'), h('p', { class: 'muted' }, T('noData'))));
    if (stm) {
      const st = sec(T('stmt') + ': ' + stm.supplier.name, table([T('date'), T('desc'), T('dueDate'), T('debit'), T('creditCol'), T('balance'), ''], stm.entries.map(e => [fdate(e.date), e.kind === 'opening' ? T('openingBal') : e.kind === 'purchase' ? T('purchaseRow', { q: vol(e.quantity_ml, 0) }) : e.kind === 'journal' ? T('src.' + e.source) + (e.ref_no ? ' ' + e.ref_no : '') + (e.note ? ' — ' + e.note : '') : T('payOut') + ' · ' + T(e.method === 'bank' ? 'mBank' : 'mCash') + (e.note ? ' — ' + e.note : ''),
        e.due_date ? fdate(e.due_date) : '', e.debit ? money(e.debit) : '', e.credit ? money(e.credit) : '', e.voided ? h('span', { class: 'muted' }, T('voided')) : h('b', null, money(e.balance)), e.kind === 'payment' && !e.voided && cd('supplier.pay') ? voidBtn(() => `/supplier-payments/${e.id}/void`) : ''])));
      st.append(h('div', { class: 'row' }, h('b', null, T('owed'), ': ', money(stm.balance)), h('button', { class: 'btn ghost sm', onclick: () => printNode(T('stmt') + ': ' + stm.supplier.name, st) }, T('print')), h('button', { class: 'btn ghost sm', onclick: () => { S.suppStmt = null; render(); } }, T('close'))));
      main.append(st);
    }
    const g = h('div', { class: 'grid2' });
    if (cd('supplier.manage')) {
      const n = h('input', { id: 'spName' }), ph = h('input', { id: 'spPhone', inputmode: 'tel' }), tm = h('input', { id: 'spTerms', inputmode: 'numeric', value: '30' }), ob = h('input', { id: 'spOpen', inputmode: 'decimal' });
      g.append(h('form', { class: 'card', onsubmit: guard(async (e) => { e.preventDefault(); await api('POST', sp('/suppliers'), { name: n.value, phone: ph.value || undefined, terms_days: +tm.value || 0, ...(ob.value.trim() ? { opening_balance: amt(ob.value) } : {}) }); toast(T('saved')); render(); }) },
        h('h2', null, T('addSupp')), h('div', { class: 'grid' }, field(T('name'), n), field(T('phone'), ph), field(T('termsDays'), tm), field(T('openingBal'), ob)), h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('add')))));
    }
    if (cd('supplier.pay') && sups.length) {
      const s = sel('spPay', sups.map(x => [x.id, `${x.name} (${money(x.balance)})`])), a = h('input', { id: 'spAmt', inputmode: 'decimal' }), m = sel('spMethod', [['bank', T('mBank')], ['cash', T('mCash')]]), n = h('input', { id: 'spNote' });
      g.append(h('form', { class: 'card', onsubmit: guard(async (e) => { e.preventDefault(); await api('POST', sp('/supplier-payments'), { supplier_id: +s.value, amount: amt(a.value), method: m.value, note: n.value || undefined }); toast(T('saved')); render(); }) },
        h('h2', null, T('suppPay')), h('div', { class: 'grid' }, field(T('supp'), s), field(T('amount'), a), field(T('method'), m), field(T('note'), n)), h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('save')))));
    }
    if (g.childElementCount) main.append(g);
    if (cd('report.read')) { const ag = await ageingSection('supplier'); if (ag) main.append(ag); }
  };
  async function ageingSection(type) {
    const r = await api('GET', sp(`/ageing?type=${type}`)); const m = mf(r.currency, r.cur_dec);
    const s = sec(T(type === 'customer' ? 'ageCust' : 'ageSupp') + ' — ' + T('asOf') + ' ' + fdate(r.as_of),
      r.rows.length ? table([T('party'), T('current'), T('d30'), T('d60'), T('d90'), T('over90'), T('advance'), T('balance')],
        [...r.rows.map(x => [x.name, m(x.current), m(x.d30), m(x.d60), m(x.d90), x.over90 ? h('b', { class: 'bad' }, m(x.over90)) : m(0), x.advance ? m(x.advance) : '', h('b', null, m(x.balance))]),
          [h('b', null, T('total')), ...['current', 'd30', 'd60', 'd90', 'over90', 'advance', 'balance'].map(k => h('b', null, m(r.totals[k])))]]) : h('p', { class: 'muted' }, T('noData')));
    s.append(h('div', { class: 'row' }, h('button', { class: 'btn ghost sm', onclick: () => printNode(T('ageing'), s) }, T('print'))));
    return s;
  }

  /* ================================ JOURNAL ENTRIES ================================ */
  /* everything recorded about one entry: FuelPro's own events and, for carried-over entries, the old system's copies and approvals */
  const journalHistory = guard(async (j) => {
    const rows = await api('GET', `/api/journals/${j.id}/history`);
    const body = rows.length ? rows.map(x => { const d = x.detail || {};
      const head = h('div', { class: 'row between' }, h('b', null, D['au.' + x.action] ? T('au.' + x.action) : x.action), h('span', { class: 'muted small' }, fdt(x.created_at), x.user_name ? ' · ' + x.user_name : ''));
      if (x.action !== 'm7.doc_edit') return h('div', { class: 'card' }, head, d.batch ? h('div', { class: 'muted small' }, '#' + d.batch) : null);
      return h('div', { class: 'card' }, head, h('div', { class: 'muted small' }, T('jOldCopy'), ': ', [d.book, d.ref].filter(Boolean).join(' '), d.doc_date ? ' · ' + fdate(d.doc_date) : '', d.amount != null ? ' · ' + money(d.amount) : '', d.memo ? ' · ' + d.memo : ''),
        table([T('code'), T('account'), T('debit'), T('creditCol'), T('memo')], (d.lines || []).map(l => [h('span', { class: 'ltr' }, l.acno || ''), l.name || '', l.debit ? money(l.debit) : '', l.credit ? money(l.credit) : '', l.memo || ''])));
    }) : [h('p', { class: 'muted' }, T('jHistoryNone'))];
    const m = modal(T('jHistory') + ': ' + (j.ref ? T('docNo') + ' ' + j.ref : '#' + j.id), h('div', { class: 'stack' }, ...body)); m.classList.add('wide');
  });
  F.VIEWS.acct = async (main) => {
    const opts = [['list', T('journals')]]; if (cd('journal.create')) opts.push(['new', T('newJournal')]); opts.push(['chart', T('chart')]); if (cd('period.lock')) opts.push(['lock', T('lockPeriod')]);
    main.append(tabs('acTab', opts)); const box = h('div', { class: 'stack' }); main.append(box);
    const accts = await api('GET', '/api/accounts');
    if (S.acTab === 'list') {
      const src = sel('jSrc', [['', T('all')], ...['sale', 'delivery', 'expense', 'payment', 'supplier_payment', 'cash_move', 'shift', 'stock_count', 'transfer', 'manual', 'tank_opening', 'customer_opening', 'supplier_opening', 'stock_fix', 'voucher', 'import', 'import_opening'].map(k => [k, T('src.' + k)])], S.jSrc || '');
      const st = sel('jSt', [['', T('all')], ['draft', T('js.draft')], ['posted', T('js.posted')]], S.jSt || ''), from = dateIn('jFrom', S.jFrom || monthStart()), to = dateIn('jTo', S.jTo || todayIso()), out = h('div', { class: 'stack' });
      const jq = h('input', { id: 'jQ', type: 'search', placeholder: T('jSearch'), value: S.jQ || '' }); jq.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
      const run = guard(async () => {
        S.jSrc = src.value; S.jSt = st.value; S.jFrom = from.value; S.jTo = to.value; S.jQ = jq.value;
        const js = await api('GET', sp(`/journals?from=${from.value}&to=${to.value}&limit=100${src.value ? '&source=' + src.value : ''}${st.value ? '&status=' + st.value : ''}${jq.value.trim() ? '&q=' + encodeURIComponent(jq.value.trim()) : ''}`));
        /* 25 cards first, more on request: each card is a table, and 100 at once took seconds to lay out on a phone */
        let shownN = 0; const STEP = 25, moreBox = h('div', { class: 'row noprint' });
        const card = (j) => {
          const d = j.lines.reduce((a, l) => a + l.debit, 0);
          return h('div', { class: 'card' }, h('div', { class: 'row between' }, h('div', null, h('b', null, j.ref ? T('docNo') + ' ' + j.ref : '#' + j.id, ' · ', fdate(j.business_date)), ' ', pill(j.status, T('js.' + j.status)), ' ', h('span', { class: 'chip' }, T('src.' + j.source)), j.reversed_by ? [' ', pill('closed', T('reversed'))] : null, j.reversal_of ? [' ', h('span', { class: 'muted small' }, T('reverse'), ' #', j.reversal_of)] : null,
            h('div', { class: 'muted small' }, j.memo || '', j.user_name ? ' · ' + j.user_name : '')),
            h('div', { class: 'row' }, h('button', { class: 'btn ghost sm', onclick: () => F.printJournal(j) }, '⎙ ', T('print')), h('button', { class: 'btn ghost sm', onclick: () => journalHistory(j) }, T('jHistory')), j.status === 'draft' && cd('journal.post') ? h('button', { class: 'btn sm', onclick: guard(async () => { await api('POST', `/api/journals/${j.id}/post`); toast(T('saved')); run(); }) }, T('post')) : null,
              j.status === 'draft' && cd('journal.create') ? h('button', { class: 'btn danger sm', onclick: guard(async () => { await api('DELETE', `/api/journals/${j.id}`); run(); }) }, T('delete')) : null,
              j.status === 'posted' && (j.source === 'manual' || j.source === 'import') && !j.reversed_by && !j.reversal_of && cd('journal.reverse') ? h('button', { class: 'btn ghost sm', onclick: () => F.askReason(guard(async (r) => { await api('POST', `/api/journals/${j.id}/reverse`, { reason: r }); run(); })) }, T('reverse')) : null)),
            table([T('code'), T('account'), T('note'), T('debit'), T('creditCol')], [...j.lines.map(l => [l.code, [P.lang === 'ar' ? l.name_ar : l.name_en, l.party_name ? h('div', { class: 'muted small' }, l.party_name) : null], h('span', { class: 'small' }, l.memo || ''), l.debit ? money(l.debit) : '', l.credit ? money(l.credit) : '']), ['', h('b', null, T('total')), '', h('b', null, money(d)), h('b', null, money(d))]]));
        };
        const addMore = (all) => { const next = js.slice(shownN, all === true ? js.length : shownN + STEP); shownN += next.length; moreBox.before(...next.map(card));
          const rest = js.length - shownN; moreBox.replaceChildren(...(rest > 0 ? [h('span', { class: 'muted small' }, T('shownOf', { n: shownN, m: js.length })), h('button', { class: 'btn ghost sm', onclick: addMore }, T('loadMore'), ` (+${Math.min(STEP, rest)})`),
            h('button', { class: 'btn ghost sm', 'data-expand': '1', onclick: () => addMore(true) }, T('showAllN', { n: js.length }))] : [])); };
        if (!js.length) out.replaceChildren(h('p', { class: 'muted' }, T('noData'))); else { out.replaceChildren(moreBox); addMore(); }
      });
      box.append(sec(null, h('div', { class: 'row' }, field(T('source'), src), field(T('status'), st), field(T('from'), from), field(T('to'), to), field(T('search'), jq), h('button', { class: 'btn', onclick: run }, T('run')))), out); await run();
    }
    if (S.acTab === 'new') {
      const date = dateIn('njDate', todayIso()), memo = h('input', { id: 'njMemo' }), body = h('tbody'), tot = h('div', { class: 'hint' });
      const active = accts.filter(a => a.active);
      const recalc = () => { let d = 0, c = 0; for (const tr of body.children) { d += parseDec(tr.querySelector('.dr').value || '0', dec()) || 0; c += parseDec(tr.querySelector('.cr').value || '0', dec()) || 0; }
        tot.replaceChildren(T('debit'), ': ', h('b', null, money(d)), ' · ', T('creditCol'), ': ', h('b', null, money(c)), ' · ', T('diff'), ': ', h('b', { class: d === c ? 'ok' : 'bad' }, money(d - c))); };
      const postable = active.filter(a => !a.is_group && a.sys !== 'inventory');
      const sups = cd('supplier.manage', 'supplier.pay', 'report.read') ? await api('GET', sp('/suppliers')) : [];
      const line = () => { const pc = h('span'); const pk = F.acctPicker(postable, 'acp', (a) => pc.replaceChildren(F.partySel(a, S.customers || [], sups) || ''));
        const tr = h('tr', null, h('td', null, pk, pc), h('td', null, h('input', { class: 'dr', inputmode: 'decimal', oninput: recalc })), h('td', null, h('input', { class: 'cr', inputmode: 'decimal', oninput: recalc })), h('td', null, h('input', { class: 'lm' })), h('td', null, h('button', { class: 'btn danger sm', type: 'button', onclick: () => { if (body.children.length > 2) { tr.remove(); recalc(); } } }, '✕'))); body.append(tr); };
      line(); line(); recalc();
      const save = (post) => guard(async () => {
        const lines = [...body.children].map(tr => ({ account_id: (tr.querySelector('.acp').acct || {}).id, ...(tr.querySelector('.pt') ? { party_type: tr.querySelector('.pt').dataset.type, party_id: +tr.querySelector('.pt').value || undefined } : {}), debit: tr.querySelector('.dr').value.trim() ? amt(tr.querySelector('.dr').value) : 0, credit: tr.querySelector('.cr').value.trim() ? amt(tr.querySelector('.cr').value) : 0, memo: tr.querySelector('.lm').value || undefined })).filter(l => l.debit || l.credit);
        const r = await api('POST', sp('/journals'), { date: date.value, memo: memo.value, lines, post }); toast(T(r.status === 'posted' ? 'js.posted' : 'js.draft') + ' #' + r.id); S.acTab = 'list'; render();
      });
      box.append(h('section', { class: 'card' }, h('h2', null, T('newJournal')), h('div', { class: 'grid' }, field(T('date'), date), field(T('memo'), memo)),
        h('div', { class: 'tw lines' }, h('table', null, h('thead', null, h('tr', null, [T('account'), T('debit'), T('creditCol'), T('note'), ''].map(x => h('th', null, x)))), body)),
        h('div', { class: 'row' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => line() }, T('addLine'))), tot,
        h('div', { class: 'row' }, h('button', { class: 'btn ghost', type: 'button', onclick: save(false) }, T('saveDraft')), cd('journal.post') ? h('button', { class: 'btn', type: 'button', onclick: save(true) }, T('saveAndPost')) : null)));
    }
    if (S.acTab === 'chart') { await F.treeView(box); }
    if (S.acTab === 'lock') {
      const cur = await api('GET', '/api/accounting/lock'); const d = dateIn('lkDate', cur.locked_through || '');
      box.append(h('form', { class: 'card', onsubmit: guard(async (e) => { e.preventDefault(); await api('POST', '/api/accounting/lock', { through: d.value }); toast(T('saved')); render(); }) },
        h('h2', null, T('lockPeriod')), h('p', null, cur.locked_through ? [T('lockedThrough'), ': ', h('b', null, fdate(cur.locked_through))] : T('notLocked')),
        h('div', { class: 'grid' }, field(T('lockUntil'), d)), h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('save')), cur.locked_through && cd('users.manage') ? h('button', { class: 'btn ghost', type: 'button', onclick: guard(async () => { await api('POST', '/api/accounting/lock', { through: null }); render(); }) }, T('unlock')) : null)));
    }
  };

  /* ================================ FINANCIAL STATEMENTS ================================ */
  F.VIEWS.fin = async (main) => {
    main.append(tabs('finTab', [['is', T('incomeStatement')], ['pl', T('plTitle')], ['bs', T('balanceSheet')], ['cf', T('cashFlow')], ['tb', T('trialBalance')], ['gl', T('ledger')], ['age', T('ageCust')], ['chk', T('integrity')]]));
    if (S.finTab === 'age') { { const ag = await ageingSection('customer'); if (ag) main.append(ag); } return; }
    if (S.finTab === 'tb' && F.trialView) { await F.trialView(main); return; }
    if (S.finTab === 'pl' && F.plView) { await F.plView(main); return; }
    if (S.finTab === 'chk') {
      const r = await api('GET', '/api/accounting/integrity');
      main.append(sec(T('integrity'), h('p', { class: r.ok ? 'note good' : 'note' }, r.ok ? T('allGood') : T('checkFailed')), table(['', ''], r.checks.map(c => [c.ok ? h('b', { class: 'ok' }, '✓') : h('b', { class: 'bad' }, '✗'), P.lang === 'ar' ? (c.name_ar || c.name) : c.name]))));
      return;
    }
    const scope = sel('fScope', [['st', T('thisStation')], ['org', T('wholeOrg')]], S.fScope || 'st');
    const from = dateIn('fFrom', S.fFrom || todayIso().slice(0, 5) + '01-01'), to = dateIn('fTo', S.fTo || todayIso());
    const accts = S.finTab === 'gl' ? await api('GET', '/api/accounts') : [];
    const ac = sel('fAcct', accts.filter(a => !a.is_group).map(a => [a.id, acctName(a)]), S.fAcct || (accts.find(a => a.code === '1010') || {}).id);
    const out = h('div', { class: 'stack' });
    const q = () => (scope.value === 'st' ? `station_id=${S.sid}` : `currency=${S.st.currency}`) + `&from=${from.value}&to=${to.value}`;
    const run = guard(async () => {
      S.fScope = scope.value; S.fFrom = from.value; S.fTo = to.value; S.fAcct = +ac.value || S.fAcct;
      if (S.finTab === 'is') {
        const r = await api('GET', '/api/accounting/income-statement?' + q()); const m = mf(r.currency, r.cur_dec);
        const rowsOf = (pred) => r.rows.filter(pred).map(x => [x.code, P.lang === 'ar' ? x.name_ar : x.name_en, m(x.amount)]);
        const np = F.statN(T('netProfit'), r.net_profit, m); np.classList.add(r.net_profit >= 0 ? 'good' : 'badv');
        out.replaceChildren(h('div', { class: 'grid' }, F.statN(T('revenue'), r.revenue, m), F.statN(T('grossProfit'), r.gross_profit, m), F.statN(T('opex'), r.operating_expenses, m), np),
          sec(T('incomeStatement') + ` — ${fdate(r.from)} → ${fdate(r.to)}`, table([T('code'), T('account'), T('amount')], [
            [h('b', null, T('revenue')), '', ''], ...rowsOf(x => x.sec === 'revenue'),
            [h('b', null, T('cogsL')), '', ''], ...rowsOf(x => x.sec === 'cos'), ['', h('b', null, T('grossProfit')), h('b', null, m(r.gross_profit))],
            [h('b', null, T('opex')), '', ''], ...rowsOf(x => x.sec === 'opex'),
            [h('b', null, T('otherIncome')), '', ''], ...rowsOf(x => x.sec === 'other'), ['', h('b', null, T('netProfit')), h('b', null, m(r.net_profit))]])), h('p', { class: 'hint' }, T('stmtNote')));
      }
      if (S.finTab === 'bs') {
        const r = await api('GET', '/api/accounting/balance-sheet?' + q() + `&as_of=${to.value}`); const m = mf(r.currency, r.cur_dec);
        const part = (title, rows) => [[h('b', null, title), ''], ...rows.map(x => [`${x.code} · ${P.lang === 'ar' ? x.name_ar : x.name_en}`, m(x.amount)])];
        out.replaceChildren(h('p', { class: r.balanced ? 'note good' : 'note' }, r.balanced ? T('balancedOk') : T('notBalanced')),
          h('div', { class: 'grid2' }, sec(T('assets') + ' — ' + fdate(r.as_of), table(['', T('amount')], [...part(T('assets'), r.assets), [h('b', null, T('totalAssets')), h('b', null, m(r.total_assets))]])),
            sec(T('liabilities') + ' / ' + T('equity'), table(['', T('amount')], [...part(T('liabilities'), r.liabilities), ...part(T('equity'), r.equity), [T('currentEarnings'), m(r.current_earnings)], [h('b', null, T('totalLE')), h('b', null, m(r.total_liabilities + r.total_equity))]]))), h('p', { class: 'hint' }, T('stmtNote')));
      }
      if (S.finTab === 'cf') {
        const r = await api('GET', '/api/accounting/cash-flow?' + q()); const m = mf(r.currency, r.cur_dec);
        const nm = (x) => P.lang === 'ar' ? x.name_ar : x.name_en;
        const part = (key, title, always) => { const s = r[key]; if (!always && !s.rows.length) return [];
          return [[h('b', null, title), '', ''], ...s.rows.map(x => [x.code, nm(x), m(x.amount)]),
            ['', T('cfIn') + ' / ' + T('cfOut'), `${m(s.inflow)} / ${m(s.outflow)}`], ['', h('b', null, T('cfNetOf') + ' — ' + title), h('b', null, m(s.total))]]; };
        const net = F.statN(T('cfNet'), r.net_change, m); net.classList.add(r.net_change >= 0 ? 'good' : 'badv');
        out.replaceChildren(h('p', { class: r.reconciled ? 'note good' : 'note' }, r.reconciled ? T('cfOk') : T('cfBad')),
          h('div', { class: 'grid' }, F.statN(T('cfOpenCash'), r.opening_cash, m), F.statN(T('cfOperating'), r.operating.total, m), net, F.statN(T('cfCloseCash'), r.closing_cash, m)),
          sec(T('cashFlow') + ` — ${fdate(r.from)} → ${fdate(r.to)}`, table([T('code'), T('account'), T('amount')], [
            ['', h('b', null, T('cfOpenCash')), h('b', null, m(r.opening_cash))],
            ...part('operating', T('cfOperating'), true), ...part('investing', T('cfInvesting'), true), ...part('financing', T('cfFinancing'), true),
            ...part('opening', T('cfOpening')), ...part('fx', T('cfFx')),
            ['', h('b', null, T('cfNet')), h('b', null, m(r.net_change))], ['', h('b', null, T('cfCloseCash')), h('b', null, m(r.closing_cash))]])),
          sec(T('cfBoxes'), table([T('code'), T('account'), T('openingCol'), T('cfNetOf'), T('closingCol')], [
            ...r.boxes.map(b => [b.code, nm(b), m(b.opening), m(b.change), m(b.closing)]),
            ['', h('b', null, T('total')), h('b', null, m(r.opening_cash)), h('b', null, m(r.net_change)), h('b', null, m(r.closing_cash))]])),
          h('p', { class: 'hint' }, T('cfNote')));
        const exp = h('button', { class: 'btn ghost sm', onclick: () => csv(`cash-flow-${r.from}_${r.to}.csv`, ['section', 'code', 'account', 'amount'],
          ['operating', 'investing', 'financing', 'opening', 'fx'].flatMap(k => r[k].rows.map(x => [k, x.code, x.name_en, (x.amount / 10 ** r.cur_dec).toFixed(r.cur_dec)]))) }, 'CSV');
        out.append(h('div', { class: 'row' }, exp));
      }
      if (S.finTab === 'tb') {
        const r = await api('GET', '/api/accounting/trial-balance?' + q()); const m = mf(r.currency, r.cur_dec); const z = (v) => v ? m(v) : '';
        out.replaceChildren(h('p', { class: r.balanced ? 'note good' : 'note' }, r.balanced ? T('balancedOk') : T('notBalanced')),
          sec(T('trialBalance') + ` — ${fdate(r.from)} → ${fdate(r.to)}`, table([T('code'), T('account'), T('openingCol') + ' ' + T('debit'), T('openingCol') + ' ' + T('creditCol'), T('periodCol') + ' ' + T('debit'), T('periodCol') + ' ' + T('creditCol'), T('closingCol') + ' ' + T('debit'), T('closingCol') + ' ' + T('creditCol')],
            [...r.rows.map(x => [x.code, P.lang === 'ar' ? x.name_ar : x.name_en, z(x.opening_dr), z(x.opening_cr), z(x.debit), z(x.credit), z(x.closing_dr), z(x.closing_cr)]),
              ['', h('b', null, T('total')), ...['opening_dr', 'opening_cr', 'debit', 'credit', 'closing_dr', 'closing_cr'].map(k => h('b', null, m(r.totals[k])))]])));
        const exp = h('button', { class: 'btn ghost sm', onclick: () => csv(`trial-balance-${r.from}_${r.to}.csv`, ['code', 'account', 'opening_dr', 'opening_cr', 'debit', 'credit', 'closing_dr', 'closing_cr'], r.rows.map(x => [x.code, x.name_en, ...['opening_dr', 'opening_cr', 'debit', 'credit', 'closing_dr', 'closing_cr'].map(k => (x[k] / 10 ** r.cur_dec).toFixed(r.cur_dec))])) }, 'CSV');
        out.append(h('div', { class: 'row' }, exp));
      }
      if (S.finTab === 'gl') {
        const r = await api('GET', `/api/accounting/ledger?${q()}&account_id=${ac.value}`); const m = mf(r.currency, r.cur_dec);
        let showN = 500;   // the first 500 lines, then more on request (opening and closing balances always shown)
        const drawGl = () => { const rest = r.lines.length - Math.min(showN, r.lines.length);
          out.replaceChildren(sec(acctName(r.account) + ` — ${fdate(r.from)} → ${fdate(r.to)}`, table([T('date'), T('source'), T('memo'), T('debit'), T('creditCol'), T('runningBal')],
            [['', h('b', null, T('openingCol')), '', '', '', h('b', null, m(r.opening))], ...r.lines.slice(0, showN).map(l => [fdate(l.business_date), T('src.' + l.source) + (l.source_id ? ' #' + l.source_id : ''), l.jmemo || '', l.debit ? m(l.debit) : '', l.credit ? m(l.credit) : '', m(l.balance)]),
              ['', h('b', null, T('closingCol')), '', '', '', h('b', null, m(r.closing))]]),
            rest > 0 ? h('div', { class: 'row noprint' }, h('span', { class: 'muted small' }, T('shownOf', { n: showN, m: r.lines.length })), h('button', { class: 'btn ghost sm', onclick: () => { showN += 500; drawGl(); } }, T('loadMore'), ` (+${Math.min(500, rest)})`),
              h('button', { class: 'btn ghost sm', 'data-expand': '1', onclick: () => { showN = Infinity; drawGl(); } }, T('showAllN', { n: r.lines.length }))) : null), r.lines.length >= 5000 ? h('p', { class: 'hint' }, '5000+') : ''); };
        drawGl();
      }
    });
    main.append(sec(null, h('div', { class: 'row' }, field(T('scope'), scope), S.finTab !== 'bs' ? field(T('from'), from) : null, field(S.finTab === 'bs' ? T('asOf') : T('to'), to), S.finTab === 'gl' ? field(T('account'), ac) : null,
      h('button', { class: 'btn', onclick: run }, T('run')), h('button', { class: 'btn ghost sm', onclick: () => printNode(T(({ is: 'incomeStatement', bs: 'balanceSheet', cf: 'cashFlow', tb: 'trialBalance', gl: 'ledger' })[S.finTab]), out) }, T('print')))), out);
    await run();
  };

  /* ================================ USERS & ROLES ================================ */
  F.VIEWS.users = async (main) => {
    const users = await api('GET', '/api/users'); const stName = (id) => (S.stations.find(s => s.id === id) || {}).name || '#' + id;
    const stationBoxes = (prefix, chosen) => h('div', { class: 'chips' }, S.stations.map(s => h('label', { class: 'check' }, h('input', { type: 'checkbox', class: prefix, value: s.id, checked: chosen.includes(s.id) }), s.name)));
    const editUser = (u) => {
      const role = sel('euRole', ROLE_LIST.filter(r => r !== 'admin' || S.user.role === 'owner').map(r => [r, T(r)]), u.role), boxes = stationBoxes('eus', u.station_ids);
      const m = modal(T('editAccess') + ': ' + u.name, h('form', { onsubmit: guard(async (e) => { e.preventDefault(); const ids = [...m.querySelectorAll('.eus:checked')].map(x => +x.value); await api('PATCH', '/api/users/' + u.id, { role: role.value, station_ids: ids }); m.remove(); toast(T('saved')); render(); }) },
        field(T('role'), role), h('label', null, T('stations')), boxes, h('p', { class: 'hint' }, T('roleHelp')), h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('save')))));
    };
    const activateOld = (u) => {
      const em = h('input', { type: 'email', required: true }), pw = h('input', { type: 'password', autocomplete: 'new-password', required: true }), role = sel('auRole', ROLE_LIST.filter(r => r !== 'admin' || S.user.role === 'owner').map(r => [r, T(r)]), 'cashier'), boxes = stationBoxes('aus', [S.sid]);
      const m = modal(T('activate') + ': ' + u.name, h('form', { onsubmit: guard(async (ev) => { ev.preventDefault(); const ids = [...m.querySelectorAll('.aus:checked')].map(x => +x.value);
        await api('PATCH', '/api/users/' + u.id, { email: em.value, password: pw.value, role: role.value, station_ids: ids, active: true }); m.remove(); toast(T('saved')); render(); }) },
        h('p', { class: 'hint' }, T('activateHelp')), field(T('email'), em), field(T('password'), pw), field(T('role'), role), h('label', null, T('stations')), boxes, h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('activate')))));
    };
    const seen = (x) => x.online ? h('span', { class: 'pill ok-pill' }, T('onlineNow'))
      : x.sessions ? h('span', { class: 'muted small' }, T('lastSeen', { t: fdt(x.last_seen_at) })) : h('span', { class: 'muted' }, '—');
    const signOut = (x) => guard(async () => { if (!confirm(T('signOutConfirm', { u: x.name }))) return; const r = await api('POST', `/api/users/${x.id}/signout`); toast(T('signedOutN', { n: r.sessions })); render(); });
    main.append(sec(T('users'), table([T('name'), T('email'), T('role'), T('stations'), T('tfa'), T('lastLogin'), T('uStatus'), ''], users.map(x => [x.name, /@old-system\.invalid$/i.test(x.email) ? h('span', { class: 'chip' }, T('oldUser')) : h('span', { class: 'ltr' }, x.email), T(x.role),
      ['owner', 'admin'].includes(x.role) ? h('span', { class: 'muted' }, T('allStations')) : x.station_ids.map(stName).join('، '),
      x.totp_enabled ? h('span', { class: 'pill ok-pill' }, T('tfaOn')) : h('span', { class: 'muted' }, T('tfaOff')),
      x.last_login_at ? h('span', null, fdt(x.last_login_at), x.last_login_device ? h('div', { class: 'muted small' }, x.last_login_device) : null) : h('span', { class: 'muted' }, T('neverIn')),
      h('span', null, seen(x), x.sessions > 1 ? h('div', { class: 'muted small' }, T('sessionsN', { n: x.sessions })) : null),
      x.role === 'owner' || x.id === S.user.id ? '' : /@old-system\.invalid$/i.test(x.email) ? h('button', { class: 'btn sm', onclick: () => activateOld(x) }, T('activate')) : h('div', { class: 'row' }, h('button', { class: 'btn ghost sm', onclick: () => editUser(x) }, T('editAccess')),
        h('button', { class: 'btn ghost sm', onclick: guard(async () => { await api('PATCH', '/api/users/' + x.id, { active: !x.active }); render(); }) }, x.active ? T('disable') : T('enable')),
        x.sessions ? h('button', { class: 'btn ghost sm', onclick: signOut(x) }, T('signOutAll')) : null,
        x.totp_enabled ? h('button', { class: 'btn ghost sm', onclick: guard(async () => { await api('PATCH', '/api/users/' + x.id, { reset_2fa: true }); toast(T('saved')); render(); }) }, T('reset2fa')) : null)])), h('p', { class: 'hint' }, T('roleHelp'))));
    main.append(await loginHistorySection(users));
    const n = h('input', { id: 'nuName' }), e = h('input', { id: 'nuEmail', type: 'email' }), pw = h('input', { id: 'nuPass', type: 'password', autocomplete: 'new-password' }), role = sel('nuRole', ROLE_LIST.filter(r => r !== 'admin' || S.user.role === 'owner').map(r => [r, T(r)]), 'cashier');
    const boxes = stationBoxes('nus', [S.sid]);
    main.append(h('form', { class: 'card', onsubmit: guard(async (ev) => { ev.preventDefault(); const ids = [...main.querySelectorAll('.nus:checked')].map(x => +x.value); await api('POST', '/api/users', { name: n.value, email: e.value, password: pw.value, role: role.value, station_ids: ids }); toast(T('saved')); render(); }) },
      h('h2', null, T('addUser')), h('div', { class: 'grid' }, field(T('name'), n), field(T('email'), e), field(T('password'), pw), field(T('role'), role)), h('label', null, T('stations')), boxes, h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('add')))));
  };

  /* sign-in history (owner/admin): who signed in or out, failed attempts, when, from which device and address */
  async function loginHistorySection(users) {
    const who = sel('lhUser', [['', T('allUsers')], ...users.map(u => [u.id, u.name])], '');
    const kind = sel('lhKind', [['', T('allEvents')], ...['login', 'logout', 'failed', 'signed_out'].map(k => [k, T('ev_' + k)])], '');
    const to = h('input', { id: 'lhTo', type: 'date', value: todayIso() });
    const from = h('input', { id: 'lhFrom', type: 'date', value: new Date(Date.parse(todayIso() + 'T12:00:00Z') - 6 * 864e5).toISOString().slice(0, 10) });
    const out = h('div');
    let rows = [], more = false;
    const detail = (r) => r.kind === 'failed' && r.reason ? T('rs_' + r.reason) : r.kind === 'signed_out' && r.reason ? T('rsBy', { u: r.reason }) : '';
    const pill = (k) => h('span', { class: 'pill ' + (k === 'login' ? 'ok-pill' : k === 'failed' ? 'bad-pill' : '') }, T('ev_' + k));
    const draw = () => out.replaceChildren(rows.length ? table([T('time'), T('name'), T('evKind'), '', T('device'), T('ipAddr')],
      rows.map(r => [fdt(r.at), r.name, pill(r.kind), h('span', { class: 'muted small' }, detail(r)), r.device || '—', h('span', { class: 'ltr' }, r.ip || '—')])) : h('p', { class: 'muted' }, T('noLogins')),
      more ? h('div', { class: 'row noprint' }, h('button', { class: 'btn ghost sm', onclick: guard(() => load(true)) }, T('loadMore'))) : null);
    const load = async (next) => {
      const q = new URLSearchParams({ limit: '200' });
      if (who.value) q.set('user_id', who.value); if (kind.value) q.set('kind', kind.value);
      if (from.value) q.set('from', from.value); if (to.value) q.set('to', to.value);
      if (next && rows.length) q.set('before', String(rows[rows.length - 1].id));
      const page = await api('GET', '/api/users/logins?' + q);
      rows = next ? rows.concat(page) : page; more = page.length === 200; draw();
    };
    // the server keeps UTC days; the list is shown in the station's time (fdt)
    const s = sec(T('loginHistory'), h('p', { class: 'hint' }, T('loginHistoryHint')),
      h('div', { class: 'row noprint' }, field(T('name'), who), field(T('evKind'), kind), field(T('from'), from), field(T('to'), to),
        h('button', { class: 'btn', onclick: guard(() => load(false)) }, T('run')), h('button', { class: 'btn ghost sm', onclick: () => printNode(T('loginHistory'), out) }, T('print'))), out);
    await load(false);
    return s;
  }

  /* customers: add ageing below the existing customer screen */
  const custView = F.VIEWS.cust;
  F.VIEWS.cust = async (main) => { await custView(main); if (!S.stmt && cd('report.read')) { const ag = await ageingSection('customer'); if (ag) main.append(ag); } };

  F.boot();
})();
