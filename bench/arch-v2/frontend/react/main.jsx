import '../shared/style.css';
import { MODE, N, ROW_H, OVERSCAN } from '../shared/harness.js';
import { genRows, fmt, fmtQty, rowFromForm, sortedByAmount, PUMPS } from '../shared/data.js';
import { memo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useVirtualizer } from '@tanstack/react-virtual';

const HEAD = ['#', 'التاريخ', 'البيان', 'المضخة', 'الكمية', 'المبلغ', 'الرصيد'];

const Row = memo(({ r }) => (
  <tr><td>{r.id}</td><td>{r.date}</td><td>{r.desc}</td><td>{r.pump}</td>
    <td className="n">{fmtQty(r.qty)}</td><td className="n">{fmt(r.amount)}</td>
    <td className={r.balance < 0 ? 'n neg' : 'n'}>{fmt(r.balance)}</td></tr>));

function Plain({ rows }) {
  return <div className="wrap"><table><thead><tr>{HEAD.map((h, i) => <th key={i} className={i > 3 ? 'n' : undefined}>{h}</th>)}</tr></thead>
    <tbody>{rows.map((r) => <Row key={r.id} r={r} />)}</tbody></table></div>;
}

function Virtual({ rows }) {
  const ref = useRef(null);
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => ref.current, estimateSize: () => ROW_H, overscan: OVERSCAN });
  return <div className="vwrap" ref={ref}>
    <div className="vhead">{HEAD.map((h, i) => <span key={i} className={i > 3 ? 'n' : undefined}>{h}</span>)}</div>
    <div style={{ position: 'relative', height: v.getTotalSize() }}>
      {v.getVirtualItems().map((it) => { const r = rows[it.index]; return (
        <div key={r.id} className="vrow" style={{ transform: `translateY(${it.start}px)` }}>
          <span>{r.id}</span><span>{r.date}</span><span>{r.desc}</span><span>{r.pump}</span>
          <span className="n">{fmtQty(r.qty)}</span><span className="n">{fmt(r.amount)}</span>
          <span className={r.balance < 0 ? 'n neg' : 'n'}>{fmt(r.balance)}</span></div>); })}
    </div></div>;
}

function App() {
  const [rows, setRows] = useState(() => genRows(N));
  const dir = useRef(1);
  const submit = (e) => { e.preventDefault(); const fd = new FormData(e.target); setRows((rs) => [...rs, rowFromForm(fd, rs)]); };
  return <>
    <header><h1>دفتر مبيعات المحطة</h1><span>{rows.length} سطر</span></header>
    <form onSubmit={submit}><input name="date" type="date" defaultValue="2026-11-27" /><input name="desc" defaultValue="بيع نقدي" />
      <input name="qty" inputMode="decimal" defaultValue="25.5" /><input name="price" inputMode="decimal" defaultValue="610" />
      <input name="note" defaultValue="وردية ١" /><select name="pump">{PUMPS.map((p) => <option key={p}>{p}</option>)}</select>
      <button type="submit">إضافة</button></form>
    <div className="toolbar">
      <button id="sort" onClick={() => { const d = dir.current; dir.current = -d; setRows((rs) => sortedByAmount(rs, d)); }}>ترتيب حسب المبلغ</button>
      <button id="clear" onClick={() => setRows([])}>مسح</button>
      <button id="create" onClick={() => setRows(genRows(N))}>إنشاء</button></div>
    {MODE === 'plain' ? <Plain rows={rows} /> : <Virtual rows={rows} />}
  </>;
}
createRoot(document.getElementById('app')).render(<App />);
