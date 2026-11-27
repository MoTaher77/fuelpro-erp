<script setup>
import { shallowRef, ref, computed } from 'vue';
import { useVirtualizer } from '@tanstack/vue-virtual';
import { MODE, N, ROW_H, OVERSCAN } from '../shared/harness.js';
import { genRows, fmt, fmtQty, rowFromForm, sortedByAmount, PUMPS } from '../shared/data.js';
const HEAD = ['#', 'التاريخ', 'البيان', 'المضخة', 'الكمية', 'المبلغ', 'الرصيد'];
// shallowRef: no deep reactivity over 5,000 objects; the array is replaced
const rows = shallowRef(genRows(N));
let dir = 1;
const submit = (e) => { rows.value = [...rows.value, rowFromForm(new FormData(e.currentTarget), rows.value)]; };
const sort = () => { rows.value = sortedByAmount(rows.value, dir); dir = -dir; };
const el = ref(null);
const v = MODE === 'virtual' ? useVirtualizer(computed(() => ({ count: rows.value.length, getScrollElement: () => el.value, estimateSize: () => ROW_H, overscan: OVERSCAN }))) : null;
</script>
<template>
  <header><h1>دفتر مبيعات المحطة</h1><span>{{ rows.length }} سطر</span></header>
  <form @submit.prevent="submit"><input name="date" type="date" value="2026-11-27" /><input name="desc" value="بيع نقدي" />
    <input name="qty" inputmode="decimal" value="25.5" /><input name="price" inputmode="decimal" value="610" />
    <input name="note" value="وردية ١" /><select name="pump"><option v-for="p in PUMPS" :key="p">{{ p }}</option></select>
    <button type="submit">إضافة</button></form>
  <div class="toolbar"><button id="sort" @click="sort">ترتيب حسب المبلغ</button>
    <button id="clear" @click="rows = []">مسح</button><button id="create" @click="rows = genRows(N)">إنشاء</button></div>
  <div v-if="MODE === 'plain'" class="wrap"><table><thead><tr><th v-for="(h, i) in HEAD" :key="i" :class="i > 3 ? 'n' : undefined">{{ h }}</th></tr></thead>
    <tbody><tr v-for="r in rows" :key="r.id"><td>{{ r.id }}</td><td>{{ r.date }}</td><td>{{ r.desc }}</td><td>{{ r.pump }}</td>
      <td class="n">{{ fmtQty(r.qty) }}</td><td class="n">{{ fmt(r.amount) }}</td><td :class="r.balance < 0 ? 'n neg' : 'n'">{{ fmt(r.balance) }}</td></tr></tbody></table></div>
  <div v-else ref="el" class="vwrap">
    <div class="vhead"><span v-for="(h, i) in HEAD" :key="i" :class="i > 3 ? 'n' : undefined">{{ h }}</span></div>
    <div :style="{ position: 'relative', height: v.getTotalSize() + 'px' }">
      <div v-for="it in v.getVirtualItems()" :key="rows[it.index].id" class="vrow" :style="{ transform: `translateY(${it.start}px)` }">
        <span>{{ rows[it.index].id }}</span><span>{{ rows[it.index].date }}</span><span>{{ rows[it.index].desc }}</span><span>{{ rows[it.index].pump }}</span>
        <span class="n">{{ fmtQty(rows[it.index].qty) }}</span><span class="n">{{ fmt(rows[it.index].amount) }}</span>
        <span :class="rows[it.index].balance < 0 ? 'n neg' : 'n'">{{ fmt(rows[it.index].balance) }}</span></div>
    </div></div>
</template>
