'use strict';
/* FuelPro print kit (0.32) — one engine and one look for printed documents.
   F.P2.print(title, node, { paper, footer })   paper: 'a4' | 'a4l' | 'r80' | 'r58'
     · waits for the print faces (document.fonts) before opening the print dialog
     · writes the page frame for this document: size, margins, «page X of Y», printed by / at, organisation — in the user's language
     · receipts get a page exactly as long as their content (thermal roll), with 2.5 mm side margins
   Documents built here: receipt (80/58 mm), account statement (A4), journal book (A4, many pages). Others follow after the owner's OK.
   Display only: amounts come in as integers in minor units and are only formatted here. */
(function () {
  const F = window.FP; if (!F) return;
  const { h, T, S, P } = F;
  const lang = () => P.lang || 'ar', rtl = () => lang() === 'ar';
  const loc = () => lang() + '-u-nu-' + (P.nums || 'latn');
  const dec = () => (S.st ? S.st.cur_dec : 2), ddec = () => Math.min(dec(), S.st && S.st.disp_dec != null ? S.st.disp_dec : dec());
  /* money: integer minor units → text, grouped, fixed decimals; never a float in the books, only on paper */
  const amt = (v) => { const d = dec(), dd = ddec(); return new Intl.NumberFormat(loc(), { minimumFractionDigits: dd, maximumFractionDigits: dd }).format((v || 0) / 10 ** d); };
  const qty = (ml, d = 3) => new Intl.NumberFormat(loc(), { minimumFractionDigits: d, maximumFractionDigits: d }).format((ml || 0) / 1000);
  /* dates on paper: day/month/year in a fixed order (Intl's Arabic pattern carries direction marks that scramble inside a table cell);
     the digits follow the user's choice (Latin or Arabic-Indic) */
  const d2 = (n, w = 2) => new Intl.NumberFormat(loc(), { minimumIntegerDigits: w, useGrouping: false }).format(n);
  const dshort = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${d2(+m[3])}/${d2(+m[2])}/${d2(+m[1], 4)}` : ''; };
  /* date + 24-hour time in the station's time zone, fixed order: 27/11/2026 14:05 */
  function dtime(d) {
    let p; try { p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: (S.st && S.st.timezone) || undefined }).formatToParts(d).map(x => [x.type, x.value])); }
    catch { const i = d.toISOString(); p = { year: i.slice(0, 4), month: i.slice(5, 7), day: i.slice(8, 10), hour: i.slice(11, 13), minute: i.slice(14, 16) }; }
    return `${dshort(`${p.year}-${p.month}-${p.day}`)} ${d2(+p.hour)}:${d2(+p.minute)}`;
  }
  const dtimeSql = (utc) => { const t = Date.parse(String(utc || '').replace(' ', 'T') + (/Z|[+-]\d\d:?\d\d$/.test(String(utc)) ? '' : 'Z')); return Number.isFinite(t) ? dtime(new Date(t)) : ''; };
  const num = (v) => h('span', { class: 'n' }, v);   // figures keep their own direction inside Arabic text
  const tr = (k, vars) => { let s = T(k); for (const x in vars || {}) s = s.replace('{' + x + '}', vars[x]); return s; };

  /* ---- page frame: written as a <style> just before printing (margin boxes cannot read variables) ---- */
  const cssStr = (s) => '"' + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ') + '"';
  function pageOf() {   // "صفحة " counter(page) " من " counter(pages), from the translated template
    const t = T('p2.page'); const out = []; let rest = t;
    for (;;) { const m = /\{(p|n)\}/.exec(rest); if (!m) { if (rest) out.push(cssStr(rest)); break; } if (m.index) out.push(cssStr(rest.slice(0, m.index))); out.push(m[1] === 'p' ? 'counter(page)' : 'counter(pages)'); rest = rest.slice(m.index + 3); }
    return out.join(' ');
  }
  function frameCss(paper, foot, heightMm) {
    const face = "'IBM Plex Sans Arabic','Dubai','Segoe UI',Tahoma,sans-serif", box = `font-family:${face};font-size:7.5pt;color:#55606b;direction:${rtl() ? 'rtl' : 'ltr'};`;
    if (paper === 'r80' || paper === 'r58') { const w = paper === 'r80' ? 80 : 58; return `@page fp-r{size:${w}mm ${Math.max(60, Math.ceil(heightMm))}mm;margin:2.5mm 2.5mm 3mm}`; }
    const size = paper === 'a4l' ? 'A4 landscape' : 'A4', start = rtl() ? 'right' : 'left', end = rtl() ? 'left' : 'right';
    return `@page fp-${paper}{size:${size};margin:13mm 13mm 17mm;
      @bottom-${start}{content:${cssStr(foot.start)};${box}text-align:${start};vertical-align:top;padding-top:3mm}
      @bottom-center{content:${cssStr(foot.center)};${box}vertical-align:top;padding-top:3mm}
      @bottom-${end}{content:${pageOf()};${box}text-align:${end};vertical-align:top;padding-top:3mm;font-weight:600;color:#1f2933}}`;
  }
  /* the page frame goes in through the CSSOM: the app's Content-Security-Policy (style-src 'self') blocks <style> elements */
  let frameSheet = null;
  function setFrame(css) {
    try { if (!frameSheet) { frameSheet = new CSSStyleSheet(); document.adoptedStyleSheets = [...document.adoptedStyleSheets, frameSheet]; } frameSheet.replaceSync(css); }
    catch { /* very old browser: the static frame in print.css still prints the document */ }
  }
  const FACES = ['400 10pt "IBM Plex Sans Arabic"', '600 10pt "IBM Plex Sans Arabic"', '700 16pt "Noto Naskh Arabic"'];
  async function fontsReady(sample) {
    try { await Promise.all(FACES.map(f => document.fonts.load(f, sample || 'صفحة 0123456789 Page'))); await document.fonts.ready; } catch { /* print with what is there */ }
  }

  async function print(fileTitle, node, { paper = 'a4', footer } = {}) {
    let box = document.getElementById('print'); if (!box) { box = h('div', { id: 'print' }); document.body.append(box); }
    box.className = 'p2 p2-' + paper; box.dir = rtl() ? 'rtl' : 'ltr'; box.lang = lang(); box.replaceChildren(node);
    await fontsReady(node.textContent.slice(0, 400));
    const b = S.brand || {}, who = S.user ? S.user.name : '';
    const foot = Object.assign({ start: [b.name || (S.st && S.st.name) || 'FuelPro', fileTitle].filter(Boolean).join(' · '), center: tr('p2.printedBy', { u: who, t: dtime(new Date()) }) }, footer || {});
    let hmm = 0;
    if (paper[0] === 'r') {   // a receipt: measure the laid-out content so the page is exactly as long as the receipt
      document.body.classList.add('p2-measure'); hmm = box.getBoundingClientRect().height * 25.4 / 96 + 6; document.body.classList.remove('p2-measure');
    }
    setFrame(frameCss(paper, foot, hmm));
    const old = document.title; document.title = fileTitle;
    document.body.classList.add('printing', 'p2-on');
    const done = () => { document.body.classList.remove('printing', 'p2-on'); document.title = old; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done); window.print(); setTimeout(done, 2500);
  }

  /* ---- shared parts ---- */
  function letterhead(title, meta) {   // meta: [[label, value], …] shown in the document box at the end of the head
    const b = S.brand || {};
    return h('header', { class: 'lh2' },
      h('div', { class: 'lh2-org' }, b.logo ? h('img', { class: 'lh2-logo', src: b.logo, alt: '' }) : null,
        h('div', null, h('div', { class: 'lh2-name' }, b.name || (S.st && S.st.name) || 'FuelPro'), b.activity ? h('div', { class: 'lh2-act' }, b.activity) : null,
          h('div', { class: 'lh2-ct' }, [b.address, b.phones].filter(Boolean).map((x, i) => h('span', { class: i ? 'n' : '' }, x))))),
      h('div', { class: 'lh2-doc' }, h('div', { class: 'lh2-title' }, title),
        h('dl', { class: 'lh2-meta' }, (meta || []).filter(m => m && m[1] != null && m[1] !== '').map(([k, v]) => [h('dt', null, k), h('dd', null, v)]))));
  }
  const ensureBrand = async () => { if (!S.brand && F.loadBrand) { try { await F.loadBrand(); } catch { /* print without letterhead details */ } } };
  const footStart = (what) => [(S.brand && S.brand.name) || (S.st && S.st.name) || 'FuelPro', what].filter(Boolean).join(' · ');
  const sigs = (labels) => h('section', { class: 'sig2' }, labels.map(l => h('div', null, h('i'), h('span', null, l))));
  const qr = (text, size) => { try { return window.QR ? h('div', { class: 'qr2' }, window.QR.svg(text, size)) : null; } catch { return null; } };

  /* ---- 1) sale receipt, thermal 80 / 58 mm ---- */
  async function receipt(s) {
    await ensureBrand();
    const b = S.brand || {}, w = (() => { try { return localStorage.getItem('fpReceiptW') === '58' ? 'r58' : 'r80'; } catch { return 'r80'; } })();
    const line = (k, v, cls) => h('div', { class: 'rc-l ' + (cls || '') }, h('span', null, k), h('b', null, v));
    const unit = (S.st && S.st.currency) || '';
    const node = h('article', { class: 'rc' + (s.voided_at ? ' is-void' : '') },
      h('header', { class: 'rc-h' }, b.logo && localStorage.getItem('fpReceiptLogo') === '1' ? h('img', { src: b.logo, alt: '' }) : null,
        h('div', { class: 'rc-name' }, b.name || (S.st && S.st.name) || 'FuelPro'), b.activity ? h('div', { class: 'rc-sub' }, b.activity) : null,
        b.address ? h('div', { class: 'rc-sub' }, b.address) : null, b.phones ? h('div', { class: 'rc-sub n' }, b.phones) : null),
      h('div', { class: 'rc-title' }, T('receipt')),
      h('div', { class: 'rc-meta' }, line(T('receiptNo'), num('#' + s.id)), line(T('time'), num(dtimeSql(s.created_at))), s.pump_name ? line(T('pump'), s.pump_name) : null),
      h('div', { class: 'rc-item' }, h('div', { class: 'rc-fuel' }, s.fuel_name || ''),
        line(T('qty'), [num(qty(s.quantity_ml)), ' ', F.uLbl ? F.uLbl() : 'L']), line(T('price', { u: F.uLbl ? F.uLbl() : 'L' }), num(F.priceShow ? F.priceShow(s.price_e4) : '')),
        line(T('p2.amount'), num(amt(s.gross + (s.discount || 0))))),
      h('div', { class: 'rc-tot' }, s.discount ? line(T('discount'), num('−' + amt(s.discount))) : null, s.vat ? line(T('net'), num(amt(s.net))) : null, s.vat ? line(T('vat'), num(amt(s.vat))) : null,
        line(T('total') + (unit ? ' (' + unit + ')' : ''), num(amt(s.gross)), 'rc-grand')),
      h('div', { class: 'rc-pay' }, line(T('payType'), T(s.pay_type) + (s.customer_name ? ' · ' + s.customer_name : ''))),
      s.voided_at ? h('div', { class: 'rc-void', role: 'note' }, h('b', null, T('p2.void')), lang() !== 'en' ? h('span', null, 'VOID') : null) : null,
      qr(`FuelPro|R${s.id}|${String(s.created_at || '').slice(0, 16)}|${(s.gross / 10 ** dec()).toFixed(ddec())}`, 74),
      h('footer', { class: 'rc-f' }, h('div', null, T('thanks')), h('div', { class: 'n' }, dtime(new Date()))));
    return print(T('receipt') + ' ' + s.id, node, { paper: w });
  }

  /* ---- 2) account statement, A4 ---- */
  async function statement(cfg, r, rows, nature) {
    await ensureBrand();
    const fc = cfg.fcCode, nat = (v) => { const n = nature(v); return n ? (n === T('natDr') ? T('p2.dr') : T('p2.cr')) : ''; };
    const bal = (v) => h('span', { class: 'bal' }, num(amt(Math.abs(v))), h('small', null, nat(v)));
    const cur = fc || (S.st && S.st.currency) || '';
    const cols = [['#', 'c'], [T('date'), 'c'], [T('mvType'), ''], [T('entryNo'), 'c'], [T('docRef'), 'c'], [T('desc'), 'd'], ...(fc ? [[T('debit') + ' ' + fc, 'n'], [T('creditCol') + ' ' + fc, 'n']] : []), [T('debit'), 'n'], [T('creditCol'), 'n'], [T('balance'), 'n']];
    const td = (v, c) => h('td', { class: c || '' }, v);
    /* a column that is empty in every row is left out (many accounts have no entry numbers or references) */
    const hasRef = rows.some(e => e.ref), hasDoc = rows.some(e => e.docRef), hasKind = rows.some(e => e.kind);
    const keep = (i) => !((i === 2 && !hasKind) || (i === 3 && !hasRef) || (i === 4 && !hasDoc));
    const drop = (arr) => arr.filter((_, i) => i > 4 || keep(i));
    const lead = 3 + [hasKind, hasRef, hasDoc].filter(Boolean).length;   // columns before the amounts (#, date, …, description)
    const body = rows.map((e, i) => h('tr', { class: e.voided ? 'void' : '' }, ...drop([td(num(String(i + 1)), 'c idx'), td(num(dshort(e.date)), 'c nw'), td(e.kind || '', 'nw'), td(num(e.ref || ''), 'c'), td(num(e.docRef || ''), 'c')]), td(e.desc, 'd'),
      ...(fc ? [td(e.fcDr ? num(amt(e.fcDr)) : '', 'n'), td(e.fcCr ? num(amt(e.fcCr)) : '', 'n')] : []), td(e.debit ? num(amt(e.debit)) : '', 'n'), td(e.credit ? num(amt(e.credit)) : '', 'n'),
      td(e.voided ? h('span', { class: 'tag' }, T('voided')) : bal(e.balance), 'n')));
    const node = h('article', { class: 'doc2' },
      letterhead(cfg.title, [[T('p2.period'), [num(dshort(r.from)), ' – ', num(dshort(r.to))]], [T('p2.issued'), num(dshort(new Date().toISOString()))], [T('currency'), cur]]),
      h('section', { class: 'party2' },
        h('div', { class: 'pbox' }, h('span', { class: 'lbl' }, T('p2.account')), h('div', { class: 'pname' }, r.name), r.ref ? h('div', { class: 'psub' }, T('acctNo'), ' ', num(r.ref)) : null),
        h('dl', { class: 'sum2' },
          h('div', null, h('dt', null, T('prevBalance')), h('dd', null, bal(r.opening))),
          h('div', null, h('dt', null, T('p2.totalDr')), h('dd', null, num(amt(r.total_debit)))),
          h('div', null, h('dt', null, T('p2.totalCr')), h('dd', null, num(amt(r.total_credit)))),
          h('div', { class: 'grand' }, h('dt', null, T('closingBal')), h('dd', null, bal(r.balance))))),
      h('table', { class: 't2' },
        h('thead', null, h('tr', null, drop(cols.slice(0, 5)).concat(cols.slice(5)).map(([c, k]) => h('th', { class: k }, c)))),
        h('tbody', null, h('tr', { class: 'open' }, ...drop([td('', 'c'), td(num(dshort(r.from)), 'c nw'), td(''), td(''), td('')]), td(T('openingCol'), 'd'), ...(fc ? [td(''), td('')] : []), td(''), td(''), td(bal(r.opening), 'n')), body),
        h('tbody', { class: 'tot' }, h('tr', null, h('td', { colspan: lead }, T('total'), ' · ', num(String(rows.length)), ' ', T('rowsN')), ...(fc ? [td(num(amt(r.fcDr || 0)), 'n'), td(num(amt(r.fcCr || 0)), 'n')] : []), td(num(amt(r.total_debit)), 'n'), td(num(amt(r.total_credit)), 'n'), td(bal(r.balance), 'n')))),
      h('section', { class: 'end2' },
        lang() === 'ar' && F.tafqeet ? h('div', { class: 'words2' }, h('span', null, T('p2.inWords')), h('b', null, F.tafqeet(Math.abs(r.balance)), ' — ', nat(r.balance))) : null,
        h('p', { class: 'note2' }, (S.brand && S.brand.footer) || T('stmtObjection')),
        h('div', { class: 'end2-row' }, sigs(cfg.classicSigs || [T('receiverS'), T('accountantS'), T('managementS')]),
          qr(`FuelPro|${r.ref || ''}|${r.from}..${r.to}|BAL ${(r.balance / 10 ** dec()).toFixed(ddec())}`, 84))));
    return print(`${cfg.title} - ${r.name} - ${r.from} - ${r.to}`, node, { paper: fc ? 'a4l' : 'a4', footer: { start: footStart(cfg.title) } });
  }

  /* ---- 3) journal book, A4, many pages: one block per entry, never split across pages ---- */
  async function jbook({ from, to, type, list }) {
    await ensureBrand();
    let total = 0; for (const j of list) for (const l of j.lines) total += l.debit;
    const blocks = list.map((j, n) => h('tbody', { class: 'je' + (n % 2 ? ' alt' : '') },
      j.lines.map((l, i) => h('tr', null,
        i === 0 ? h('td', { rowspan: j.lines.length, class: 'c nw jd' }, num(dshort(j.business_date))) : null,
        i === 0 ? h('td', { rowspan: j.lines.length, class: 'c nw' }, num(j.ref || '#' + j.id)) : null,
        i === 0 ? h('td', { rowspan: j.lines.length, class: 'jt' }, j.doc_type || T('src.' + j.source), j.memo ? h('div', { class: 'mut' }, j.memo) : null) : null,
        h('td', { class: 'c' }, num(l.code)), h('td', { class: 'acc' }, l.name_ar, l.party_name ? h('small', null, l.party_name) : null),
        h('td', { class: 'n' }, l.debit ? num(amt(l.debit)) : ''), h('td', { class: 'n' }, l.credit ? num(amt(l.credit)) : '')))));
    const node = h('article', { class: 'doc2' },
      letterhead(T('jbook'), [[T('p2.period'), [num(dshort(from)), ' – ', num(dshort(to))]], type ? [T('docType'), type] : null, [T('entriesN'), num(String(list.length))], [T('currency'), (S.st && S.st.currency) || '']]),
      h('table', { class: 't2 jb' },
        h('thead', null, h('tr', null, [[T('date'), 'c'], [T('docNo'), 'c'], [T('docType'), ''], [T('code'), 'c'], [T('account'), ''], [T('debit'), 'n'], [T('creditCol'), 'n']].map(([c, k]) => h('th', { class: k }, c)))),
        blocks.length ? blocks : h('tbody', null, h('tr', null, h('td', { colspan: 7 }, T('noData')))),
        h('tbody', { class: 'tot' }, h('tr', null, h('td', { colspan: 5 }, T('total'), ' · ', T('entriesN'), ' ', num(String(list.length))), h('td', { class: 'n' }, num(amt(total))), h('td', { class: 'n' }, num(amt(total)))))),
      h('section', { class: 'end2' }, sigs([T('accountantSig'), T('auditorSig'), T('managerSig')])));
    return print(`${T('jbook')} ${from}_${to}`, node, { paper: 'a4', footer: { start: footStart(T('jbook')) } });
  }

  F.P2 = { print, letterhead, receipt, statement, jbook, amt, dshort };
})();
