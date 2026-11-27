import '../shared/style.css';
import { MODE, N, ROW_H, OVERSCAN } from '../shared/harness.js';
import { genRows, fmt, fmtQty, rowFromForm, sortedByAmount, PUMPS } from '../shared/data.js';
import { createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { createVirtualizer } from '@tanstack/solid-virtual';

const HEAD = ['#', 'التاريخ', 'البيان', 'المضخة', 'الكمية', 'المبلغ', 'الرصيد'];

function Plain(p) {
  return <div class="wrap"><table><thead><tr><For each={HEAD}>{(h, i) => <th class={i() > 3 ? 'n' : undefined}>{h}</th>}</For></tr></thead>
    <tbody><For each={p.rows()}>{(r) => <tr><td>{r.id}</td><td>{r.date}</td><td>{r.desc}</td><td>{r.pump}</td>
      <td class="n">{fmtQty(r.qty)}</td><td class="n">{fmt(r.amount)}</td><td class={r.balance < 0 ? 'n neg' : 'n'}>{fmt(r.balance)}</td></tr>}</For></tbody></table></div>;
}

function Virtual(p) {
  let ref;
  const v = createVirtualizer({ get count() { return p.rows().length; }, getScrollElement: () => ref, estimateSize: () => ROW_H, overscan: OVERSCAN });
  return <div class="vwrap" ref={ref}>
    <div class="vhead"><For each={HEAD}>{(h, i) => <span class={i() > 3 ? 'n' : undefined}>{h}</span>}</For></div>
    <div style={{ position: 'relative', height: v.getTotalSize() + 'px' }}>
      <For each={v.getVirtualItems()}>{(it) => { const r = p.rows()[it.index]; return (
        <div class="vrow" style={{ transform: `translateY(${it.start}px)` }}><span>{r.id}</span><span>{r.date}</span><span>{r.desc}</span><span>{r.pump}</span>
          <span class="n">{fmtQty(r.qty)}</span><span class="n">{fmt(r.amount)}</span><span class={r.balance < 0 ? 'n neg' : 'n'}>{fmt(r.balance)}</span></div>); }}</For>
    </div></div>;
}

function App() {
  const [rows, setRows] = createSignal(genRows(N));
  let dir = 1;
  const submit = (e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); setRows((rs) => [...rs, rowFromForm(fd, rs)]); };
  return <>
    <header><h1>دفتر مبيعات المحطة</h1><span>{rows().length} سطر</span></header>
    <form onSubmit={submit}><input name="date" type="date" value="2026-11-27" /><input name="desc" value="بيع نقدي" />
      <input name="qty" inputMode="decimal" value="25.5" /><input name="price" inputMode="decimal" value="610" />
      <input name="note" value="وردية ١" /><select name="pump"><For each={PUMPS}>{(p) => <option>{p}</option>}</For></select>
      <button type="submit">إضافة</button></form>
    <div class="toolbar">
      <button id="sort" onClick={() => { setRows((rs) => sortedByAmount(rs, dir)); dir = -dir; }}>ترتيب حسب المبلغ</button>
      <button id="clear" onClick={() => setRows([])}>مسح</button>
      <button id="create" onClick={() => setRows(genRows(N))}>إنشاء</button></div>
    <Show when={MODE === 'plain'} fallback={<Virtual rows={rows} />}><Plain rows={rows} /></Show>
  </>;
}
render(() => <App />, document.getElementById('app'));
