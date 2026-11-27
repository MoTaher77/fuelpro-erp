import '../shared/style.css';
import { MODE, N, ROW_H, OVERSCAN } from '../shared/harness.js';
import { genRows, fmt, fmtQty, rowFromForm, sortedByAmount, PUMPS } from '../shared/data.js';
import { Virtualizer, elementScroll, observeElementOffset, observeElementRect } from '@tanstack/virtual-core';

const app = document.getElementById('app');
app.innerHTML = `<header><h1>دفتر مبيعات المحطة</h1><span id="cnt"></span></header>
<form id="f"><input name="date" type="date" value="2026-11-27"><input name="desc" value="بيع نقدي">
<input name="qty" inputmode="decimal" value="25.5"><input name="price" inputmode="decimal" value="610">
<input name="note" value="وردية ١"><select name="pump">${PUMPS.map(p => `<option>${p}</option>`).join('')}</select>
<button type="submit">إضافة</button></form>
<div class="toolbar"><button id="sort">ترتيب حسب المبلغ</button><button id="clear">مسح</button><button id="create">إنشاء</button></div>
<div id="body"></div>`;
const $ = (s) => app.querySelector(s);
const cnt = $('#cnt');
let rows = genRows(N), dir = 1;

const HEAD = ['#', 'التاريخ', 'البيان', 'المضخة', 'الكمية', 'المبلغ', 'الرصيد'];
const cells = (r) => [r.id, r.date, r.desc, r.pump, fmtQty(r.qty), fmt(r.amount), fmt(r.balance)];

if (MODE === 'plain') {
  $('#body').innerHTML = `<div class="wrap"><table><thead><tr>${HEAD.map((h, i) => `<th${i > 3 ? ' class="n"' : ''}>${h}</th>`).join('')}</tr></thead><tbody></tbody></table></div>`;
  const tbody = $('tbody');
  const tpl = document.createElement('tr');
  tpl.innerHTML = '<td></td><td></td><td></td><td></td><td class="n"></td><td class="n"></td><td class="n"></td>';
  const nodes = new Map();             // keyed: id -> <tr>
  const make = (r) => {
    const tr = tpl.cloneNode(true); const c = cells(r);
    let td = tr.firstChild; for (let i = 0; i < 7; i++, td = td.nextSibling) td.textContent = c[i];
    if (r.balance < 0) tr.lastChild.className = 'n neg';
    nodes.set(r.id, tr); return tr;
  };
  const renderAll = () => { const fr = document.createDocumentFragment(); for (const r of rows) fr.appendChild(make(r)); tbody.appendChild(fr); cnt.textContent = rows.length + ' سطر'; };
  renderAll();
  $('#f').onsubmit = (e) => { e.preventDefault(); const r = rowFromForm(new FormData(e.target), rows); rows.push(r); tbody.appendChild(make(r)); cnt.textContent = rows.length + ' سطر'; };
  $('#sort').onclick = () => { rows = sortedByAmount(rows, dir); dir = -dir; const fr = document.createDocumentFragment(); for (const r of rows) fr.appendChild(nodes.get(r.id)); tbody.appendChild(fr); };
  $('#clear').onclick = () => { rows = []; nodes.clear(); tbody.textContent = ''; cnt.textContent = '0 سطر'; };
  $('#create').onclick = () => { tbody.textContent = ''; nodes.clear(); rows = genRows(N); renderAll(); };
} else {
  $('#body').innerHTML = `<div class="vwrap"><div class="vhead">${HEAD.map((h, i) => `<span${i > 3 ? ' class="n"' : ''}>${h}</span>`).join('')}</div><div class="vinner" style="position:relative"></div></div>`;
  const scroller = $('.vwrap'), inner = $('.vinner');
  const pool = new Map();              // index -> element currently mounted
  const rowEl = (r) => { const d = document.createElement('div'); d.className = 'vrow';
    d.innerHTML = '<span></span><span></span><span></span><span></span><span class="n"></span><span class="n"></span><span class="n"></span>';
    const c = cells(r); let s = d.firstChild; for (let i = 0; i < 7; i++, s = s.nextSibling) s.textContent = c[i];
    if (r.balance < 0) d.lastChild.className = 'n neg'; return d; };
  const draw = () => {
    const items = v.getVirtualItems(); inner.style.height = v.getTotalSize() + 'px';
    const keep = new Set();
    for (const it of items) { keep.add(it.index); let el = pool.get(it.index);
      if (!el) { el = rowEl(rows[it.index]); pool.set(it.index, el); inner.appendChild(el); }
      el.style.transform = `translateY(${it.start}px)`; }
    for (const [i, el] of pool) if (!keep.has(i)) { el.remove(); pool.delete(i); }
  };
  const v = new Virtualizer({ count: rows.length, getScrollElement: () => scroller, estimateSize: () => ROW_H, overscan: OVERSCAN,
    scrollToFn: elementScroll, observeElementRect, observeElementOffset, onChange: draw });
  v._didMount(); v._willUpdate(); draw(); cnt.textContent = rows.length + ' سطر';
  const reset = () => { for (const el of pool.values()) el.remove(); pool.clear(); v.setOptions({ ...v.options, count: rows.length }); v._willUpdate(); draw(); cnt.textContent = rows.length + ' سطر'; };
  $('#f').onsubmit = (e) => { e.preventDefault(); rows.push(rowFromForm(new FormData(e.target), rows)); reset(); };
  $('#sort').onclick = () => { rows = sortedByAmount(rows, dir); dir = -dir; reset(); };
  $('#clear').onclick = () => { rows = []; reset(); };
  $('#create').onclick = () => { rows = genRows(N); reset(); };
}
