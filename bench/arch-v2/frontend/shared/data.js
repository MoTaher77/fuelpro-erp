// Shared, framework-neutral data + formatting. Identical for every app.
const DESCS = ['بيع بنزين نقدي', 'بيع ديزل آجل', 'توريد خزان رقم ٢', 'مبيعات الوردية الصباحية',
  'تحويل إلى الصندوق الرئيسي', 'مبيعات بطاقة شركة النقل', 'تسوية فرق عداد', 'بيع زيت محركات'];
const PUMPS = ['مضخة 1', 'مضخة 2', 'مضخة 3', 'مضخة 4', 'مضخة 5', 'مضخة 6'];
export { PUMPS };

const nf = new Intl.NumberFormat('ar', { numberingSystem: 'latn', minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmt = (minor) => nf.format(minor / 100);      // amounts stored as integer minor units
export const fmtQty = (ml) => nf.format(ml / 1000);       // quantities stored as ml

let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

export function genRows(n) {
  seed = 12345;
  const rows = new Array(n);
  let bal = 0;
  const base = Date.UTC(2026, 0, 1);
  for (let i = 0; i < n; i++) {
    const qty = Math.round(rnd() * 200000) + 1000;          // ml
    const sign = rnd() < 0.15 ? -1 : 1;
    const amount = sign * Math.round(qty * 0.65 + rnd() * 1000); // minor units
    bal += amount;
    if (i % 997 === 0) bal -= 900000;                         // some negative balances (bidi check)
    const d = new Date(base + Math.floor(i / 20) * 86400000);
    rows[i] = { id: i + 1, date: d.toISOString().slice(0, 10), desc: DESCS[i % DESCS.length],
      pump: PUMPS[i % PUMPS.length], qty, amount, balance: bal };
  }
  return rows;
}

let nextId = 1e6;
export function rowFromForm(fd, rows) {
  const qty = Math.round(parseFloat(fd.get('qty')) * 1000);
  const price = Math.round(parseFloat(fd.get('price')) * 100);
  const amount = Math.round(qty * price / 1000);
  const last = rows.length ? rows[rows.length - 1].balance : 0;
  return { id: ++nextId, date: fd.get('date'), desc: fd.get('desc') + ' ' + fd.get('note'),
    pump: fd.get('pump'), qty, amount, balance: last + amount };
}

export function sortedByAmount(rows, dir) {
  return rows.slice().sort((a, b) => dir * (b.amount - a.amount));
}
