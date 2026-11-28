/* «التقارير»: the daily station report, income statement, balance sheet, cash flow, profit by month, boxes & banks,
   collections follow-up, meter sheet and trial balance — each shown on screen and printed on A4 from the same builder —
   and the letterhead printed on every document. Shared by the three editions; loaded only when its tab opens.
   Every figure comes from the core (summed from the journals when asked); nothing here adds money up except column totals. */
import { errText, field, h, type Backend, type Station } from './index.ts';
import { doc, grand, letterhead, litres, loadBrand, money as moneyOf, num, periodText, print, ptable, ptitle, setBrandCache, sigs, tafqeet, tiles, today, type Brand, type Paper } from './print.ts';

type Row = Record<string, unknown> & { code: string; name_ar: string; amount: number };
type Sec = { rows: Row[]; inflow: number; outflow: number; total: number };
const s = (v: unknown) => String(v ?? '');
const n = (v: unknown) => Number(v) || 0;
const CATS: Record<string, string> = { power: 'كهرباء ومولدات', maint: 'صيانة', transport: 'نقل', rent: 'إيجار', fees: 'رسوم وضرائب', salaries: 'رواتب', other: 'أخرى' };
const SRC: Record<string, string> = { voucher: 'سند', payment: 'سداد عميل', supplier_payment: 'سداد مورد', expense: 'مصروف', delivery: 'توريد', cash_move: 'حركة صندوق', manual: 'قيد يدوي' };

type Spec = { key: string; title: string; dates: 'day' | 'range' | 'asof' | 'year' | 'none'; paper?: Paper;
  load: (be: Backend, st: Station, d: { from: string; to: string }) => Promise<unknown>; build: (st: Station, r: never, d: { from: string; to: string }) => HTMLElement };

export async function reportsView(main: HTMLElement, be: Backend, st: Station, toast: (m: string, k?: 'ok' | 'err') => void) {
  const sid = st.id, m = moneyOf(st);
  const tday = (() => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: st.timezone }).format(new Date()); } catch { return new Date().toISOString().slice(0, 10); } })();
  await loadBrand(be);
  const q = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v));
  const mt = (v: number) => (v ? m(v) : '');
  const SPECS: Spec[] = [
    { key: 'daily', title: 'التقرير اليومي للمحطة', dates: 'day', load: (b, _, d) => b.call('GET', `/stations/${sid}/reports/daily`, undefined, q({ date: d.to })), build: daily },
    { key: 'income', title: 'قائمة الدخل', dates: 'range', load: (b, _, d) => b.call('GET', '/accounting/income-statement', undefined, q({ station_id: String(sid), from: d.from, to: d.to })), build: income },
    { key: 'balance', title: 'الميزانية العمومية', dates: 'asof', load: (b, _, d) => b.call('GET', '/accounting/balance-sheet', undefined, q({ station_id: String(sid), as_of: d.to })), build: balance },
    { key: 'cash', title: 'قائمة التدفقات النقدية', dates: 'range', load: (b, _, d) => b.call('GET', '/accounting/cash-flow', undefined, q({ station_id: String(sid), from: d.from, to: d.to })), build: cashflow },
    { key: 'months', title: 'الأرباح الشهرية', dates: 'year', paper: 'a4l', load: (b, _, d) => b.call('GET', '/accounting/profit-by-month', undefined, q({ station_id: String(sid), year: d.to.slice(0, 4) })), build: months },
    { key: 'boxes', title: 'حركة الصناديق والبنوك', dates: 'range', load: (b, _, d) => b.call('GET', `/stations/${sid}/reports/boxes`, undefined, q({ from: d.from, to: d.to })), build: boxes },
    { key: 'collect', title: 'متابعة التحصيل', dates: 'asof', paper: 'a4l', load: (b, _, d) => b.call('GET', `/stations/${sid}/reports/collections`, undefined, q({ as_of: d.to })), build: collect },
    { key: 'meters', title: 'كشف العدادات', dates: 'range', load: (b, _, d) => b.call('GET', `/stations/${sid}/reports/meters`, undefined, q({ from: d.from, to: d.to })), build: meters },
    { key: 'trial', title: 'ميزان المراجعة', dates: 'range', paper: 'a4l', load: (b, _, d) => b.call('GET', '/accounting/trial-balance', undefined, q({ station_id: String(sid), from: d.from, to: d.to })), build: trial }
  ];

  /* ---------- builders: one article, on screen and on paper ---------- */
  const head = (title: string, period: Node, extra: Array<[string, Node | string | null] | null> = []) =>
    letterhead(st, title, [['الفترة', period], ['العملة', st.currency], ...extra, ['تاريخ الإصدار', num(today())]]);
  function daily(_: Station, r: Record<string, never>) {
    const t = r.totals as Record<string, number>;
    const meters = r.meters as { pumps: Array<Record<string, number | string>> } | null;
    return doc(head('التقرير اليومي للمحطة', num(s(r.date).split('-').reverse().join('/'))),
      tiles([['المبيعات (لتر)', litres(t.qty_ml)], ['المبيعات', m(t.amount), true], ['نقداً', m(t.cash)], ['آجل', m(t.credit)], ['مجمل الربح', m(t.gross_profit)],
        ['مقبوضات', m(t.receipts)], ['مدفوعات', m(t.payments)], ['مصروفات', m(t.expenses)], ['توريدات', m(t.deliveries)]]),
      ptitle('المبيعات حسب الوقود'),
      ptable([['الوقود'], ['الكمية (لتر)', 'n'], ['سعر اللتر', 'n'], ['نقداً', 'n'], ['آجل', 'n'], ['المبلغ', 'n']],
        (r.fuels as Array<Record<string, number>>).map((f) => [s(f.fuel_name), litres(f.qty_ml), m(Math.round(f.price_e4 / 10_000)), m(f.cash), m(f.credit), m(f.amount)]),
        ['الإجمالي', litres(t.qty_ml), '', m(t.cash), m(t.credit), m(t.amount)]),
      meters ? ptitle('العدادات') : null,
      meters ? ptable([['المضخة'], ['الوقود'], ['قراءة البداية', 'n'], ['قراءة النهاية', 'n'], ['الكمية (لتر)', 'n'], ['المبلغ', 'n']],
        meters.pumps.map((p) => [s(p.pump_name), s(p.fuel_name), litres(n(p.open_ml)), litres(n(p.close_ml)), litres(n(p.qty_ml)), m(n(p.amount))])) : null,
      (r.credit as unknown[]).length ? ptitle('المبيعات الآجلة') : null,
      (r.credit as unknown[]).length ? ptable([['العميل'], ['الوقود'], ['الكمية (لتر)', 'n'], ['المبلغ', 'n']],
        (r.credit as Array<Record<string, number>>).map((c) => [s(c.customer_name), s(c.fuel_name), litres(c.qty_ml), m(c.amount)]), ['الإجمالي', '', '', m(t.credit)]) : null,
      (r.moves as unknown[]).length ? ptitle('المقبوضات والمدفوعات') : null,
      (r.moves as unknown[]).length ? ptable([['المستند'], ['الحساب'], ['البيان', 'd'], ['الصندوق'], ['مقبوض', 'n'], ['مدفوع', 'n']],
        (r.moves as Array<Record<string, number>>).map((x) => [(SRC[s(x.source)] || s(x.source)) + (x.ref ? ' ' + x.ref : ''), s(x.party_name || x.account_name), s(x.source) === 'expense' ? CATS[s(x.memo)] || s(x.memo) : s(x.memo), s(x.box_name), mt(x.amount_in), mt(x.amount_out)]),
        ['الإجمالي', '', '', '', m(t.receipts), m(t.payments)]) : null,
      (r.expenses as unknown[]).length ? ptitle('المصروفات') : null,
      (r.expenses as unknown[]).length ? ptable([['البند'], ['البيان', 'd'], ['المبلغ', 'n']], (r.expenses as Array<Record<string, number>>).map((x) => [CATS[s(x.category)] || s(x.category), s(x.memo), m(x.amount)]), ['الإجمالي', '', m(t.expenses)]) : null,
      (r.deliveries as unknown[]).length ? ptitle('التوريدات') : null,
      (r.deliveries as unknown[]).length ? ptable([['الفاتورة'], ['الوقود'], ['المورد'], ['الكمية (لتر)', 'n'], ['المبلغ', 'n']],
        (r.deliveries as Array<Record<string, number>>).map((x) => [s(x.ref), s(x.fuel_name), s(x.supplier_name), litres(x.quantity_ml), m(x.total)]), ['الإجمالي', '', '', '', m(t.deliveries)]) : null,
      ptitle('الصناديق والبنوك'), boxTable(r.boxes as never),
      ptitle('الخزانات'),
      ptable([['الخزان'], ['الوقود'], ['أول اليوم', 'n'], ['وارد', 'n'], ['منصرف', 'n'], ['آخر اليوم', 'n']],
        (r.tanks as Array<Record<string, number>>).map((x) => [s(x.tank_name), s(x.fuel_name), litres(x.opening_ml), litres(x.in_ml), litres(x.out_ml), litres(x.closing_ml)])),
      h('section', { class: 'end2' }, sigs(['المحاسب', 'مدير المحطة', 'الإدارة'])));
  }
  const boxTable = (list: Array<Record<string, number | string>>, tot?: Record<string, number>) => ptable([['الحساب'], ['رصيد أول', 'n'], ['داخل', 'n'], ['خارج', 'n'], ['رصيد آخر', 'n']],
    list.map((b) => [`${b.code} ${b.name_ar}`, m(n(b.opening)), mt(n(b.debit)), mt(n(b.credit)), m(n(b.closing))]),
    tot ? ['الإجمالي', m(tot.opening), m(tot.debit), m(tot.credit), m(tot.closing)] : undefined);
  function income(_: Station, r: Record<string, never>) {
    const rows = r.rows as Row[], part = (sec: string) => rows.filter((x) => x.sec === sec && x.amount).map((x) => [num(x.code), x.name_ar, m(x.amount)]);
    const cols: Array<[string, string?]> = [['الرمز', 'c'], ['الحساب'], ['المبلغ', 'n']];
    const net = n(r.net_profit);
    return doc(head('قائمة الدخل', periodText(s(r.from), s(r.to))),
      tiles([['الإيرادات', m(n(r.revenue))], ['تكلفة المبيعات', m(n(r.cost_of_sales))], ['مجمل الربح', m(n(r.gross_profit))], ['المصروفات', m(n(r.operating_expenses))], [net < 0 ? 'صافي الخسارة' : 'صافي الربح', m(Math.abs(net)), true]]),
      ptitle('الإيرادات'), ptable(cols, part('revenue'), ['', 'إجمالي الإيرادات', m(n(r.revenue))]),
      ptitle('تكلفة المبيعات'), ptable(cols, part('cos'), ['', 'مجمل الربح', m(n(r.gross_profit))]),
      ptitle('المصروفات التشغيلية'), ptable(cols, part('opex'), ['', 'إجمالي المصروفات', m(n(r.operating_expenses))]),
      part('other').length ? ptitle('إيرادات أخرى') : null, part('other').length ? ptable(cols, part('other'), ['', 'إجمالي الإيرادات الأخرى', m(n(r.other_income))]) : null,
      grand(net < 0 ? 'صافي الخسارة' : 'صافي الربح', m(Math.abs(net))),
      h('section', { class: 'end2' }, h('div', { class: 'words2' }, h('span', {}, 'المبلغ كتابةً'), h('b', {}, tafqeet(net, st))), sigs(['المحاسب', 'المراجع', 'المدير'])));
  }
  function balance(_: Station, r: Record<string, never>) {
    const cols: Array<[string, string?]> = [['الرمز', 'c'], ['الحساب'], ['الرصيد', 'n']];
    const part = (k: string) => (r[k] as Row[]).map((x) => [num(x.code), x.name_ar, m(x.amount)]);
    const eq = part('equity'); if (n(r.current_earnings)) eq.push(['', 'أرباح الفترة غير المقفلة', m(n(r.current_earnings))]);
    return doc(letterhead(st, 'الميزانية العمومية', [['كما في', num(s(r.as_of).split('-').reverse().join('/'))], ['العملة', st.currency], ['تاريخ الإصدار', num(today())]]),
      tiles([['الأصول', m(n(r.total_assets)), true], ['الخصوم', m(n(r.total_liabilities))], ['حقوق الملكية', m(n(r.total_equity))], ['التوازن', r.balanced ? 'متوازنة' : 'غير متوازنة']]),
      ptitle('الأصول'), ptable(cols, part('assets'), ['', 'إجمالي الأصول', m(n(r.total_assets))]),
      ptitle('الخصوم'), ptable(cols, part('liabilities'), ['', 'إجمالي الخصوم', m(n(r.total_liabilities))]),
      ptitle('حقوق الملكية'), ptable(cols, eq, ['', 'إجمالي حقوق الملكية', m(n(r.total_equity))]),
      grand('الخصوم وحقوق الملكية', m(n(r.total_liabilities) + n(r.total_equity))),
      h('section', { class: 'end2' }, sigs(['المحاسب', 'المراجع', 'المدير'])));
  }
  function cashflow(_: Station, r: Record<string, never>) {
    const cols: Array<[string, string?]> = [['الرمز', 'c'], ['الحساب'], ['داخل', 'n'], ['خارج', 'n']];
    const part = (k: string, title: string) => { const x = r[k] as Sec; return x.rows.length ? [ptitle(title), ptable(cols, x.rows.map((y) => [num(y.code), y.name_ar, y.amount > 0 ? m(y.amount) : '', y.amount < 0 ? m(-y.amount) : '']),
      ['', 'صافي ' + title, x.total >= 0 ? m(x.total) : '', x.total < 0 ? m(-x.total) : ''])] : []; };
    return doc(head('قائمة التدفقات النقدية', periodText(s(r.from), s(r.to))),
      tiles([['النقد أول الفترة', m(n(r.opening_cash))], ['صافي التغير', m(n(r.net_change))], ['النقد آخر الفترة', m(n(r.closing_cash)), true], ['المطابقة', r.reconciled ? 'مطابقة' : 'غير مطابقة']]),
      ...part('operating', 'الأنشطة التشغيلية'), ...part('investing', 'الأنشطة الاستثمارية'), ...part('financing', 'الأنشطة التمويلية'), ...part('opening', 'أرصدة افتتاحية'), ...part('fx', 'فروق العملة'),
      ptitle('الصناديق والبنوك'), ptable([['الحساب'], ['أول الفترة', 'n'], ['التغير', 'n'], ['آخر الفترة', 'n']],
        (r.boxes as Array<Record<string, number | string>>).map((b) => [`${b.code} ${b.name_ar}`, m(n(b.opening)), m(n(b.change)), m(n(b.closing))]),
        ['الإجمالي', m(n(r.opening_cash)), m(n(r.net_change)), m(n(r.closing_cash))]),
      h('section', { class: 'end2' }, sigs(['المحاسب', 'المراجع', 'المدير'])));
  }
  function months(_: Station, r: Record<string, never>) {
    const list = r.months as Array<Record<string, number | string>>;
    const tot = (k: string) => list.reduce((a, x) => a + n(x[k]), 0);
    return doc(letterhead(st, 'الأرباح الشهرية', [['السنة', num(s(r.year))], ['العملة', st.currency], ['تاريخ الإصدار', num(today())]]),
      ptable([['الشهر', 'c'], ['المبيعات (لتر)', 'n'], ['الإيرادات', 'n'], ['تكلفة المبيعات', 'n'], ['مجمل الربح', 'n'], ['المصروفات', 'n'], ['إيرادات أخرى', 'n'], ['صافي الربح', 'n']],
        list.map((x) => [num(s(x.month).split('-').reverse().join('/')), litres(n(x.qty_ml)), m(n(x.revenue)), m(n(x.cost_of_sales)), m(n(x.gross_profit)), m(n(x.operating_expenses)), m(n(x.other_income)), m(n(x.net_profit))]),
        ['الإجمالي', litres(tot('qty_ml')), m(tot('revenue')), m(tot('cost_of_sales')), m(tot('gross_profit')), m(tot('operating_expenses')), m(tot('other_income')), m(tot('net_profit'))], { cls: 'dense' }));
  }
  function boxes(_: Station, r: Record<string, never>) {
    return doc(head('حركة الصناديق والبنوك', periodText(s(r.from), s(r.to))), boxTable(r.boxes as never, r.totals as never), h('section', { class: 'end2' }, sigs(['أمين الصندوق', 'المحاسب', 'المدير'])));
  }
  function collect(_: Station, r: Record<string, never>) {
    const b = r.bands as Record<string, number>;
    return doc(letterhead(st, 'متابعة التحصيل', [['كما في', num(s(r.as_of).split('-').reverse().join('/'))], ['العملة', st.currency], ['تاريخ الإصدار', num(today())]]),
      tiles([['المستحق', m(n(r.total)), true], ['حتى 30 يوماً', m(b.b1)], ['31–60', m(b.b2)], ['61–90', m(b.b3)], ['أكثر من 90 أو لم يسدد', m(b.b4)]]),
      ptable([['العميل'], ['الهاتف', 'c'], ['الرصيد', 'n'], ['السقف', 'n'], ['آخر سداد', 'c'], ['مبلغه', 'n'], ['أيام بلا سداد', 'n']],
        (r.rows as Array<Record<string, number | string | null>>).map((x) => [s(x.name) + (x.over_limit ? ' (تجاوز السقف)' : ''), num(s(x.phone)), m(n(x.balance)), x.credit_limit ? m(n(x.credit_limit)) : '—',
          x.last_credit ? num(s(x.last_credit).split('-').reverse().join('/')) : 'لم يسدد', mt(n(x.last_credit_amount)), num(x.days_since_payment == null ? '—' : String(x.days_since_payment))]),
        ['الإجمالي', '', m(n(r.total)), '', '', '', '']));
  }
  function meters(_: Station, r: Record<string, never>) {
    const days = r.days as Array<{ date: string; pumps: Array<Record<string, number | string>> }>;
    const t = r.totals as Record<string, number>;
    return doc(head('كشف العدادات', periodText(s(r.from), s(r.to))),
      ptable([['التاريخ', 'c'], ['المضخة'], ['الوقود'], ['البداية', 'n'], ['النهاية', 'n'], ['الكمية (لتر)', 'n'], ['نقداً', 'n'], ['آجل', 'n']],
        days.flatMap((d) => d.pumps.map((p) => [num(d.date.split('-').reverse().join('/')), s(p.pump_name), s(p.fuel_name), litres(n(p.open_ml)), litres(n(p.close_ml)), litres(n(p.qty_ml)), m(n(p.cash)), mt(n(p.credit))])),
        ['الإجمالي', '', '', '', '', litres(t.qty_ml), m(t.cash), m(t.credit)], { cls: 'dense' }));
  }
  function trial(_: Station, r: Record<string, never>) {
    const t = r.totals as Record<string, number>;
    return doc(head('ميزان المراجعة', periodText(s(r.from), s(r.to))),
      ptable([['الرمز', 'c'], ['الحساب'], ['أول المدة مدين', 'n'], ['أول المدة دائن', 'n'], ['حركة مدين', 'n'], ['حركة دائن', 'n'], ['آخر المدة مدين', 'n'], ['آخر المدة دائن', 'n']],
        (r.rows as Array<Record<string, number | string>>).map((x) => [num(s(x.code)), s(x.name_ar), mt(n(x.opening_dr)), mt(n(x.opening_cr)), mt(n(x.debit)), mt(n(x.credit)), mt(n(x.closing_dr)), mt(n(x.closing_cr))]),
        ['', r.balanced ? 'الإجمالي — متوازن' : 'الإجمالي — غير متوازن', m(t.opening_dr), m(t.opening_cr), m(t.debit), m(t.credit), m(t.closing_dr), m(t.closing_cr)], { cls: 'dense' }),
      h('section', { class: 'end2' }, sigs(['المحاسب', 'المراجع', 'المدير'])));
  }

  /* ---------- the screen ---------- */
  const pick = h('select', { id: 'r-kind' }, ...SPECS.map((x) => h('option', { value: x.key }, x.title)));
  const from = h('input', { id: 'r-from', type: 'date', value: tday.slice(0, 8) + '01' }), to = h('input', { id: 'r-to', type: 'date', value: tday });
  const fromF = field('من', from), toF = field('إلى', to);
  const show = h('button', { class: 'btn primary', type: 'submit' }, 'عرض');
  const prn = h('button', { class: 'btn', type: 'button', disabled: true }, 'طباعة');
  const out = h('div', { class: 'paper', id: 'r-out' });
  let shown: { spec: Spec; node: HTMLElement; d: { from: string; to: string } } | null = null;
  const spec = () => SPECS.find((x) => x.key === pick.value)!;
  const sync = () => {
    const sp = spec(); fromF.hidden = sp.dates !== 'range';
    (toF.querySelector('span') as HTMLElement).textContent = sp.dates === 'day' ? 'اليوم' : sp.dates === 'asof' ? 'كما في' : sp.dates === 'year' ? 'أي يوم من السنة' : 'إلى';
  };
  pick.addEventListener('change', () => { sync(); prn.disabled = true; out.replaceChildren(); });
  sync();
  const form = h('form', { class: 'row reports-form', onsubmit: async (ev: Event) => {
    ev.preventDefault(); if (show.disabled) return;
    show.disabled = true; show.classList.add('busy');
    try {
      const sp = spec(), d = { from: sp.dates === 'range' ? from.value : to.value, to: to.value || tday };
      const r = await sp.load(be, st, d);
      const node = sp.build(st, r as never, d); shown = { spec: sp, node, d };
      out.replaceChildren(node); prn.disabled = false;
    } catch (e) { toast(errText(e), 'err'); } finally { show.disabled = false; show.classList.remove('busy'); }
  } }, field('التقرير', pick), fromF, toF, show, prn);
  prn.addEventListener('click', () => { if (shown) void print(`${shown.spec.title} ${shown.d.from === shown.d.to ? shown.d.to : shown.d.from + '_' + shown.d.to}`, shown.node.cloneNode(true) as HTMLElement, { paper: shown.spec.paper || 'a4', st, footer: shown.spec.title }); });

  /* letterhead */
  const b = await loadBrand(be);
  const bf = { name: h('input', { id: 'b-name', maxlength: 120, value: b.name }), activity: h('input', { id: 'b-act', maxlength: 160, value: b.activity }),
    address: h('input', { id: 'b-addr', maxlength: 200, value: b.address }), phones: h('input', { id: 'b-ph', maxlength: 120, value: b.phones }), footer: h('input', { id: 'b-foot', maxlength: 200, value: b.footer }) };
  const logo = h('input', { id: 'b-logo', type: 'file', accept: 'image/png,image/jpeg,image/webp,image/svg+xml' });
  const bBtn = h('button', { class: 'btn', type: 'submit' }, 'حفظ الترويسة');
  const brandCard = h('section', { class: 'card' }, h('h2', {}, 'ترويسة المستندات'),
    h('p', { class: 'muted' }, 'تظهر أعلى كل تقرير وكشف وإيصال مطبوع.'),
    h('form', { class: 'stack', onsubmit: async (ev: Event) => {
      ev.preventDefault(); bBtn.disabled = true;
      try {
        const body: Record<string, unknown> = { name: bf.name.value, activity: bf.activity.value, address: bf.address.value, phones: bf.phones.value, footer: bf.footer.value };
        const f = logo.files?.[0];
        if (f) { if (f.size > 400 * 1024) throw { code: 'VALIDATION', message: 'الشعار أكبر من 400 KB' }; body.logo = await new Promise<string>((ok, no) => { const rd = new FileReader(); rd.onload = () => ok(String(rd.result)); rd.onerror = no; rd.readAsDataURL(f); }); }
        setBrandCache(await be.call<Brand>('PATCH', '/brand', body)); toast('حُفظت الترويسة');
      } catch (e) { toast(errText(e), 'err'); } finally { bBtn.disabled = false; }
    } }, field('اسم المنشأة', bf.name), field('النشاط', bf.activity), h('div', { class: 'row' }, field('العنوان', bf.address), field('الهواتف', bf.phones)),
    field('سطر أسفل المستند', bf.footer), field('الشعار (اختياري)', logo, 'PNG أو JPEG أو WEBP أو SVG، حتى 400 KB'), bBtn));

  main.replaceChildren(h('section', { class: 'card wide' }, h('h2', {}, 'التقارير'), form, out), brandCard);
}
