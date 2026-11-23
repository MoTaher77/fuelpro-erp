'use strict';
/* FuelPro books screens: receipt & payment vouchers, the account tree, and the daily meter sheet.
   Uses window.FP from app.js; the server checks every permission again. */
(function () {
  const F = window.FP; if (!F) return;
  const { h, T, P, S, api, sp, guard, toast, field, sel, table, sec, stat, modal, askReason, render, cd, money, vol, volNum, parseDec, dec, fdate, todayIso, num, csv, printNode, priceShow } = F;
  const amt = (v) => num(v, (x) => parseDec(x, dec()));
  const pill = (cls, text) => h('span', { class: 'pill ' + cls }, text);
  const nm = (a) => (P.lang === 'ar' ? a.name_ar : a.name_en) || a.name_ar;
  const acctName = (a) => `${a.code} · ${nm(a)}`;
  const dateIn = (id, v) => h('input', { id, type: 'date', value: v, max: todayIso() });
  const monthStart = () => todayIso().slice(0, 8) + '01';
  const tabs = (key, list) => { S[key] = S[key] || list[0][0]; return h('div', { class: 'tabs', role: 'tablist' }, list.map(([k, label]) => h('button', { role: 'tab', 'aria-selected': S[key] === k ? 'true' : 'false', onclick: () => { S[key] = k; render(); } }, label))); };
  let cache = { accts: null, sup: null, at: 0 };
  async function refData() {
    if (cache.accts && Date.now() - cache.at < 30_000 && cache.sid === S.sid) return cache;
    const [accts, sup] = await Promise.all([api('GET', '/api/accounts'), cd('supplier.manage', 'supplier.pay', 'report.read') ? api('GET', sp('/suppliers')) : Promise.resolve([])]);
    cache = { accts, sup, at: Date.now(), sid: S.sid }; return cache;
  }
  const bust = () => { cache.at = 0; };

  /** Searchable account box: type a code or part of the name. Calls onPick(account) when it matches. */
  function acctPicker(list, cls, onPick, initial) {
    const id = 'dl' + Math.random().toString(36).slice(2);
    const byLabel = new Map(list.map(a => [acctName(a), a]));
    const inp = h('input', { class: cls, list: id, placeholder: T('typeToSearch'), autocomplete: 'off', value: initial ? acctName(initial) : '' });
    inp.acct = initial || null;
    const pick = () => { const v = inp.value.trim(); let a = byLabel.get(v); if (!a) { const code = v.split(' ')[0]; a = list.find(x => x.code === code) || null; if (a) inp.value = acctName(a); } inp.acct = a; inp.classList.toggle('invalid', !!v && !a); onPick && onPick(a); };
    inp.addEventListener('change', pick); inp.addEventListener('blur', pick);
    return h('span', { class: 'picker' }, inp, h('datalist', { id }, list.map(a => h('option', { value: acctName(a) }))));
  }
  const partySel = (a, customers, suppliers) => {
    if (!a || (a.sys !== 'ar' && a.sys !== 'ap')) return null;
    const list = a.sys === 'ar' ? customers : suppliers;
    return h('select', { class: 'pt', 'data-type': a.sys === 'ar' ? 'customer' : 'supplier' }, h('option', { value: '' }, '— ' + T(a.sys === 'ar' ? 'customer' : 'supplierCol') + ' —'), list.map(p => h('option', { value: p.id }, p.name)));
  };

  /* ================================ VOUCHERS ================================ */
  function voucherDoc(v) {
    const rec = v.kind === 'receipt';
    return h('div', { class: 'voucher-doc' },
      h('div', { class: 'row between' }, h('h2', null, T(rec ? 'receiptV' : 'paymentV'), v.ref_no ? ' — ' + v.ref_no : ''), h('div', null, fdate(v.business_date))),
      h('dl', { class: 'kv' }, h('dt', null, T(rec ? 'intoBox' : 'fromBox')), h('dd', null, `${v.box_code} · ${P.lang === 'ar' ? v.box_name_ar : v.box_name_en}`),
        h('dt', null, T('amount')), h('dd', null, h('b', null, money(v.amount))), v.memo ? [h('dt', null, T('memo')), h('dd', null, v.memo)] : null,
        v.voided_at ? [h('dt', null, T('status')), h('dd', null, pill('closed', T('voided')), ' ', v.void_reason || '')] : null),
      table([T('account'), T(rec ? 'receivedFrom' : 'paidTo'), T('note'), T('amount')], [...v.lines.map(l => [`${l.code} · ${P.lang === 'ar' ? l.name_ar : l.name_en}`, l.party_name || '', l.memo || '', money(l.amount)]), ['', '', h('b', null, T('total')), h('b', null, money(v.amount))]]),
      h('div', { class: 'row between sign' }, h('span', null, T('preparedBy'), ': ', v.user_name || ''), h('span', null, T('receiverSig'), ': ________'), h('span', null, T('managerSig'), ': ________')));
  }
  function voucherModal(v) {
    const doc = voucherDoc(v);
    const m = modal(T(v.kind === 'receipt' ? 'receiptV' : 'paymentV') + ' #' + v.id, h('div', null, doc, h('div', { class: 'row' },
      h('button', { class: 'btn gold-btn', type: 'button', onclick: () => F.printVoucher(v) }, '⎙ ', T('printPdf')),
      !v.voided_at && cd('voucher.void') ? h('button', { class: 'btn danger', type: 'button', onclick: () => askReason(guard(async (r) => { await api('POST', sp(`/vouchers/${v.id}/void`), { reason: r }); m.remove(); toast(T('saved')); bust(); render(); })) }, T('void')) : null)));
    m.classList.add('wide');
  }
  async function voucherForm(box, kind) {
    const { accts, sup } = await refData();
    const boxes = await api('GET', '/api/boxes');
    const post = accts.filter(a => a.active && !a.is_group && a.sys !== 'inventory');
    const customers = S.customers || [];
    const bx = sel('vBox', boxes.map(b => [b.id, acctName(b)]), S.vBox || (boxes.find(b => b.sys === 'cash') || boxes[0] || {}).id);
    const date = dateIn('vDate', todayIso()), ref = h('input', { id: 'vRef', placeholder: T('autoNo') }), memo = h('input', { id: 'vMemo' }), body = h('tbody'), tot = h('div', { class: 'hint' });
    /* a box kept in a foreign currency: amounts are typed in that currency, with the day's rate */
    const curs = await api('GET', '/api/currencies').catch(() => []);
    const rate = h('input', { id: 'vRate', inputmode: 'decimal' }), rateF = field(T('rateLbl'), rate); const amtHead = h('th', null, T('amount'));
    const fcOf = () => { const b = boxes.find(x => String(x.id) === bx.value); return b && b.currency && b.currency !== S.st.currency ? b.currency : null; };
    const syncBox = () => { const c = fcOf(); rateF.hidden = !c; amtHead.textContent = c ? T('amount') + ' (' + c + ')' : T('amount'); if (c) { const cu = curs.find(x => x.code === c); rate.value = cu && cu.rate_e6 ? String(cu.rate_e6 / 1e6) : ''; } recalc(); };
    const recalc = () => { const c = fcOf(); let s = 0; for (const tr of body.children) s += parseDec(tr.querySelector('.am').value || '0', c ? 2 : dec()) || 0;
      if (c) { const r = Number(rate.value) || 0; tot.replaceChildren(T('total'), ': ', h('b', null, nf(s), ' ', c), ' × ', r, ' = ', h('b', null, money(Math.round(s * r * 10 ** dec() / 100)))); }
      else tot.replaceChildren(T('total'), ': ', h('b', null, money(s))); };
    bx.onchange = syncBox; rate.oninput = recalc;
    const line = () => {
      const pcell = h('td');
      const tr = h('tr', null, h('td', null, acctPicker(post, 'ac', (a) => { pcell.replaceChildren(partySel(a, customers, sup) || ''); })), pcell,
        h('td', null, h('input', { class: 'am', inputmode: 'decimal', oninput: recalc })), h('td', null, h('input', { class: 'lm' })),
        h('td', null, h('button', { class: 'btn danger sm', type: 'button', onclick: () => { if (body.children.length > 1) { tr.remove(); recalc(); } } }, '✕')));
      body.append(tr);
    };
    line(); recalc();
    const save = guard(async () => {
      const lines = [...body.children].map(tr => {
        const a = tr.querySelector('.ac').acct, ps = tr.querySelector('.pt'), v = tr.querySelector('.am').value.trim();
        if (!v) return null; if (!a) throw new Error(T('pickAccount'));
        const c = fcOf(); return { account_id: a.id, ...(c ? { fc_amount: num(v, (x) => parseDec(x, 2)) } : { amount: amt(v) }), memo: tr.querySelector('.lm').value || undefined, ...(ps ? { party_type: ps.dataset.type, party_id: +ps.value || undefined } : {}) };
      }).filter(Boolean);
      S.vBox = +bx.value;
      const r = await api('POST', sp('/vouchers'), { kind, box_account_id: +bx.value, date: date.value, ref_no: ref.value || undefined, memo: memo.value || undefined, lines, ...(fcOf() ? { fc_rate_e6: Math.round(Number(rate.value) * 1e6) } : {}) });
      toast(T('saved') + ' #' + r.id); bust(); S.vTab = 'list'; render();
      voucherModal(await api('GET', sp(`/vouchers/${r.id}`)));
    });
    box.append(h('section', { class: 'card' }, h('h2', null, T(kind === 'receipt' ? 'newReceipt' : 'newPayment')),
      h('p', { class: 'hint' }, T(kind === 'receipt' ? 'receiptHelp' : 'paymentHelp')),
      h('div', { class: 'grid' }, field(T(kind === 'receipt' ? 'intoBox' : 'fromBox'), bx), rateF, field(T('date'), date), field(T('refNo'), ref), field(T('memo'), memo)),
      h('div', { class: 'tw lines' }, h('table', null, h('thead', null, h('tr', null, h('th', null, T('account')), h('th', null, T('party')), amtHead, h('th', null, T('note')), h('th'))), body)),
      h('div', { class: 'row' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => line() }, T('addLine'))), tot,
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: save }, T('save')))));
    syncBox();
  }
  F.VIEWS.vch = async (main) => {
    const opts = [['list', T('vouchers')]]; if (cd('voucher.create')) opts.push(['receipt', T('newReceipt')], ['payment', T('newPayment')]);
    main.append(tabs('vTab', opts)); const box = h('div', { class: 'stack' }); main.append(box);
    if (S.vTab !== 'list') return voucherForm(box, S.vTab);
    const boxes = await api('GET', '/api/boxes');
    const kind = sel('vKind', [['', T('all')], ['receipt', T('receiptV')], ['payment', T('paymentV')]], S.vKind || ''), bx = sel('vBoxF', [['', T('all')], ...boxes.map(b => [b.id, acctName(b)])], S.vBoxF || '');
    const from = dateIn('vFrom', S.vFrom || monthStart()), to = dateIn('vTo', S.vTo || todayIso()), q = h('input', { id: 'vQ', type: 'search', value: S.vQ || '', placeholder: T('search') }), out = h('div', { class: 'stack' });
    let last = [];
    const run = guard(async () => {
      S.vKind = kind.value; S.vBoxF = bx.value; S.vFrom = from.value; S.vTo = to.value; S.vQ = q.value;
      const r = await api('GET', sp(`/vouchers?from=${from.value}&to=${to.value}&limit=200${kind.value ? '&kind=' + kind.value : ''}${bx.value ? '&box_account_id=' + bx.value : ''}${q.value.trim() ? '&q=' + encodeURIComponent(q.value.trim()) : ''}`));
      last = r.rows; const tr = r.totals.receipt || { count: 0, amount: 0 }, tp = r.totals.payment || { count: 0, amount: 0 };
      out.replaceChildren(h('div', { class: 'grid' }, F.statN(T('receiptsTotal') + ` (${tr.count})`, tr.amount, money), F.statN(T('paymentsTotal') + ` (${tp.count})`, tp.amount, money), F.statN(T('netFlow'), tr.amount - tp.amount, money)),
        r.rows.length ? table([T('date'), T('refNo'), T('kind'), T('box'), T('memo'), T('amount'), ''], r.rows.map(v => [fdate(v.business_date), v.ref_no || '#' + v.id,
          pill(v.kind === 'receipt' ? 'cash' : 'credit', T(v.kind === 'receipt' ? 'receiptV' : 'paymentV')), `${v.box_code} · ${P.lang === 'ar' ? v.box_name_ar : v.box_name_en}`,
          h('span', { class: 'small' }, v.memo || v.lines.map(l => l.party_name || (P.lang === 'ar' ? l.name_ar : l.name_en)).slice(0, 3).join('، ')),
          [v.voided_at ? h('span', { class: 'struck' }, money(v.amount)) : h('b', null, money(v.amount)), v.fc_code ? h('div', { class: 'muted small' }, nf(v.fc_amount), ' ', v.fc_code, ' @ ', v.fc_rate_e6 / 1e6) : null], h('button', { class: 'btn ghost sm', onclick: () => voucherModal(v) }, T('open'))])) : h('p', { class: 'muted' }, T('noData')),
        r.rows.length >= 200 ? h('p', { class: 'hint' }, T('first200')) : '');
    });
    const exp = h('button', { class: 'btn ghost sm', onclick: () => csv(`vouchers-${from.value}_${to.value}.csv`, ['date', 'ref', 'kind', 'box', 'memo', 'amount', 'voided'], last.map(v => [v.business_date, v.ref_no || v.id, v.kind, v.box_code, v.memo || '', (v.amount / 10 ** dec()).toFixed(dec()), v.voided_at ? 'yes' : ''])) }, 'CSV');
    box.append(sec(null, h('div', { class: 'row' }, field(T('kind'), kind), field(T('box'), bx), field(T('from'), from), field(T('to'), to), field(T('search'), q), h('button', { class: 'btn', onclick: run }, T('run')), exp)), out);
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
    await run();
  };

  /* ================================ ACCOUNT TREE ================================ */
  async function treeView(box) {
    const to = dateIn('atTo', S.atTo || todayIso()), q = h('input', { id: 'atQ', type: 'search', placeholder: T('search'), value: S.atQ || '' }), out = h('div');
    const open = S.atOpen || (S.atOpen = new Set());
    let rows = [];
    const draw = () => {
      const kids = new Map(); for (const a of rows) { const k = a.parent_id || 0; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(a); }
      const term = q.value.trim(); const hit = (a) => !term || a.code.startsWith(term) || nm(a).includes(term);
      const visible = new Set(); if (term) for (const a of rows) if (hit(a)) for (let n = a; n; n = rows.find(x => x.id === n.parent_id)) visible.add(n.id);
      const trs = [];
      const walk = (pid, depth) => { for (const a of (kids.get(pid) || [])) {
        if (term && !visible.has(a.id)) continue;
        const has = (kids.get(a.id) || []).length, isOpen = term ? true : open.has(a.id);
        if (!a.is_group && !a.debit && !a.credit && !term && S.atHideZero !== false) continue;
        trs.push(h('tr', { class: a.is_group ? 'grp-row d' + Math.min(depth, 4) : '' },
          h('td', null, h('span', { class: 'tree-lbl ind' + Math.min(depth, 8) }, has ? h('button', { class: 'tree-tg', type: 'button', 'aria-expanded': isOpen ? 'true' : 'false', onclick: () => { isOpen ? open.delete(a.id) : open.add(a.id); draw(); } }, isOpen ? '▾' : '▸') : h('span', { class: 'tree-sp' }), h('b', { class: 'mono' }, a.code), ' ', nm(a),
            a.box ? [' ', pill(a.box === 'bank' ? 'bank' : 'cash', T(a.box === 'bank' ? 'bankBox' : 'cashBox'))] : null, a.currency ? [' ', pill('credit', a.currency)] : null, a.sys ? [' ', h('span', { class: 'muted small' }, '⚙')] : null, a.active ? null : [' ', h('span', { class: 'muted small' }, T('inactive'))])),
          h('td', null, T('ty.' + a.type)), h('td', { class: 'num' }, a.debit ? money(a.debit) : ''), h('td', { class: 'num' }, a.credit ? money(a.credit) : ''),
          h('td', { class: 'num' }, a.balance ? h('b', { class: a.balance < 0 ? 'bad' : '' }, money(a.balance)) : ''),
          h('td', { class: 'nowrap' }, !a.is_group ? h('button', { class: 'btn ghost sm', onclick: () => { S.acctStmt = a.id; location.hash = '#stm'; } }, T('ledgerShort')) : '', cd('account.edit') ? [' ', h('button', { class: 'btn ghost sm', onclick: () => editAccount(a) }, T('edit'))] : null)));
        if (has && isOpen) walk(a.id, depth + 1);
      } };
      walk(0, 0);
      out.replaceChildren(h('div', { class: 'tw' }, h('table', { class: 'tree' }, h('thead', null, h('tr', null, [T('account'), T('type'), T('debit'), T('creditCol'), T('balance'), ''].map(x => h('th', null, x)))), h('tbody', null, trs))));
    };
    const run = guard(async () => { S.atTo = to.value; rows = (await api('GET', `/api/accounts/tree?to=${to.value}&station_id=${S.sid}`)).rows; if (!open.size) for (const a of rows) if (!a.parent_id) open.add(a.id); draw(); });
    const zero = h('input', { type: 'checkbox', id: 'atZero', checked: S.atHideZero !== false, onchange: (e) => { S.atHideZero = e.target.checked; draw(); } });
    q.addEventListener('input', () => { S.atQ = q.value; draw(); });
    box.append(sec(T('chart'), h('div', { class: 'row' }, field(T('asOf'), to), field(T('search'), q), h('label', { class: 'chk' }, zero, ' ', T('hideZero')),
      h('button', { class: 'btn', onclick: run }, T('run')), h('button', { class: 'btn ghost sm', onclick: () => { for (const a of rows) if (a.is_group) open.add(a.id); draw(); } }, T('expandAll')),
      h('button', { class: 'btn ghost sm', onclick: () => { open.clear(); for (const a of rows) if (!a.parent_id) open.add(a.id); draw(); } }, T('collapseAll')), h('button', { class: 'btn ghost sm', onclick: () => printNode(T('chart'), out) }, T('print'))), out));
    await run();
    if (cd('account.edit')) {
      const groups = rows.filter(a => a.is_group);
      const c = h('input', { id: 'naCode', inputmode: 'numeric' }), t = sel('naType', ['asset', 'liability', 'equity', 'income', 'expense'].map(k => [k, T('ty.' + k)]), 'expense'), ar = h('input', { id: 'naAr' }), en = h('input', { id: 'naEn' });
      const par = sel('naPar', [['', '— ' + T('rootLevel') + ' —'], ...groups.map(g => [g.id, acctName(g)])], ''), isG = h('input', { type: 'checkbox', id: 'naGrp' }), bx = sel('naBox', [['', T('none')], ['cash', T('cashBox')], ['bank', T('bankBox')]], '');
      const curList = await api('GET', '/api/currencies').catch(() => []); const cu = sel('naCur', [['', S.st.currency + ' (' + T('baseCur') + ')'], ...curList.map(c => [c.code, c.code + ' · ' + c.name_ar])], '');
      par.onchange = () => { const g = groups.find(x => String(x.id) === par.value); if (g) { t.value = g.type; if (!c.value) { const sib = rows.filter(x => x.parent_id === g.id).map(x => x.code).sort().pop(); c.value = sib && /^\d+$/.test(sib) ? String(BigInt(sib) + 1n) : g.code + '01'; } } };
      box.append(h('form', { class: 'card', onsubmit: guard(async (e) => { e.preventDefault(); await api('POST', '/api/accounts', { code: c.value, type: t.value, name_ar: ar.value, name_en: en.value || ar.value, parent_id: par.value ? +par.value : null, is_group: isG.checked, box: bx.value || null, currency: cu.value || null }); toast(T('saved')); bust(); render(); }) },
        h('h2', null, T('addAccount')), h('div', { class: 'grid' }, field(T('parentAcct'), par), field(T('code'), c), field(T('type'), t), field(T('nameAr'), ar), field(T('nameEn'), en), field(T('boxKind'), bx), field(T('currency'), cu), h('label', { class: 'chk' }, isG, ' ', T('isGroup'))),
        h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('add')))));
    }
  }
  async function editAccount(a) {
    const curList = await api('GET', '/api/currencies').catch(() => []);
    const ar = h('input', { value: a.name_ar }), en = h('input', { value: a.name_en || '', dir: 'ltr' });
    const bx = sel('eaBox', [['', T('none')], ['cash', T('cashBox')], ['bank', T('bankBox')]], a.box || ''), cu = sel('eaCur', [['', S.st.currency + ' (' + T('baseCur') + ')'], ...curList.map(c => [c.code, c.code + ' · ' + c.name_ar])], a.currency || '');
    const act = h('input', { type: 'checkbox', checked: !!a.active });
    const m = modal(T('edit') + ': ' + a.code, h('form', { onsubmit: guard(async (e) => { e.preventDefault();
      await api('PATCH', '/api/accounts/' + a.id, { name_ar: ar.value, name_en: en.value || ar.value, active: act.checked, ...(a.is_group || a.sys ? {} : { box: bx.value || null, currency: cu.value || null }) }); m.remove(); toast(T('saved')); bust(); render(); }) },
      h('div', { class: 'grid' }, field(T('nameAr'), ar), field(T('nameEn'), en), a.is_group || a.sys ? null : field(T('boxKind'), bx), a.is_group || a.sys ? null : field(T('currency'), cu), h('label', { class: 'chk' }, act, ' ', T('activeLbl'))),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('save')))));
  }
  F.treeView = treeView; F.acctPicker = acctPicker; F.partySel = partySel;


  /* ================================ LETTERHEAD ================================ */
  async function loadBrand() { try { S.brand = await api('GET', '/api/brand'); } catch { S.brand = S.brand || null; } return S.brand; }
  F.loadBrand = loadBrand;
  /** The printed head of every document: logo, name and activity, address and phones, then the document title band. */
  function letterhead(title, sub) {
    const b = S.brand || { name: S.st ? S.st.name : 'FuelPro' };
    return h('div', { class: 'lh' },
      h('div', { class: 'lh-top' },
        h('div', { class: 'lh-id' }, b.logo ? h('img', { class: 'lh-logo', src: b.logo, alt: '' }) : null,
          h('div', null, h('div', { class: 'lh-name' }, b.name || ''), b.activity ? h('div', { class: 'lh-act' }, b.activity) : null)),
        h('div', { class: 'lh-contact' }, b.address ? h('div', null, b.address) : null, b.phones ? h('div', { class: 'ltr-num' }, b.phones) : null)),
      h('div', { class: 'lh-rule' }),
      title ? h('div', { class: 'lh-title' }, h('span', null, title), sub ? h('small', null, sub) : null) : null);
  }
  F.letterhead = letterhead;
  const printFooter = () => h('div', { class: 'pf' }, h('span', null, (S.brand && S.brand.footer) || ''), h('span', null, T('printedOn'), ': ', F.fdt(new Date().toISOString().slice(0, 19).replace('T', ' ')), S.user ? ' · ' + S.user.name : ''));
  /** Print a finished document (letterhead included) — the browser's "Save as PDF" turns it into a PDF file. */
  function printDoc(fileTitle, node) {
    let box = document.getElementById('print'); if (!box) { box = h('div', { id: 'print' }); document.body.append(box); }
    box.replaceChildren(node); if (F.fitTables) F.fitTables(box);
    const old = document.title; document.title = fileTitle;
    document.body.classList.add('printing', 'doc');
    const done = () => { document.body.classList.remove('printing', 'doc'); document.title = old; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done); window.print(); setTimeout(done, 2000);
  }
  F.printDoc = printDoc;

  /* ================================ WHATSAPP (statement summaries and payment reminders) ================================ */
  /* Opens WhatsApp with a ready message to the customer's number (wa.me works on phones, WhatsApp Web and desktop).
     Nothing is sent by FuelPro itself: the user checks the text and presses Send in WhatsApp. */
  const CC = { YER: '967', SAR: '966', AED: '971', OMR: '968', KWD: '965', QAR: '974', BHD: '973', EGP: '20', JOD: '962' };
  function waNumber(raw) {
    let d = String(raw || '').replace(/[^\d+]/g, ''); if (!d) return '';
    const cc = CC[S.st && S.st.currency] || '';
    if (d.startsWith('+')) return d.slice(1).replace(/\D/g, '');
    if (d.startsWith('00')) return d.slice(2);
    if (cc && d.startsWith(cc) && d.length > cc.length + 7) return d;
    if (cc && d.startsWith('0')) return cc + d.slice(1);
    if (cc && d.length <= 9) return cc + d;
    return d;
  }
  function waDialog(phone, text, hint, rememberKey) {
    if (!phone && rememberKey) { try { phone = localStorage.getItem(rememberKey) || ''; } catch { phone = ''; } }
    const num = h('input', { id: 'waNum', type: 'tel', dir: 'ltr', inputmode: 'tel', value: waNumber(phone), placeholder: '9677XXXXXXXX' });
    const msg = h('textarea', { id: 'waMsg', rows: 12, dir: 'auto', style: 'min-height:220px;line-height:1.7' }); msg.value = text;
    const link = h('a', { class: 'btn wa-go', target: '_blank', rel: 'noopener' }, waIcon(), ' ', T('waOpen'));
    const sync = () => { const n = waNumber(num.value).replace(/\D/g, ''); link.href = 'https://wa.me/' + n + '?text=' + encodeURIComponent(msg.value); };
    num.addEventListener('input', sync); msg.addEventListener('input', sync); sync();
    const copy = h('button', { class: 'btn ghost', type: 'button', onclick: () => {
      const done = () => toast(T('waCopied'));
      try { navigator.clipboard.writeText(msg.value).then(done, () => { msg.select(); document.execCommand && document.execCommand('copy'); done(); }); } catch { msg.select(); }
    } }, T('waCopy'));
    const share = navigator.share ? h('button', { class: 'btn ghost', type: 'button', onclick: () => navigator.share({ text: msg.value }).catch(() => {}) }, T('waShare')) : null;
    const m = modal(T('waTitle'), h('div', { class: 'stack', style: 'gap:12px' }, field(T('waPhone'), num), field(T('waMsg'), msg),
      h('div', { class: 'row', style: 'margin-top:0' }, link, copy, share), h('p', { class: 'hint', style: 'margin:0' }, hint || T('waHint'))));
    link.addEventListener('click', () => { if (rememberKey) { try { localStorage.setItem(rememberKey, waNumber(num.value).replace(/\D/g, '')); } catch { /* optional */ } } setTimeout(() => m.remove(), 300); });
    return m;
  }
  function waIcon() {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '18'); s.setAttribute('height', '18'); s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('fill', 'currentColor');
    p.setAttribute('d', 'M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .2-1.2c-.1-.1-.3-.2-.5-.3Z');
    s.append(p); return s;
  }
  const curWord = () => { const c = S.st ? S.st.currency : ''; return P.lang === 'ar' ? ({ YER: 'ريال', SAR: 'ريال سعودي', USD: 'دولار', AED: 'درهم' })[c] || c : c; };
  F.waDialog = waDialog; F.waIcon = waIcon; F.curWord = curWord;

  /* ================================ STATEMENT SCREEN (any account, customer or supplier) ================================ */
  const addDay = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const nf = (v) => { const d = dec(), dd = Math.min(d, S.st.disp_dec ?? d); return new Intl.NumberFormat('en-US', { minimumFractionDigits: dd, maximumFractionDigits: dd }).format(v / 10 ** d); };
  /**
   * One statement layout for every kind of account: period, opening balance, rows in the source documents' own wording,
   * totals, search, print / PDF with the letterhead, CSV.
   * cfg: { title, who, back, backLabel, load(from, to) -> { name, ref, opening, rows:[{date, ref, desc, debit, credit, balance, voided, action}], total_debit, total_credit, balance },
   *        debitNormal: true when a positive balance means "مدين", sigs: [labels], stateKey }
   */
  async function statementScreen(main, cfg) {
    if (!S.brand) await loadBrand();
    const from = dateIn('psFrom', S.psFrom || todayIso().slice(0, 5) + '01-01'), to = dateIn('psTo', S.psTo || todayIso());
    const q = h('input', { id: 'psQ', type: 'search', placeholder: T('search'), value: S.psQ || '' }), out = h('div', { class: 'stack' });
    let r = null, shown = [], printing = false;
    const nature = (v) => !v ? '' : (cfg.debitNormal ? v > 0 : v < 0) ? T('natDr') : T('natCr');
    const dt = (d) => printing && d ? d.slice(0, 10).replace(/-/g, '/') : fdate(d);
    const natS = (v) => { const n = nature(v); return printing && n ? (n === T('natDr') ? T('natDrS') : T('natCrS')) : n; };
    const amt = (v) => nf(Math.abs(v));
    const fc = cfg.fcCode, fcCols = (e) => fc ? [h('td', { class: 'num fc' }, e.fcDr ? nf(e.fcDr) : ''), h('td', { class: 'num fc' }, e.fcCr ? nf(e.fcCr) : ''), h('td', { class: 'num fc' }, e.fcBal != null ? nf(e.fcBal) : '')] : [];
    const tableFor = (rows, forPrint) => h('div', { class: forPrint ? 'tw-print' : 'tw' }, h('table', { class: 'stmt' + (fc ? ' has-fc' : '') }, forPrint && !fc ? h('colgroup', null, [12, 7, 33, 15, 15, 18].map(w => h('col', { class: 'w' + w }))) : null,
      h('thead', null, h('tr', null, [T('date'), T('mvType'), T('entryNo'), T('docRef'), T('desc'), ...(fc ? [T('debit') + ' ' + fc, T('creditCol') + ' ' + fc, T('balance') + ' ' + fc] : []), T('debit'), T('creditCol'), T('balance'), forPrint ? null : ''].filter(x => x !== null).map((x, i) => h('th', { class: i >= 5 ? 'num' : '' }, x)))),
      h('tbody', null,
        h('tr', { class: 'open-row' }, h('td', null, dt(r.from)), h('td'), h('td'), h('td'), h('td', null, T('openingCol')), ...(fc ? [h('td'), h('td'), h('td', { class: 'num fc' }, nf(r.fcOpening || 0))] : []), h('td'), h('td'), h('td', { class: 'num' }, amt(r.opening), h('i', null, natS(r.opening))), forPrint ? null : h('td')),
        rows.map(e => h('tr', { class: e.voided ? 'voided' : '' }, h('td', { class: 'nowrap' }, dt(e.date)), h('td', { class: 'nowrap small' }, e.kind || ''), h('td', { class: 'ref' }, e.ref || ''), h('td', { class: 'ref' }, e.docRef || ''), h('td', { class: 'desc' }, e.desc), ...fcCols(e),
          h('td', { class: 'num dr' }, e.debit ? nf(e.debit) : ''), h('td', { class: 'num cr' }, e.credit ? nf(e.credit) : ''),
          h('td', { class: 'num bal' }, e.voided ? T('voided') : [amt(e.balance), h('i', null, natS(e.balance))]),
          forPrint ? null : h('td', null, e.action || '')))),
      h('tfoot', null, h('tr', null, h('td', { colspan: 5 }, T('total')), ...(fc ? [h('td', { class: 'num' }, nf(r.fcDr || 0)), h('td', { class: 'num' }, nf(r.fcCr || 0)), h('td', { class: 'num' }, nf(r.fcBal || 0))] : []), h('td', { class: 'num' }, nf(r.total_debit)), h('td', { class: 'num' }, nf(r.total_credit)), h('td', { class: 'num' }, amt(r.balance), h('i', null, natS(r.balance))), forPrint ? null : h('td')))));
    const summary = () => h('div', { class: 'sumbox' },
      [[T('openingCol'), r.opening, true], [T('debit'), r.total_debit], [T('creditCol'), r.total_credit], [T('closingBal'), r.balance, true]]
        .map(([k, v, nat], i) => h('div', { class: 'sb' + (i === 3 ? ' main' : '') }, h('span', null, k), h('b', null, nat ? amt(v) : nf(v)), nat && v ? h('em', null, nature(v)) : null, i === 3 && fc ? h('em', null, ' · ', nf(r.fcBal || 0), ' ', fc) : null)));
    const infoBox = () => h('div', { class: 'partybox' },
      h('div', null, h('span', null, cfg.who), h('b', null, r.name)),
      h('div', null, h('span', null, T('acctNo')), h('b', { class: 'ltr-num' }, r.ref || '')),
      h('div', null, h('span', null, T('period')), h('b', null, dt(r.from), ' — ', dt(r.to))),
      h('div', null, h('span', null, T('rowsN')), h('b', null, String(shown.length))),
      h('div', { class: 'curnote' }, T('amountsIn'), ' ', S.st ? S.st.currency : ''));
    /* the WhatsApp text: who, period, totals, the balance in words, the last movements, and how to reach the station */
    const waStatement = () => {
      const b = S.brand || {}, d = (x) => String(x || '').slice(0, 10).split('-').reverse().join('/'), cur = curWord();
      const live = r.rows.filter(e => !e.voided), last = live.slice(-8);
      const lines = [`*${b.name || (S.st && S.st.name) || 'FuelPro'}*`, `${cfg.title}: *${r.name}*${r.ref ? ' (' + r.ref + ')' : ''}`, `${T('period')}: ${d(r.from)} — ${d(r.to)}`, '',
        `${T('openingCol')}: ${amt(r.opening)} ${natS(r.opening)}`, `${T('debit')}: ${nf(r.total_debit)}`, `${T('creditCol')}: ${nf(r.total_credit)}`,
        `*${T('closingBal')}: ${amt(r.balance)} ${cur} ${nature(r.balance)}*`];
      if (last.length) { lines.push('', `${T('waLast')} (${last.length}${live.length > last.length ? ' / ' + live.length : ''}):`);
        for (const e of last) lines.push(`• ${d(e.date)} ${String(e.desc || e.kind || '').slice(0, 60)} — ${e.debit ? nf(e.debit) : '(' + nf(e.credit) + ')'}`); }
      lines.push('', T('stmtObjection')); if (b.phones) lines.push('☎ ' + b.phones);
      return lines.join('\n');
    };
    /* the statement as a PDF file for WhatsApp: share sheet (phone / Windows) straight to WhatsApp,
       otherwise the file is saved and WhatsApp opens on the customer's chat to attach it */
    const sendPdf = guard(async () => {
      if (!r || !window.FPPDF) return;
      if (!S.brand) await loadBrand();
      const b = S.brand || {}, cw = curWord(), bal = (v) => v ? `${amt(v)} ${natS(v)}` : '0';
      /* balance cell for the PDF: the amount, and Dr/Cr as its own badge */
      const balCell = (v) => v ? { t: amt(v), pill: nature(v), kind: nature(v) === T('natCr') ? 'cr' : 'dr' } : { t: '0' };
      toast(T('pdfMaking'));
      const live = shown;
      const rows = [{ cells: [dmy(r.from), '', T('openingCol'), '', '', balCell(r.opening)], fill: '#fdf8ea', bold: true },
        ...live.map(e => ({ cells: [dmy(e.date), e.kind || '', e.desc || '', e.debit ? nf(e.debit) : '', e.credit ? nf(e.credit) : '', e.voided ? T('voided') : balCell(e.balance)], color: [null, null, null, null, '#0b5a44', null] }))];
      const blob = await window.FPPDF.statement({
        brand: { name: b.name || (S.st && S.st.name) || 'FuelPro', activity: b.activity, phones: b.phones, address: b.address, logo: b.logo },
        title: cfg.title, periodText: `${T('fromDate')} ${dmy(r.from)}   ${T('toDate')} ${dmy(r.to)}`,
        party: { name: r.name, ref: r.ref, currency: cw }, labels: { party: cfg.who, acct: T('acctNo'), currency: T('currency'), words: T('amountWords') },
        summary: [{ k: T('prevBalance'), v: bal(r.opening) }, { k: T('debit'), v: nf(r.total_debit) }, { k: T('creditCol'), v: nf(r.total_credit) }, { k: T('closingBal'), v: bal(r.balance), main: true }],
        cols: [{ k: T('date'), w: 13.5, center: true, nowrap: true }, { k: T('mvType'), w: 11.5, center: true }, { k: T('desc'), w: 28 }, { k: T('debit'), w: 13.5, num: true }, { k: T('creditCol'), w: 13.5, num: true }, { k: T('balance'), w: 20, num: true, bold: true }],
        rows, total: [T('total'), '', `${live.length} ${T('rowsN')}`, nf(r.total_debit), nf(r.total_credit), balCell(r.balance)],
        words: F.tafqeet ? F.tafqeet(Math.abs(r.balance)) : '', note: (S.brand && S.brand.footer) || T('stmtObjection'), stamp: dmy(todayIso()) });
      const name = `${cfg.title} - ${r.name} - ${r.to}.pdf`.replace(/[\\/:*?"<>|]+/g, '-');
      const file = new File([blob], name, { type: 'application/pdf' });
      const text = `${cfg.title}: ${r.name}\n${T('closingBal')}: ${amt(r.balance)} ${cw} ${nature(r.balance)}`;
      const dlName = `FuelPro-statement-${String(r.ref || '').replace(/[^\w-]+/g, '')}-${r.to}.pdf`;
      /* every action below runs from its own click, so the browser (or Claude's download prompt) always accepts it */
      const inClaude = !!(window.claude && window.claude.use);
      const canShare = !inClaude && navigator.canShare && navigator.canShare({ files: [file] });
      const save = async () => {
        if (inClaude) {
          const dl = await window.claude.use('downloads').catch(() => null);
          if (!dl) { toast(T('dlUnavailable')); return; }
          try { await dl.save({ filename: dlName, data: blob }); } catch (e) { if (e && e.code !== 'declined') toast(T('dlFailed') + (e && e.code ? ' (' + e.code + ')' : '')); }
          return;
        }
        const a = h('a', { href: URL.createObjectURL(blob), download: dlName }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 60000);
      };
      const shareBtn = canShare ? h('button', { class: 'btn wa-btn', type: 'button', onclick: () => navigator.share({ files: [file], title: cfg.title, text }).then(() => m.remove(), () => {}) }, waIcon(), ' ', T('waSharePdf')) : null;
      const saveBtn = h('button', { class: 'btn ' + (canShare ? 'ghost' : 'gold'), type: 'button', onclick: save }, '⬇ ', T('dlPdf'));
      const chat = h('button', { class: 'btn ghost', type: 'button', onclick: () => { m.remove(); waDialog(r.phone, text + '\n' + T('waAttach'), T('waPdfHint')); } }, waIcon(), ' ', T('waOpen'));
      const kb = Math.max(1, Math.round(blob.size / 1024));
      const m = modal(T('pdfReady'), h('div', { class: 'stack', style: 'gap:12px' },
        h('p', { style: 'margin:0' }, h('b', null, r.name), ' · ', `${live.length} ${T('rowsN')} · ${kb} KB`),
        h('div', { class: 'row', style: 'margin-top:0' }, shareBtn, saveBtn, chat),
        h('p', { class: 'hint', style: 'margin:0' }, canShare ? T('pdfShareHint') : T('pdfSaveHint'))));
    });
    const draw = () => {
      const term = q.value.trim(); shown = term ? r.rows.filter(e => (e.desc + ' ' + (e.ref || '')).includes(term)) : r.rows;
      out.replaceChildren(h('div', { class: 'stmt-screen' }, infoBox(), summary(), tableFor(shown, false), r.truncated ? h('p', { class: 'hint' }, T('stmtTruncated')) : null));
    };
    const run = guard(async () => { S.psFrom = from.value; S.psTo = to.value; r = await cfg.load(from.value, to.value); r.from = r.from || from.value; r.to = r.to || to.value; draw(); title.lastChild.textContent = r.name; });
    q.addEventListener('input', () => { S.psQ = q.value; if (r) draw(); });
    const doPrint = () => { if (!r) return; printDoc(`${cfg.title} - ${r.name} - ${r.from} - ${r.to}`, classicStatement(cfg, r, shown, nature)); };
    const exp = h('button', { class: 'btn ghost sm', onclick: () => r && csv(`statement-${r.name}-${r.from}_${r.to}.csv`, ['date', 'doc_no', 'description', 'debit', 'credit', 'balance'],
      [[r.from, '', 'opening', '', '', r.opening / 10 ** dec()], ...r.rows.map(e => [e.date, e.ref || '', e.desc, e.debit ? e.debit / 10 ** dec() : '', e.credit ? e.credit / 10 ** dec() : '', e.voided ? 'voided' : e.balance / 10 ** dec()])]) }, 'CSV');
    const title = h('h2', null, cfg.title, ': ', h('span', { class: 'gold' }, '…'));
    main.append(sec(null, h('div', { class: 'row between' }, title, cfg.back ? h('button', { class: 'btn ghost', onclick: cfg.back }, '← ', cfg.backLabel) : null),
      cfg.picker || null,
      h('div', { class: 'row' }, field(T('from'), from), field(T('to'), to), field(T('search'), q), h('button', { class: 'btn', onclick: run }, T('run')),
        h('button', { class: 'btn gold-btn', onclick: doPrint, title: T('pdfHint') }, '⎙ ', T('printPdf')), exp, cfg.whatsapp ? h('button', { class: 'btn wa-btn', onclick: () => sendPdf() }, waIcon(), ' ', T('waPdf')) : null), h('p', { class: 'hint' }, T('pdfHint'))), out);
    await run();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return true;
  }

  /* ---- the printed statement, laid out like the old system's: boxed header, full grid, نوع الحركة / رقم القيد / المرجع, balance with د / م ---- */
  const dmy = (d) => d ? d.slice(0, 10).split('-').reverse().join('-') : '';
  function classicStatement(cfg, r, rows, nature) {
    const b = S.brand || {}, fc = cfg.fcCode;
    const natS = (v) => { const n = nature(v); return n ? (n === T('natDr') ? T('natDrS') : T('natCrS')) : ''; };
    const badge = (v) => { const n = natS(v); return n ? h('i', { class: 'nb ' + (n === T('natDrS') ? 'dr' : 'cr') }, n) : null; };
    const bal = (v) => [nf(Math.abs(v)), ' ', badge(v)];
    const amtC = (v) => { const d = dec(); if (!v) return h('span', { class: 'z' }, '0'); return v % 10 ** d === 0 ? new Intl.NumberFormat('en-US').format(v / 10 ** d) : nf(v); };
    const now = new Date(), hh = now.getHours(), stamp = `${dmy(todayIso())}  ${String(hh % 12 || 12).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} ${hh < 12 ? 'ص' : 'م'}`;
    const cols = ['#', T('date'), T('mvType'), T('entryNo'), T('docRef'), T('desc'), ...(fc ? [T('debit') + ' ' + fc, T('creditCol') + ' ' + fc] : []), T('debit'), T('creditCol'), T('balance')];
    const n = cols.length;
    const cell = (k, v, cls) => h('div', { class: 'pc ' + (cls || '') }, h('span', null, k), h('b', null, v));
    const curName = fc ? fc : (S.st && S.st.currency === 'YER' ? 'ريال يمني' : S.st.currency);
    const tile = (k, v, cls, withNat) => h('div', { class: 'pt ' + (cls || '') }, h('span', null, k), h('b', null, withNat ? bal(v) : nf(v)));
    const head = h('div', { class: 'p-head' },
      h('div', { class: 'p-band' },
        h('div', { class: 'p-id' }, b.logo ? h('img', { src: b.logo, alt: '' }) : null, h('div', null, h('div', { class: 'p-name' }, b.name || ''), b.activity ? h('div', { class: 'p-act' }, b.activity) : null)),
        h('div', { class: 'p-ttl' }, h('div', { class: 'p-ribbon' }, cfg.title), h('div', { class: 'p-per' }, T('fromDate'), ' ', h('span', { class: 'ltr-num' }, dmy(r.from)), '  ', T('toDate'), ' ', h('span', { class: 'ltr-num' }, dmy(r.to)))),
        h('div', { class: 'p-ct' }, b.address ? h('div', null, '⌂ ', b.address) : null, b.phones ? h('div', { class: 'ltr-num' }, '☎ ', b.phones) : null)),
      h('div', { class: 'p-rule' }),
      h('div', { class: 'p-info' },
        h('div', { class: 'p-box main' }, cell(T('acctName'), r.name, 'big'), cell(T('acctNo'), h('span', { class: 'ltr-num' }, r.ref || ''), ''), cell(T('currency'), curName, '')),
        h('div', { class: 'p-box' }, cell(T('fromDate'), h('span', { class: 'ltr-num' }, dmy(r.from))), cell(T('toDate'), h('span', { class: 'ltr-num' }, dmy(r.to))), cell(T('employee'), S.user ? S.user.name : ''), cell(T('printedOn'), h('span', { class: 'ltr-num' }, stamp)))),
      h('div', { class: 'p-sum' }, tile(T('prevBalance'), r.opening, 'gold', true), tile(T('debit'), r.total_debit, ''), tile(T('creditCol'), r.total_credit, 'cr'), tile(T('closingBal'), r.balance, 'main', true)));
    const td = (v, cls) => h('td', { class: cls || '' }, v);
    let qr = null; try { qr = window.QR && window.QR.svg(`FuelPro|${r.ref || ''}|${r.from}..${r.to}|BAL ${(r.balance / 10 ** dec()).toFixed(2)}|${todayIso()}`, 92); } catch { qr = null; }
    const end = h('div', { class: 'p-end' },
      h('div', { class: 'p-words' }, h('span', null, T('closingBal'), ' (', natS(r.balance) === T('natDrS') ? T('natDr') : natS(r.balance) ? T('natCr') : '—', ')'), h('b', null, F.tafqeet(Math.abs(r.balance)))),
      h('div', { class: 'p-note' }, (S.brand && S.brand.footer) || T('stmtObjection')),
      h('div', { class: 'p-sig' }, h('div', { class: 'p-signs' }, (cfg.classicSigs || [T('receiverS'), T('accountantS'), T('managementS')]).map(x => h('div', null, h('span', null, x), h('i')))),
        qr ? h('div', { class: 'p-qr' }, qr, h('small', null, T('qrHint'))) : null));
    /* the full head prints once; a slim running head with the column titles repeats on every page */
    const run = h('div', { class: 'p-run' }, b.logo ? h('img', { src: b.logo, alt: '' }) : null, h('b', null, b.name || ''), h('span', null, cfg.title, ' · ', r.name, ' · ', h('span', { class: 'ltr-num' }, r.ref || '')));
    return h('div', { class: 'classic premium' }, b.logo ? h('img', { class: 'p-wm', src: b.logo, alt: '' }) : null, head, h('table', { class: 'cl-tbl' },
      h('thead', null, h('tr', { class: 'cl-hrow p-runrow' }, h('td', { colspan: n }, run)), h('tr', { class: 'p-cols' }, cols.map(c => h('th', null, c)))),
      h('tbody', null,
        h('tr', { class: 'p-open' }, td('', 'c'), td(dmy(r.from), 'c nw'), td('', ''), td('', ''), td('', ''), td(T('openingCol'), 'd'), ...(fc ? [td('', ''), td('', '')] : []), td('', ''), td('', ''), td(bal(r.opening), 'n b')),
        rows.map((e, i) => h('tr', { class: e.voided ? 'voided' : '' }, td(String(i + 1), 'c idx'), td(dmy(e.date), 'c nw'), td(e.kind || '', 'c k'), td(e.ref || '', 'c'), td(e.docRef || '', 'c'), td(e.desc, 'd'),
          ...(fc ? [td(amtC(e.fcDr || 0), 'n'), td(amtC(e.fcCr || 0), 'n cr')] : []), td(amtC(e.debit || 0), 'n'), td(amtC(e.credit || 0), 'n cr'), td(e.voided ? T('voided') : bal(e.balance), 'n b')))),
      h('tbody', { class: 'cl-sum' }, h('tr', null, h('td', { colspan: 6 }, T('total'), ' — ', rows.length, ' ', T('rowsN')), ...(fc ? [td(nf(r.fcDr || 0), 'n'), td(nf(r.fcCr || 0), 'n')] : []), td(nf(r.total_debit), 'n'), td(nf(r.total_credit), 'n'), td(bal(r.balance), 'n b'))),
      h('tbody', { class: 'p-endrow' }, h('tr', null, h('td', { colspan: n }, end))),
      h('tfoot', null, h('tr', { class: 'cl-frow' }, h('td', { colspan: n }, h('div', { class: 'p-foot' }, h('span', null, b.name || ''), h('span', null, cfg.title, ' · ', r.name), h('span', { class: 'ltr-num' }, 'FuelPro · ', stamp)))))));
  }

  /* customers & suppliers */
  async function partyStatement(main, type) {
    const key = type === 'customer' ? 'stmt' : 'suppStmt'; const id = S[key]; if (!id) return false;
    const cust = type === 'customer';
    const desc = (e) => e.note && (e.kind === 'sale' || e.kind === 'journal' || e.kind === 'purchase') ? e.note   // the document's own wording, as written in the source
      : e.kind === 'opening' ? T('openingBal') : e.kind === 'sale' ? T('saleRow', { f: e.fuel_name, q: vol(e.quantity_ml) }) : e.kind === 'purchase' ? T('purchaseRow', { q: vol(e.quantity_ml, 0) })
      : e.kind === 'journal' ? T('src.' + e.source) + (e.ref_no ? ' ' + e.ref_no : '') + (e.note ? ' — ' + e.note : '')
      : (cust ? T('payRow') : T('payOut') + ' · ' + T(e.method === 'bank' ? 'mBank' : 'mCash')) + (e.note ? ' — ' + e.note : '');
    return statementScreen(main, {
      title: T(cust ? 'stmtCust' : 'stmtSupp'), who: T(cust ? 'customer' : 'supplierCol'), debitNormal: cust, whatsapp: true,
      back: () => { S[key] = null; render(); }, backLabel: T(cust ? 'cust' : 'supp'),
      sigs: [T('accountantSig'), T('managerSig'), T(cust ? 'customerSig' : 'supplierSig')],
      load: async (from, to) => {
        const r = await api('GET', sp(`/${cust ? 'customers' : 'suppliers'}/${id}/statement?from=${from}&to=${to}`)); const p = r.customer || r.supplier;
        return { name: p.name, ref: p.ref || '#' + p.id, phone: p.phone || '', opening: r.opening, total_debit: r.total_debit, total_credit: r.total_credit, balance: r.balance, from: r.from, to: r.to,
          rows: r.entries.map(e => ({ date: e.date, ref: e.ref_no || '', docRef: e.doc_ref || '', kind: e.doc_type || T('mt.' + (e.kind === 'journal' ? e.source : e.kind)), desc: desc(e), debit: e.debit, credit: e.credit, balance: e.balance, voided: e.voided,
            action: e.kind === 'payment' && !e.voided && cd(cust ? 'payment.void' : 'supplier.pay') ? F.voidBtn(() => `/${cust ? 'payments' : 'supplier-payments'}/${e.id}/void`) : null })) };
      }
    });
  }

  /* any ledger account: boxes, banks, employees, expenses, revenue… (كشف حساب عام) */
  F.VIEWS.stm = async (main) => {
    const accts = (await refData()).accts.filter(a => !a.is_group);
    const cur = accts.find(a => a.id === S.acctStmt) || null;
    const pick = acctPicker(accts, 'stmAcct', (a) => { if (a && a.id !== S.acctStmt) { S.acctStmt = a.id; render(); } }, cur);
    const pickRow = h('div', { class: 'row' }, field(T('account'), pick));
    if (!cur) { main.append(sec(T('stm'), h('p', { class: 'hint' }, T('stmHelp')), pickRow)); return; }
    const debitNormal = cur.type === 'asset' || cur.type === 'expense';
    await statementScreen(main, {
      title: T('stm'), who: T('account'), debitNormal: true, picker: pickRow, fcCode: cur.currency && cur.currency !== S.st.currency ? cur.currency : null,
      load: async (from, to) => {
        const r = await api('GET', `/api/accounting/ledger?station_id=${S.sid}&account_id=${cur.id}&from=${from}&to=${to}`);
        const sign = debitNormal ? 1 : -1;   // the ledger returns balances in the account's normal direction; the screen shows debit-positive
        let td = 0, tc = 0, fb = 0, fd = 0, fcr = 0; const fcC = cur.currency && cur.currency !== S.st.currency ? cur.currency : null;
        const fcOpen = fcC ? (await api('GET', `/api/accounting/revaluation?station_id=${S.sid}&date=${addDay(from, -1)}`)).rows.find(x => x.account_id === cur.id) : null;
        fb = fcOpen ? fcOpen.fc_balance : 0; const fcOpening = fb;
        const rows = r.lines.map(l => { td += l.debit; tc += l.credit;
          const f = fcC && l.fc_code === fcC ? l.fc_amount : 0, fDr = l.debit ? f : 0, fCr = l.credit ? f : 0; fb += fDr - fCr; fd += fDr; fcr += fCr;
          return { date: l.business_date, ref: l.ref || String(l.journal_id), docRef: l.doc_ref || '', kind: l.doc_type || T('mt.' + l.source), debit: l.debit, credit: l.credit, balance: l.balance * sign, fcDr: fDr, fcCr: fCr, fcBal: fcC ? fb : null,
            desc: [l.sale_note || l.memo || l.jmemo || T('src.' + l.source), l.party_name && !(l.sale_note || l.memo || '').includes(l.party_name) ? ' — ' + l.party_name : ''].join('') }; });
        return { name: nm(r.account), ref: r.account.code, opening: r.opening * sign, balance: r.closing * sign, total_debit: td, total_credit: tc, from: r.from, to: r.to, rows, truncated: r.lines.length >= 30000,
          fcOpening, fcDr: fd, fcCr: fcr, fcBal: fb };
      }
    });
  };
  F.partyStatement = partyStatement;

  /* ================================ LETTERHEAD SETTINGS ================================ */
  function brandCard() {
    const b = S.brand || {};
    const nm = h('input', { id: 'bName', value: b.name || '' }), ac = h('input', { id: 'bAct', value: b.activity || '' }), ad = h('input', { id: 'bAddr', value: b.address || '' }),
      ph = h('input', { id: 'bPh', value: b.phones || '', dir: 'ltr' }), ft = h('input', { id: 'bFt', value: b.footer || '' });
    let logo = b.logo || null;
    const prev = h('div', { class: 'lh-preview' });
    const redraw = () => { const keep = S.brand; S.brand = { name: nm.value, activity: ac.value, address: ad.value, phones: ph.value, footer: ft.value, logo }; prev.replaceChildren(letterhead(T('stmtCust'))); S.brand = keep; };
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/svg+xml', onchange: (e) => { const f = e.target.files[0]; if (!f) return;
      if (f.size > 400_000) { toast(T('logoTooBig')); return; } const rd = new FileReader(); rd.onload = () => { logo = rd.result; redraw(); }; rd.readAsDataURL(f); } });
    [nm, ac, ad, ph, ft].forEach(i => i.addEventListener('input', redraw)); redraw();
    return h('form', { class: 'card', onsubmit: guard(async (e) => { e.preventDefault(); S.brand = await api('PATCH', '/api/brand', { name: nm.value, activity: ac.value, address: ad.value, phones: ph.value, footer: ft.value, logo }); toast(T('saved')); }) },
      h('h2', null, T('letterhead')), h('p', { class: 'hint' }, T('letterheadHelp')),
      h('div', { class: 'grid' }, field(T('lhName'), nm), field(T('lhAct'), ac), field(T('lhAddr'), ad), field(T('lhPhones'), ph), field(T('lhFooter'), ft)),
      h('div', { class: 'row' }, h('label', { class: 'btn ghost' }, T('uploadLogo'), file), logo ? h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { logo = null; redraw(); } }, T('removeLogo')) : null),
      prev, h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('save'))));
  }
  const setupView = F.VIEWS.setup;
  if (setupView) F.VIEWS.setup = async (main) => { await setupView(main); if (cd('config.edit')) { await loadBrand(); main.append(brandCard()); } };


  /* ================================ TRIAL BALANCE BY LEVEL (ميزان المراجعة) ================================ */
  F.trialView = async (main) => {
    if (!S.brand) await loadBrand();
    const from = dateIn('tbFrom', S.tbFrom || todayIso().slice(0, 5) + '01-01'), to = dateIn('tbTo', S.tbTo || todayIso());
    const lvl = sel('tbLvl', [['0', T('lvlDetail')], ['1', T('lvlN', { n: 1 })], ['2', T('lvlN', { n: 2 })], ['3', T('lvlN', { n: 3 })], ['4', T('lvlN', { n: 4 })]], S.tbLvl || '0');
    const zero = h('input', { type: 'checkbox', id: 'tbZero', checked: S.tbHideZero !== false });
    const out = h('div', { class: 'stack' }); let view = null;
    const run = guard(async () => {
      S.tbFrom = from.value; S.tbTo = to.value; S.tbLvl = lvl.value; S.tbHideZero = zero.checked;
      const [tb, tree] = await Promise.all([api('GET', `/api/accounting/trial-balance?station_id=${S.sid}&from=${from.value}&to=${to.value}`), api('GET', '/api/accounts/tree')]);
      const byId = new Map(tree.rows.map(a => [a.id, { ...a, o: 0, d: 0, c: 0 }]));
      const depth = (a) => { let n = 0; for (let x = a; x && x.parent_id; x = byId.get(x.parent_id)) n++; return n + 1; };
      for (const r of tb.rows) for (let x = byId.get(r.account_id); x; x = byId.get(x.parent_id)) { x.o += r.opening_dr - r.opening_cr; x.d += r.debit; x.c += r.credit; }
      const L = +lvl.value;
      const kids = new Map(); for (const a of byId.values()) { const k = a.parent_id || 0; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(a); }
      const rows = [];
      const walk = (pid) => { for (const a of (kids.get(pid) || []).sort((x, y) => x.code.localeCompare(y.code))) {
        const dp = depth(a); const leaf = !(kids.get(a.id) || []).length;
        const show = L === 0 ? true : dp <= L && (dp === L || leaf);
        if (show && !(zero.checked && !a.o && !a.d && !a.c)) rows.push({ a, dp, leaf, cb: a.o + a.d - a.c });
        if (L === 0 || dp < L) walk(a.id);
      } };
      walk(0);
      const sum = rows.filter(r => r.leaf || r.dp === L);
      const tot = { od: 0, oc: 0, d: 0, c: 0, cd: 0, cc: 0 };
      for (const r of (L === 0 ? rows.filter(x => x.leaf) : sum)) { tot.od += Math.max(r.a.o, 0); tot.oc += Math.max(-r.a.o, 0); tot.d += r.a.d; tot.c += r.a.c; tot.cd += Math.max(r.cb, 0); tot.cc += Math.max(-r.cb, 0); }
      const z = (v) => v ? nf(v) : '';
      const tbl = (forPrint) => h('div', { class: forPrint ? 'tw-print' : 'tw' }, h('table', { class: 'stmt tb' },
        h('thead', null, h('tr', null, h('th', { rowspan: 2 }, T('code')), h('th', { rowspan: 2 }, T('account')), h('th', { colspan: 2, class: 'c' }, T('openingCol')), h('th', { colspan: 2, class: 'c' }, T('periodCol')), h('th', { colspan: 2, class: 'c' }, T('closingCol'))),
          h('tr', null, [T('debit'), T('creditCol'), T('debit'), T('creditCol'), T('debit'), T('creditCol')].map(x => h('th', { class: 'num' }, x)))),
        h('tbody', null, rows.map(r => h('tr', { class: r.leaf ? '' : 'grp-row d' + Math.min(r.dp - 1, 4) },
          h('td', { class: 'ref' }, r.a.code), h('td', { class: 'desc' }, h('span', { class: 'ind' + Math.min(r.dp - 1, 8) }, nm(r.a))),
          h('td', { class: 'num' }, z(Math.max(r.a.o, 0))), h('td', { class: 'num' }, z(Math.max(-r.a.o, 0))), h('td', { class: 'num' }, z(r.a.d)), h('td', { class: 'num' }, z(r.a.c)),
          h('td', { class: 'num bal' }, z(Math.max(r.cb, 0))), h('td', { class: 'num bal' }, z(Math.max(-r.cb, 0)))))),
        h('tfoot', null, h('tr', null, h('td', { colspan: 2 }, T('total')), ...[tot.od, tot.oc, tot.d, tot.c, tot.cd, tot.cc].map(v => h('td', { class: 'num' }, nf(v)))))));
      const ok = tot.d === tot.c && tot.cd === tot.cc;
      view = { tbl, tb };
      out.replaceChildren(h('p', { class: ok ? 'note good' : 'note' }, ok ? T('balancedOk') : T('notBalanced')), tbl(false));
    });
    const doPrint = () => { if (!view) return; printDoc(`${T('trialBalance')} ${from.value} - ${to.value}`, h('div', { class: 'a4 wide-doc' }, letterhead(T('trialBalance'), `${from.value.replace(/-/g, '/')} — ${to.value.replace(/-/g, '/')} · ${lvl.options[lvl.selectedIndex].text}`), view.tbl(true),
      h('div', { class: 'signs' }, h('div', null, T('accountantSig')), h('div', null, T('managerSig')), h('div', null, T('auditorSig'))), printFooter())); };
    main.append(sec(T('trialBalance'), h('div', { class: 'row' }, field(T('from'), from), field(T('to'), to), field(T('level'), lvl), h('label', { class: 'chk' }, zero, ' ', T('hideZero')),
      h('button', { class: 'btn', onclick: run }, T('run')), h('button', { class: 'btn gold-btn', onclick: doPrint }, '⎙ ', T('printPdf')))), out);
    await run();
  };

  /* ================================ PRICES (التسعيرة) ================================ */
  F.VIEWS.prc = async (main) => {
    const [fuels, hist] = await Promise.all([api('GET', sp('/fuels')), api('GET', sp('/price-history'))]);
    const p4 = (e4) => nf(Math.round(e4 / 10_000));   // price per litre in minor units
    main.append(h('div', { class: 'grid' }, fuels.map(f => { const last = hist.find(x => x.fuel_id === f.id);
      return h('div', { class: 'stat price-card' }, h('div', { class: 'k' }, f.name), h('div', { class: 'v' }, p4(f.price_e4), h('small', null, ' ', S.st.currency, ' / ', F.uLbl())),
        h('div', { class: 'muted small' }, T('costNow'), ': ', p4(f.cost_e4), last ? [' · ', T('since'), ' ', fdate(last.effective_at.slice(0, 10))] : null)); })));
    if (cd('price.edit')) {
      const fs = sel('pcFuel', fuels.map(f => [f.id, f.name])), pr = h('input', { id: 'pcPrice', inputmode: 'decimal' }), nt = h('input', { id: 'pcNote' });
      main.append(h('form', { class: 'card', onsubmit: guard(async (e) => { e.preventDefault(); await api('PATCH', sp('/fuels/' + fs.value), { price_e4: num(pr.value, F.priceE4), note: nt.value || undefined }); toast(T('saved')); await F.loadBase(); render(); }) },
        h('h2', null, T('changePrice')), h('div', { class: 'grid' }, field(T('fuel'), fs), field(T('newPrice', { u: F.uLbl() }), pr), field(T('note'), nt)), h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('save')))));
    }
    main.append(sec(T('priceHistory'), hist.length ? table([T('date'), T('fuel'), T('oldPrice'), T('newPrice', { u: F.uLbl() }), T('change'), T('costAt'), T('by'), T('note')],
      hist.map(x => [fdate(x.effective_at.slice(0, 10)) + ' ' + x.effective_at.slice(11, 16), x.fuel_name, x.old_price_e4 != null ? p4(x.old_price_e4) : '—', h('b', null, p4(x.price_e4)),
        x.old_price_e4 != null ? h('b', { class: x.price_e4 > x.old_price_e4 ? 'bad' : 'ok' }, (x.price_e4 > x.old_price_e4 ? '▲ ' : '▼ ') + p4(Math.abs(x.price_e4 - x.old_price_e4))) : '',
        x.cost_e4 != null ? p4(x.cost_e4) : '', x.user_name || '', x.note || ''])) : h('p', { class: 'muted' }, T('noData'))));
  };

  /* ================================ CUSTOMER / SUPPLIER LIST (أرصدة العملاء والموردين) ================================ */
  /** Searchable list with account numbers, debit / credit balances, totals, edit, and a printable balances list. */
  F.partyList = (type, list, onStmt) => {
    const cust = type === 'customer';
    const q = h('input', { type: 'search', placeholder: T('searchParty'), value: S['pl' + type] || '' });
    const sortSel = sel('plSort' + type, [['name', T('sortName')], ['bal', T('sortBal')], ['ref', T('sortRef')]], S['plSort' + type] || 'name');
    const nz = h('input', { type: 'checkbox', checked: !!S['plNz' + type] });
    const box = h('div');
    const owed = (p) => cust ? p.balance : p.balance;   // customers: + owes us; suppliers: + we owe
    const filtered = () => { const t = q.value.trim(); let r = list.filter(p => (!t || p.name.includes(t) || (p.ref || '').startsWith(t) || (p.phone || '').includes(t)) && (!nz.checked || p.balance));
      const k = sortSel.value; r = r.slice().sort((a, b) => k === 'bal' ? owed(b) - owed(a) : k === 'ref' ? String(a.ref || '').localeCompare(String(b.ref || '')) : a.name.localeCompare(b.name, 'ar')); return r; };
    const tbl = (rows, forPrint) => { const td = rows.reduce((s, p) => s + Math.max(cust ? p.balance : -p.balance, 0), 0), tc = rows.reduce((s, p) => s + Math.max(cust ? -p.balance : p.balance, 0), 0);
      return h('div', { class: forPrint ? 'tw-print' : 'tw' }, h('table', { class: 'stmt' },
        h('thead', null, h('tr', null, ['#', T('acctNo'), T('name'), T('phone'), T('creditLimit'), T('balDr'), T('balCr'), forPrint ? null : ''].filter(x => x !== null).map((x, i) => h('th', { class: i >= 4 && i <= 6 ? 'num' : '' }, x)))),
        h('tbody', null, rows.map((p, i) => { const dr = cust ? p.balance : -p.balance;
          return h('tr', { class: p.credit_limit && p.balance > p.credit_limit ? 'over' : '' }, h('td', { class: 'ref' }, String(i + 1)), h('td', { class: 'ref ltr-num' }, p.ref || ''), h('td', null, h('b', null, p.name)), h('td', { class: 'ltr-num' }, p.phone || ''),
            h('td', { class: 'num' }, p.credit_limit ? nf(p.credit_limit) : '—'), h('td', { class: 'num dr' }, dr > 0 ? nf(dr) : ''), h('td', { class: 'num cr' }, dr < 0 ? nf(-dr) : ''),
            forPrint ? null : h('td', { class: 'nowrap' }, h('button', { class: 'btn ghost sm', onclick: () => onStmt(p.id) }, T('stmt')), ' ', cd(cust ? 'customer.edit' : 'supplier.manage') ? h('button', { class: 'btn ghost sm', onclick: () => editParty(type, p) }, T('edit')) : null)); })),
        h('tfoot', null, h('tr', null, h('td', { colspan: 5 }, T('total'), ' (', rows.length, ')'), h('td', { class: 'num' }, nf(td)), h('td', { class: 'num' }, nf(tc)), forPrint ? null : h('td', null, h('b', null, T('net'), ': ', nf(Math.abs(td - tc)), ' ', td >= tc ? T('natDr') : T('natCr')))))));
    };
    const draw = () => { S['pl' + type] = q.value; S['plSort' + type] = sortSel.value; S['plNz' + type] = nz.checked; box.replaceChildren(tbl(filtered(), false)); };
    q.addEventListener('input', draw); sortSel.onchange = draw; nz.onchange = draw;
    const doPrint = async () => { if (!S.brand) await loadBrand(); const title = T(cust ? 'custBalances' : 'suppBalances');
      printDoc(`${title} ${todayIso()}`, h('div', { class: 'a4' }, letterhead(title, T('asOf') + ' ' + todayIso().replace(/-/g, '/')), tbl(filtered(), true), h('div', { class: 'signs' }, h('div', null, T('accountantSig')), h('div', null, T('managerSig')), h('div')), printFooter())); };
    draw();
    return sec(T(cust ? 'cust' : 'supp'), h('div', { class: 'row' }, field(T('search'), q), field(T('sortBy'), sortSel), h('label', { class: 'chk' }, nz, ' ', T('onlyNonZero')),
      h('button', { class: 'btn gold-btn', onclick: doPrint }, '⎙ ', T(cust ? 'custBalances' : 'suppBalances'))), box);
  };
  function editParty(type, p) {
    const cust = type === 'customer';
    const n = h('input', { value: p.name }), ph = h('input', { value: p.phone || '', dir: 'ltr' }), cl = h('input', { inputmode: 'decimal', value: p.credit_limit ? String(p.credit_limit / 10 ** dec()) : '' }), tm = h('input', { inputmode: 'numeric', value: String(p.terms_days ?? 30) });
    const m = modal(T('edit') + ': ' + p.name, h('form', { onsubmit: guard(async (e) => { e.preventDefault();
      const body = { name: n.value, phone: ph.value, terms_days: +tm.value || 0 }; if (cust) body.credit_limit = cl.value.trim() ? num(cl.value, (v) => parseDec(v, dec())) : 0;
      await api('PATCH', sp(`/${cust ? 'customers' : 'suppliers'}/${p.id}`), body); m.remove(); toast(T('saved')); await F.refresh(); }) },
      h('div', { class: 'grid' }, field(T('name'), n), field(T('phone'), ph), cust ? field(T('creditLimit'), cl) : null, field(T('termsDays'), tm)),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('save')))));
  }


  /* ================================ AMOUNT IN WORDS (التفقيط) ================================ */
  const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
  const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
  const HUND = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];
  const SCALES = [['', '', '', ''], ['ألف', 'ألفان', 'آلاف', 'ألفاً'], ['مليون', 'مليونان', 'ملايين', 'مليوناً'], ['مليار', 'ملياران', 'مليارات', 'ملياراً']];
  function below1000(n) {
    const hnd = Math.floor(n / 100), rest = n % 100, parts = [];
    if (hnd) parts.push(HUND[hnd]);
    if (rest) { if (rest < 20) parts.push(ONES[rest]); else { const o = rest % 10, t = Math.floor(rest / 10); parts.push(o ? ONES[o] + ' و' + TENS[t] : TENS[t]); } }
    return parts.join(' و');
  }
  function arWords(n) {
    n = Math.floor(Math.abs(n)); if (!n) return 'صفر';
    const groups = []; let i = 0, rest = 0;   // rest: value of the lower groups already written
    while (n > 0) { const g = n % 1000; if (g) {
      const sc = SCALES[i], t = g % 100; let w;
      if (!i) w = below1000(g);
      else if (g === 1) w = sc[0]; else if (g === 2) w = sc[1];
      else if (t >= 3 && t <= 10 && g < 100) w = below1000(g) + ' ' + sc[2];
      else if (t >= 11 && rest) w = below1000(g) + ' ' + sc[3];      // "خمسة وعشرون ألفاً وخمسمائة"
      else w = below1000(g) + ' ' + sc[0];                            // "مائة ألف"، "خمسة وعشرون ألف"
      groups.unshift(w); }
      rest += g * 1000 ** i; n = Math.floor(n / 1000); i++; }
    return groups.join(' و');
  }
  /** "فقط مائتان وخمسون ريالاً يمنياً و50 فلساً لا غير" */
  F.tafqeet = (minor) => {
    const d = dec(), dd = Math.min(d, S.st.disp_dec ?? d), shown = Math.round(Math.abs(minor) / 10 ** (d - dd)), whole = Math.floor(shown / 10 ** dd), frac = shown % 10 ** dd;
    const yer = !S.st || S.st.currency === 'YER', cur = S.st ? S.st.currency : '';
    const t = whole % 100;
    const head = !whole ? 'صفر ' + (yer ? 'ريال' : cur) : whole === 1 ? (yer ? 'ريال يمني واحد' : 'واحد ' + cur) : whole === 2 ? (yer ? 'ريالان يمنيان' : 'اثنان ' + cur)
      : arWords(whole) + ' ' + (!yer ? cur : t >= 3 && t <= 10 ? 'ريالات يمنية' : t >= 11 ? 'ريالاً يمنياً' : 'ريال يمني');
    const fils = frac ? ' و' + frac + ' ' + (yer ? (frac >= 3 && frac <= 10 ? 'فلوس' : 'فلساً') : '') : '';
    return 'فقط ' + head + fils + ' لا غير';
  };

  /* ================================ PRINTED VOUCHERS & ENTRIES ================================ */
  F.printVoucher = async (v) => {
    if (!S.brand) await loadBrand();
    const rec = v.kind === 'receipt', title = T(rec ? 'receiptV' : 'paymentV');
    printDoc(`${title} ${v.ref_no || v.id}`, h('div', { class: 'a4 vdoc' }, letterhead(title),
      h('div', { class: 'vhead' }, h('div', null, h('span', null, T('refNo')), h('b', { class: 'ltr-num' }, v.ref_no || '#' + v.id)), h('div', null, h('span', null, T('date')), h('b', null, v.business_date.replace(/-/g, '/'))),
        h('div', { class: 'vamt' }, h('span', null, T('amount')), h('b', null, nf(v.amount), ' ', S.st ? (S.st.currency === 'YER' ? 'ريال' : S.st.currency) : ''))),
      h('div', { class: 'vline' }, h('span', null, T(rec ? 'receivedFromBox' : 'paidFromBox')), h('b', null, `${v.box_code} · ${v.box_name_ar}`)),
      h('div', { class: 'vline words' }, h('span', null, T('amountWords')), h('b', null, F.tafqeet(v.amount))),
      v.memo ? h('div', { class: 'vline' }, h('span', null, T('memo')), h('b', null, v.memo)) : null,
      h('div', { class: 'tw-print' }, h('table', { class: 'stmt' }, h('thead', null, h('tr', null, ['#', T('acctNo'), T('account'), T(rec ? 'receivedFrom' : 'paidTo'), T('note'), T('amount')].map((x, i) => h('th', { class: i === 5 ? 'num' : '' }, x)))),
        h('tbody', null, v.lines.map((l, i) => h('tr', null, h('td', null, String(i + 1)), h('td', { class: 'ref' }, l.code), h('td', null, l.name_ar), h('td', null, l.party_name || ''), h('td', { class: 'desc' }, l.memo || ''), h('td', { class: 'num' }, nf(l.amount))))),
        h('tfoot', null, h('tr', null, h('td', { colspan: 5 }, T('total')), h('td', { class: 'num' }, nf(v.amount)))))),
      v.voided_at ? h('div', { class: 'void-stamp' }, T('voided'), v.void_reason ? ' — ' + v.void_reason : '') : null,
      h('div', { class: 'signs' }, h('div', null, T('preparedBy'), v.user_name ? ': ' + v.user_name : ''), h('div', null, T(rec ? 'payerSig' : 'receiverSig')), h('div', null, T('managerSig'))), printFooter()));
  };
  F.printJournal = async (j) => {
    if (!S.brand) await loadBrand();
    const d = j.lines.reduce((a, l) => a + l.debit, 0);
    printDoc(`${T('journalDoc')} ${j.ref || j.id}`, h('div', { class: 'a4 vdoc' }, letterhead(T('journalDoc'), T('src.' + j.source)),
      h('div', { class: 'vhead' }, h('div', null, h('span', null, T('docNo')), h('b', { class: 'ltr-num' }, j.ref || '#' + j.id)), h('div', null, h('span', null, T('date')), h('b', null, j.business_date.replace(/-/g, '/'))),
        h('div', { class: 'vamt' }, h('span', null, T('amount')), h('b', null, nf(d), ' ', S.st ? (S.st.currency === 'YER' ? 'ريال' : S.st.currency) : ''))),
      j.memo ? h('div', { class: 'vline' }, h('span', null, T('memo')), h('b', null, j.memo)) : null,
      h('div', { class: 'tw-print' }, h('table', { class: 'stmt' }, h('thead', null, h('tr', null, [T('acctNo'), T('account'), T('party'), T('note'), T('debit'), T('creditCol')].map((x, i) => h('th', { class: i >= 4 ? 'num' : '' }, x)))),
        h('tbody', null, j.lines.map(l => h('tr', null, h('td', { class: 'ref' }, l.code), h('td', null, l.name_ar), h('td', null, l.party_name || ''), h('td', { class: 'desc' }, l.memo || ''), h('td', { class: 'num' }, l.debit ? nf(l.debit) : ''), h('td', { class: 'num' }, l.credit ? nf(l.credit) : '')))),
        h('tfoot', null, h('tr', null, h('td', { colspan: 4 }, T('total')), h('td', { class: 'num' }, nf(d)), h('td', { class: 'num' }, nf(d)))))),
      h('div', { class: 'vline words' }, h('span', null, T('amountWords')), h('b', null, F.tafqeet(d))),
      h('div', { class: 'signs' }, h('div', null, T('preparedBy'), j.user_name ? ': ' + j.user_name : ''), h('div', null, T('auditorSig')), h('div', null, T('managerSig'))), printFooter()));
  };

  /* ================================ SALES REGISTER (سجل المبيعات) ================================ */
  const pct = (a, b) => b ? (a * 100 / b).toFixed(1) + '%' : '—';
  F.VIEWS.sreg = async (main) => {
    const fuels = await api('GET', sp('/fuels'));
    const from = dateIn('srFrom', S.srFrom || monthStart()), to = dateIn('srTo', S.srTo || todayIso());
    const fu = sel('srFuel', [['', T('all')], ...fuels.map(f => [f.id, f.name])], S.srFuel || ''), pt = sel('srPay', [['', T('all')], ['cash', T('cash')], ['credit', T('credit')]], S.srPay || '');
    const cu = sel('srCust', [['', T('all')], ...(S.customers || []).map(c => [c.id, c.name])], S.srCust || ''), q = h('input', { type: 'search', placeholder: T('srSearch'), value: S.srQ || '' });
    const out = h('div', { class: 'stack' }); let r = null;
    const qs = () => `from=${from.value}&to=${to.value}${fu.value ? '&fuel_id=' + fu.value : ''}${pt.value ? '&pay_type=' + pt.value : ''}${cu.value ? '&customer_id=' + cu.value : ''}${q.value.trim() ? '&q=' + encodeURIComponent(q.value.trim()) : ''}`;
    const tbl = (forPrint) => h('div', { class: forPrint ? 'tw-print' : 'tw' }, h('table', { class: 'stmt' },
      h('thead', null, h('tr', null, [T('billNo'), T('date'), T('fuel'), T('pumps'), T('qty'), T('price', { u: F.uLbl() }), T('cashSales'), T('creditSales'), T('total'), T('grossProfit'), forPrint ? null : ''].filter(x => x !== null).map((x, i) => h('th', { class: i >= 4 && i <= 9 ? 'num' : '' }, x)))),
      h('tbody', null, r.bills.map(b => h('tr', null, h('td', { class: 'ref' }, b.bill), h('td', { class: 'nowrap' }, forPrint ? b.date.replace(/-/g, '/') : fdate(b.date)), h('td', { class: 'fuel' }, b.fuel_name), h('td', { class: 'small nowrap pumps', title: b.pumps }, String(b.pumps || '').split(',').length > 1 ? T('nPumps', { n: String(b.pumps).split(',').length }) : String(b.pumps || '').replace(/ — عداد \d+$/, '')),
        h('td', { class: 'num' }, volNum(b.qty_ml, 2)), h('td', { class: 'num' }, priceShow(b.price_e4)), h('td', { class: 'num' }, nf(b.cash)), h('td', { class: 'num cr' }, b.credit ? nf(b.credit) : ''), h('td', { class: 'num bal' }, nf(b.amount)),
        h('td', { class: 'num' }, nf(b.amount - (b.cogs || 0))), forPrint ? null : h('td', null, h('button', { class: 'btn ghost sm', onclick: () => billModal(b.bill) }, T('open')))))),
      h('tfoot', null, h('tr', null, h('td', { colspan: 4 }, T('total'), ' (', r.bills.length, ')'), h('td', { class: 'num' }, volNum(r.totals.qty_ml, 2)), h('td'), h('td', { class: 'num' }, nf(r.totals.cash)), h('td', { class: 'num' }, nf(r.totals.credit)),
        h('td', { class: 'num' }, nf(r.totals.amount)), h('td', { class: 'num' }, nf(r.totals.amount - r.totals.cogs)), forPrint ? null : h('td')))));
    const run = guard(async () => {
      Object.assign(S, { srFrom: from.value, srTo: to.value, srFuel: fu.value, srPay: pt.value, srCust: cu.value, srQ: q.value });
      r = await api('GET', sp('/sales-register?' + qs())); const t = r.totals;
      out.replaceChildren(h('div', { class: 'grid' }, F.statN(T('volSold'), t.qty_ml, (v) => vol(v, 0)), F.statN(T('sales'), t.amount, nf), F.statN(T('cashSales'), t.cash, nf), F.statN(T('creditSales'), t.credit, nf),
          F.statN(T('grossProfit'), t.amount - t.cogs, nf), stat(T('marginPct'), pct(t.amount - t.cogs, t.amount))),
        r.by_fuel.length > 1 ? h('div', { class: 'chips' }, r.by_fuel.map(f => h('span', { class: 'chip' }, h('b', null, f.fuel_name), ': ', vol(f.qty_ml, 0), ' · ', money(f.amount), ' · ', T('grossProfit'), ' ', money(f.amount - f.cogs)))) : null,
        tbl(false), r.bills.length >= 2000 ? h('p', { class: 'hint' }, T('first2000')) : null);
    });
    const doPrint = async () => { if (!r) return; if (!S.brand) await loadBrand(); printDoc(`${T('sreg')} ${from.value} - ${to.value}`, h('div', { class: 'a4 wide-doc' }, letterhead(T('sreg'), `${from.value.replace(/-/g, '/')} — ${to.value.replace(/-/g, '/')}`), tbl(true), printFooter())); };
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
    main.append(sec(T('sreg'), h('div', { class: 'row' }, field(T('from'), from), field(T('to'), to), field(T('fuel'), fu), field(T('payType'), pt), field(T('customer'), cu), field(T('search'), q),
      h('button', { class: 'btn', onclick: run }, T('run')), h('button', { class: 'btn gold-btn', onclick: doPrint }, '⎙ ', T('printPdf')))), out);
    await run();
  };
  async function billModal(bill) {
    const b = await api('GET', sp('/sales-register/' + encodeURIComponent(bill)));
    const total = b.rows.reduce((s, x) => s + x.gross, 0), qty = b.rows.reduce((s, x) => s + x.quantity_ml, 0);
    const body = (forPrint) => h('div', { class: 'tw' + (forPrint ? '-print' : '') }, h('table', { class: 'stmt' },
      h('thead', null, h('tr', null, ['#', T('pump'), T('openMeter'), T('closeMeterCol'), T('qty'), T('payType'), T('customer'), T('desc'), T('amount')].map((x, i) => h('th', { class: [2, 3, 4, 8].includes(i) ? 'num' : '' }, x)))),
      h('tbody', null, b.rows.map((x, i) => h('tr', { class: x.voided_at ? 'voided' : '' }, h('td', null, String(i + 1)), h('td', null, x.pump_name), h('td', { class: 'num' }, volNum(x.open_ml, 3)), h('td', { class: 'num' }, volNum(x.close_ml, 3)),
        h('td', { class: 'num' }, volNum(x.quantity_ml, 3)), h('td', null, T(x.pay_type)), h('td', null, x.customer_name || ''), h('td', { class: 'desc' }, x.note || ''), h('td', { class: 'num' }, nf(x.gross))))),
      h('tfoot', null, h('tr', null, h('td', { colspan: 4 }, T('total')), h('td', { class: 'num' }, volNum(qty, 3)), h('td', { colspan: 3 }), h('td', { class: 'num' }, nf(total))))));
    const m = modal(T('billNo') + ' ' + bill + ' — ' + fdate(b.date), h('div', null, body(false), h('div', { class: 'row' },
      h('button', { class: 'btn gold-btn', onclick: async () => { if (!S.brand) await loadBrand(); printDoc(`${T('salesBill')} ${bill}`, h('div', { class: 'a4 wide-doc' }, letterhead(T('salesBill'), `${T('billNo')} ${bill} · ${b.date.replace(/-/g, '/')}`), body(true),
        h('div', { class: 'vline words' }, h('span', null, T('amountWords')), h('b', null, F.tafqeet(total))), h('div', { class: 'signs' }, h('div', null, T('cashierSig')), h('div', null, T('accountantSig')), h('div', null, T('managerSig'))), printFooter())); } }, '⎙ ', T('printPdf')))));
    m.classList.add('wide');
  }

  /* ================================ PURCHASE INVOICES (فواتير المشتريات) ================================ */
  F.VIEWS.pur = async (main) => {
    const [fuels, sups] = await Promise.all([api('GET', sp('/fuels')), cd('supplier.manage', 'supplier.pay', 'report.read') ? api('GET', sp('/suppliers')) : []]);
    const from = dateIn('puFrom', S.puFrom || todayIso().slice(0, 5) + '01-01'), to = dateIn('puTo', S.puTo || todayIso());
    const su = sel('puSup', [['', T('all')], ...sups.map(x => [x.id, x.name])], S.puSup || ''), fu = sel('puFuel', [['', T('all')], ...fuels.map(f => [f.id, f.name])], S.puFuel || '');
    const q = h('input', { type: 'search', placeholder: T('puSearch'), value: S.puQ || '' }), out = h('div', { class: 'stack' }); let r = null;
    const tbl = (forPrint) => h('div', { class: forPrint ? 'tw-print' : 'tw' }, h('table', { class: 'stmt' },
      h('thead', null, h('tr', null, [T('invNo'), T('date'), T('supplierCol'), T('fuel'), T('qty'), T('unitCost'), T('invTotal'), T('toSupplier'), T('otherCost'), T('desc'), forPrint ? null : ''].filter(x => x !== null).map((x, i) => h('th', { class: i >= 4 && i <= 8 ? 'num' : '' }, x)))),
      h('tbody', null, r.rows.map(d => h('tr', { class: d.voided_at ? 'voided' : '' }, h('td', { class: 'ref' }, d.ref || '#' + d.id), h('td', { class: 'nowrap' }, forPrint ? d.business_date.replace(/-/g, '/') : fdate(d.business_date)),
        h('td', { class: 'nowrap' }, d.supplier_name || d.supplier || (d.pay_type === 'credit' ? '' : T('m' + d.pay_type[0].toUpperCase() + d.pay_type.slice(1)))), h('td', null, d.fuel_name),
        h('td', { class: 'num' }, volNum(d.quantity_ml, 0)), h('td', { class: 'num' }, priceShow(d.cost_e4)), h('td', { class: 'num bal' }, nf(d.total)), h('td', { class: 'num' }, d.payable ? nf(d.payable) : ''), h('td', { class: 'num' }, d.other_cost ? nf(d.other_cost) : ''),
        h('td', { class: 'desc small' }, d.note || ''), forPrint ? null : h('td', null, h('button', { class: 'btn ghost sm', onclick: () => purModal(d.id) }, T('open')))))),
      h('tfoot', null, h('tr', null, h('td', { colspan: 4 }, T('total'), ' (', r.totals.n, ')'), h('td', { class: 'num' }, volNum(r.totals.qty_ml, 0)), h('td'), h('td', { class: 'num' }, nf(r.totals.total)), h('td', { class: 'num' }, nf(r.totals.payable)), h('td', { class: 'num' }, nf(r.totals.other_cost)), h('td'), forPrint ? null : h('td')))));
    const run = guard(async () => {
      Object.assign(S, { puFrom: from.value, puTo: to.value, puSup: su.value, puFuel: fu.value, puQ: q.value });
      r = await api('GET', sp(`/purchases?from=${from.value}&to=${to.value}${su.value ? '&supplier_id=' + su.value : ''}${fu.value ? '&fuel_id=' + fu.value : ''}${q.value.trim() ? '&q=' + encodeURIComponent(q.value.trim()) : ''}`));
      out.replaceChildren(h('div', { class: 'grid' }, stat(T('invCount'), String(r.totals.n)), F.statN(T('qtyIn'), r.totals.qty_ml, (v) => vol(v, 0)), F.statN(T('invTotal'), r.totals.total, nf), F.statN(T('otherCost'), r.totals.other_cost, nf)),
        r.by_fuel.length ? h('div', { class: 'chips' }, r.by_fuel.map(f => h('span', { class: 'chip' }, h('b', null, f.fuel_name), ': ', f.n, ' ', T('invShort'), ' · ', vol(f.qty_ml, 0), ' · ', money(f.total), ' · ', T('avgCost'), ' ', nf(Math.round(f.total * 1000 / (f.qty_ml || 1))), '/', F.uLbl()))) : null,
        tbl(false));
    });
    const doPrint = async () => { if (!r) return; if (!S.brand) await loadBrand(); printDoc(`${T('pur')} ${from.value} - ${to.value}`, h('div', { class: 'a4 wide-doc' }, letterhead(T('pur'), `${from.value.replace(/-/g, '/')} — ${to.value.replace(/-/g, '/')}`), tbl(true), printFooter())); };
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
    main.append(sec(T('pur'), h('div', { class: 'row' }, field(T('from'), from), field(T('to'), to), field(T('supplierCol'), su), field(T('fuel'), fu), field(T('search'), q),
      h('button', { class: 'btn', onclick: run }, T('run')), h('button', { class: 'btn gold-btn', onclick: doPrint }, '⎙ ', T('printPdf')), cd('delivery.create') ? h('a', { class: 'btn ghost', href: '#stock' }, '+ ', T('newPurchase')) : null)), out);
    await run();
  };
  async function purModal(id) {
    const d = await api('GET', sp('/purchases/' + id));
    const doc = (forPrint) => h('div', { class: 'stack' },
      h('div', { class: 'partybox' }, h('div', null, h('span', null, T('invNo')), h('b', null, d.ref || '#' + d.id)), h('div', null, h('span', null, T('date')), h('b', null, d.business_date.replace(/-/g, '/'))),
        h('div', null, h('span', null, T('supplierCol')), h('b', null, d.supplier_name || d.supplier || '—')), h('div', null, h('span', null, T('tank')), h('b', null, d.tank_name + ' · ' + d.fuel_name))),
      h('div', { class: 'tw' + (forPrint ? '-print' : '') }, h('table', { class: 'stmt' }, h('thead', null, h('tr', null, [T('desc'), T('qty'), T('unitCost'), T('amount')].map((x, i) => h('th', { class: i ? 'num' : '' }, x)))),
        h('tbody', null, h('tr', null, h('td', { class: 'desc' }, d.note || d.fuel_name), h('td', { class: 'num' }, volNum(d.quantity_ml, 0)), h('td', { class: 'num' }, priceShow(d.cost_e4)), h('td', { class: 'num bal' }, nf(d.net + d.vat)))))),
      h('h3', null, T('postedAs')),
      h('div', { class: 'tw' + (forPrint ? '-print' : '') }, h('table', { class: 'stmt' }, h('thead', null, h('tr', null, [T('acctNo'), T('account'), T('party'), T('debit'), T('creditCol')].map((x, i) => h('th', { class: i >= 3 ? 'num' : '' }, x)))),
        h('tbody', null, d.lines.map(l => h('tr', null, h('td', { class: 'ref' }, l.code), h('td', null, l.name_ar), h('td', null, l.party_name || ''), h('td', { class: 'num' }, l.debit ? nf(l.debit) : ''), h('td', { class: 'num' }, l.credit ? nf(l.credit) : '')))))),
      h('div', { class: 'vline words' }, h('span', null, T('amountWords')), h('b', null, F.tafqeet(d.net + d.vat))));
    const m = modal(T('purInvoice') + ' ' + (d.ref || '#' + d.id), h('div', null, doc(false), h('div', { class: 'row' },
      h('button', { class: 'btn gold-btn', onclick: async () => { if (!S.brand) await loadBrand(); printDoc(`${T('purInvoice')} ${d.ref || d.id}`, h('div', { class: 'a4 vdoc' }, letterhead(T('purInvoice')), doc(true),
        h('div', { class: 'signs' }, h('div', null, T('storekeeperSig')), h('div', null, T('accountantSig')), h('div', null, T('managerSig'))), printFooter())); } }, '⎙ ', T('printPdf')))));
    m.classList.add('wide');
  }

  /* ================================ PROFIT & LOSS BY MONTH (الأرباح والخسائر) ================================ */
  F.plView = async (main) => {
    const yr = h('input', { type: 'number', min: 2000, max: 2100, value: S.plYear || todayIso().slice(0, 4), class: 'yr' }); const out = h('div', { class: 'stack' }); let r = null;
    const MN = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    const ml = (m) => P.lang === 'ar' ? MN[+m.slice(5) - 1] : m;
    const tbl = (forPrint) => { const tot = { qty_ml: 0, revenue: 0, cost_of_sales: 0, gross_profit: 0, operating_expenses: 0, other_income: 0, net_profit: 0 }; for (const m of r.months) for (const k in tot) tot[k] += m[k];
      const cols = [['revenue', T('revenue')], ['cost_of_sales', T('cogsL')], ['gross_profit', T('grossProfit')], ['operating_expenses', T('opex')], ['other_income', T('otherIncome')], ['net_profit', T('netProfit')]];
      return h('div', { class: forPrint ? 'tw-print' : 'tw' }, h('table', { class: 'stmt' },
        h('thead', null, h('tr', null, h('th', null, T('month')), h('th', { class: 'num' }, T('qty')), cols.map(([, l]) => h('th', { class: 'num' }, l)), h('th', { class: 'num' }, T('marginPct')))),
        h('tbody', null, r.months.map(m => h('tr', null, h('td', null, h('b', null, ml(m.month))), h('td', { class: 'num' }, volNum(m.qty_ml, 0)), cols.map(([k]) => h('td', { class: 'num' + (k === 'net_profit' ? ' bal ' + (m[k] < 0 ? 'neg' : 'pos') : '') }, nf(m[k]))), h('td', { class: 'num' }, pct(m.gross_profit, m.revenue))))),
        h('tfoot', null, h('tr', null, h('td', null, T('total')), h('td', { class: 'num' }, volNum(tot.qty_ml, 0)), cols.map(([k]) => h('td', { class: 'num' }, nf(tot[k]))), h('td', { class: 'num' }, pct(tot.gross_profit, tot.revenue))))));
    };
    const fuelTbl = (forPrint) => { const by = {}; for (const f of r.fuels) { const x = by[f.fuel_name] || (by[f.fuel_name] = { qty_ml: 0, revenue: 0, cogs: 0 }); x.qty_ml += f.qty_ml; x.revenue += f.revenue; x.cogs += f.cogs || 0; }
      return h('div', { class: forPrint ? 'tw-print' : 'tw' }, h('table', { class: 'stmt' }, h('thead', null, h('tr', null, [T('fuel'), T('qty'), T('revenue'), T('cogsL'), T('grossProfit'), T('perLitre'), T('marginPct')].map((x, i) => h('th', { class: i ? 'num' : '' }, x)))),
        h('tbody', null, Object.entries(by).map(([n, x]) => h('tr', null, h('td', null, h('b', null, n)), h('td', { class: 'num' }, volNum(x.qty_ml, 0)), h('td', { class: 'num' }, nf(x.revenue)), h('td', { class: 'num' }, nf(x.cogs)), h('td', { class: 'num bal' }, nf(x.revenue - x.cogs)),
          h('td', { class: 'num' }, nf(Math.round((x.revenue - x.cogs) * 1000 / (x.qty_ml || 1)))), h('td', { class: 'num' }, pct(x.revenue - x.cogs, x.revenue)))))));
    };
    const bars = () => { const mx = Math.max(1, ...r.months.map(m => Math.abs(m.net_profit)));
      return h('div', { class: 'plbars' }, r.months.map(m => h('div', { class: 'plbar' }, h('div', { class: 'plv' + (m.net_profit < 0 ? ' neg' : ''), 'data-h': String(Math.round(Math.abs(m.net_profit) * 100 / mx)) }), h('small', null, ml(m.month).slice(0, 5)), h('b', null, nf(m.net_profit).replace(/\.\d+$/, ''))))); };
    let old = null;
    const oldTbl = (forPrint) => { const cols = [['revenue', T('revenue')], ['cost_of_sales', T('cogsL')], ['gross_profit', T('grossProfit')], ['operating_expenses', T('opex')], ['other_income', T('otherIncome')], ['net_profit', T('netProfit')]];
      const tot = {}; for (const [k] of cols) tot[k] = old.months.reduce((s, m) => s + m[k], 0);
      return h('div', { class: forPrint ? 'tw-print' : 'tw' }, h('table', { class: 'stmt' },
        h('thead', null, h('tr', null, h('th', null, T('month')), h('th', null, T('oldRunDate')), cols.map(([, l]) => h('th', { class: 'num' }, l)), h('th', { class: 'num' }, T('marginPct')))),
        h('tbody', null, old.months.map(m => h('tr', null, h('td', null, h('b', null, ml(m.month)), m.derived ? h('small', { class: 'muted' }, ' *') : ''), h('td', { class: 'ltr-num' }, m.as_of.slice(5).replace('-', '/')),
          cols.map(([k]) => h('td', { class: 'num' + (k === 'net_profit' ? ' bal ' + (m[k] < 0 ? 'neg' : 'pos') : '') }, nf(m[k]))), h('td', { class: 'num' }, pct(m.gross_profit, m.revenue))))),
        h('tfoot', null, h('tr', null, h('td', { colspan: 2 }, T('total')), cols.map(([k]) => h('td', { class: 'num' }, nf(tot[k]))), h('td', { class: 'num' }, pct(tot.gross_profit, tot.revenue))))));
    };
    const oldSec = () => old && old.months.length ? sec(T('oldResults') + ' — ' + old.year, h('p', { class: 'hint' }, T('oldResultsHelp')), oldTbl(false),
      old.months.some(m => m.derived) ? h('p', { class: 'hint' }, '* ', T('oldDerived'), old.year_run ? ' — ' + T('oldYearRun') + ': ' + nf(old.year_run.net_profit) : '') : null) : null;
    const yearsHint = () => old && old.years.length ? h('p', { class: 'hint' }, T('oldYears'), ': ', old.years.map(y => h('button', { class: 'btn ghost sm', onclick: () => { yr.value = y; run(); } }, String(y)))) : null;
    const run = guard(async () => { S.plYear = yr.value; [r, old] = await Promise.all([api('GET', `/api/accounting/profit-by-month?station_id=${S.sid}&year=${yr.value}`), api('GET', sp(`/reports/old-results?year=${yr.value}`)).catch(() => null)]);
      const has = r.months.some(m => m.revenue || m.net_profit || m.operating_expenses);
      out.replaceChildren(yearsHint() || '', has ? bars() : '', has ? tbl(false) : '', has ? h('h3', null, T('byFuel')) : '', has ? fuelTbl(false) : '', oldSec() || '', h('p', { class: 'hint' }, T('plNote')));
      out.querySelectorAll('.plv').forEach(el => { el.style.height = el.dataset.h + '%'; }); });
    const doPrint = async () => { if (!r) return; if (!S.brand) await loadBrand(); printDoc(`${T('plTitle')} ${r.year}`, h('div', { class: 'a4 wide-doc' }, letterhead(T('plTitle'), String(r.year)), r.months.length ? tbl(true) : '', r.months.length ? h('h3', null, T('byFuel')) : '', r.months.length ? fuelTbl(true) : '', old && old.months.length ? [h('h3', null, T('oldResults')), oldTbl(true)] : '',
      h('div', { class: 'signs' }, h('div', null, T('accountantSig')), h('div', null, T('auditorSig')), h('div', null, T('managerSig'))), printFooter())); };
    main.append(sec(T('plTitle'), h('div', { class: 'row' }, field(T('year'), yr), h('button', { class: 'btn', onclick: run }, T('run')), h('button', { class: 'btn gold-btn', onclick: doPrint }, '⎙ ', T('printPdf')))), out);
    await run();
  };


  /* ================================ CURRENCIES & EXCHANGE RATES (العملات) ================================ */
  F.VIEWS.cur = async (main) => {
    const curs = await api('GET', '/api/currencies');
    const base = S.st.currency;
    main.append(h('div', { class: 'grid' }, stat(T('baseCur'), base), ...curs.map(c => h('div', { class: 'stat price-card' }, h('div', { class: 'k' }, c.name_ar, ' · ', c.code),
      h('div', { class: 'v' }, c.rate_e6 ? String(c.rate_e6 / 1e6) : '—', h('small', null, ' ', base, ' / 1 ', c.code)), h('div', { class: 'muted small' }, c.rate_date ? T('since') + ' ' + fdate(c.rate_date) : T('noRate'))))));
    if (cd('config.edit') && curs.length) {
      const cc = sel('rtCur', curs.map(c => [c.code, c.code + ' · ' + c.name_ar])), rv = h('input', { inputmode: 'decimal' }), rd = dateIn('rtDate', todayIso());
      main.append(h('form', { class: 'card', onsubmit: guard(async (e) => { e.preventDefault(); await api('POST', '/api/currencies/rates', { code: cc.value, rate_e6: Math.round(Number(rv.value) * 1e6), date: rd.value }); toast(T('saved')); render(); }) },
        h('h2', null, T('setRate')), h('div', { class: 'grid' }, field(T('currency'), cc), field(T('rateLbl') + ' (' + base + ')', rv), field(T('date'), rd)), h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('save')))));
    }
    /* revaluation */
    const rd = dateIn('rvDate', S.rvDate || todayIso()), out = h('div');
    const runRv = guard(async () => { S.rvDate = rd.value; const r = await api('GET', `/api/accounting/revaluation?station_id=${S.sid}&date=${rd.value}`);
      const tot = r.rows.reduce((a, x) => a + (x.diff || 0), 0);
      out.replaceChildren(r.rows.length ? table([T('acctNo'), T('account'), T('currency'), T('fcBalance'), T('rateLbl'), T('bookValue'), T('worthNow'), T('fxDiff')],
        [...r.rows.map(x => [x.code, nm(x), x.currency, h('b', null, nf(x.fc_balance)), x.rate_e6 ? String(x.rate_e6 / 1e6) : '—', money(x.book), x.worth == null ? '—' : money(x.worth), x.diff ? h('b', { class: x.diff > 0 ? 'ok' : 'bad' }, money(x.diff)) : '0']),
          ['', h('b', null, T('total')), '', '', '', '', '', h('b', { class: tot > 0 ? 'ok' : tot < 0 ? 'bad' : '' }, money(tot))]]) : h('p', { class: 'muted' }, T('noFcAccounts')),
        tot && cd('journal.post') ? h('div', { class: 'row' }, h('button', { class: 'btn', onclick: guard(async () => { const p = await api('POST', '/api/accounting/revaluation', { station_id: S.sid, date: rd.value }); toast(T('js.posted') + ' #' + p.id); runRv(); }) }, T('postReval'))) : null); });
    main.append(sec(T('reval'), h('p', { class: 'hint' }, T('revalHelp')), h('div', { class: 'row' }, field(T('asOf'), rd), h('button', { class: 'btn ghost', onclick: runRv }, T('run'))), out));
    /* history and the list of currencies */
    main.append(h('div', { class: 'grid2' }, ...curs.map(c => sec(T('rateHistory') + ' — ' + c.code, c.history.length ? table([T('date'), T('rateLbl')], c.history.map(x => [fdate(x.rate_date), String(x.rate_e6 / 1e6)])) : h('p', { class: 'muted' }, T('noData')),
      c.accounts.length ? h('p', { class: 'muted small' }, T('fcAccounts'), ': ', c.accounts.map(a => a.code + ' ' + nm(a)).join('، ')) : null))));
    if (cd('config.edit')) {
      const code = h('input', { maxlength: 3, placeholder: 'USD', dir: 'ltr' }), na = h('input'), ne = h('input', { dir: 'ltr' }), rt = h('input', { inputmode: 'decimal' });
      main.append(h('form', { class: 'card', onsubmit: guard(async (e) => { e.preventDefault(); await api('POST', '/api/currencies', { code: code.value, name_ar: na.value, name_en: ne.value || na.value, ...(rt.value ? { rate_e6: Math.round(Number(rt.value) * 1e6) } : {}) }); toast(T('saved')); render(); }) },
        h('h2', null, T('addCurrency')), h('div', { class: 'grid' }, field(T('code'), code), field(T('nameAr'), na), field(T('nameEn'), ne), field(T('rateLbl') + ' (' + base + ')', rt)), h('p', { class: 'hint' }, T('curHelp')),
        h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('add')))));
    }
    await runRv();
  };

  /* ================================ FIXED ASSETS (الأصول الثابتة) ================================ */
  F.VIEWS.fa = async (main) => {
    const list = await api('GET', sp('/assets')); const { accts } = await refData();
    const tot = list.reduce((a, x) => ({ cost: a.cost + x.cost, acc: a.acc + x.accumulated, bv: a.bv + x.book_value, m: a.m + (x.disposed_on ? 0 : x.monthly) }), { cost: 0, acc: 0, bv: 0, m: 0 });
    main.append(h('div', { class: 'grid' }, F.statN(T('assetCost'), tot.cost, nf), F.statN(T('accumDep'), tot.acc, nf), F.statN(T('bookValue'), tot.bv, nf), F.statN(T('monthlyDep'), tot.m, nf)));
    const tbl = (forPrint) => h('div', { class: forPrint ? 'tw-print' : 'tw' }, h('table', { class: 'stmt' },
      h('thead', null, h('tr', null, [T('acctNo'), T('asset'), T('acquired'), T('assetCost'), T('lifeMonths'), T('monthlyDep'), T('accumDep'), T('bookValue'), T('lastDep'), forPrint ? null : ''].filter(x => x !== null).map((x, i) => h('th', { class: [3, 5, 6, 7].includes(i) ? 'num' : '' }, x)))),
      h('tbody', null, list.map(a => h('tr', { class: a.disposed_on ? 'voided' : '' }, h('td', { class: 'ref' }, a.ref || a.acct_code), h('td', null, h('b', null, a.name), a.life_months ? null : h('div', { class: 'muted small' }, T('setLife'))),
        h('td', { class: 'nowrap' }, forPrint ? a.acquired_on.replace(/-/g, '/') : fdate(a.acquired_on)), h('td', { class: 'num' }, nf(a.cost)), h('td', { class: 'num' }, a.life_months || '—'), h('td', { class: 'num' }, a.monthly ? nf(a.monthly) : ''),
        h('td', { class: 'num' }, nf(a.accumulated)), h('td', { class: 'num bal' }, nf(a.book_value)), h('td', null, a.last_month || ''), forPrint ? null : h('td', null, cd('account.edit') ? h('button', { class: 'btn ghost sm', onclick: () => assetModal(a, accts) }, T('edit')) : '')))),
      h('tfoot', null, h('tr', null, h('td', { colspan: 3 }, T('total'), ' (', list.length, ')'), h('td', { class: 'num' }, nf(tot.cost)), h('td'), h('td', { class: 'num' }, nf(tot.m)), h('td', { class: 'num' }, nf(tot.acc)), h('td', { class: 'num' }, nf(tot.bv)), h('td'), forPrint ? null : h('td')))));
    const doPrint = async () => { if (!S.brand) await loadBrand(); printDoc(`${T('fa')} ${todayIso()}`, h('div', { class: 'a4 wide-doc' }, letterhead(T('faRegister'), T('asOf') + ' ' + todayIso().replace(/-/g, '/')), tbl(true),
      h('div', { class: 'signs' }, h('div', null, T('accountantSig')), h('div', null, T('auditorSig')), h('div', null, T('managerSig'))), printFooter())); };
    main.append(sec(T('faRegister'), h('div', { class: 'row' }, h('button', { class: 'btn gold-btn', onclick: doPrint }, '⎙ ', T('printPdf')), cd('account.edit') ? h('button', { class: 'btn ghost', onclick: () => assetModal(null, accts) }, '+ ', T('addAsset')) : null), list.length ? tbl(false) : h('p', { class: 'muted' }, T('noData'))));
    if (cd('journal.post')) {
      const mo = h('input', { type: 'month', value: S.depMonth || todayIso().slice(0, 7), max: todayIso().slice(0, 7) }), res = h('div');
      main.append(h('form', { class: 'card', onsubmit: guard(async (e) => { e.preventDefault(); S.depMonth = mo.value; const r = await api('POST', sp('/assets/depreciate'), { month: mo.value });
        toast(r.posted.length ? T('depPosted', { n: r.posted.length }) + ' · ' + nf(r.total) : T('depNothing')); render(); }) },
        h('h2', null, T('runDep')), h('p', { class: 'hint' }, T('depHelp')), h('div', { class: 'row' }, field(T('month'), mo), h('button', { class: 'btn', type: 'submit' }, T('postDep'))), res));
    }
  };
  function assetModal(a, accts) {
    const leaf = accts.filter(x => !x.is_group && x.active);
    const nmI = h('input', { value: a ? a.name : '' }), acq = h('input', { type: 'date', value: a ? a.acquired_on : todayIso() }), cost = h('input', { inputmode: 'decimal', value: a ? String(a.cost / 10 ** dec()) : '' });
    const sal = h('input', { inputmode: 'decimal', value: a ? String(a.salvage / 10 ** dec()) : '0' }), life = h('input', { inputmode: 'numeric', value: a ? String(a.life_months) : '60' }), oa = h('input', { inputmode: 'decimal', value: a ? String(a.opening_accum / 10 ** dec()) : '0' });
    const disp = h('input', { type: 'date', value: a && a.disposed_on ? a.disposed_on : '' }), note = h('input', { value: a && a.note ? a.note : '' });
    const pk = acctPicker(leaf.filter(x => x.type === 'asset'), 'faAcct', null, a ? leaf.find(x => x.id === a.account_id) : null);
    const m = modal(a ? T('edit') + ': ' + a.name : T('addAsset'), h('form', { onsubmit: guard(async (e) => { e.preventDefault();
      const acc = pk.querySelector('input').acct; if (!acc) throw new Error(T('pickAccount'));
      const b = { name: nmI.value, account_id: acc.id, acquired_on: acq.value, cost: num(cost.value, (v) => parseDec(v, dec())), salvage: num(sal.value || '0', (v) => parseDec(v, dec())), life_months: +life.value || 0,
        opening_accum: num(oa.value || '0', (v) => parseDec(v, dec())), disposed_on: disp.value || null, note: note.value };
      await api(a ? 'PATCH' : 'POST', sp('/assets' + (a ? '/' + a.id : '')), b); m.remove(); toast(T('saved')); render(); }) },
      h('div', { class: 'grid' }, field(T('asset'), nmI), field(T('assetAcct'), pk), field(T('acquired'), acq), field(T('assetCost'), cost), field(T('salvage'), sal), field(T('lifeMonths'), life), field(T('openingAccum'), oa), field(T('disposedOn'), disp), field(T('note'), note)),
      h('p', { class: 'hint' }, T('faHelp')), h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('save')))));
    m.classList.add('wide');
  }


  /* ================================ MONTHLY STOCK COUNT (الجرد الشهري) ================================ */
  F.VIEWS.cnt = async (main) => {
    const yr = h('input', { type: 'number', class: 'yr', min: 2000, max: 2100, value: S.cntYear || todayIso().slice(0, 4) });
    const out = h('div', { class: 'stack' }); let r = null;
    const L = (ml) => volNum(ml, 0), pctBp = (bp) => (bp / 100).toFixed(2) + '%';
    const tankTbl = (t, forPrint) => h('div', { class: forPrint ? 'tw-print' : 'tw' }, h('table', { class: 'stmt' },
      h('thead', null, h('tr', null, [T('month'), T('openingQty'), T('received'), T('soldQty'), T('shortage'), T('surplus'), T('lossPct'), T('lossValue'), T('closingQty')].map((x, i) => h('th', { class: i ? 'num' : '' }, x)))),
      h('tbody', null, t.months.map(m => h('tr', { class: m.over_tolerance ? 'over' : '' }, h('td', null, h('b', null, m.month)), h('td', { class: 'num' }, L(m.opening_ml)), h('td', { class: 'num' }, L(m.received_ml)), h('td', { class: 'num' }, L(m.sold_ml)),
        h('td', { class: 'num' + (m.shortage_ml ? ' neg' : '') }, m.shortage_ml ? L(m.shortage_ml) : ''), h('td', { class: 'num pos' }, m.surplus_ml ? L(m.surplus_ml) : ''),
        h('td', { class: 'num' + (m.over_tolerance ? ' neg' : '') }, m.sold_ml ? pctBp(m.loss_bp) : ''), h('td', { class: 'num' }, m.loss_value ? nf(m.loss_value) : ''), h('td', { class: 'num bal' }, L(m.closing_ml))))),
      h('tfoot', null, h('tr', null, h('td', { colspan: 2 }, T('total')), h('td', { class: 'num' }, L(t.totals.received_ml)), h('td', { class: 'num' }, L(t.totals.sold_ml)), h('td', { class: 'num', colspan: 2 }, L(-t.totals.counted_ml)),
        h('td', { class: 'num' }, pctBp(t.totals.loss_bp)), h('td', { class: 'num' }, nf(t.totals.loss_value)), h('td', { class: 'num' }, L(t.level_ml))))));
    const oldTbl = (rows) => rows.length ? h('div', { class: 'tw' }, h('table', { class: 'stmt' },
      h('thead', null, h('tr', null, [T('month'), T('oldValue'), T('fpValue'), T('diffCol')].map((x, i) => h('th', { class: i ? 'num' : '' }, x)))),
      h('tbody', null, rows.map(x => h('tr', null, h('td', null, fdate(x.month_end)), h('td', { class: 'num' }, nf(x.value)), h('td', { class: 'num' }, x.fuelpro_value == null ? '—' : nf(x.fuelpro_value)),
        h('td', { class: 'num' + (x.difference ? ' neg' : '') }, x.difference == null ? '' : nf(x.difference))))))) : null;
    const run = guard(async () => { S.cntYear = yr.value; const [rr, old] = await Promise.all([api('GET', sp(`/stock/monthly?year=${yr.value}`)), api('GET', sp(`/stock/old-values?year=${yr.value}`)).catch(() => ({ rows: [] }))]); r = rr;
      out.replaceChildren(h('p', { class: 'hint' }, T('cntHelp', { t: pctBp(r.tolerance_bp) })),
        ...r.tanks.map(t => { const o = old.rows.filter(x => x.tank_id === t.tank_id);
          return sec(h('span', null, t.tank_name, ' · ', t.fuel_name, ' — ', T('bookNow'), ': ', h('b', null, vol(t.level_ml, 0))), tankTbl(t, false), o.length ? h('h3', null, T('oldStock')) : '', oldTbl(o) || ''); }),
        old.rows.length ? h('p', { class: 'hint' }, T('oldStockHelp')) : ''); });
    const doPrint = async () => { if (!r) return; if (!S.brand) await loadBrand(); printDoc(`${T('cnt')} ${r.year}`, h('div', { class: 'a4 wide-doc' }, letterhead(T('cntReport'), String(r.year)),
      ...r.tanks.map(t => h('div', { class: 'stack' }, h('h3', null, t.tank_name, ' · ', t.fuel_name), tankTbl(t, true))), h('div', { class: 'signs' }, h('div', null, T('storekeeperSig')), h('div', null, T('accountantSig')), h('div', null, T('managerSig'))), printFooter())); };
    main.append(sec(T('cnt'), h('div', { class: 'row' }, field(T('year'), yr), h('button', { class: 'btn', onclick: run }, T('run')), h('button', { class: 'btn gold-btn', onclick: doPrint }, '⎙ ', T('printPdf')))));
    /* count now: measured dip vs book, and who bears a shortage */
    if (cd('adjust.create')) {
      const tanks = await api('GET', sp('/tanks')); const sups = cd('supplier.manage', 'supplier.pay', 'report.read') ? await api('GET', sp('/suppliers')) : [];
      const tk = sel('cnTank', tanks.map(t => [t.id, `${t.name} — ${t.fuel_name}`])), meas = h('input', { inputmode: 'decimal' }), who = sel('cnWho', [['', T('stationLoss')], ...sups.map(x => [x.id, T('chargeTo') + ': ' + x.name])]), note = h('input', { value: T('cntNote', { m: todayIso().slice(0, 7) }) });
      const prev = h('div', { class: 'hint' });
      const upd = () => { const t = tanks.find(x => String(x.id) === tk.value); const ml = F.volMl(meas.value); if (!t) return;
        if (ml == null) { prev.replaceChildren(T('bookNow'), ': ', h('b', null, vol(t.level_ml, 0))); return; }
        const d = ml - t.level_ml; prev.replaceChildren(T('bookNow'), ': ', h('b', null, vol(t.level_ml, 0)), ' · ', T('diff'), ': ', h('b', { class: d < 0 ? 'bad' : d > 0 ? 'ok' : '' }, (d > 0 ? '+' : '') + vol(d, 0)),
          ' · ', T('lossValue'), ': ', h('b', null, nf(Math.round(Math.abs(d) * t.avg_cost_e4 / 1e7)))); };
      tk.onchange = upd; meas.oninput = upd; upd();
      main.append(h('form', { class: 'card', onsubmit: guard(async (e) => { e.preventDefault(); const ml = F.volMl(meas.value); if (ml == null) throw new Error(T('enterMeasured'));
        const res = await api('POST', sp('/adjustments'), { tank_id: +tk.value, after_ml: ml, note: note.value, ...(who.value ? { charge_supplier_id: +who.value } : {}) });
        toast(T('saved') + ' · ' + (res.diff_ml > 0 ? '+' : '') + vol(res.diff_ml, 0)); await F.loadBase(); render(); }) },
        h('h2', null, T('countNow')), h('p', { class: 'hint' }, T('countNowHelp')), h('div', { class: 'grid' }, field(T('tank'), tk), field(T('measuredQty', { u: F.uLbl() }), meas), field(T('whoBears'), who), field(T('note'), note)), prev,
        h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('postCount')))));
    }
    if (cd('users.manage')) {
      const tol = h('input', { inputmode: 'decimal', value: String((S.st.loss_tolerance_bp ?? 50) / 100) });
      main.append(h('form', { class: 'card', onsubmit: guard(async (e) => { e.preventDefault(); await api('PATCH', `/api/stations/${S.sid}`, { loss_tolerance_bp: Math.round(Number(tol.value) * 100) }); toast(T('saved')); await F.loadBase(); render(); }) },
        h('h2', null, T('tolerance')), h('div', { class: 'row' }, field(T('tolerancePct'), tol), h('button', { class: 'btn ghost', type: 'submit' }, T('save')))));
    }
    main.append(out); await run();
  };

  /* ================================ BACKUPS (النسخ الاحتياطي) ================================ */
  async function backupCard() {
    const box = h('div');
    const load = guard(async () => { const r = await api('GET', '/api/backups');
      box.replaceChildren(h('p', { class: 'hint' }, T('backupHelp'), ' ', h('span', { class: 'ltr-num small' }, r.dir)),
        r.rows.length ? table([T('date'), T('kind'), T('size'), ''], r.rows.map(b => [b.name.slice(8, 25).replace(/-(\d{2})(\d{2})(\d{2})$/, ' $1:$2:$3'), T('bk.' + b.kind), (b.bytes / 1048576).toFixed(1) + ' MB',
          h('a', { class: 'btn ghost sm', href: '/api/backups/' + encodeURIComponent(b.name), download: b.name }, '⬇ ', T('download'))])) : h('p', { class: 'muted' }, T('noBackups'))); });
    const card = sec(T('backups'), h('div', { class: 'row' }, h('button', { class: 'btn', onclick: guard(async () => { const r = await api('POST', '/api/backups'); toast(T('saved') + ' · ' + r.name); load(); }) }, T('backupNow'))), box);
    await load(); return card;
  }
  const setupView2 = F.VIEWS.setup;
  if (setupView2) F.VIEWS.setup = async (main) => { await setupView2(main); if (cd('users.manage') && (S.user.role === 'owner' || S.user.role === 'admin')) main.append(await backupCard()); };

  /* ================================ DAILY METER SHEET ================================ */
  F.VIEWS.mtr = async (main) => {
    const from = dateIn('mFrom', S.mFrom || monthStart()), to = dateIn('mTo', S.mTo || todayIso()), out = h('div', { class: 'stack' });
    let last = null;
    const run = guard(async () => {
      S.mFrom = from.value; S.mTo = to.value;
      const r = last = await api('GET', sp(`/reports/meters?from=${from.value}&to=${to.value}`));
      out.replaceChildren(h('div', { class: 'grid' }, F.statN(T('volSold'), r.totals.qty_ml, (v) => vol(v, 0)), F.statN(T('sales'), r.totals.amount, money), F.statN(T('cashSales'), r.totals.cash, money), F.statN(T('creditSales'), r.totals.credit, money)),
        ...(r.days.length ? r.days.slice().reverse().map(d => sec(h('span', null, fdate(d.date), ' — ', h('b', null, money(d.amount)), ' · ', vol(d.qty_ml, 0)),
          table([T('pump'), T('fuel'), T('openMeter'), T('closeMeterCol'), T('qty'), T('price', { u: F.uLbl() }), T('cashSales'), T('creditSales'), T('total')],
            [...d.pumps.map(p => [p.pump_name, p.fuel_name, volNum(p.open_ml, 3), volNum(p.close_ml, 3), volNum(p.qty_ml, 3), priceShow(p.price_e4), money(p.cash), money(p.credit), h('b', null, money(p.amount))]),
              ['', '', '', h('b', null, T('total')), h('b', null, volNum(d.qty_ml, 3)), '', h('b', null, money(d.cash)), h('b', null, money(d.credit)), h('b', null, money(d.amount))]]))) : [h('p', { class: 'muted' }, T('noData'))]));
    });
    const exp = h('button', { class: 'btn ghost sm', onclick: () => last && csv(`meters-${last.from}_${last.to}.csv`, ['date', 'pump', 'fuel', 'open_l', 'close_l', 'qty_l', 'cash', 'credit', 'total'],
      last.days.flatMap(d => d.pumps.map(p => [d.date, p.pump_name, p.fuel_name, p.open_ml / 1000, p.close_ml / 1000, p.qty_ml / 1000, (p.cash / 10 ** dec()).toFixed(dec()), (p.credit / 10 ** dec()).toFixed(dec()), (p.amount / 10 ** dec()).toFixed(dec())]))) }, 'CSV');
    main.append(sec(T('mtr'), h('p', { class: 'hint' }, T('mtrHelp')), h('div', { class: 'row' }, field(T('from'), from), field(T('to'), to), h('button', { class: 'btn', onclick: run }, T('run')), exp, h('button', { class: 'btn ghost sm', onclick: () => printNode(T('mtr'), out) }, T('print')))), out);
    await run();
  };
})();
