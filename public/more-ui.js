'use strict';
/* FuelPro extra screens: daily station report, cash & bank boxes, collections follow-up, journal book, year-end closing.
   Uses window.FP from app.js and the print helpers from books-ui.js; the server checks every permission again. */
(function () {
  const F = window.FP; if (!F) return;
  const { h, T, P, S, api, sp, guard, toast, field, sel, table, sec, modal, render, cd, vol, volNum, dec, fdate, todayIso, csv, priceShow } = F;
  const nf = (v) => { const d = dec(), dd = Math.min(d, S.st.disp_dec ?? d); return new Intl.NumberFormat('en-US', { minimumFractionDigits: dd, maximumFractionDigits: dd }).format((v || 0) / 10 ** d); };
  const nf0 = (v, d = 2) => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }).format((v || 0) / 10 ** d);
  const dateIn = (id, v) => h('input', { id, type: 'date', value: v, max: todayIso() });
  const monthStart = () => todayIso().slice(0, 8) + '01';
  const addDay = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const slash = (d) => String(d || '').replace(/-/g, '/');
  const brand = async () => { if (!S.brand && F.loadBrand) await F.loadBrand(); };
  const foot = () => h('div', { class: 'pf' }, h('span', null, (S.brand && S.brand.footer) || ''), h('span', null, T('printedOn'), ': ', F.fdt(new Date().toISOString().slice(0, 19).replace('T', ' ')), S.user ? ' · ' + S.user.name : ''));
  const signs = (...ks) => h('div', { class: 'signs' }, ks.map(k => h('div', null, T(k))));
  const tile = (k, v, cls) => h('div', { class: 'xtile ' + (cls || '') }, h('span', null, k), h('b', null, v));
  /** A bordered statement-style table: cols = [[label, numeric?]], rows = arrays of cells, foot = array of cells (or null). */
  const grid = (cols, rows, footRow, forPrint, rowCls) => h('div', { class: forPrint ? 'tw-print' + (rows.length <= 14 ? ' keep' : '') : 'tw' }, h('table', { class: 'stmt' },
    h('thead', null, h('tr', null, cols.map(([c, n]) => h('th', { class: n ? 'num' : '' }, c)))),
    h('tbody', null, rows.length ? rows.map((r, i) => h('tr', { class: rowCls ? rowCls(i) || '' : '' }, r.map((c, j) => h('td', { class: cols[j] && cols[j][1] ? 'num' : '' }, c ?? '')))) : h('tr', null, h('td', { colspan: cols.length, class: 'muted' }, T('noData')))),
    footRow ? h('tfoot', null, h('tr', null, footRow.map(c => Array.isArray(c) && c.colspan ? h('td', { colspan: c.colspan }, c[0]) : h('td', { class: 'num' }, c ?? '')))) : null));
  const span = (n, v) => { const a = [v]; a.colspan = n; return a; };
  const goStmt = (accountId) => { S.acctStmt = accountId; location.hash = '#stm'; };
  const goCust = (id) => { S.stmt = id; location.hash = '#cust'; };

  /* the letterhead must be ready before anything is printed */
  let brandTried = false;
  new MutationObserver(() => { if (!brandTried && S.user && !S.brand && F.loadBrand) { brandTried = true; F.loadBrand(); } }).observe(document.body, { childList: true, subtree: true });

  /* ================================ DAILY STATION REPORT (التقرير اليومي) ================================ */
  F.VIEWS.day = async (main) => {
    const d = dateIn('dyDate', S.dyDate || todayIso()); const out = h('div', { class: 'stack' }); let r = null;
    const body = (forPrint) => {
      const t = r.totals, m = r.meters;
      const parts = [
        h('div', { class: 'xtiles' }, tile(T('volSold'), vol(t.qty_ml, 0)), tile(T('sales'), nf(t.amount)), tile(T('cashSales'), nf(t.cash)), tile(T('creditSales'), nf(t.credit)), tile(T('grossProfit'), nf(t.gross_profit), 'gold')),
        h('h3', { class: 'xh' }, T('salesByFuel')),
        grid([[T('fuel')], [T('qty'), 1], [T('price', { u: F.uLbl() }), 1], [T('cashSales'), 1], [T('creditSales'), 1], [T('total'), 1], [T('grossProfit'), 1]],
          r.fuels.map(f => [h('b', null, f.fuel_name), volNum(f.qty_ml, 2), priceShow(f.price_e4), nf(f.cash), f.credit ? nf(f.credit) : '', h('b', null, nf(f.amount)), nf(f.amount - (f.cogs || 0))]),
          r.fuels.length > 1 ? [span(1, T('total')), volNum(t.qty_ml, 2), '', nf(t.cash), nf(t.credit), nf(t.amount), nf(t.gross_profit)] : null, forPrint)
      ];
      if (m && m.pumps.length) parts.push(h('h3', { class: 'xh' }, T('mtr')), grid([[T('pump')], [T('fuel')], [T('openMeter'), 1], [T('closeMeterCol'), 1], [T('qty'), 1], [T('total'), 1]],
        m.pumps.map(p => [p.pump_name, p.fuel_name, volNum(p.open_ml, 3), volNum(p.close_ml, 3), volNum(p.qty_ml, 3), nf(p.amount)]), [span(4, T('total')), volNum(m.qty_ml, 3), nf(m.amount)], forPrint));
      if (r.credit.length) parts.push(h('h3', { class: 'xh' }, T('creditByCust')), grid([['#'], [T('acctNo')], [T('customer')], [T('fuel')], [T('qty'), 1], [T('amount'), 1], [T('note')]],
        r.credit.map((c, i) => [String(i + 1), h('span', { class: 'ltr-num' }, c.ref || ''), h('b', null, c.customer_name), c.fuel_name, volNum(c.qty_ml, 2), nf(c.amount), h('span', { class: 'small' }, (c.note || '').split(',').slice(0, 3).join(' · '))]),
        [span(5, T('total')), nf(t.credit), ''], forPrint));
      if (r.moves.length) parts.push(h('h3', { class: 'xh' }, T('boxMoves')), grid([[T('docType')], [T('docNo')], [T('boxCol')], [T('counterAcct')], [T('memo')], [T('moneyIn'), 1], [T('moneyOut'), 1]],
        r.moves.map(x => [x.doc_type || T('src.' + x.source), h('span', { class: 'ltr-num' }, x.ref || ''), x.box_name || '', h('span', null, x.party_name || x.account_name, x.party_name ? h('small', { class: 'muted' }, ' · ' + x.account_name) : null), h('span', { class: 'small' }, x.memo || ''),
          x.amount_in ? h('b', { class: 'ok' }, nf(x.amount_in)) : '', x.amount_out ? h('b', { class: 'bad' }, nf(x.amount_out)) : '']),
        [span(5, T('total')), nf(t.receipts), nf(t.payments)], forPrint));
      if (r.expenses.length) parts.push(h('h3', { class: 'xh' }, T('exp')), grid([[T('category')], [T('note')], [T('amount'), 1]], r.expenses.map(e => [T('cat.' + e.category), e.memo || '', nf(e.amount)]), [span(2, T('total')), nf(t.expenses)], forPrint));
      if (r.deliveries.length) parts.push(h('h3', { class: 'xh' }, T('pur')), grid([[T('docNo')], [T('supplierCol')], [T('fuel')], [T('qty'), 1], [T('total'), 1]], r.deliveries.map(x => [x.ref || '', x.supplier_name || '', x.fuel_name, volNum(x.quantity_ml, 2), nf(x.total)]), [span(4, T('total')), nf(t.deliveries)], forPrint));
      if (r.boxes.length) parts.push(h('h3', { class: 'xh' }, T('box')), grid([[T('code')], [T('boxCol')], [T('openingBal'), 1], [T('moneyIn'), 1], [T('moneyOut'), 1], [T('closingBal'), 1]],
        r.boxes.map(b => [h('span', { class: 'ltr-num' }, b.code), h('span', null, b.name_ar, b.fc ? h('small', { class: 'muted' }, ` · ${nf0(b.fc.closing)} ${b.currency}`) : null), nf(b.opening), b.debit ? nf(b.debit) : '', b.credit ? nf(b.credit) : '', h('b', null, nf(b.closing))]), null, forPrint));
      if (r.tanks.length) parts.push(h('h3', { class: 'xh' }, T('tankLevels')), grid([[T('tank')], [T('fuel')], [T('openingQty'), 1], [T('received'), 1], [T('soldQty'), 1], [T('closingQty'), 1]],
        r.tanks.map(k => [k.tank_name, k.fuel_name, volNum(k.opening_ml, 0), k.in_ml ? volNum(k.in_ml, 0) : '', k.out_ml ? volNum(k.out_ml, 0) : '', h('b', null, volNum(k.closing_ml, 0))]), null, forPrint));
      return parts;
    };
    const run = guard(async () => { S.dyDate = d.value; r = await api('GET', sp('/reports/daily?date=' + d.value)); out.replaceChildren(sec(h('span', null, T('dayReport'), ' — ', fdate(r.date)), ...body(false))); });
    const step = (n) => () => { const v = addDay(d.value || todayIso(), n); if (v > todayIso()) return; d.value = v; run(); };
    const doPrint = async () => { if (!r) return; await brand(); F.printDoc(`${T('dayReport')} ${r.date}`, h('div', { class: 'a4 xdoc' }, F.letterhead(T('dayReport'), slash(r.date)), ...body(true), signs('cashierSig', 'accountantSig', 'managerSig'), foot())); };
    main.append(sec(T('day'), h('div', { class: 'row' }, h('button', { class: 'btn ghost sm', onclick: step(-1) }, '→ ', T('prevDay')), field(T('date'), d), h('button', { class: 'btn ghost sm', onclick: step(1) }, T('nextDay'), ' ←'),
      h('button', { class: 'btn', onclick: run }, T('run')), h('button', { class: 'btn gold-btn', onclick: doPrint }, '⎙ ', T('printPdf')))), out);
    await run();
  };

  /* ================================ CASH & BANK BOXES (حركة الصناديق والبنوك) ================================ */
  F.VIEWS.box = async (main) => {
    const from = dateIn('bxFrom', S.bxFrom || monthStart()), to = dateIn('bxTo', S.bxTo || todayIso()); const out = h('div', { class: 'stack' }); let r = null;
    const tbl = (forPrint) => grid([[T('code')], [T('boxCol')], [T('openingBal'), 1], [T('moneyIn'), 1], [T('moneyOut'), 1], [T('closingBal'), 1], [T('inCur'), 1], forPrint ? null : ['']].filter(Boolean),
      r.boxes.map(b => [h('span', { class: 'ltr-num' }, b.code), h('b', null, b.name_ar), nf(b.opening), b.debit ? nf(b.debit) : '', b.credit ? nf(b.credit) : '',
        h('b', { class: b.closing < 0 ? 'bad' : '' }, nf(b.closing)), b.fc ? h('span', { class: 'ltr-num' }, nf0(b.fc.closing), ' ', b.currency) : '',
        forPrint ? null : h('span', { class: 'nowrap' }, h('button', { class: 'btn ghost sm', onclick: () => days(b) }, T('byDay')), ' ', h('button', { class: 'btn ghost sm', onclick: () => goStmt(b.account_id) }, T('stmtShort')))].filter(x => x !== null)),
      [span(2, T('total') + ' (' + r.boxes.length + ')'), nf(r.totals.opening), nf(r.totals.debit), nf(r.totals.credit), nf(r.totals.closing), '', forPrint ? null : ''].filter(x => x !== null), forPrint, (i) => r.boxes[i].closing < 0 ? 'over' : '');
    const days = guard(async (b) => {
      const x = await api('GET', sp(`/reports/boxes?from=${from.value}&to=${to.value}&box_account_id=${b.account_id}`));
      const t = (pr) => grid([[T('date')], [T('moneyIn'), 1], [T('moneyOut'), 1], [T('movesN'), 1], [T('balance'), 1]],
        [[T('openingBal'), '', '', '', h('b', null, nf(b.opening))], ...x.days.map(d => [pr ? slash(d.date) : fdate(d.date), d.debit ? nf(d.debit) : '', d.credit ? nf(d.credit) : '', String(d.moves), h('b', null, nf(d.balance))])],
        [span(1, T('total')), nf(b.debit), nf(b.credit), '', nf(b.closing)], pr);
      const m = modal(`${b.code} · ${b.name_ar}`, h('div', { class: 'stack' }, t(false), h('div', { class: 'row' }, h('button', { class: 'btn gold-btn', onclick: async () => { await brand(); m.remove();
        F.printDoc(`${b.name_ar} ${x.from}_${x.to}`, h('div', { class: 'a4 xdoc' }, F.letterhead(T('boxDays') + ': ' + b.name_ar, slash(x.from) + ' — ' + slash(x.to)), t(true), signs('cashierSig', 'accountantSig', 'managerSig'), foot())); } }, '⎙ ', T('printPdf')),
        h('button', { class: 'btn ghost', onclick: () => { m.remove(); goStmt(b.account_id); } }, T('stmt'))))); m.classList.add('wide');
    });
    const run = guard(async () => { S.bxFrom = from.value; S.bxTo = to.value; r = await api('GET', sp(`/reports/boxes?from=${from.value}&to=${to.value}`));
      const cashT = r.boxes.filter(b => b.kind !== 'bank' && !b.currency).reduce((s, b) => s + b.closing, 0), bankT = r.boxes.filter(b => b.kind === 'bank' && !b.currency).reduce((s, b) => s + b.closing, 0);
      out.replaceChildren(h('div', { class: 'xtiles' }, tile(T('openingBal'), nf(r.totals.opening)), tile(T('moneyIn'), nf(r.totals.debit)), tile(T('moneyOut'), nf(r.totals.credit)), tile(T('closingBal'), nf(r.totals.closing), 'gold')),
        h('p', { class: 'hint' }, T('boxKindCash'), ': ', h('b', null, nf(cashT)), ' · ', T('boxKindBank'), ': ', h('b', null, nf(bankT)), ' · ', r.boxes.filter(b => b.fc).map(b => `${b.name_ar}: ${nf0(b.fc.closing)} ${b.currency}`).join(' · ')), tbl(false)); });
    const doPrint = async () => { if (!r) return; await brand(); F.printDoc(`${T('boxesReport')} ${r.from}_${r.to}`, h('div', { class: 'a4 xdoc' }, F.letterhead(T('boxesReport'), slash(r.from) + ' — ' + slash(r.to)), tbl(true), signs('cashierSig', 'accountantSig', 'managerSig'), foot())); };
    main.append(sec(T('box'), h('p', { class: 'hint' }, T('boxHelp')), h('div', { class: 'row' }, field(T('from'), from), field(T('to'), to), h('button', { class: 'btn', onclick: run }, T('run')), h('button', { class: 'btn gold-btn', onclick: doPrint }, '⎙ ', T('printPdf')))), out);
    await run();
  };

  /* ================================ COLLECTIONS FOLLOW-UP (متابعة التحصيل) ================================ */
  F.VIEWS.col = async (main) => {
    const dd = h('input', { type: 'number', min: 0, max: 3650, class: 'yr', value: S.colDays ?? 0 }), q = h('input', { type: 'search', placeholder: T('searchParty'), value: S.colQ || '' });
    const ov = h('input', { type: 'checkbox', checked: !!S.colOver }); const out = h('div', { class: 'stack' }); let r = null;
    const rows = () => r.rows.filter(c => (!q.value.trim() || c.name.includes(q.value.trim()) || (c.ref || '').startsWith(q.value.trim())) && (!ov.checked || c.over_limit));
    const tbl = (forPrint) => { const list = rows();
      const ph = list.some(c => c.phone), lim = list.some(c => c.credit_limit);
      const cols = [['#'], [T('acctNo')], [T('customer')], ph ? [T('phone')] : null, [T('balance'), 1], lim ? [T('creditLimit'), 1] : null, [T('lastSale')], [T('lastPay')], [T('lastPayAmt'), 1], [T('daysSince'), 1], forPrint ? null : ['']];
      const keep = cols.map(c => c !== null);
      const pick = (arr) => arr.filter((_, i) => keep[i]);
      return grid(cols.filter(Boolean),
        list.map((c, i) => pick([String(i + 1), h('span', { class: 'ltr-num' }, c.ref || ''), h('b', null, c.name), h('span', { class: 'ltr-num' }, c.phone || ''), h('b', null, nf(c.balance)), c.credit_limit ? nf(c.credit_limit) : '—',
          c.last_debit ? slash(c.last_debit) : '', c.last_credit ? slash(c.last_credit) : h('span', { class: 'bad' }, T('neverPaid')), c.last_credit_amount ? nf(c.last_credit_amount) : '',
          h('span', { class: 'nb ' + c.band }, c.days_since_payment ?? '—'), h('button', { class: 'btn ghost sm nowrap', onclick: () => goCust(c.id) }, T('stmtShort'))])),
        [span(3 + (ph ? 1 : 0), T('total') + ' (' + list.length + ')'), nf(list.reduce((s, c) => s + c.balance, 0)), ...Array(4 + (lim ? 1 : 0) + (forPrint ? 0 : 1)).fill('')], forPrint, (i) => list[i].over_limit ? 'over' : '');
    };
    const draw = () => { S.colQ = q.value; S.colOver = ov.checked; out.replaceChildren(
      h('div', { class: 'xtiles' }, tile(T('totalOwed'), nf(r.total), 'gold'), tile(T('band1'), nf(r.bands.b1)), tile(T('band2'), nf(r.bands.b2)), tile(T('band3'), nf(r.bands.b3)), tile(T('band4'), nf(r.bands.b4), 'red'), tile(T('overLimit'), String(r.over_limit))), tbl(false)); };
    const run = guard(async () => { S.colDays = +dd.value || 0; r = await api('GET', sp('/reports/collections?days=' + (+dd.value || 0))); draw(); });
    q.addEventListener('input', () => r && draw()); ov.onchange = () => r && draw();
    const doPrint = async () => { if (!r) return; await brand(); F.printDoc(`${T('colReport')} ${r.as_of}`, h('div', { class: 'a4 wide-doc xdoc' }, F.letterhead(T('colReport'), T('asOf') + ' ' + slash(r.as_of) + (r.days ? ' · ' + T('noPayFor') + ' ' + r.days : '')), tbl(true), signs('accountantSig', 'managerSig'), foot())); };
    const exp = () => r && csv(`collections-${r.as_of}.csv`, ['ref', 'name', 'phone', 'balance', 'credit_limit', 'last_sale', 'last_payment', 'last_payment_amount', 'days_since'],
      rows().map(c => [c.ref || '', c.name, c.phone || '', (c.balance / 10 ** dec()).toFixed(2), (c.credit_limit / 10 ** dec()).toFixed(2), c.last_debit || '', c.last_credit || '', (c.last_credit_amount / 10 ** dec()).toFixed(2), c.days_since_payment ?? '']));
    main.append(sec(T('col'), h('p', { class: 'hint' }, T('colHelp')), h('div', { class: 'row' }, field(T('noPayFor'), dd), h('button', { class: 'btn', onclick: run }, T('run')), field(T('search'), q), h('label', { class: 'chk' }, ov, ' ', T('overLimit')),
      h('button', { class: 'btn ghost sm', onclick: exp }, 'CSV'), h('button', { class: 'btn gold-btn', onclick: doPrint }, '⎙ ', T('printPdf')))), out);
    await run();
  };

  /* ================================ JOURNAL BOOK (دفتر اليومية) ================================ */
  F.VIEWS.jbook = async (main) => {
    const from = dateIn('jbFrom', S.jbFrom || monthStart()), to = dateIn('jbTo', S.jbTo || todayIso());
    const q = h('input', { type: 'search', placeholder: T('jSearch'), value: S.jbQ || '' }); const out = h('div', { class: 'stack' }); let js = [], capped = false;
    const ty = sel('jbType', [['', T('allTypes')]], S.jbType || '');
    const MAX = 3000;
    const shown = () => js.filter(j => !ty.value || (j.doc_type || T('src.' + j.source)) === ty.value);
    const tbl = (forPrint) => { const list = shown(); let td = 0; const hn = list.some(j => j.lines.some(l => l.memo));
      const body = list.flatMap((j, n) => { const d = j.lines.reduce((s, l) => s + l.debit, 0); td += d;
        return j.lines.map((l, i) => h('tr', { class: (n % 2 ? 'zb ' : '') + (i === 0 ? 'jfirst' : '') },
          i === 0 ? h('td', { rowspan: j.lines.length, class: 'nowrap' }, forPrint ? slash(j.business_date) : fdate(j.business_date)) : null,
          i === 0 ? h('td', { rowspan: j.lines.length, class: 'ltr-num' }, j.ref || '#' + j.id) : null,
          i === 0 ? h('td', { rowspan: j.lines.length, class: 'small' }, j.doc_type || T('src.' + j.source), j.memo ? h('div', { class: 'muted' }, j.memo) : null) : null,
          h('td', { class: 'ltr-num' }, l.code), h('td', null, l.name_ar, l.party_name ? h('small', { class: 'muted' }, ' · ' + l.party_name) : null), hn ? h('td', { class: 'small' }, l.memo || '') : null,
          h('td', { class: 'num' }, l.debit ? nf(l.debit) : ''), h('td', { class: 'num' }, l.credit ? nf(l.credit) : ''))); });
      return h('div', { class: forPrint ? 'tw-print' : 'tw' }, h('table', { class: 'stmt jbook' },
        h('thead', null, h('tr', null, [T('date'), T('docNo'), T('docType'), T('code'), T('account'), hn ? T('note') : null, T('debit'), T('creditCol')].filter(x => x !== null).map((x, i, a) => h('th', { class: i >= a.length - 2 ? 'num' : '' }, x)))),
        h('tbody', null, body.length ? body : h('tr', null, h('td', { colspan: hn ? 8 : 7, class: 'muted' }, T('noData')))),
        h('tfoot', null, h('tr', null, h('td', { colspan: hn ? 6 : 5 }, T('total'), ' — ', T('entriesN'), ': ', list.length), h('td', { class: 'num' }, nf(td)), h('td', { class: 'num' }, nf(td))))));
    };
    const draw = () => { S.jbType = ty.value; out.replaceChildren(...(capped ? [h('p', { class: 'note' }, T('tooMany', { n: MAX }))] : []), tbl(false)); };
    const run = guard(async () => {
      S.jbFrom = from.value; S.jbTo = to.value; S.jbQ = q.value; js = []; capped = false; let before = '';
      for (;;) { const page = await api('GET', sp(`/journals?from=${from.value}&to=${to.value}&status=posted&limit=200${before}${q.value.trim() ? '&q=' + encodeURIComponent(q.value.trim()) : ''}`));
        js.push(...page); if (page.length < 200) break; if (js.length >= MAX) { capped = true; break; } before = '&before_id=' + page[page.length - 1].id; }
      js.sort((a, b) => a.business_date.localeCompare(b.business_date) || a.id - b.id);
      const types = [...new Set(js.map(j => j.doc_type || T('src.' + j.source)))].sort((a, b) => a.localeCompare(b, 'ar'));
      ty.replaceChildren(h('option', { value: '' }, T('allTypes')), ...types.map(t => h('option', { value: t, selected: t === S.jbType ? '' : null }, t))); draw();
    });
    ty.onchange = draw; q.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
    const doPrint = async () => { await brand(); F.printDoc(`${T('jbook')} ${from.value}_${to.value}`, h('div', { class: 'a4 wide-doc xdoc' }, F.letterhead(T('jbook'), slash(from.value) + ' — ' + slash(to.value) + (ty.value ? ' · ' + ty.value : '')), tbl(true), signs('accountantSig', 'auditorSig', 'managerSig'), foot())); };
    main.append(sec(T('jbook'), h('p', { class: 'hint' }, T('jbookHelp')), h('div', { class: 'row' }, field(T('from'), from), field(T('to'), to), field(T('docType'), ty), field(T('search'), q), h('button', { class: 'btn', onclick: run }, T('run')),
      h('button', { class: 'btn gold-btn', onclick: doPrint }, '⎙ ', T('printPdf')))), out);
    await run();
  };

  /* ================================ YEAR-END CLOSING (إقفال السنة المالية) ================================ */
  F.VIEWS.yc = async (main) => {
    const yr = h('input', { type: 'number', class: 'yr', min: 2000, max: 2100, value: S.ycYear || todayIso().slice(0, 4) }); const out = h('div', { class: 'stack' });
    const ended = (y) => todayIso() >= `${y}-12-31`;
    const run = guard(async () => { S.ycYear = yr.value; const r = await api('GET', '/api/accounting/year-close?year=' + yr.value);
      const lock = h('input', { type: 'checkbox', checked: true });
      out.replaceChildren(...r.stations.map(s => {
        const inc = s.rows.filter(x => x.type === 'income'), exp = s.rows.filter(x => x.type === 'expense');
        const lines = [...inc, ...exp].map(x => [h('span', { class: 'ltr-num' }, x.code), x.name_ar, x.balance < 0 ? nf(-x.balance) : '', x.balance > 0 ? nf(x.balance) : '']); lines.push(
          [h('span', { class: 'ltr-num' }, s.retained_account.code), h('b', null, s.retained_account.name_ar, ' — ', T('toRetained')), s.net_profit < 0 ? h('b', null, nf(-s.net_profit)) : '', s.net_profit > 0 ? h('b', null, nf(s.net_profit)) : '']);
        return sec(h('span', null, s.station_name, ' — ', s.closed ? h('span', { class: 'pill posted' }, T('ycClosed'), ' #', s.closed.id) : h('span', { class: 'pill draft' }, T('ycOpen'))),
          h('div', { class: 'xtiles' }, tile(T('incomeTotal'), nf(s.income)), tile(T('expenseTotal'), nf(s.expense)), tile(s.net_profit >= 0 ? T('netProfit') : T('netLoss'), nf(Math.abs(s.net_profit)), s.net_profit >= 0 ? 'gold' : 'red')),
          h('h3', { class: 'xh' }, T('ycPreview'), ' — 31/12/', r.year), grid([[T('code')], [T('account')], [T('debit'), 1], [T('creditCol'), 1]], lines, null, false));
      }), r.stations.some(s => s.closed)
        ? h('div', { class: 'card' }, h('div', { class: 'row' }, h('button', { class: 'btn danger', onclick: () => F.askReason(guard(async (reason) => { await api('POST', '/api/accounting/year-reopen', { year: +yr.value, reason }); toast(T('saved')); run(); })) }, T('ycReopen'))))
        : h('div', { class: 'card' }, ended(r.year) ? [h('label', { class: 'chk' }, lock, ' ', T('ycLock')), h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => confirmBox(T('ycConfirm'), guard(async () => {
            const x = await api('POST', '/api/accounting/year-close', { year: +yr.value, lock: lock.checked }); toast(T('saved') + ' · ' + x.posted); run(); })) }, T('ycDo')))] : h('p', { class: 'note' }, T('ycNotEnded'))));
    });
    main.append(sec(T('yc'), h('p', { class: 'hint' }, T('ycHelp')), h('div', { class: 'row' }, field(T('year'), yr), h('button', { class: 'btn', onclick: run }, T('run')))), out);
    await run();
  };
  function confirmBox(msg, onYes) {
    const m = modal(T('yc'), h('div', { class: 'stack' }, h('p', null, msg), h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { m.remove(); onYes(); } }, T('confirmYes')), h('button', { class: 'btn ghost', onclick: () => m.remove() }, T('cancel2')))));
  }
})();
