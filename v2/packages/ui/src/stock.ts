/* «المخزون والتوريد»: tanks, deliveries (cash / bank / credit), stock counts, transfers, suppliers, the month's reconciliation.
   Shared by the three editions like the sales screen. Every rule is checked again by the core. */
import { fmtLitres, fmtMinor, parseDec } from './fmt.ts';
import { errText, field, h, type Backend, type Station } from './index.ts';

type Tank = { id: number; name: string; fuel_name: string; level_ml: number; capacity_ml: number; min_ml: number; value: number; avg_cost_e4: number };
type Supplier = { id: number; name: string; balance: number; terms_days: number };
type Delivery = { id: number; business_date: string; tank_name: string; quantity_ml: number; net: number; vat: number; pay_type: string; supplier: string | null; ref: string | null; voided_at: string | null };
type RecRow = { tank_name: string; fuel_name: string; opening_ml: number; received_ml: number; transfer_in_ml: number; transfer_out_ml: number; sales_ml: number;
  count_variance_ml: number; closing_ml: number; closing_value: number; variance_pct: number | null; consistent: boolean };
const PAY: Record<string, string> = { cash: 'نقداً', bank: 'بنك', credit: 'آجل' };

export async function stockView(main: HTMLElement, be: Backend, st: Station, toast: (m: string, k?: 'ok' | 'err') => void) {
  const sid = st.id, money = (v: number) => fmtMinor(v, st.cur_dec, st.disp_dec);
  const costDec = st.cur_dec + 4;                 // unit cost typed per litre → cost_e4 (minor units ×10^4)
  main.replaceChildren(h('div', { class: 'boot' }, 'جارٍ التحميل…'));
  const [tanks, sups, dels, rec] = await Promise.all([
    be.call<Tank[]>('GET', `/stations/${sid}/tanks`), be.call<Supplier[]>('GET', `/stations/${sid}/suppliers`),
    be.call<Delivery[]>('GET', `/stations/${sid}/deliveries`, undefined, { limit: '30' }), be.call<{ from: string; to: string; rows: RecRow[] }>('GET', `/stations/${sid}/stock-reconciliation`)]);
  const reload = () => stockView(main, be, st, toast);
  const run = async (ev: Event, btn: HTMLButtonElement, fn: () => Promise<void>) => {
    ev.preventDefault(); if (btn.disabled) return;
    btn.disabled = true; btn.classList.add('busy');
    try { await fn(); await reload(); } catch (e) { toast(errText(e), 'err'); btn.disabled = false; btn.classList.remove('busy'); }
  };
  const tankOpts = (id: string) => h('select', { id }, ...tanks.map((t) => h('option', { value: t.id }, `${t.name} — ${t.fuel_name}`)));
  const litres = (id: string) => h('input', { id, inputmode: 'decimal', autocomplete: 'off', required: true });
  const needL = (el: HTMLInputElement) => { const v = parseDec(el.value, 3); if (v === null || v <= 0) throw { code: 'VALIDATION', message: 'أدخل كمية صحيحة باللتر' }; return v; };

  // width through the CSSOM: a style="" attribute is refused by the page's CSP (style-src 'self')
  const bar = (pct: number) => { const i = h('i'); i.style.width = pct + '%'; return h('div', { class: 'bar', role: 'img', 'aria-label': pct + '%' }, i); };
  /* tanks */
  const tankCards = h('section', { class: 'tiles' }, ...tanks.map((t) => {
    const pct = Math.min(100, Math.round(t.level_ml * 100 / t.capacity_ml)), low = t.min_ml > 0 && t.level_ml <= t.min_ml;
    return h('div', { class: 'tile tank' + (low ? ' low' : '') }, h('span', {}, `${t.name} — ${t.fuel_name}`), h('b', { class: 'num' }, fmtLitres(t.level_ml) + ' L'),
      bar(pct),
      h('small', { class: 'muted num' }, `${pct}% · ${money(t.value)}`));
  }));

  /* delivery */
  const dT = tankOpts('d-tank'), dQ = litres('d-qty'), dC = h('input', { id: 'd-cost', inputmode: 'decimal', required: true });
  const dP = h('select', { id: 'd-pay' }, ...Object.entries(PAY).map(([k, v]) => h('option', { value: k }, v)));
  const dS = h('select', { id: 'd-sup' }, h('option', { value: '' }, '— المورد —'), ...sups.map((s) => h('option', { value: s.id }, s.name)));
  const dR = h('input', { id: 'd-ref', maxlength: 30, placeholder: 'تلقائي' });
  const dB = h('button', { class: 'btn primary', type: 'submit' }, 'تسجيل التوريد');
  const delivery = h('section', { class: 'card' }, h('h2', {}, 'توريد وقود'),
    h('form', { class: 'stack', onsubmit: (ev: Event) => run(ev, dB, async () => {
      const cost = parseDec(dC.value, costDec); if (cost === null) throw { code: 'VALIDATION', message: 'أدخل تكلفة اللتر' };
      const body: Record<string, unknown> = { tank_id: Number(dT.value), quantity_ml: needL(dQ), cost_e4: cost, pay_type: dP.value };
      if (dS.value) body.supplier_id = Number(dS.value); if (dR.value.trim()) body.ref = dR.value.trim();
      const d = await be.call<{ net: number; vat: number; ref: string }>('POST', `/stations/${sid}/deliveries`, body);
      toast(`سُجّل التوريد رقم ${d.ref}: ${money(d.net + d.vat)}`);
    }) }, field('الخزان', dT), h('div', { class: 'row' }, field('الكمية (لتر)', dQ), field('تكلفة اللتر', dC)),
    h('div', { class: 'row' }, field('الدفع', dP), field('المورد', dS)), field('رقم الفاتورة', dR), dB));

  /* stock count */
  const cT = tankOpts('c-tank'), cQ = h('input', { id: 'c-qty', inputmode: 'decimal', required: true }), cN = h('input', { id: 'c-note', required: true, minlength: 3, maxlength: 200, value: 'جرد' });
  const cInfo = h('p', { class: 'muted num' }), cB = h('button', { class: 'btn', type: 'submit' }, 'تسجيل الجرد');
  const cShow = () => { const t = tanks.find((x) => x.id === Number(cT.value)), v = parseDec(cQ.value, 3);
    cInfo.textContent = t ? 'الدفتري ' + fmtLitres(t.level_ml) + (v !== null ? ' · الفرق ' + fmtLitres(v - t.level_ml) : '') : ''; };
  cT.addEventListener('change', cShow); cQ.addEventListener('input', cShow); cShow();
  const count = h('section', { class: 'card' }, h('h2', {}, 'جرد خزان'),
    h('form', { class: 'stack', onsubmit: (ev: Event) => run(ev, cB, async () => {
      const v = parseDec(cQ.value, 3); if (v === null) throw { code: 'VALIDATION', message: 'أدخل الكمية المقيسة' };
      const r = await be.call<{ diff_ml: number; value: number }>('POST', `/stations/${sid}/adjustments`, { tank_id: Number(cT.value), after_ml: v, note: cN.value });
      toast(r.diff_ml === 0 ? 'لا فرق' : (r.diff_ml < 0 ? 'عجز ' : 'زيادة ') + fmtLitres(Math.abs(r.diff_ml)) + ' L — ' + money(Math.abs(r.value)));
    }) }, field('الخزان', cT), field('الكمية المقيسة (لتر)', cQ), field('ملاحظة', cN), cInfo, cB));

  /* transfer (same station; between stations comes with the multi-station screens) */
  const tF = tankOpts('t-from'), tTo = tankOpts('t-to'), tQ = litres('t-qty'), tB = h('button', { class: 'btn', type: 'submit' }, 'تحويل');
  if (tanks.length > 1) tTo.selectedIndex = 1;
  const transfer = h('section', { class: 'card' }, h('h2', {}, 'تحويل بين خزانين'),
    tanks.length < 2 ? h('p', { class: 'muted' }, 'يلزم خزانان لنفس الوقود.') :
      h('form', { class: 'stack', onsubmit: (ev: Event) => run(ev, tB, async () => {
        const r = await be.call<{ value: number }>('POST', `/stations/${sid}/transfers`, { from_tank_id: Number(tF.value), to_tank_id: Number(tTo.value), quantity_ml: needL(tQ) });
        toast('تم التحويل بقيمة ' + money(r.value));
      }) }, h('div', { class: 'row' }, field('من', tF), field('إلى', tTo)), field('الكمية (لتر)', tQ), tB));

  /* suppliers */
  const sN = h('input', { id: 's-name', required: true, maxlength: 120 }), sO = h('input', { id: 's-open', inputmode: 'decimal', value: '0' }), sB = h('button', { class: 'btn', type: 'submit' }, 'إضافة');
  const suppliers = h('section', { class: 'card' }, h('h2', {}, 'الموردون'),
    sups.length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'المورد'), h('th', {}, 'الرصيد (له)'))),
      h('tbody', {}, ...sups.map((s) => h('tr', {}, h('td', {}, s.name), h('td', { class: 'num' }, money(s.balance))))))) : h('p', { class: 'muted' }, 'لا موردين بعد.'),
    h('form', { class: 'row', onsubmit: (ev: Event) => run(ev, sB, async () => {
      const o = parseDec(sO.value || '0', st.cur_dec); if (o === null) throw { code: 'VALIDATION', message: 'الرصيد الافتتاحي غير صحيح' };
      await be.call('POST', `/stations/${sid}/suppliers`, { name: sN.value, opening_balance: o }); toast('أُضيف المورد');
    }) }, field('اسم المورد', sN), field('رصيد افتتاحي له', sO), sB));

  /* recent deliveries */
  const list = h('section', { class: 'card wide' }, h('h2', {}, 'آخر التوريدات'), dels.length ? h('div', { class: 'tablewrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ...['رقم', 'التاريخ', 'الخزان', 'لتر', 'المبلغ', 'الدفع', 'المورد', ''].map((x) => h('th', {}, x)))),
    h('tbody', {}, ...dels.map((d) => h('tr', { class: d.voided_at ? 'void' : '' }, h('td', { class: 'num' }, d.ref || String(d.id)), h('td', { class: 'num' }, d.business_date),
      h('td', {}, d.tank_name), h('td', { class: 'num' }, fmtLitres(d.quantity_ml)), h('td', { class: 'num' }, money(d.net + d.vat)), h('td', {}, PAY[d.pay_type] || d.pay_type),
      h('td', {}, d.supplier || '—'), h('td', {}, d.voided_at ? 'ملغى' : h('button', { class: 'btn link', type: 'button', onclick: (ev: Event) => {
        const reason = prompt('سبب إلغاء التوريد (3 أحرف على الأقل)'); if (!reason) return;
        run(ev, ev.currentTarget as HTMLButtonElement, async () => { await be.call('POST', `/stations/${sid}/deliveries/${d.id}/void`, { reason }); toast('أُلغي التوريد'); });
      } }, 'إلغاء'))))))) : h('p', { class: 'muted' }, 'لا توريدات بعد.'));

  /* this month's reconciliation */
  const recon = h('section', { class: 'card wide' }, h('h2', {}, `مطابقة الخزانات ${rec.from} → ${rec.to}`), h('div', { class: 'tablewrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ...['الخزان', 'أول المدة', 'وارد', 'تحويل وارد', 'تحويل صادر', 'مبيعات', 'فرق الجرد', 'آخر المدة', 'القيمة', ''].map((x) => h('th', {}, x)))),
    h('tbody', {}, ...rec.rows.map((r) => h('tr', {}, h('td', {}, `${r.tank_name} — ${r.fuel_name}`),
      ...[r.opening_ml, r.received_ml, r.transfer_in_ml, r.transfer_out_ml, r.sales_ml, r.count_variance_ml, r.closing_ml].map((v) => h('td', { class: 'num' }, fmtLitres(v))),
      h('td', { class: 'num' }, money(r.closing_value)), h('td', {}, r.consistent ? '✓' : h('span', { class: 'bad' }, 'غير متطابق'))))))));

  main.replaceChildren(tankCards, delivery, count, transfer, suppliers, list, recon);
}
