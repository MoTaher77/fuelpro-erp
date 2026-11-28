/* The shared FuelPro v2 screen for sales & shifts. It runs unchanged in the three editions; only `Backend` differs:
   server = fetch to /api/v2, desktop/phone = the core called in-process on the local SQLite file. */
import { fmtLitres, fmtMinor, parseDec } from './fmt.ts';

export interface BackendError { status: number; code: string; message: string; extra?: Record<string, unknown> }
export interface Backend {
  mode: 'server' | 'desktop' | 'phone';
  /** null until the first-run form has been completed */
  stationId(): Promise<number | null>;
  call<T = unknown>(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<T>;
  firstRun(b: Record<string, unknown>): Promise<void>;
}
export type Station = { id: number; name: string; currency: string; cur_dec: number; disp_dec: number | null; require_shift: number; timezone?: string };
type Pump = { id: number; name: string; meter_ml: number; fuel_name: string; price_e4: number; tank_id: number };
type Customer = { id: number; name: string };
type Sale = { id: number; pump_name: string; fuel_name: string; quantity_ml: number; gross: number; pay_type: string; customer_name: string | null; voided_at: string | null; created_at: string; business_date: string };
type Totals = { cash_sales: number; credit_sales: number; qty_ml: number; sales_count: number; expected_cash: number };
type ShiftNow = { id: number; float_amount: number; opened_at: string; totals: Totals } | null;

const MSG: Record<string, string> = {
  SHIFT_REQUIRED: 'افتح وردية قبل تسجيل البيع', SHIFT_ALREADY_OPEN: 'توجد وردية مفتوحة بالفعل', METER_NOT_INCREASING: 'القراءة الحالية يجب أن تكون أكبر من السابقة',
  METER_MISMATCH: 'تغيّر عداد المضخة منذ فتح النموذج؛ راجع القراءة', INSUFFICIENT_STOCK: 'الكمية أكبر من رصيد الخزان', CREDIT_LIMIT: 'البيع يتجاوز سقف ائتمان العميل',
  QUANTITY_TOO_LARGE: 'كمية غير معتادة، راجع قراءة العداد', PRICE_NOT_SET: 'حدّد سعر الوقود أولاً', PERIOD_LOCKED: 'الفترة المحاسبية مقفلة',
  SHIFT_CLOSED: 'هذا المستند يتبع وردية مغلقة', ALREADY_VOIDED: 'المستند ملغى مسبقاً', FORBIDDEN: 'لا تملك صلاحية لهذا الإجراء', NOT_FOUND: 'غير موجود',
  DISCOUNT_TOO_LARGE: 'الخصم يجب أن يكون أقل من مبلغ البيع', EXCEEDS_CAPACITY: 'الكمية أكبر من المساحة الفارغة في الخزان',
  STOCK_ALREADY_SOLD: 'بيع جزء من هذه الكمية؛ صحّح الخزان بالجرد', FUEL_MISMATCH: 'الخزانان ليسا لنفس الوقود', CURRENCY_MISMATCH: 'المحطتان بعملتين مختلفتين', FUTURE_DATE: 'التاريخ في المستقبل', OVERPAYMENT: 'المبلغ أكبر من الرصيد المستحق', CASH_INSUFFICIENT: 'الصندوق لا يحوي هذا المبلغ', NO_OPEN_SHIFT: 'افتح وردية أولاً',
  JOURNAL_UNBALANCED: 'القيد غير متوازن', DRAFTS_PENDING: 'رحّل أو احذف المسودات في هذه الفترة أولاً', NOT_A_BOX: 'اختر صندوقاً أو بنكاً', GROUP_ACCOUNT: 'اختر حساباً تفصيلياً لا تجميعياً',
  USE_STOCK_SCREENS: 'المخزون يتحرك من شاشات المخزون فقط', NOT_DRAFT: 'القيد ليس مسودة', USE_DOCUMENT_VOID: 'ألغِ المستند الأصلي بدل عكس قيده', CODE_TAKEN: 'رمز الحساب مستخدم', CUSTOMER_INACTIVE: 'العميل موقوف', NETWORK: 'تعذّر الاتصال بالخادم', VALIDATION: 'تحقق من الحقول'
};
export const errText = (e: unknown) => { const x = e as BackendError; return MSG[x?.code] || x?.message || 'حدث خطأ غير متوقع'; };
const MODE: Record<Backend['mode'], string> = { server: 'الخادم', desktop: 'سطح المكتب — بدون إنترنت', phone: 'الهاتف — بدون إنترنت' };

type Attrs = Record<string, unknown>;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, a: Attrs = {}, ...kids: Array<Node | string | null | false | undefined>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(a)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}
const newClientId = () => (crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, '').slice(0, 24);

export async function mount(root: HTMLElement, be: Backend): Promise<void> {
  document.documentElement.lang = 'ar'; document.documentElement.dir = 'rtl';
  root.replaceChildren(h('div', { class: 'boot' }, 'جارٍ التحميل…'));
  let sid: number | null;
  try { sid = await be.stationId(); } catch (e) { root.replaceChildren(h('div', { class: 'boot err' }, errText(e))); return; }
  if (sid === null) return firstRunView(root, be);
  return mainView(root, be, sid);
}

export function toastHost(): (m: string, kind?: 'ok' | 'err') => void {
  let host = document.querySelector<HTMLElement>('.toasts');
  if (!host) { host = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(host); }
  return (m, kind = 'ok') => { const t = h('div', { class: 'toast ' + kind }, m); host!.append(t); setTimeout(() => t.remove(), kind === 'err' ? 6000 : 3000); };
}

function firstRunView(root: HTMLElement, be: Backend) {
  const toast = toastHost();
  const f = {
    station: h('input', { id: 'fr-st', required: true, maxlength: 120, value: 'محطة تجريبية' }),
    fuel: h('input', { id: 'fr-fu', value: 'بنزين', maxlength: 60 }),
    price: h('input', { id: 'fr-pr', inputmode: 'decimal', value: '600' }),
    cap: h('input', { id: 'fr-cap', inputmode: 'decimal', value: '40000' }),
    level: h('input', { id: 'fr-lv', inputmode: 'decimal', value: '10000' }),
    pumps: h('input', { id: 'fr-pu', inputmode: 'numeric', value: '2' })
  };
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'ابدأ');
  const form = h('form', { class: 'card narrow', onsubmit: async (ev: Event) => {
    ev.preventDefault();
    // the station's currency decides the stored decimals (ISO 4217 via Intl, as the core does): price_e4 = minor units per litre ×10^4
    const dec = new Intl.NumberFormat('en', { style: 'currency', currency: 'YER' }).resolvedOptions().maximumFractionDigits ?? 0;
    const price = parseDec(f.price.value, dec), cap = parseDec(f.cap.value, 3), lvl = parseDec(f.level.value, 3), pumps = Number(f.pumps.value);
    if (price === null || !price || cap === null || !cap || lvl === null || lvl > cap || !(pumps >= 1 && pumps <= 20)) { toast('تحقق من الأرقام', 'err'); return; }
    btn.disabled = true; btn.textContent = 'جارٍ الإعداد…';
    try {
      await be.firstRun({ station_name: f.station.value, fuel_name: f.fuel.value, price_e4: price * 10_000, capacity_ml: cap, level_ml: lvl, pumps, require_shift: true });
      await mount(root, be);
    } catch (e) { toast(errText(e), 'err'); btn.disabled = false; btn.textContent = 'ابدأ'; }
  } },
  h('h1', {}, 'إعداد المحطة'),
  h('p', { class: 'muted' }, 'قاعدة بيانات جديدة على هذا الجهاز (' + MODE[be.mode] + '). يمكنك تعديل الإعداد لاحقاً.'),
  field('اسم المحطة', f.station), field('الوقود', f.fuel), field('سعر اللتر (ريال)', f.price),
  field('سعة الخزان (لتر)', f.cap), field('الرصيد الافتتاحي (لتر)', f.level), field('عدد المضخات', f.pumps), btn);
  root.replaceChildren(h('main', { class: 'wrap' }, form));
}
export function field(label: string, input: HTMLElement, hint?: string) {
  return h('label', { class: 'field', for: input.id }, h('span', {}, label), input, hint ? h('small', { class: 'muted' }, hint) : null);
}

async function mainView(root: HTMLElement, be: Backend, sid: number) {
  const toast = toastHost();
  const st = await be.call<Station>('GET', `/stations/${sid}`);
  const money = (v: number) => fmtMinor(v, st.cur_dec, st.disp_dec);
  const head = h('header', { class: 'top' }, h('div', { class: 'brand' }, h('b', {}, 'FuelPro'), h('span', {}, st.name)),
    h('span', { class: 'chip', 'data-mode': be.mode }, MODE[be.mode]));
  const tiles = h('section', { class: 'tiles' });
  const shiftBox = h('section', { class: 'card' });
  const saleBox = h('section', { class: 'card' });
  const listBox = h('section', { class: 'card wide' });
  const salesMain = h('main', { class: 'wrap grid' }, tiles, shiftBox, saleBox, listBox);
  const stockMain = h('main', { class: 'wrap grid', hidden: true });
  const partiesMain = h('main', { class: 'wrap grid', hidden: true });
  const financeMain = h('main', { class: 'wrap grid', hidden: true });
  const reportsMain = h('main', { class: 'wrap grid', hidden: true });
  const tabs: Array<[string, string]> = [['sales', 'البيع والوردية'], ['stock', 'المخزون والتوريد'], ['parties', 'العملاء والموردون'], ['finance', 'المالية'], ['reports', 'التقارير']];
  const tabBar = h('nav', { class: 'tabs', role: 'tablist' }, ...tabs.map(([k, label]) => h('button', { type: 'button', role: 'tab', 'data-tab': k, onclick: () => show(k) }, label)));
  const show = async (k: string) => {
    for (const b of tabBar.querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.tab === k));
    salesMain.hidden = k !== 'sales'; stockMain.hidden = k !== 'stock'; partiesMain.hidden = k !== 'parties'; financeMain.hidden = k !== 'finance'; reportsMain.hidden = k !== 'reports';
    try { history.replaceState(null, '', k === 'sales' ? location.pathname : '#' + k); } catch { /* file:// or sandbox */ }
    // the stock screen is a separate file, fetched the first time its tab opens (smaller first screen)
    if (k === 'stock') await (await import('./stock.ts')).stockView(stockMain, be, st, toast);
    else if (k === 'parties') await (await import('./parties.ts')).partiesView(partiesMain, be, st, toast);
    else if (k === 'finance') await (await import('./finance.ts')).financeView(financeMain, be, st, toast);
    else if (k === 'reports') await (await import('./reports.ts')).reportsView(reportsMain, be, st, toast);
    else await refresh();
  };
  root.replaceChildren(head, tabBar, salesMain, stockMain, partiesMain, financeMain, reportsMain);

  let pumps: Pump[] = [], customers: Customer[] = [], shift: ShiftNow = null;
  async function refresh() {
    const [p, c, s, sum, list] = await Promise.all([
      be.call<Pump[]>('GET', `/stations/${sid}/pumps`), be.call<Customer[]>('GET', `/stations/${sid}/customers`),
      be.call<ShiftNow>('GET', `/stations/${sid}/shift`), be.call<{ n: number; qty_ml: number; gross: number; cash: number }>('GET', `/stations/${sid}/summary`),
      be.call<Sale[]>('GET', `/stations/${sid}/sales`, undefined, { limit: '30' })]);
    pumps = p; customers = c; shift = s;
    tiles.replaceChildren(tile('مبيعات اليوم', money(sum.gross)), tile('نقداً', money(sum.cash)), tile('اللترات', fmtLitres(sum.qty_ml)), tile('عدد العمليات', String(sum.n)));
    drawShift(); drawSale(); drawList(list);
  }
  const tile = (k: string, v: string) => h('div', { class: 'tile' }, h('span', {}, k), h('b', { class: 'num' }, v));

  function drawShift() {
    if (!shift) {
      const fl = h('input', { id: 'sh-float', inputmode: 'decimal', value: '0' });
      const b = h('button', { class: 'btn primary', type: 'submit' }, 'فتح وردية');
      shiftBox.replaceChildren(h('h2', {}, 'الوردية'), h('p', { class: 'muted' }, 'لا توجد وردية مفتوحة.'),
        h('form', { class: 'row', onsubmit: (ev: Event) => run(ev, b, async () => {
          const v = parseDec(fl.value, st.cur_dec); if (v === null) throw { code: 'VALIDATION' };
          await be.call('POST', `/stations/${sid}/shifts`, { float_amount: v }); toast('فُتحت الوردية');
        }) }, field('عهدة الصندوق', fl), b));
      return;
    }
    const t = shift.totals;
    const cnt = h('input', { id: 'sh-count', inputmode: 'decimal', placeholder: money(t.expected_cash) });
    const b = h('button', { class: 'btn', type: 'submit' }, 'إغلاق الوردية');
    const id = shift.id;
    shiftBox.replaceChildren(h('h2', {}, 'الوردية رقم ' + id),
      h('dl', { class: 'kv' }, h('dt', {}, 'العهدة'), h('dd', { class: 'num' }, money(shift.float_amount)), h('dt', {}, 'مبيعات نقدية'), h('dd', { class: 'num' }, money(t.cash_sales)),
        h('dt', {}, 'مبيعات آجلة'), h('dd', { class: 'num' }, money(t.credit_sales)), h('dt', {}, 'النقد المتوقع'), h('dd', { class: 'num strong' }, money(t.expected_cash))),
      h('form', { class: 'row', onsubmit: (ev: Event) => run(ev, b, async () => {
        const v = parseDec(cnt.value, st.cur_dec); if (v === null) throw { code: 'VALIDATION', message: 'أدخل النقد المعدود' };
        const r = await be.call<{ variance: number }>('POST', `/stations/${sid}/shifts/${id}/close`, { counted_cash: v });
        toast(r.variance === 0 ? 'أُغلقت الوردية بلا فرق' : (r.variance < 0 ? 'أُغلقت الوردية — عجز ' : 'أُغلقت الوردية — زيادة ') + money(Math.abs(r.variance)));
      }) }, field('النقد المعدود', cnt), b));
  }

  function drawSale() {
    const pump = h('select', { id: 's-pump' }, ...pumps.map((p) => h('option', { value: p.id }, `${p.name} — ${p.fuel_name}`)));
    const mode = h('select', { id: 's-mode' }, h('option', { value: 'meter' }, 'بقراءة العداد'), h('option', { value: 'qty' }, 'بالكمية (لتر)'));
    const val = h('input', { id: 's-val', inputmode: 'decimal', autocomplete: 'off', required: true });
    const pay = h('select', { id: 's-pay' }, h('option', { value: 'cash' }, 'نقداً'), h('option', { value: 'credit' }, 'آجل'));
    const cust = h('select', { id: 's-cust', disabled: true }, h('option', { value: '' }, '— العميل —'), ...customers.map((c) => h('option', { value: c.id }, c.name)));
    const info = h('p', { class: 'muted num', id: 's-info' });
    const b = h('button', { class: 'btn primary', type: 'submit' }, 'تسجيل البيع');
    let clientId = newClientId();                       // one id per form: a retry after a dropped connection is not a second sale
    const cur = () => pumps.find((p) => p.id === Number(pump.value));
    const preview = () => {
      const p = cur(); if (!p) { info.textContent = ''; return; }
      const x = parseDec(val.value, 3);
      const qty = x === null ? null : mode.value === 'meter' ? x - p.meter_ml : x;
      const price = 'السعر ' + fmtMinor(Number(BigInt(p.price_e4) / 10_000n), st.cur_dec, st.disp_dec);
      info.textContent = 'العداد الحالي ' + fmtLitres(p.meter_ml) + ' · ' + price + (qty && qty > 0 ? ' · الكمية ' + fmtLitres(qty) + ' لتر' : '');
    };
    pump.addEventListener('change', preview); mode.addEventListener('change', preview); val.addEventListener('input', preview);
    pay.addEventListener('change', () => { cust.disabled = pay.value !== 'credit'; });
    preview();
    saleBox.replaceChildren(h('h2', {}, 'بيع وقود'),
      h('form', { class: 'stack', onsubmit: (ev: Event) => run(ev, b, async () => {
        const p = cur(); if (!p) throw { code: 'VALIDATION', message: 'اختر المضخة' };
        const x = parseDec(val.value, 3); if (x === null || x <= 0) throw { code: 'VALIDATION', message: 'أدخل رقماً صحيحاً' };
        const body: Record<string, unknown> = { client_id: clientId, pump_id: p.id, pay_type: pay.value, expected_open_ml: p.meter_ml };
        if (mode.value === 'meter') body.close_ml = x; else body.quantity_ml = x;
        if (pay.value === 'credit') { if (!cust.value) throw { code: 'VALIDATION', message: 'اختر العميل للبيع الآجل' }; body.customer_id = Number(cust.value); }
        const s = await be.call<{ gross: number; quantity_ml: number; duplicate?: boolean }>('POST', `/stations/${sid}/sales`, body);
        clientId = newClientId();
        toast((s.duplicate ? 'سُجّل مسبقاً: ' : 'تم البيع: ') + fmtLitres(s.quantity_ml) + ' لتر — ' + money(s.gross));
      }) }, field('المضخة', pump), h('div', { class: 'row' }, field('طريقة الإدخال', mode), field(mode.value === 'meter' ? 'القراءة' : 'الكمية', val)),
      h('div', { class: 'row' }, field('الدفع', pay), field('العميل', cust)), info, b));
  }

  function drawList(rows: Sale[]) {
    const body = h('tbody', {}, ...rows.map((s) => h('tr', { class: s.voided_at ? 'void' : '' },
      h('td', { class: 'num' }, String(s.id)), h('td', {}, s.pump_name), h('td', {}, s.fuel_name), h('td', { class: 'num' }, fmtLitres(s.quantity_ml)),
      h('td', { class: 'num' }, money(s.gross)), h('td', {}, s.pay_type === 'cash' ? 'نقداً' : 'آجل — ' + (s.customer_name || '')),
      h('td', {}, h('button', { class: 'btn link plain', type: 'button', title: 'طباعة الإيصال', onclick: async () => {
        try { await (await import('./print.ts')).receipt(be, st, s as never); } catch (e) { toast(errText(e), 'err'); }
      } }, 'إيصال')),
      h('td', {}, s.voided_at ? 'ملغى' : h('button', { class: 'btn link', type: 'button', onclick: async (ev: Event) => {
        const reason = prompt('سبب الإلغاء (3 أحرف على الأقل)'); if (!reason) return;
        await run(ev, ev.currentTarget as HTMLButtonElement, async () => { await be.call('POST', `/stations/${sid}/sales/${s.id}/void`, { reason }); toast('أُلغي البيع'); });
      } }, 'إلغاء')))));
    listBox.replaceChildren(h('h2', {}, 'آخر المبيعات'), rows.length
      ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, ...['#', 'المضخة', 'الوقود', 'لتر', 'المبلغ', 'الدفع', '', ''].map((x) => h('th', {}, x)))), body))
      : h('p', { class: 'muted' }, 'لا مبيعات بعد.'));
  }

  async function run(ev: Event, btn: HTMLButtonElement, fn: () => Promise<void>) {
    ev.preventDefault(); if (btn.disabled) return;
    const label = btn.textContent; btn.disabled = true; btn.classList.add('busy');
    try { await fn(); await refresh(); }
    catch (e) { toast(errText(e), 'err'); }
    finally { btn.disabled = false; btn.classList.remove('busy'); btn.textContent = label; }
  }
  await refresh();
}
