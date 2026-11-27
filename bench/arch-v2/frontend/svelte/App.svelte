<script>
  import { MODE, N, ROW_H, OVERSCAN } from '../shared/harness.js';
  import { genRows, fmt, fmtQty, rowFromForm, sortedByAmount, PUMPS } from '../shared/data.js';
  import Virtual from './Virtual.svelte';
  const HEAD = ['#', 'التاريخ', 'البيان', 'المضخة', 'الكمية', 'المبلغ', 'الرصيد'];
  // $state.raw: no deep proxy over 5,000 objects; arrays are replaced, not mutated
  let rows = $state.raw(genRows(N));
  let dir = 1;
  function submit(e) { e.preventDefault(); rows = [...rows, rowFromForm(new FormData(e.currentTarget), rows)]; }
  function sort() { rows = sortedByAmount(rows, dir); dir = -dir; }
</script>

<header><h1>دفتر مبيعات المحطة</h1><span>{rows.length} سطر</span></header>
<form onsubmit={submit}><input name="date" type="date" value="2026-11-27" /><input name="desc" value="بيع نقدي" />
  <input name="qty" inputmode="decimal" value="25.5" /><input name="price" inputmode="decimal" value="610" />
  <input name="note" value="وردية ١" /><select name="pump">{#each PUMPS as p}<option>{p}</option>{/each}</select>
  <button type="submit">إضافة</button></form>
<div class="toolbar"><button id="sort" onclick={sort}>ترتيب حسب المبلغ</button>
  <button id="clear" onclick={() => (rows = [])}>مسح</button>
  <button id="create" onclick={() => (rows = genRows(N))}>إنشاء</button></div>
{#if MODE === 'plain'}
<div class="wrap"><table><thead><tr>{#each HEAD as h, i}<th class={i > 3 ? 'n' : undefined}>{h}</th>{/each}</tr></thead>
<tbody>{#each rows as r (r.id)}<tr><td>{r.id}</td><td>{r.date}</td><td>{r.desc}</td><td>{r.pump}</td>
<td class="n">{fmtQty(r.qty)}</td><td class="n">{fmt(r.amount)}</td><td class={r.balance < 0 ? 'n neg' : 'n'}>{fmt(r.balance)}</td></tr>{/each}</tbody></table></div>
{:else}
<Virtual {rows} {HEAD} />
{/if}
