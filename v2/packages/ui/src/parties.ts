/* «العملاء والموردون»: balances, collect from a customer, pay a supplier, account statements and debt ageing.
   Shared by the three editions; loaded only when its tab opens. Every rule is checked again by the core. */
import { fmtLitres, fmtMinor, parseDec } from './fmt.ts';
import { errText, field, h, type Backend, type Station } from './index.ts';

type Customer = { id: number; name: string; phone: string | null; balance: number; credit_limit: number; terms_days: number };
type Supplier = { id: number; name: string; balance: number; terms_days: number };
type Entry = { kind: string; id: number; date: string; debit: number; credit: number; balance: number; voided: boolean; quantity_ml?: number; fuel_name?: string; note?: string | null; ref_no?: string };
type Statement = { balance: number; opening: number; total_debit: number; total_credit: number; from?: string | null; to?: string | null; entries: Entry[] };
type AgeRow = { id: number; name: string; current: number; d30: number; d60: number; d90: number; over90: number; advance: number; balance: number; oldest_due: string | null };
const KIND: Record<string, string> = { sale: 'بيع آجل', payment: 'سداد', purchase: 'توريد آجل', opening: 'رصيد افتتاحي', journal: 'قيد' };

export async function partiesView(main: HTMLElement, be: Backend, st: Station, toast: (m: string, k?: 'ok' | 'err') => void) {
  const sid = st.id, money = (v: number) => fmtMinor(v, st.cur_dec, st.disp_dec), amt = (el: HTMLInputElement) => {
    const v = parseDec(el.value, st.cur_dec); if (v === null || v <= 0) throw { code: 'VALIDATION', message: 'أدخل مبلغاً صحيحاً' }; return v; };
  main.replaceChildren(h('div', { class: 'boot' }, 'جارٍ التحميل…'));
  const [custs, sups, ageC, ageS] = await Promise.all([
    be.call<Customer[]>('GET', `/stations/${sid}/customers`), be.call<Supplier[]>('GET', `/stations/${sid}/suppliers`),
    be.call<{ rows: AgeRow[]; totals: AgeRow }>('GET', `/stations/${sid}/ageing`, undefined, { type: 'customer' }),
    be.call<{ rows: AgeRow[]; totals: AgeRow }>('GET', `/stations/${sid}/ageing`, undefined, { type: 'supplier' })]);
  const reload = () => partiesView(main, be, st, toast);
  const run = async (ev: Event, btn: HTMLButtonElement, fn: () => Promise<void>, again = true) => {
    ev.preventDefault(); if (btn.disabled) return;
    btn.disabled = true; btn.classList.add('busy');
    try { await fn(); if (again) await reload(); } catch (e) { toast(errText(e), 'err'); }
    finally { btn.disabled = false; btn.classList.remove('busy'); }
  };
  const table = (head: string[], rows: Array<Array<Node | string>>, cls = '') => h('div', { class: 'tablewrap' }, h('table', { class: cls },
    h('thead', {}, h('tr', {}, ...head.map((x) => h('th', {}, x)))), h('tbody', {}, ...rows.map((r) => h('tr', {}, ...r.map((c) => h('td', {}, c)))))));
  const num = (v: number) => h('span', { class: 'num' }, money(v));
  const stBox = h('section', { class: 'card wide', hidden: true });

  /* statement of one customer or supplier, with voids for payments */
  async function showStatement(type: 'customer' | 'supplier', id: number, name: string) {
    const from = h('input', { id: 'st-from', type: 'date' }), to = h('input', { id: 'st-to', type: 'date' }), go = h('button', { class: 'btn', type: 'submit' }, 'عرض');
    const out = h('div');
    let last: Statement | null = null;
    const desc = (e: Entry) => (KIND[e.kind] || e.kind) + (e.quantity_ml ? ` — ${fmtLitres(e.quantity_ml)} L ${e.fuel_name || ''}` : '') + (e.ref_no ? ` #${e.ref_no}` : '') + (e.note ? ` — ${e.note}` : '');
    const printIt = async () => {
      if (!last) return;
      const s = last;
      try {
        await (await import('./print.ts')).statement(be, st, { title: type === 'customer' ? 'كشف حساب عميل' : 'كشف حساب مورد', name, from: s.from || from.value || null, to: s.to || to.value || null,
          opening: s.opening, total_debit: s.total_debit, total_credit: s.total_credit, balance: s.balance, natural: type === 'customer' ? 'debit' : 'credit',
          entries: s.entries.map((e) => ({ date: e.date, desc: desc(e), debit: e.debit, credit: e.credit, balance: e.balance, voided: e.voided })) });
      } catch (e) { toast(errText(e), 'err'); }
    };
    const draw = async () => {
      const q: Record<string, string> = {}; if (from.value) q.from = from.value; if (to.value) q.to = to.value;
      const s = await be.call<Statement>('GET', `/stations/${sid}/${type === 'customer' ? 'customers' : 'suppliers'}/${id}/statement`, undefined, q);
      last = s;
      out.replaceChildren(
        h('dl', { class: 'kv' }, h('dt', {}, 'رصيد أول المدة'), h('dd', { class: 'num' }, money(s.opening)), h('dt', {}, 'مدين'), h('dd', { class: 'num' }, money(s.total_debit)),
          h('dt', {}, 'دائن'), h('dd', { class: 'num' }, money(s.total_credit)), h('dt', {}, type === 'customer' ? 'الرصيد (عليه)' : 'الرصيد (له)'), h('dd', { class: 'num strong' }, money(s.balance))),
        s.entries.length ? table(['التاريخ', 'البيان', 'مدين', 'دائن', 'الرصيد', ''], s.entries.map((e) => [
          h('span', { class: 'num' }, e.date || '—'),
          h('span', { class: e.voided ? 'muted strike' : '' }, desc(e) + (e.voided ? ' (ملغى)' : '')),
          e.debit ? num(e.debit) : '', e.credit ? num(e.credit) : '', e.voided ? '' : num(e.balance),
          e.kind === 'payment' && !e.voided ? h('button', { class: 'btn link', type: 'button', onclick: (ev: Event) => {
            const reason = prompt('سبب إلغاء السداد (3 أحرف على الأقل)'); if (!reason) return;
            run(ev, ev.currentTarget as HTMLButtonElement, async () => {
              await be.call('POST', `/stations/${sid}/${type === 'customer' ? 'payments' : 'supplier-payments'}/${e.id}/void`, { reason }); toast('أُلغي السداد');
            });
          } }, 'إلغاء') : ''])) : h('p', { class: 'muted' }, 'لا حركات في هذه الفترة.'));
    };
    stBox.hidden = false;
    stBox.replaceChildren(h('h2', {}, `كشف حساب: ${name}`),
      h('form', { class: 'row noprint', onsubmit: (ev: Event) => run(ev, go, draw, false) }, field('من', from), field('إلى', to), go,
        h('button', { class: 'btn', type: 'button', onclick: printIt }, 'طباعة')), out);
    await draw();
    stBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* customers */
  const pC = h('select', { id: 'p-cust' }, ...custs.map((c) => h('option', { value: c.id }, `${c.name} — ${money(c.balance)}`)));
  const pA = h('input', { id: 'p-amt', inputmode: 'decimal', required: true }), pM = h('select', { id: 'p-method' }, h('option', { value: 'cash' }, 'نقداً'), h('option', { value: 'bank' }, 'بنك'));
  const pB = h('button', { class: 'btn primary', type: 'submit' }, 'تسجيل السداد');
  const collect = h('section', { class: 'card' }, h('h2', {}, 'تحصيل من عميل'), custs.length
    ? h('form', { class: 'stack', onsubmit: (ev: Event) => run(ev, pB, async () => {
      const r = await be.call<{ balance: number }>('POST', `/stations/${sid}/payments`, { customer_id: Number(pC.value), amount: amt(pA), method: pM.value });
      toast('سُجّل السداد — الرصيد المتبقي ' + money(r.balance));
    }) }, field('العميل', pC), h('div', { class: 'row' }, field('المبلغ', pA), field('الطريقة', pM)), pB)
    : h('p', { class: 'muted' }, 'لا عملاء بعد.'));
  const nN = h('input', { id: 'n-name', required: true, maxlength: 120 }), nO = h('input', { id: 'n-open', inputmode: 'decimal', value: '0' }),
    nL = h('input', { id: 'n-limit', inputmode: 'decimal', value: '0' }), nB = h('button', { class: 'btn', type: 'submit' }, 'إضافة عميل');
  const custList = h('section', { class: 'card wide' }, h('h2', {}, 'العملاء'),
    custs.length ? table(['العميل', 'الهاتف', 'الرصيد (عليه)', 'سقف الائتمان', ''], custs.map((c) => [c.name, h('span', { class: 'num' }, c.phone || '—'), num(c.balance),
      c.credit_limit ? num(c.credit_limit) : '—', h('button', { class: 'btn link plain', type: 'button', onclick: () => showStatement('customer', c.id, c.name) }, 'كشف الحساب')])) : '',
    h('form', { class: 'row', onsubmit: (ev: Event) => run(ev, nB, async () => {
      const o = parseDec(nO.value || '0', st.cur_dec), l = parseDec(nL.value || '0', st.cur_dec);
      if (o === null || l === null) throw { code: 'VALIDATION', message: 'أرقام غير صحيحة' };
      await be.call('POST', `/stations/${sid}/customers`, { name: nN.value, opening_balance: o, credit_limit: l }); toast('أُضيف العميل');
    }) }, field('اسم العميل', nN), field('رصيد افتتاحي عليه', nO), field('سقف الائتمان', nL), nB));

  /* suppliers */
  const sS = h('select', { id: 'sp-sup' }, ...sups.map((s) => h('option', { value: s.id }, `${s.name} — ${money(s.balance)}`)));
  const sA = h('input', { id: 'sp-amt', inputmode: 'decimal', required: true }), sM = h('select', { id: 'sp-method' }, h('option', { value: 'bank' }, 'بنك'), h('option', { value: 'cash' }, 'نقداً'));
  const sB = h('button', { class: 'btn', type: 'submit' }, 'سداد للمورد');
  const pay = h('section', { class: 'card' }, h('h2', {}, 'سداد لمورد'), sups.length
    ? h('form', { class: 'stack', onsubmit: (ev: Event) => run(ev, sB, async () => {
      const r = await be.call<{ balance: number }>('POST', `/stations/${sid}/supplier-payments`, { supplier_id: Number(sS.value), amount: amt(sA), method: sM.value });
      toast('سُجّل السداد — المتبقي للمورد ' + money(r.balance));
    }) }, field('المورد', sS), h('div', { class: 'row' }, field('المبلغ', sA), field('الطريقة', sM)), sB,
      h('div', { class: 'row' }, ...sups.map((s) => h('button', { class: 'btn link plain', type: 'button', onclick: () => showStatement('supplier', s.id, s.name) }, 'كشف ' + s.name))))
    : h('p', { class: 'muted' }, 'لا موردين بعد (أضفهم من «المخزون والتوريد»).'));

  /* ageing */
  const ageTable = (title: string, a: { rows: AgeRow[]; totals: AgeRow }) => h('section', { class: 'card wide' }, h('h2', {}, title),
    a.rows.length ? table(['الاسم', 'غير مستحق', '1–30 يوماً', '31–60', '61–90', 'أكثر من 90', 'مقدّم', 'الرصيد'],
      [...a.rows.map((r) => [r.name, num(r.current), num(r.d30), num(r.d60), num(r.d90), h('span', { class: r.over90 ? 'num bad' : 'num' }, money(r.over90)), num(r.advance), h('b', { class: 'num' }, money(r.balance))]),
        [h('b', {}, 'الإجمالي'), num(a.totals.current), num(a.totals.d30), num(a.totals.d60), num(a.totals.d90), num(a.totals.over90), num(a.totals.advance), h('b', { class: 'num' }, money(a.totals.balance))]])
      : h('p', { class: 'muted' }, 'لا أرصدة.'));

  main.replaceChildren(collect, pay, custList, stBox, ageTable('أعمار ديون العملاء', ageC), ageTable('أعمار مستحقات الموردين', ageS));
}
