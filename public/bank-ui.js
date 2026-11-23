'use strict';
/* «تسوية البنك» — match a bank (or cash) account with its statement: tick the lines the statement shows,
   the difference must reach zero before the reconciliation is finalised. The books are never changed. */
(function () {
  const F = window.FP; if (!F) return;
  const { h, T, P, S, api, sp, guard, toast, field, sec, modal, render, cd, dec, parseDec, fdate, todayIso, printNode } = F;
  const tile = (k, v, cls) => h('div', { class: 'xtile ' + (cls || '') }, h('span', null, k), h('b', null, v));
  const nm = (a) => (P.lang === 'ar' ? a.name_ar : a.name_en) || a.name_ar;
  const fmt = (v, d) => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }).format((v || 0) / 10 ** d);
  const decOf = (acct) => acct.currency ? (acct.decimals ?? 2) : dec();
  const money = (v, acct) => fmt(v, acct.currency ? (acct.decimals ?? 2) : Math.min(dec(), S.st.disp_dec ?? dec())) + (acct.currency ? ' ' + acct.currency : '');

  F.VIEWS.bank = async (main) => {
    if (S.bankRec) { await recView(main, S.bankRec); return; }
    const accts = await api('GET', sp('/bank-recs'));
    const can = cd('bank.reconcile');
    main.append(sec(T('bank'), h('p', { class: 'hint' }, T('bankHelp')),
      ...accts.map(a => h('div', { class: 'card' },
        h('div', { class: 'row between' }, h('div', null, h('b', null, a.code, ' · ', nm(a)), ' ', h('span', { class: 'chip' }, T(a.kind === 'bank' ? 'boxKindBank' : 'boxKindCash')), a.currency ? h('span', { class: 'chip' }, a.currency) : ''),
          h('div', { class: 'muted small' }, T('bookBalance'), ': ', h('b', null, money(a.book_balance, a)), ' · ', T('lastRec'), ': ', a.last_final ? fdate(a.last_final.statement_date) : T('never'))),
        h('div', { class: 'row' },
          a.draft ? h('button', { class: 'btn sm', onclick: () => { S.bankRec = a.draft.id; render(); } }, T('continueRec'), ' — ', fdate(a.draft.statement_date))
            : can ? h('button', { class: 'btn sm', onclick: () => newRec(a) }, T('newRec')) : null,
          a.recs.length ? h('details', null, h('summary', null, T('recHistory'), ` (${a.recs.length})`),
            F.table([T('statementDate'), T('statementBal'), T('status'), ''], a.recs.map(r => [fdate(r.statement_date), money(r.statement_balance, a), T('rec.' + r.status),
              h('button', { class: 'btn ghost sm', onclick: () => { S.bankRec = r.id; render(); } }, T('open'))]))) : null)))));
  };

  const newRec = (a) => {
    const d = h('input', { type: 'date', value: todayIso(), max: todayIso() }), b = h('input', { inputmode: 'decimal', required: true }), note = h('input', { maxlength: 200 });
    const m = modal(T('newRec') + ': ' + nm(a), h('form', { onsubmit: guard(async (e) => { e.preventDefault();
      const r = await api('POST', sp('/bank-recs'), { account_id: a.account_id, statement_date: d.value, statement_balance: parseDec(b.value, a.currency ? 2 : dec()), note: note.value || undefined });
      m.remove(); S.bankRec = r.id; render(); }) },
      h('p', { class: 'hint' }, T('newRecHelp')), field(T('statementDate'), d), field(T('statementBal') + (a.currency ? ` (${a.currency})` : ''), b), field(T('memo'), note),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('start')))));
  };

  async function recView(main, id) {
    let r = await api('GET', sp('/bank-recs/' + id));
    const draft = r.status === 'draft', can = cd('bank.reconcile') && draft;
    const pending = new Map();                                   // line id -> wanted cleared state, sent with «حفظ»
    const q = h('input', { type: 'search', placeholder: T('search') });
    const out = h('div', { class: 'stack' }), sumBox = h('div');
    const ac = r.account, d = decOf(ac);
    const summary = () => { const s = r.summary;
      sumBox.replaceChildren(h('div', { class: 'xtiles' }, tile(T('bookBalance'), money(s.book_balance, ac)), tile(T('outDeposits'), money(s.outstanding_deposits, ac)), tile(T('outPayments'), money(s.outstanding_payments, ac)),
        tile(T('clearedBal'), money(s.cleared_balance, ac)), tile(T('statementBal'), money(s.statement_balance, ac), 'gold'), tile(T('difference'), money(s.difference, ac), s.balanced ? '' : 'red')),
        h('p', { class: s.balanced ? 'note good' : 'note' }, s.balanced ? T('recBalanced') : T('recNotBalanced'))); };
    const isOn = (l) => pending.has(l.id) ? pending.get(l.id) : l.cleared;
    const draw = () => { const t = q.value.trim();
      const rows = r.lines.filter(l => !t || (l.memo || '').includes(t) || String(l.ref || '').includes(t) || fmt(Math.abs(l.amount), d).includes(t));
      out.replaceChildren(F.table(['', T('date'), T('docNo'), T('source'), T('memo'), T('deposit'), T('withdrawal')], rows.map(l => {
        const cb = h('input', { type: 'checkbox', checked: isOn(l), disabled: !can, 'aria-label': T('cleared'), onchange: (e) => { if (e.target.checked === l.cleared) pending.delete(l.id); else pending.set(l.id, e.target.checked); local(); } });
        return [cb, fdate(l.date), l.ref || '#' + l.journal_id, l.doc_type || T('src.' + l.source), (l.memo || '').slice(0, 70), l.amount > 0 ? fmt(l.amount, d) : '', l.amount < 0 ? fmt(-l.amount, d) : '']; }))); };
    /* recompute the summary locally while ticking, so the difference moves as you go */
    const local = () => { const s = { ...r.summary }; let now = 0, dep = 0, pay = 0;
      for (const l of r.lines) { if (isOn(l)) now += l.amount; else if (l.amount > 0) dep += l.amount; else pay += l.amount; }
      s.cleared_now = now; s.cleared_balance = s.cleared_before + now; s.outstanding_deposits = dep; s.outstanding_payments = pay; s.difference = s.statement_balance - s.cleared_balance; s.balanced = s.difference === 0;
      const keep = r.summary; r.summary = s; summary(); r.summary = keep; };
    const save = guard(async () => { if (!pending.size) return; const clear = [], unclear = []; for (const [k, v] of pending) (v ? clear : unclear).push(k);
      r = await api('PATCH', sp('/bank-recs/' + id), { clear, unclear }); pending.clear(); summary(); draw(); toast(T('saved')); });
    const tickAll = () => { for (const l of r.lines) if (!isOn(l)) pending.set(l.id, true); local(); draw(); };
    const finalize = guard(async () => { await save(); r = await api('POST', sp(`/bank-recs/${id}/finalize`)); toast(T('saved')); render(); });
    const edit = () => { const dd = h('input', { type: 'date', value: r.statement_date, max: todayIso() }), b = h('input', { inputmode: 'decimal', value: fmt(r.statement_balance, d).replace(/,/g, '') });
      const m = modal(T('editRec'), h('form', { onsubmit: guard(async (e) => { e.preventDefault(); await save(); r = await api('PATCH', sp('/bank-recs/' + id), { statement_date: dd.value, statement_balance: parseDec(b.value, d) }); m.remove(); render(); }) },
        field(T('statementDate'), dd), field(T('statementBal'), b), h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('save'))))); };
    q.oninput = draw;
    summary(); draw();
    main.append(sec(`${T('bank')}: ${ac.code} · ${nm(ac)} — ${fdate(r.statement_date)}`, h('p', { class: 'hint' }, T('rec.' + r.status), r.note ? ' · ' + r.note : ''),
      h('div', { class: 'row' }, h('button', { class: 'btn ghost sm', onclick: () => { S.bankRec = null; render(); } }, '← ', T('back')),
        can ? [h('button', { class: 'btn sm', onclick: save }, T('save')), h('button', { class: 'btn ghost sm', onclick: tickAll }, T('tickAll')), h('button', { class: 'btn ghost sm', onclick: edit }, T('editRec')),
          h('button', { class: 'btn gold-btn sm', onclick: finalize }, T('finalizeRec')),
          h('button', { class: 'btn danger sm', onclick: guard(async () => { if (!confirm(T('deleteRecQ'))) return; await api('DELETE', sp('/bank-recs/' + id)); S.bankRec = null; render(); }) }, T('delete'))] : null,
        !draft && cd('bank.reconcile') ? h('button', { class: 'btn ghost sm', onclick: guard(async () => { await api('POST', sp(`/bank-recs/${id}/reopen`)); render(); }) }, T('reopenRec')) : null,
        h('button', { class: 'btn ghost sm', onclick: () => printNode(`${T('bank')} ${ac.code} ${r.statement_date}`, h('div', null, sumBox.cloneNode(true), out.cloneNode(true))) }, '⎙ ', T('print'))),
      sumBox, field(T('search'), q), out));
  }
})();
