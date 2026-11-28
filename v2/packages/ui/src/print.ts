/* Printed documents for the three editions: one engine and one look, ported from v1 public/print-kit.js (0.32).
   print(title, node, { paper })  paper: 'a4' | 'a4l' | 'r80' | 'r58'
     · loads print.css and the print faces the first time, then waits for them before opening the print dialog
     · writes the page frame (size, margins, «صفحة X من Y», printed at, organisation) through the CSSOM (the CSP blocks <style>)
     · a receipt gets a page exactly as long as its content (thermal roll)
   Display only: amounts arrive as integers in minor units and are only formatted here. */
import { fmtLitres, fmtMinor } from './fmt.ts';
import { h, type Backend, type Station } from './index.ts';

export type Brand = { name: string; activity: string; address: string; phones: string; footer: string; logo: string | null };
export type Paper = 'a4' | 'a4l' | 'r80' | 'r58';
type Cell = Node | string | null;

let brand: Brand | null = null;
/** the letterhead, read once per session (and again after it is changed) */
export async function loadBrand(be: Backend, fresh = false): Promise<Brand> {
  if (!brand || fresh) { try { brand = await be.call<Brand>('GET', '/brand'); } catch { brand = brand || { name: '', activity: '', address: '', phones: '', footer: '', logo: null }; } }
  return brand;
}
export const setBrandCache = (b: Brand) => { brand = b; };

/* ---- figures and dates on paper: Latin digits, fixed order (Intl's Arabic patterns carry direction marks) ---- */
const d2 = (n: number) => String(n).padStart(2, '0');
export const dshort = (iso: string | null | undefined) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
function dtime(d: Date, tz?: string) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).formatToParts(d).map((x) => [x.type, x.value]));
    return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
  } catch { return `${d2(d.getDate())}/${d2(d.getMonth() + 1)}/${d.getFullYear()} ${d2(d.getHours())}:${d2(d.getMinutes())}`; }
}
export const num = (v: string) => h('span', { class: 'n' }, v);

/* ---- amount in words (التفقيط), v1 books-ui.js ---- */
const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUND = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];
const SCALES = [['', '', '', ''], ['ألف', 'ألفان', 'آلاف', 'ألفاً'], ['مليون', 'مليونان', 'ملايين', 'مليوناً'], ['مليار', 'ملياران', 'مليارات', 'ملياراً']];
function below1000(n: number) {
  const hnd = Math.floor(n / 100), rest = n % 100, parts: string[] = [];
  if (hnd) parts.push(HUND[hnd]);
  if (rest) { if (rest < 20) parts.push(ONES[rest]); else { const o = rest % 10, t = Math.floor(rest / 10); parts.push(o ? ONES[o] + ' و' + TENS[t] : TENS[t]); } }
  return parts.join(' و');
}
export function arWords(n: number) {
  n = Math.floor(Math.abs(n)); if (!n) return 'صفر';
  const groups: string[] = []; let i = 0, rest = 0;
  while (n > 0) {
    const g = n % 1000;
    if (g) {
      const sc = SCALES[i], t = g % 100; let w: string;
      if (!i) w = below1000(g);
      else if (g === 1) w = sc[0]; else if (g === 2) w = sc[1];
      else if (t >= 3 && t <= 10 && g < 100) w = below1000(g) + ' ' + sc[2];
      else if (t >= 11 && rest) w = below1000(g) + ' ' + sc[3];
      else w = below1000(g) + ' ' + sc[0];
      groups.unshift(w);
    }
    rest += g * 1000 ** i; n = Math.floor(n / 1000); i++;
  }
  return groups.join(' و');
}
/** "فقط مائتان وخمسون ريالاً يمنياً لا غير" — whole units at the shown decimals, the fraction in figures */
export function tafqeet(minor: number, st: Pick<Station, 'currency' | 'cur_dec' | 'disp_dec'>) {
  const d = st.cur_dec, dd = Math.min(d, st.disp_dec ?? d);
  const shown = Math.round(Math.abs(minor) / 10 ** (d - dd)), whole = Math.floor(shown / 10 ** dd), frac = shown % 10 ** dd;
  const yer = st.currency === 'YER', cur = st.currency, t = whole % 100;
  const head = !whole ? 'صفر ' + (yer ? 'ريال' : cur) : whole === 1 ? (yer ? 'ريال يمني واحد' : 'واحد ' + cur) : whole === 2 ? (yer ? 'ريالان يمنيان' : 'اثنان ' + cur)
    : arWords(whole) + ' ' + (!yer ? cur : t >= 3 && t <= 10 ? 'ريالات يمنية' : t >= 11 ? 'ريالاً يمنياً' : 'ريال يمني');
  const fils = frac ? ' و' + frac + ' ' + (yer ? (frac >= 3 && frac <= 10 ? 'فلوس' : 'فلساً') : '') : '';
  return 'فقط ' + head + fils + ' لا غير';
}

/* ---- the print sheet and faces: fetched the first time something is printed (the first screen stays small) ---- */
let cssReady: Promise<void> | null = null;
function ensureCss() {
  if (!cssReady) cssReady = new Promise<void>((ok) => {
    const l = h('link', { rel: 'stylesheet', href: 'print.css' }); l.addEventListener('load', () => ok()); l.addEventListener('error', () => ok()); document.head.append(l);
  });
  return cssReady;
}
const FACES = ['400 10pt "IBM Plex Sans Arabic"', '600 10pt "IBM Plex Sans Arabic"', '700 16pt "Noto Naskh Arabic"'];
async function fontsReady(sample: string) {
  try { await Promise.all(FACES.map((f) => document.fonts.load(f, sample || 'صفحة 0123456789'))); await document.fonts.ready; } catch { /* print with what is there */ }
}
const cssStr = (s: string) => '"' + String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ') + '"';
function frameCss(paper: Paper, foot: { start: string; center: string }, heightMm: number) {
  if (paper === 'r80' || paper === 'r58') return `@page fp-r{size:${paper === 'r80' ? 80 : 58}mm ${Math.max(60, Math.ceil(heightMm))}mm;margin:2.5mm 2.5mm 3mm}`;
  const box = "font-family:'IBM Plex Sans Arabic',Tahoma,sans-serif;font-size:7.5pt;color:#55606b;direction:rtl;";
  return `@page fp-${paper}{size:${paper === 'a4l' ? 'A4 landscape' : 'A4'};margin:13mm 13mm 17mm;
    @bottom-right{content:${cssStr(foot.start)};${box}text-align:right;vertical-align:top;padding-top:3mm}
    @bottom-center{content:${cssStr(foot.center)};${box}vertical-align:top;padding-top:3mm}
    @bottom-left{content:"صفحة " counter(page) " من " counter(pages);${box}text-align:left;vertical-align:top;padding-top:3mm;font-weight:600;color:#1f2933}}`;
}
let frameSheet: CSSStyleSheet | null = null;
function setFrame(css: string) {
  try { if (!frameSheet) { frameSheet = new CSSStyleSheet(); document.adoptedStyleSheets = [...document.adoptedStyleSheets, frameSheet]; } frameSheet.replaceSync(css); }
  catch { /* an old engine: print.css's static frame still prints the document */ }
}
export async function print(fileTitle: string, node: HTMLElement, o: { paper?: Paper; footer?: string; st: Station }) {
  const paper = o.paper || 'a4';
  await ensureCss();
  // class lg: print.css's report pieces (tiles, section titles)
  let box = document.getElementById('print');
  if (!box) { box = h('div', { id: 'print' }); document.body.append(box); }
  box.className = 'p2 lg p2-' + paper; box.dir = 'rtl'; box.lang = 'ar'; box.replaceChildren(node);
  await fontsReady((node.textContent || '').slice(0, 400));
  const org = brand?.name || o.st.name || 'FuelPro';
  const foot = { start: [org, o.footer || fileTitle].filter(Boolean).join(' · '), center: 'طُبع في ' + dtime(new Date(), o.st.timezone) };
  let mm = 0;
  if (paper[0] === 'r') { document.body.classList.add('p2-measure'); mm = box.getBoundingClientRect().height * 25.4 / 96 + 6; document.body.classList.remove('p2-measure'); }
  setFrame(frameCss(paper, foot, mm));
  const old = document.title; document.title = fileTitle;
  document.body.classList.add('p2-on');
  const done = () => { document.body.classList.remove('p2-on'); document.title = old; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
  setTimeout(done, 2500);
}

/* ---- shared parts ---- */
export function letterhead(st: Station, title: string, meta: Array<[string, Cell] | null>, sub?: string) {
  const b = brand || { name: '', activity: '', address: '', phones: '', footer: '', logo: null };
  return h('header', { class: 'lh2' },
    h('div', { class: 'lh2-org' }, b.logo ? h('img', { class: 'lh2-logo', src: b.logo, alt: '' }) : null,
      h('div', {}, h('div', { class: 'lh2-name' }, b.name || st.name || 'FuelPro'), b.activity ? h('div', { class: 'lh2-act' }, b.activity) : null,
        h('div', { class: 'lh2-ct' }, ...[b.address, b.phones].filter(Boolean).map((x, i) => h('span', { class: i ? 'n' : '' }, x))))),
    h('div', { class: 'lh2-doc' }, h('div', { class: 'lh2-title' }, title), sub ? h('div', { class: 'lh2-sub' }, sub) : null,
      h('dl', { class: 'lh2-meta' }, ...meta.filter((m): m is [string, Cell] => !!m && m[1] !== null && m[1] !== '').flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]))));
}
export const sigs = (labels: string[]) => h('section', { class: 'sig2' }, ...labels.map((l) => h('div', {}, h('i'), h('span', {}, l))));
/** a table for paper: columns [title, class] where class 'n' = figures (end-aligned), 'c' = centred, 'd' = description */
export function ptable(cols: Array<[string, string?]>, rows: Cell[][], total?: Cell[], o: { cls?: string } = {}) {
  // the wrapper scrolls sideways on a phone screen; on paper it is a plain block
  return h('div', { class: 'tw2' }, h('table', { class: 't2 ' + (o.cls || '') },
    h('thead', {}, h('tr', {}, ...cols.map(([c, k]) => h('th', { class: k || '' }, c)))),
    h('tbody', {}, ...(rows.length ? rows.map((r) => h('tr', {}, ...r.map((v, i) => h('td', { class: cols[i]?.[1] || '' }, v)))) : [h('tr', {}, h('td', { colspan: cols.length, class: 'c' }, 'لا بيانات'))])),
    total ? h('tbody', { class: 'tot' }, h('tr', {}, ...total.map((v, i) => h('td', { class: cols[i]?.[1] || '' }, v)))) : null));
}
/** the one figure a statement ends on (net profit, liabilities + equity), ruled like a ledger total */
export const grand = (label: string, v: Node) => h('div', { class: 'grand2' }, h('span', {}, label), h('b', {}, v));
export const ptitle = (t: string) => h('h3', { class: 'xh' }, t);
export function tiles(list: Array<[string, Cell, boolean?]>) {
  return h('section', { class: 'xtiles' }, ...list.map(([k, v, main]) => h('div', { class: 'xtile' + (main ? ' gold' : '') }, h('span', {}, k), h('b', {}, v))));
}
export const doc = (...kids: Array<Node | null>) => h('article', { class: 'doc2' }, ...kids);
export const money = (st: Station) => (v: number) => num(fmtMinor(v, st.cur_dec, st.disp_dec));
export const litres = (ml: number) => num(fmtLitres(ml));
export const periodText = (from: string, to: string) => from === to ? num(dshort(from)) : h('span', {}, num(dshort(from)), ' – ', num(dshort(to)));
export const today = () => dshort(new Date().toISOString());

/* ---- a sale receipt, thermal 80 / 58 mm ---- */
export type ReceiptSale = { id: number; created_at: string; pump_name: string; fuel_name: string; quantity_ml: number; price_e4?: number; gross: number; net?: number; vat?: number;
  discount?: number; pay_type: string; customer_name: string | null; voided_at: string | null };
export async function receipt(be: Backend, st: Station, s: ReceiptSale, width: 'r80' | 'r58' = 'r80') {
  await loadBrand(be);
  const b = brand!, m = (v: number) => fmtMinor(v, st.cur_dec, st.disp_dec);
  const line = (k: string, v: Cell, cls = '') => h('div', { class: 'rc-l ' + cls }, h('span', {}, k), h('b', {}, v));
  const at = Date.parse(String(s.created_at).replace(' ', 'T') + 'Z');
  const node = h('article', { class: 'rc' + (s.voided_at ? ' is-void' : '') },
    h('header', { class: 'rc-h' }, h('div', { class: 'rc-name' }, b.name || st.name), b.activity ? h('div', { class: 'rc-sub' }, b.activity) : null,
      b.address ? h('div', { class: 'rc-sub' }, b.address) : null, b.phones ? h('div', { class: 'rc-sub n' }, b.phones) : null),
    h('div', { class: 'rc-title' }, 'إيصال بيع'),
    h('div', { class: 'rc-meta' }, line('رقم الإيصال', num('#' + s.id)), line('الوقت', num(Number.isFinite(at) ? dtime(new Date(at), st.timezone) : '')), line('المضخة', s.pump_name)),
    h('div', { class: 'rc-item' }, h('div', { class: 'rc-fuel' }, s.fuel_name), line('الكمية', h('span', {}, num(fmtLitres(s.quantity_ml)), ' لتر')),
      s.price_e4 ? line('سعر اللتر', num(m(Math.round(s.price_e4 / 10_000)))) : null, line('المبلغ', num(m(s.gross + (s.discount || 0))))),
    h('div', { class: 'rc-tot' }, s.discount ? line('الخصم', num('−' + m(s.discount))) : null, s.vat ? line('الصافي', num(m(s.net || 0))) : null, s.vat ? line('الضريبة', num(m(s.vat))) : null,
      line(`الإجمالي (${st.currency})`, num(m(s.gross)), 'rc-grand')),
    h('div', { class: 'rc-pay' }, line('الدفع', s.pay_type === 'cash' ? 'نقداً' : 'آجل' + (s.customer_name ? ' · ' + s.customer_name : ''))),
    s.voided_at ? h('div', { class: 'rc-void', role: 'note' }, h('b', {}, 'ملغى'), h('span', {}, 'VOID')) : null,
    h('footer', { class: 'rc-f' }, h('div', {}, b.footer || 'شكراً لتعاملكم'), h('div', { class: 'n' }, dtime(new Date(), st.timezone))));
  return print('إيصال ' + s.id, node, { paper: width, st });
}

/* ---- an account statement (customer or supplier), A4 ---- */
export type StmtEntry = { date: string; desc: string; debit: number; credit: number; balance: number; voided: boolean };
export async function statement(be: Backend, st: Station, o: { title: string; name: string; from: string | null; to: string | null; opening: number; total_debit: number;
  total_credit: number; balance: number; natural: 'debit' | 'credit'; entries: StmtEntry[] }) {
  await loadBrand(be);
  const m = (v: number) => num(fmtMinor(v, st.cur_dec, st.disp_dec));
  /* a balance says which side it is on in words (black-and-white paper): عليه / له for the party's own nature */
  const side = (v: number) => !v ? '' : (v > 0) === (o.natural === 'debit') ? 'مدين' : 'دائن';
  const bal = (v: number) => h('span', { class: 'bal' }, m(Math.abs(v)), h('small', {}, side(v)));
  const first = o.from || o.entries[0]?.date || '', last = o.to || o.entries[o.entries.length - 1]?.date || '';
  const td = (v: Cell, c = '') => h('td', { class: c }, v);
  const node = h('article', { class: 'doc2' },
    letterhead(st, o.title, [['الفترة', first ? periodText(first, last || first) : 'كل الحركات'], ['تاريخ الإصدار', num(today())], ['العملة', st.currency]]),
    h('section', { class: 'party2' },
      h('div', { class: 'pbox' }, h('span', { class: 'lbl' }, 'الحساب'), h('div', { class: 'pname' }, o.name)),
      h('dl', { class: 'sum2' },
        h('div', {}, h('dt', {}, 'رصيد سابق'), h('dd', {}, bal(o.opening))),
        h('div', {}, h('dt', {}, 'إجمالي المدين'), h('dd', {}, m(o.total_debit))),
        h('div', {}, h('dt', {}, 'إجمالي الدائن'), h('dd', {}, m(o.total_credit))),
        h('div', { class: 'grand' }, h('dt', {}, 'الرصيد الختامي'), h('dd', {}, bal(o.balance))))),
    h('table', { class: 't2' },
      h('thead', {}, h('tr', {}, ...([['#', 'c idx'], ['التاريخ', 'c'], ['البيان', 'd'], ['مدين', 'n'], ['دائن', 'n'], ['الرصيد', 'n']] as const).map(([c, k]) => h('th', { class: k }, c)))),
      h('tbody', {}, h('tr', { class: 'open' }, td('', 'c idx'), td(first ? num(dshort(first)) : '', 'c nw'), td('رصيد أول المدة', 'd'), td(''), td(''), td(bal(o.opening), 'n')),
        ...o.entries.map((e, i) => h('tr', { class: e.voided ? 'void' : '' }, td(num(String(i + 1)), 'c idx'), td(num(dshort(e.date)), 'c nw'), td(e.desc, 'd'),
          td(e.debit ? m(e.debit) : '', 'n'), td(e.credit ? m(e.credit) : '', 'n'), td(e.voided ? h('span', { class: 'tag' }, 'ملغى') : bal(e.balance), 'n')))),
      h('tbody', { class: 'tot' }, h('tr', {}, h('td', { class: 'idx' }), h('td', { colspan: 2 }, 'الإجمالي · ', num(String(o.entries.length)), ' حركة'), td(m(o.total_debit), 'n'), td(m(o.total_credit), 'n'), td(bal(o.balance), 'n')))),
    h('section', { class: 'end2' },
      h('div', { class: 'words2' }, h('span', {}, 'الرصيد كتابةً'), h('b', {}, tafqeet(o.balance, st), side(o.balance) ? ' — ' + side(o.balance) : '')),
      h('p', { class: 'note2' }, brand?.footer || 'يُرجى مراجعة الكشف وإبلاغنا بأي ملاحظة خلال سبعة أيام من تاريخه.'),
      h('div', { class: 'end2-row' }, sigs(['المستلم', 'المحاسب', 'الإدارة']))));
  return print(`${o.title} - ${o.name}`, node, { paper: 'a4', st, footer: o.title });
}
