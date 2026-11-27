/* «المالية»: boxes & banks, expenses, receipt & payment vouchers, drawer ↔ bank / owner, manual journals (draft → post),
   the trial balance and the period lock. Shared by the three editions; loaded only when its tab opens.
   Every rule (accounts that can be used, customer / supplier lines, balance, lock) is checked again by the core. */
import { fmtMinor, parseDec } from './fmt.ts';
import { errText, field, h, type Backend, type Station } from './index.ts';

type Account = { id: number; code: string; name_ar: string; type: string; sys: string | null; is_group: number; active: number; box: string | null };
type TbRow = { account_id: number; code: string; name_ar: string; type: string; debit: number; credit: number; closing_dr: number; closing_cr: number };
type Tb = { from: string; to: string; rows: TbRow[]; totals: Record<string, number>; balanced: boolean };
type Journal = { id: number; business_date: string; memo: string | null; status: string; source: string; lines: Array<{ code: string; name_ar: string; debit: number; credit: number }> };
type Party = { id: number; name: string };
const CATS: Array<[string, string]> = [['power', 'كهرباء ومولدات'], ['maint', 'صيانة'], ['transport', 'نقل'], ['rent', 'إيجار'], ['fees', 'رسوم وضرائب'], ['salaries', 'رواتب'], ['other', 'أخرى']];

export async function financeView(main: HTMLElement, be: Backend, st: Station, toast: (m: string, k?: 'ok' | 'err') => void) {
  const sid = st.id, money = (v: number) => fmtMinor(v, st.cur_dec, st.disp_dec);
  const amt = (el: HTMLInputElement, zero = false) => { const v = parseDec(el.value || (zero ? '0' : ''), st.cur_dec); if (v === null || (!zero && v <= 0)) throw { code: 'VALIDATION', message: 'أدخل مبلغاً صحيحاً' }; return v; };
  main.replaceChildren(h('div', { class: 'boot' }, 'جارٍ التحميل…'));
  const today = new Date().toISOString().slice(0, 10);
  const [accounts, custs, sups, tb, drafts, lock] = await Promise.all([
    be.call<Account[]>('GET', '/accounts'), be.call<Party[]>('GET', `/stations/${sid}/customers`), be.call<Party[]>('GET', `/stations/${sid}/suppliers`),
    be.call<Tb>('GET', '/accounting/trial-balance', undefined, { station_id: String(sid), to: '9999-12-31', from: today.slice(0, 4) + '-01-01' }),
    be.call<Journal[]>('GET', `/stations/${sid}/journals`, undefined, { status: 'draft', limit: '20' }), be.call<{ locked_through: string | null }>('GET', '/period-lock')]);
  const reload = () => financeView(main, be, st, toast);
  const run = async (ev: Event, btn: HTMLButtonElement, fn: () => Promise<void>) => {
    ev.preventDefault(); if (btn.disabled) return;
    btn.disabled = true; btn.classList.add('busy');
    try { await fn(); await reload(); } catch (e) { toast(errText(e), 'err'); btn.disabled = false; btn.classList.remove('busy'); }
  };
  const table = (head: string[], rows: Array<Array<Node | string>>) => h('div', { class: 'tablewrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ...head.map((x) => h('th', {}, x)))), h('tbody', {}, ...rows.map((r) => h('tr', {}, ...r.map((c) => h('td', {}, c)))))));
  const num = (v: number) => h('span', { class: 'num' }, money(v));
  const usable = accounts.filter((a) => a.active && !a.is_group && a.sys !== 'inventory' && a.sys !== 'emp_adv' && a.sys !== 'salaries_payable');
  const boxList = usable.filter((a) => a.box || a.sys === 'cash' || a.sys === 'bank');
  const acctSel = (id: string, list = usable) => h('select', { id }, ...list.map((a) => h('option', { value: a.id }, `${a.code} — ${a.name_ar}`)));
  const closing = new Map(tb.rows.map((r) => [r.account_id, r.closing_dr - r.closing_cr]));

  /* boxes & banks */
  const boxCard = h('section', { class: 'tiles' }, ...boxList.map((a) => h('div', { class: 'tile' }, h('span', {}, a.name_ar), h('b', { class: 'num' }, money(closing.get(a.id) || 0)))));

  /* expense */
  const eC = h('select', { id: 'e-cat' }, ...CATS.map(([k, l]) => h('option', { value: k }, l))), eG = h('input', { id: 'e-gross', inputmode: 'decimal', required: true });
  const eV = h('input', { id: 'e-vat', inputmode: 'decimal', value: '0' }), eM = h('select', { id: 'e-method' }, h('option', { value: 'cash' }, 'من الصندوق'), h('option', { value: 'bank' }, 'من البنك'));
  const eN = h('input', { id: 'e-note', maxlength: 200 }), eB = h('button', { class: 'btn primary', type: 'submit' }, 'تسجيل المصروف');
  const expense = h('section', { class: 'card' }, h('h2', {}, 'مصروف'), h('form', { class: 'stack', onsubmit: (ev: Event) => run(ev, eB, async () => {
    await be.call('POST', `/stations/${sid}/expenses`, { category: eC.value, gross: amt(eG), vat: amt(eV, true), method: eM.value, note: eN.value || undefined }); toast('سُجّل المصروف');
  }) }, h('div', { class: 'row' }, field('البند', eC), field('المبلغ', eG)), h('div', { class: 'row' }, field('منه ضريبة', eV), field('الدفع', eM)), field('ملاحظة', eN), eB));

  /* voucher (one line; the core takes up to 200) */
  const vK = h('select', { id: 'v-kind' }, h('option', { value: 'receipt' }, 'سند قبض (إلى الصندوق)'), h('option', { value: 'payment' }, 'سند صرف (من الصندوق)'));
  const vB = acctSel('v-box', boxList), vA = acctSel('v-acct'), vM = h('input', { id: 'v-amt', inputmode: 'decimal', required: true }), vN = h('input', { id: 'v-memo', maxlength: 300 });
  const vP = h('select', { id: 'v-party' }), vPf = field('العميل / المورد', vP);
  const syncParty = () => { const a = usable.find((x) => x.id === Number(vA.value)); const list = a?.sys === 'ar' ? custs : a?.sys === 'ap' ? sups : [];
    vP.replaceChildren(...list.map((p) => h('option', { value: p.id }, p.name))); vPf.hidden = !list.length; };
  vA.addEventListener('change', syncParty); syncParty();
  const vBtn = h('button', { class: 'btn', type: 'submit' }, 'حفظ السند');
  const voucher = h('section', { class: 'card' }, h('h2', {}, 'سند قبض أو صرف'), h('form', { class: 'stack', onsubmit: (ev: Event) => run(ev, vBtn, async () => {
    const line: Record<string, unknown> = { account_id: Number(vA.value), amount: amt(vM) }; if (!vPf.hidden) line.party_id = Number(vP.value);
    const r = await be.call<{ amount: number }>('POST', `/stations/${sid}/vouchers`, { kind: vK.value, box_account_id: Number(vB.value), memo: vN.value || undefined, lines: [line] });
    toast('حُفظ السند بمبلغ ' + money(r.amount));
  }) }, field('النوع', vK), field('الصندوق / البنك', vB), field('الحساب المقابل', vA), vPf, h('div', { class: 'row' }, field('المبلغ', vM), field('البيان', vN)), vBtn));

  /* drawer ↔ bank / owner */
  const mK = h('select', { id: 'm-kind' }, h('option', { value: 'withdrawal' }, 'سحب من الصندوق'), h('option', { value: 'deposit' }, 'إيداع في الصندوق'));
  const mC = h('select', { id: 'm-cp' }, h('option', { value: 'bank' }, 'البنك'), h('option', { value: 'owner' }, 'المالك'));
  const mA = h('input', { id: 'm-amt', inputmode: 'decimal', required: true }), mB = h('button', { class: 'btn', type: 'submit' }, 'تسجيل');
  const move = h('section', { class: 'card' }, h('h2', {}, 'حركة صندوق الوردية'), h('form', { class: 'stack', onsubmit: (ev: Event) => run(ev, mB, async () => {
    await be.call('POST', `/stations/${sid}/cash-moves`, { kind: mK.value, counterpart: mC.value, amount: amt(mA) }); toast('سُجّلت الحركة');
  }) }, h('div', { class: 'row' }, field('الحركة', mK), field('الطرف', mC)), field('المبلغ', mA), mB));

  /* manual journal: two lines */
  const jD = acctSel('j-dr'), jC = acctSel('j-cr'), jA = h('input', { id: 'j-amt', inputmode: 'decimal', required: true });
  const jM = h('input', { id: 'j-memo', required: true, minlength: 3, maxlength: 300 }), jP = h('input', { id: 'j-post', type: 'checkbox' }), jB = h('button', { class: 'btn', type: 'submit' }, 'حفظ القيد');
  if (jC.options.length > 1) jC.selectedIndex = 1;
  const journal = h('section', { class: 'card' }, h('h2', {}, 'قيد يدوي'), h('form', { class: 'stack', onsubmit: (ev: Event) => run(ev, jB, async () => {
    const v = amt(jA);
    const r = await be.call<{ id: number; status: string }>('POST', `/stations/${sid}/journals`, { memo: jM.value, post: jP.checked,
      lines: [{ account_id: Number(jD.value), debit: v }, { account_id: Number(jC.value), credit: v }] });
    toast(r.status === 'posted' ? `رُحّل القيد #${r.id}` : `حُفظ القيد #${r.id} مسودة`);
  }) }, field('مدين', jD), field('دائن', jC), h('div', { class: 'row' }, field('المبلغ', jA), field('البيان', jM)),
  h('label', { class: 'check', for: 'j-post' }, jP, ' ترحيل الآن (وإلا يبقى مسودة)'), jB),
  drafts.length ? h('div', {}, h('h3', {}, 'مسودات'), table(['#', 'التاريخ', 'البيان', 'المبلغ', ''], drafts.map((d) => [h('span', { class: 'num' }, String(d.id)), h('span', { class: 'num' }, d.business_date), d.memo || '',
    num(d.lines.reduce((s, l) => s + l.debit, 0)), h('div', { class: 'row' },
      h('button', { class: 'btn link plain', type: 'button', onclick: (ev: Event) => run(ev, ev.currentTarget as HTMLButtonElement, async () => { await be.call('POST', `/journals/${d.id}/post`); toast('رُحّل القيد'); }) }, 'ترحيل'),
      h('button', { class: 'btn link', type: 'button', onclick: (ev: Event) => { if (!confirm('حذف المسودة؟')) return; run(ev, ev.currentTarget as HTMLButtonElement, async () => { await be.call('DELETE', `/journals/${d.id}`); toast('حُذفت المسودة'); }); } }, 'حذف'))]))) : '');

  /* trial balance */
  const trial = h('section', { class: 'card wide' }, h('h2', {}, `ميزان المراجعة ${tb.from} → ${tb.to === '9999-12-31' ? 'اليوم' : tb.to}`),
    table(['الحساب', 'مدين الفترة', 'دائن الفترة', 'الرصيد'], [...tb.rows.map((r) => [`${r.code} — ${r.name_ar}`, num(r.debit), num(r.credit), num(r.closing_dr - r.closing_cr)]),
      [h('b', {}, 'الإجمالي'), num(tb.totals.debit), num(tb.totals.credit), h('b', { class: tb.balanced ? 'num' : 'num bad' }, tb.balanced ? 'متوازن ✓' : 'غير متوازن')]]));

  /* period lock */
  const lD = h('input', { id: 'l-date', type: 'date', value: lock.locked_through || '' }), lB = h('button', { class: 'btn', type: 'submit' }, 'إقفال حتى هذا التاريخ');
  const lockCard = h('section', { class: 'card' }, h('h2', {}, 'إقفال الفترة'),
    h('p', { class: 'muted' }, lock.locked_through ? `الفترة مقفلة حتى ${lock.locked_through}: لا يُسجَّل ولا يُلغى شيء بتاريخ قبله أو فيه.` : 'لا فترة مقفلة.'),
    h('form', { class: 'row', onsubmit: (ev: Event) => run(ev, lB, async () => {
      if (!lD.value) throw { code: 'VALIDATION', message: 'اختر التاريخ' };
      await be.call('POST', '/period-lock', { through: lD.value }); toast('أُقفلت الفترة حتى ' + lD.value);
    }) }, field('حتى', lD), lB),
    lock.locked_through ? h('button', { class: 'btn link', type: 'button', onclick: (ev: Event) => { if (!confirm('فتح كل الفترات المقفلة؟')) return;
      run(ev, ev.currentTarget as HTMLButtonElement, async () => { await be.call('POST', '/period-lock', { through: null }); toast('فُتحت الفترة'); }); } }, 'إلغاء الإقفال') : '');

  main.replaceChildren(boxCard, expense, voucher, move, journal, trial, lockCard);
}
