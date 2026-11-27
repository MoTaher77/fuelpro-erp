<script>
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import { untrack } from 'svelte';
  import { get } from 'svelte/store';
  import { ROW_H, OVERSCAN } from '../shared/harness.js';
  import { fmt, fmtQty } from '../shared/data.js';
  let { rows, HEAD } = $props();
  let el = $state();
  const v = createVirtualizer({ count: rows.length, getScrollElement: () => el, estimateSize: () => ROW_H, overscan: OVERSCAN });
  // read only rows.length; calling $v here would subscribe the effect to the store and loop on every scroll
  $effect(() => { const count = rows.length; untrack(() => get(v).setOptions({ count })); });
</script>
<div class="vwrap" bind:this={el}>
  <div class="vhead">{#each HEAD as h, i}<span class={i > 3 ? 'n' : undefined}>{h}</span>{/each}</div>
  <div style="position:relative;height:{$v.getTotalSize()}px">
    {#each $v.getVirtualItems() as it (rows[it.index].id)}{@const r = rows[it.index]}
      <div class="vrow" style="transform:translateY({it.start}px)"><span>{r.id}</span><span>{r.date}</span><span>{r.desc}</span><span>{r.pump}</span>
      <span class="n">{fmtQty(r.qty)}</span><span class="n">{fmt(r.amount)}</span><span class={r.balance < 0 ? 'n neg' : 'n'}>{fmt(r.balance)}</span></div>
    {/each}
  </div>
</div>
