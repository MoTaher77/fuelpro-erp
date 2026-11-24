'use strict';
/* «لوحة التحليلات» — headline figures with comparison, sales trend vs last year, fuel margins, every year on record
   (incl. the old system), weekdays, payment mix, receivables ageing, stock cover, top credit customers, pumps.
   Charts are plain SVG: one axis each, thin marks, rounded data-ends, hover tooltips, legends for 2+ series. */
(function () {
  const F = window.FP; if (!F) return;
  const { h, T, P, S, api, sp, guard, field, sec, dec, todayIso, printNode, volNum } = F;
  const NS = 'http://www.w3.org/2000/svg';
  const s = (tag, attrs, ...kids) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs || {})) if (v != null) e.setAttribute(k, v); for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c))); return e; };
  const nf = (v, d) => { const dd = d ?? Math.min(dec(), S.st.disp_dec ?? dec()); return FPFMT.nf('en-US', { minimumFractionDigits: dd, maximumFractionDigits: dd }).format((v || 0) / 10 ** dec()); };
  const nf0 = (v) => nf(v, 0);
  const short = (v) => { const x = Math.abs(v || 0) / 10 ** dec(); const sg = v < 0 ? '-' : ''; return sg + (x >= 1e9 ? (x / 1e9).toFixed(1) + 'B' : x >= 1e6 ? (x / 1e6).toFixed(1) + 'M' : x >= 1e3 ? (x / 1e3).toFixed(0) + 'K' : x.toFixed(0)); };
  const lit = (ml) => volNum(ml, 0);
  const pct = (a, b) => b ? (a * 100 / b).toFixed(1) + '%' : '—';
  const MN = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const WD = { ar: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'], en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], fr: ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'] };
  const keyLabel = (k) => k.length === 7 ? (P.lang === 'ar' ? MN[+k.slice(5) - 1] : k.slice(5) + '/' + k.slice(2, 4)) : k.slice(8) + '/' + k.slice(5, 7);
  const shiftDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

  /* one tooltip per card; any SVG element with data-tip shows it */
  const withTip = (card) => { const tip = h('div', { class: 'an-tip', role: 'status' }); card.append(tip);
    const show = (e) => { const g = e.target.closest('[data-tip]'); if (!g || !card.contains(g)) { tip.style.opacity = 0; return; }
      tip.replaceChildren(...g.dataset.tip.split('\n').map((l, i) => i ? h('div', null, l) : h('b', null, l)));
      const r = card.getBoundingClientRect(), x = (e.clientX || r.left + r.width / 2) - r.left, y = (e.clientY || r.top) - r.top;
      tip.style.opacity = 1; tip.style.left = Math.min(Math.max(x - tip.offsetWidth / 2, 4), r.width - tip.offsetWidth - 4) + 'px'; tip.style.top = Math.max(y - tip.offsetHeight - 12, 4) + 'px'; };
    card.addEventListener('mousemove', show); card.addEventListener('focusin', show); card.addEventListener('mouseleave', () => { tip.style.opacity = 0; }); return card; };
  const card = (title, sub, ...body) => withTip(h('div', { class: 'an-card' }, h('h3', null, title), sub ? h('p', { class: 'sub' }, sub) : null, ...body));
  const swatch = (color, line) => { const i = h('i', { class: line ? 'line' : '' }); i.style.background = color; return i; };   // CSSOM, allowed by the CSP (inline style attributes are not)
  const legend = (items) => h('div', { class: 'an-legend' }, items.map(([label, color, line]) => h('span', null, swatch(color, line), label)));
  const niceMax = (v) => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };
  /* a rounded-top bar anchored to the baseline (4px data-end radius, square at the base) */
  const barPath = (x, y0, w, y1) => { const top = Math.min(y0, y1), bot = Math.max(y0, y1), r = Math.min(4, w / 2, bot - top); const up = y1 <= y0;
    return up ? `M${x},${bot}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${bot}Z`
      : `M${x},${top}V${bot - r}Q${x},${bot} ${x + r},${bot}H${x + w - r}Q${x + w},${bot} ${x + w},${bot - r}V${top}Z`; };

  /* vertical columns, one axis; optional comparison line (same measure, e.g. last year) */
  function columns(items, { value, label, tip, color, line, lineTip, labelEvery = 1, signed }) {
    const W = 640, H = 230, L = 46, R = 8, Tp = 12, B = 26, iw = W - L - R, ih = H - Tp - B;
    const vals = items.map(value), lv = line ? items.map(line) : [];
    const max = niceMax(Math.max(0, ...vals, ...lv)), min = signed && vals.some(v => v < 0) ? -niceMax(Math.max(...vals.map(v => -v))) : 0;
    const y = (v) => Tp + ih * (max - v) / ((max - min) || 1), y0 = y(0);
    const step = iw / Math.max(items.length, 1), bw = Math.max(Math.min(step - 2, 28), 1.5);
    const svg = s('svg', { class: 'an-chart', viewBox: `0 0 ${W} ${H}`, role: 'img' });
    for (let i = 0; i <= 4; i++) { const v = min + (max - min) * i / 4, yy = y(v); svg.append(s('line', { class: 'grid', x1: L, x2: W - R, y1: yy, y2: yy }), s('text', { class: 'axis', x: L - 6, y: yy + 4, 'text-anchor': 'end' }, short(v))); }
    items.forEach((it, i) => { const x = L + i * step + (step - bw) / 2, v = vals[i];
      const g = s('g', { class: 'col', tabindex: 0, 'data-tip': tip(it) });
      g.append(s('rect', { class: 'hit', x: L + i * step, y: Tp, width: step, height: ih }));
      if (v) g.append(s('path', { class: 'bar', d: barPath(x, y0, bw, y(v)), fill: typeof color === 'function' ? color(it) : color }));
      svg.append(g);
      if (i % labelEvery === 0) svg.append(s('text', { class: 'axis', x: L + i * step + step / 2, y: H - 8, 'text-anchor': 'middle' }, label(it))); });
    if (line && lv.some(Boolean)) svg.append(s('polyline', { points: items.map((it, i) => `${L + i * step + step / 2},${y(lv[i])}`).join(' '), fill: 'none', stroke: 'var(--viz-ly)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'pointer-events': 'none' }));
    return svg;
  }
  /* horizontal bars with direct labels */
  function hbars(items, { value, label, color, tip, text }) {
    const rowH = 30, W = 640, L = 200, R = 110, H = items.length * rowH + 6, max = niceMax(Math.max(1, ...items.map(value)));
    const svg = s('svg', { class: 'an-chart', viewBox: `0 0 ${W} ${H}`, role: 'img' });
    items.forEach((it, i) => { const y = 4 + i * rowH, w = Math.max((W - L - R) * value(it) / max, value(it) ? 3 : 0);
      const g = s('g', { class: 'col', tabindex: 0, 'data-tip': tip(it) });
      g.append(s('rect', { class: 'hit', x: 0, y, width: W, height: rowH }), s('text', { class: 'lbl', x: L - 8, y: y + 18, 'text-anchor': 'end' }, (l => l.length > 28 ? l.slice(0, 27) + '…' : l)(String(label(it)))));
      if (w) g.append(s('path', { class: 'bar', d: `M${L},${y + 5}H${L + w - 4}Q${L + w},${y + 5} ${L + w},${y + 9}V${y + 21}Q${L + w},${y + 25} ${L + w - 4},${y + 25}H${L}Z`, fill: typeof color === 'function' ? color(it, i) : color }));
      g.append(s('text', { class: 'lbl m', x: L + w + 6, y: y + 18 }, text(it))); svg.append(g); });
    return svg;
  }
  /* one stacked bar (parts of a whole), 2px surface gaps, legend below */
  function stack(parts) {
    const W = 640, H = 34, tot = parts.reduce((t, p) => t + Math.max(p.value, 0), 0) || 1; let x = 0;
    const svg = s('svg', { class: 'an-chart', viewBox: `0 0 ${W} ${H}`, role: 'img' });
    parts.filter(p => p.value > 0).forEach((p, i, arr) => { const w = W * p.value / tot; const last = i === arr.length - 1;
      svg.append(s('g', { class: 'col', tabindex: 0, 'data-tip': p.tip }, s('rect', { class: 'bar', x: x + (i ? 1 : 0), y: 4, width: Math.max(w - (i ? 1 : 0) - (last ? 0 : 1), 1), height: H - 8, rx: (i === 0 || last) ? 4 : 0, fill: p.color })));
      x += w; });
    return svg;
  }
  const delta = (cur, base, label) => { if (!base) return h('small', null, label + ': —'); const d = (cur - base) * 100 / Math.abs(base);
    return h('small', { class: d >= 0 ? 'up' : 'down' }, (d >= 0 ? '▲ ' : '▼ ') + Math.abs(d).toFixed(1) + '% ' + label); };
  const kpi = (label, value, ...notes) => h('div', { class: 'kpi' }, h('span', null, label), h('b', null, value), ...notes);

  F.VIEWS.ana = async (main) => {
    const today = todayIso();
    const from = h('input', { type: 'date', value: S.anFrom || today.slice(0, 8) + '01', max: today }), to = h('input', { type: 'date', value: S.anTo || today, max: today });
    const preset = (label, a, b) => h('button', { class: 'btn ghost sm', onclick: () => { from.value = a; to.value = b; run(); } }, label);
    const y = +today.slice(0, 4), m = +today.slice(5, 7), pm = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    const pmEnd = new Date(Date.UTC(+pm.slice(0, 4), +pm.slice(5), 0)).toISOString().slice(0, 10);
    const out = h('div', { class: 'stack' }); let r = null;
    const run = guard(async () => { S.anFrom = from.value; S.anTo = to.value; r = await api('GET', sp(`/analytics?from=${from.value}&to=${to.value}`)); draw(); });
    const draw = () => {
      const c = r.current;
      const overdue = r.ageing.d30 + r.ageing.d60 + r.ageing.d90 + r.ageing.over90;
      const kpis = h('div', { class: 'kpis' },
        kpi(T('anRevenue'), nf0(c.revenue), delta(c.revenue, r.previous.revenue, T('anVsPrev')), delta(c.revenue, r.last_year.revenue, T('anVsLy'))),
        kpi(T('anLitres'), lit(c.litres_ml), delta(c.litres_ml, r.previous.litres_ml, T('anVsPrev')), h('small', null, num(c.sales_count) + ' ' + T('anSales'))),
        kpi(T('grossProfit'), nf0(c.gross_profit), h('small', null, T('marginPct') + ': ' + pct(c.gross_profit, c.revenue)), delta(c.gross_profit, r.previous.gross_profit, T('anVsPrev'))),
        kpi(T('netProfit'), nf0(c.net_profit), delta(c.net_profit, r.previous.net_profit, T('anVsPrev')), delta(c.net_profit, r.last_year.net_profit, T('anVsLy'))),
        kpi(T('anCash'), nf0(r.cash.closing), h('small', null, T('cfOperating') + ': ' + nf0(r.cash.operating))),
        kpi(T('anReceivable'), nf0(r.ageing.current + overdue), h('small', { class: overdue ? 'down' : '' }, T('anOverdue') + ': ' + nf0(overdue)), h('small', null, T('anAdvances') + ': ' + nf0(r.ageing.advance) + ' · ' + T('anNet') + ': ' + nf0(r.ageing.balance))));

      const tr = r.trend, every = Math.ceil(tr.length / 12);
      const trendCard = card(T('anTrend'), r.granularity === 'month' ? T('anByMonth') : T('anByDay'),
        legend([[T('anThisPeriod'), 'var(--viz-1)'], [T('anLastYear'), 'var(--viz-ly)', true]]),
        columns(tr, { value: x => x.revenue, line: x => x.last_year_revenue, label: x => keyLabel(x.key), labelEvery: every, color: 'var(--viz-1)',
          tip: x => `${keyLabel(x.key)} ${x.key.slice(0, 4)}\n${T('anRevenue')}: ${nf0(x.revenue)}\n${T('anLitres')}: ${lit(x.litres_ml)}\n${T('anMargin')}: ${nf0(x.margin)}\n${T('anLastYear')}: ${nf0(x.last_year_revenue)}` }));

      const FC = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)'], fcol = (f) => FC[r.fuels.findIndex(x => x.fuel_id === f.fuel_id) % 3];
      const totL = r.fuels.reduce((t, f) => t + f.litres_ml, 0);
      const fuelCard = card(T('anFuelMargin'), T('anFuelMarginSub'),
        hbars(r.fuels, { value: f => Math.max(f.margin, 0), label: f => f.name, color: fcol, text: f => `${nf0(f.margin)} · ${pct(f.margin, f.revenue)}`,
          tip: f => `${f.name}\n${T('anLitres')}: ${lit(f.litres_ml)} (${pct(f.litres_ml, totL)})\n${T('anRevenue')}: ${nf0(f.revenue)}\n${T('cogsL')}: ${nf0(f.cogs)}\n${T('anMarginPerL')}: ${nf(f.margin_per_litre_e4 / 1e4 * 10 ** 0)}` }),
        F.table([T('fuel'), T('anLitres'), T('anRevenue'), T('anMargin'), T('anMarginPerL'), T('marginPct')], r.fuels.map(f => [f.name, lit(f.litres_ml), nf0(f.revenue), nf0(f.margin), nf(Math.round(f.margin_per_litre_e4 / 1e4)), pct(f.margin, f.revenue)])));

      const yrs = r.years;
      const yearsCard = yrs.length ? card(T('anYears'), T('anYearsSub'),
        legend([[T('anFp'), 'var(--viz-1)'], [T('anOldSys'), 'var(--viz-2)']]),
        columns(yrs, { value: x => x.net_profit, label: x => String(x.year) + (x.partial ? '*' : ''), signed: true, color: x => x.source === 'old' ? 'var(--viz-2)' : 'var(--viz-1)',
          tip: x => `${x.year}${x.partial ? ' (' + T('anPartial') + ')' : ''} — ${x.source === 'old' ? T('anOldSys') : 'FuelPro'}\n${T('anRevenue')}: ${nf0(x.revenue)}\n${T('grossProfit')}: ${nf0(x.gross_profit)}\n${T('netProfit')}: ${nf0(x.net_profit)}` }),
        h('p', { class: 'hint' }, '* ', T('anPartial'))) : null;

      const wdCard = card(T('anWeekday'), T('anWeekdaySub'), columns(r.weekdays, { value: x => x.avg_revenue, label: x => (WD[P.lang] || WD.en)[x.weekday], color: 'var(--viz-1)', tip: x => `${(WD[P.lang] || WD.en)[x.weekday]}\n${T('anAvgDay')}: ${nf0(x.avg_revenue)}` }));

      const PC = { cash: 'var(--viz-1)', credit: 'var(--viz-2)' }, payTot = r.pay_mix.reduce((t, p) => t + p.amount, 0);
      const payName = (k) => T(k);
      const payCard = card(T('anPayMix'), null, stack(r.pay_mix.map(p => ({ value: p.amount, color: PC[p.pay_type] || 'var(--viz-3)', tip: `${payName(p.pay_type)}\n${nf0(p.amount)} · ${pct(p.amount, payTot)}\n${num(p.n)} ${T('anSales')}` }))),
        legend(r.pay_mix.map(p => [`${payName(p.pay_type)} ${pct(p.amount, payTot)}`, PC[p.pay_type] || 'var(--viz-3)'])));

      const A = [['current', T('anNotDue')], ['d30', '1–30'], ['d60', '31–60'], ['d90', '61–90'], ['over90', '90+']];
      const ageCard = card(T('anAgeing'), T('anAgeingSub'), stack(A.map(([k, l], i) => ({ value: r.ageing[k], color: `var(--age-${i})`, tip: `${l} ${k === 'current' ? '' : T('anDaysLate')}\n${nf0(r.ageing[k])} · ${pct(r.ageing[k], r.ageing.current + overdue)}` }))),
        legend(A.map(([k, l], i) => [`${l}: ${short(r.ageing[k])}`, `var(--age-${i})`])));

      const ST = { good: ['●', T('anGood')], warning: ['▲', T('anWarn')], critical: ['■', T('anCritical')], idle: ['○', T('anIdle')] };
      const coverCard = card(T('anCover'), T('anCoverSub'), h('div', { class: 'stack' }, r.tanks.map(t => h('div', { class: 'cover' },
        h('span', { class: 'st ' + t.status }, ST[t.status][0] + ' ' + ST[t.status][1]), h('div', null, h('b', null, t.name), h('div', { class: 'muted small' }, `${lit(t.level_ml)} · ${T('anPerDay')}: ${lit(t.sold_per_day_ml)}`)),
        h('b', { class: 'cover-days' }, t.days_cover == null ? '—' : t.days_cover + ' ' + T('anDays'))))));

      const custCard = card(T('anTopCust'), T('anTopCustSub'), r.top_customers.length ? F.table([T('name'), T('anSales'), T('anLitres'), T('amount'), T('balance')],
        r.top_customers.map(x => [h('a', { href: '#cust', onclick: () => { S.stmt = x.id; } }, x.name), num(x.n), lit(x.litres_ml), nf0(x.amount), nf0(x.balance)])) : h('p', { class: 'muted' }, T('noData')));

      const pumpCard = card(T('anPumps'), null, hbars(r.pumps.slice(0, 12), { value: p => p.litres_ml, label: p => p.name, color: p => FC[Math.max(r.fuels.findIndex(f => f.fuel_id === p.fuel_id), 0) % 3], text: p => lit(p.litres_ml),
        tip: p => `${p.name}\n${T('anLitres')}: ${lit(p.litres_ml)}\n${T('anRevenue')}: ${nf0(p.revenue)}` }), legend(r.fuels.map((f, i) => [f.name, FC[i % 3]])));

      out.replaceChildren(h('p', { class: 'hint' }, `${r.station.name} · ${r.from} → ${r.to} (${r.days} ${T('anDays')}) · ${T('anVsPrev')}: ${r.previous.from} → ${r.previous.to}`),
        kpis, trendCard, h('div', { class: 'an-grid' }, fuelCard, coverCard), yearsCard || '', h('div', { class: 'an-grid' }, wdCard, payCard), h('div', { class: 'an-grid' }, ageCard, pumpCard), custCard);
    };
    const num = (v) => FPFMT.nf('en-US').format(v || 0);
    main.append(sec(T('ana'), h('div', { class: 'row' }, field(T('from'), from), field(T('to'), to), h('button', { class: 'btn', onclick: run }, T('run')),
      h('button', { class: 'btn gold-btn', onclick: () => r && printNode(T('ana') + ' ' + r.from + '_' + r.to, out) }, '⎙ ', T('print'))),
      h('div', { class: 'presets' }, preset(T('anThisMonth'), today.slice(0, 8) + '01', today), preset(T('anPrevMonth'), pm + '-01', pmEnd),
        preset(T('anThisYear'), y + '-01-01', today), preset(T('an12m'), shiftDays(today, -364), today))), out);
    await run();
  };
})();
