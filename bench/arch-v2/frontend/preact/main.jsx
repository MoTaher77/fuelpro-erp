import '../shared/style.css';
import { MODE, N, ROW_H, OVERSCAN } from '../shared/harness.js';
import { genRows, fmt, fmtQty, rowFromForm, sortedByAmount, PUMPS } from '../shared/data.js';
import { render, Component } from 'preact';
import { useRef, useState, useEffect } from 'preact/hooks';

const HEAD = ['#', 'التاريخ', 'البيان', 'المضخة', 'الكمية', 'المبلغ', 'الرصيد'];

class Row extends Component {
  shouldComponentUpdate(n) { return n.r !== this.props.r; }
  render({ r }) {
    return <tr><td>{r.id}</td><td>{r.date}</td><td>{r.desc}</td><td>{r.pump}</td>
      <td class="n">{fmtQty(r.qty)}</td><td class="n">{fmt(r.amount)}</td>
      <td class={r.balance < 0 ? 'n neg' : 'n'}>{fmt(r.balance)}</td></tr>;
  }
}

function Plain({ rows }) {
  return <div class="wrap"><table><thead><tr>{HEAD.map((h, i) => <th class={i > 3 ? 'n' : undefined}>{h}</th>)}</tr></thead>
    <tbody>{rows.map((r) => <Row key={r.id} r={r} />)}</tbody></table></div>;
}

// Minimal hand-written windowing (no official Preact TanStack adapter without preact/compat).
function Virtual({ rows }) {
  const ref = useRef(null);
  const [top, setTop] = useState(0);
  const [h, setH] = useState(480);
  useEffect(() => { setH(ref.current.clientHeight); }, []);
  const start = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((top + h) / ROW_H) + OVERSCAN);
  const items = [];
  for (let i = start; i < end; i++) { const r = rows[i]; items.push(
    <div key={r.id} class="vrow" style={{ transform: `translateY(${i * ROW_H}px)` }}>
      <span>{r.id}</span><span>{r.date}</span><span>{r.desc}</span><span>{r.pump}</span>
      <span class="n">{fmtQty(r.qty)}</span><span class="n">{fmt(r.amount)}</span>
      <span class={r.balance < 0 ? 'n neg' : 'n'}>{fmt(r.balance)}</span></div>); }
  return <div class="vwrap" ref={ref} onScroll={(e) => setTop(e.currentTarget.scrollTop)}>
    <div class="vhead">{HEAD.map((x, i) => <span class={i > 3 ? 'n' : undefined}>{x}</span>)}</div>
    <div style={{ position: 'relative', height: rows.length * ROW_H }}>{items}</div></div>;
}

function App() {
  const [rows, setRows] = useState(() => genRows(N));
  const dir = useRef(1);
  const submit = (e) => { e.preventDefault(); const fd = new FormData(e.target); setRows((rs) => [...rs, rowFromForm(fd, rs)]); };
  return <>
    <header><h1>دفتر مبيعات المحطة</h1><span>{rows.length} سطر</span></header>
    <form onSubmit={submit}><input name="date" type="date" value="2026-11-27" /><input name="desc" value="بيع نقدي" />
      <input name="qty" inputMode="decimal" value="25.5" /><input name="price" inputMode="decimal" value="610" />
      <input name="note" value="وردية ١" /><select name="pump">{PUMPS.map((p) => <option>{p}</option>)}</select>
      <button type="submit">إضافة</button></form>
    <div class="toolbar">
      <button id="sort" onClick={() => { const d = dir.current; dir.current = -d; setRows((rs) => sortedByAmount(rs, d)); }}>ترتيب حسب المبلغ</button>
      <button id="clear" onClick={() => setRows([])}>مسح</button>
      <button id="create" onClick={() => setRows(genRows(N))}>إنشاء</button></div>
    {MODE === 'plain' ? <Plain rows={rows} /> : <Virtual rows={rows} />}
  </>;
}
render(<App />, document.getElementById('app'));
