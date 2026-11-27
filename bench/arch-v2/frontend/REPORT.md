# Front-end framework benchmark: Arabic RTL ERP table app on a throttled phone

Date 2026-11-27. Synthetic data only (generated rows, no real data). Everything is in this folder.

## Setup
- **Same app ×6** (Vite 8.4.0 production builds, `base: './'`): `<html dir="rtl" lang="ar">`, header, form (5 inputs + select + submit that appends a row), table with columns #, date, Arabic description, pump, quantity, amount, balance; numbers via `Intl.NumberFormat('ar', {numberingSystem:'latn'})`. Shared, identical `shared/data.js` (deterministic generator, integer minor units), `shared/style.css`, `shared/harness.js`. Every bundle contains both modes.
- **Modes**: `?mode=plain&n=5000` (real `<table>`, keyed rows) and `?mode=virtual&n=10000` (div grid, row height 32 px, overscan 5).
- **Virtualizers**: React `@tanstack/react-virtual` 3.14.28, Vue `@tanstack/vue-virtual` 3.13.54, Solid `@tanstack/solid-virtual` 3.13.55, Svelte `@tanstack/svelte-virtual` 3.13.54, vanilla `@tanstack/virtual-core` 3.19.13. Preact has no TanStack adapter without `preact/compat`, so it uses about 15 lines of hand-written windowing.
- **Versions**: react/react-dom 19.3.1 (+ @vitejs/plugin-react 6.3.0), preact 11.2.0 (@preact/preset-vite 2.10.6), svelte 5.59.2 (@sveltejs/vite-plugin-svelte 7.3.2), solid-js 1.9.20 (vite-plugin-solid 2.11.17; npm picked 1.x because solid-virtual peers on 1.x, although 2.0.4 is out), vue 3.5.46 (@vitejs/plugin-vue 6.0.11). Each project has its own install because one shared tree had plugin peer conflicts.
- **Idiomatic large-list state**: React `memo` rows; Preact class row with `shouldComponentUpdate`; Svelte `$state.raw`; Vue `shallowRef`; Solid signal + `<For>`; vanilla keyed `Map<id, tr>` + `<template>` cloning.

## How it was measured (`bench.js`, `server.js`)
- Node static server, gzip level 9, `no-store`. Playwright 1.65.1 + Chrome for Testing 153.0.8010.12 headless on 4 vCPU.
- Each run uses a fresh context: 390×844, DPR 2, `isMobile`. CDP: `Emulation.setCPUThrottlingRate 4`, `Network.emulateNetworkConditions` (150 ms latency, 1.6 Mbit/s down, 750 kbit/s up), cache disabled.
- **FCP** comes from the paint timing entry. **First rows visible** is a shared `performance.mark`: a rAF poll sees the first `tbody tr`/`.vrow`, then the next rAF runs after that frame has painted.
- **Long tasks** come from a `PerformanceObserver('longtask')` added by an init script. *TBT\** = Σ(duration − 50) over all load long tasks. Lighthouse-style TBT (after FCP only) is about 0 for every framework, because the 5k render is one task that runs before the first paint.
- **Interactions** are timed in the page: `t0 → click → rAF` gives the framework JS time (in brackets). `→ setTimeout 0` after that frame gives the total, which also covers style, layout and paint. Render 5k = `#clear`, wait, then `#create`. Sort = re-sort 5k by amount (keyed move). Append = form submit. Row counts and sort order are checked in every run.
- **Heap**: `HeapProfiler.collectGarbage` then `Runtime.getHeapUsage`, i.e. the JS heap only, not DOM memory.
- **Scroll**: rAF loop for 3 s sets `scrollTop = t·3 px/ms`, which is a fast fling of about 94 rows/s. It records frame deltas: average, p95, and dropped = Σ(round(Δ/16.67) − 1).
- **Median of 5 runs** per framework. The framework order is rotated in each run. Raw data: `results-raw-5runs.json`, medians: `results-5runs.json`.

## Results (median of 5, mid-phone profile: 4× CPU, 1.6 Mbit/s, 150 ms RTT)
| Framework | JS raw / gzip (KB) | CSS raw / gzip (KB) | FCP (ms) | First rows visible (ms) | Long tasks sum / TBT* (ms) | Heap after 5k (MB) | Render 5k: total (JS) ms | Sort 5k: total (JS) ms | Append 1: total (JS) ms | Virtual 10k: rows visible (ms) | Virtual TBT (ms) | Virtual heap (MB) | Scroll 3 s: avg / p95 frame (ms), dropped |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Vanilla JS | 38.7 / 12.0 | 1.9 / 0.8 | 4532 | 4536 | 4073 / 3973 | 2.0 | 3535 (289) | 3420 (330) | 845 (47) | 793 | 232 | 2.2 | 17.0 / 16.8, 4 |
| React 19.3.1 | 253.8 / 77.9 | 1.9 / 0.8 | 4216 | 4257 | 3473 / 3273 | 10.8 | 3759 (633) | 3624 (460) | 798 (77) | 1147 | 171 | 2.8 | 18.2 / 33.3, 15 |
| Preact 11.2.0 | 17.9 / 7.6 | 1.9 / 0.8 | 4720 | 4756 | 4325 / 4175 | 11.1 | 3338 (529) | 3982 (467) | 707 (69) | 725 | 211 | 2.2 | 16.9 / 16.8, 2 |
| Svelte 5.59.2 | 87.2 / 30.2 | 1.9 / 0.8 | 4352 | 4367 | 3846 / 3696 | 12.8 | 3233 (403) | 3802 (381) | 699 (70) | 917 | 285 | 2.6 | 17.1 / 16.8, 5 |
| Solid 1.9.20 | 58.4 / 19.1 | 1.9 / 0.8 | 3972 | 3999 | 3490 / 3390 | 9.1 | 3268 (358) | 3327 (220) | 845 (53) | 827 | 245 | 2.4 | 16.8 / 16.7, 1 |
| Vue 3.5.46 | 100.8 / 35.6 | 1.9 / 0.8 | 4532 | 4551 | 4001 / 3851 | 8.5 | 3287 (449) | 3734 (450) | 934 (115) | 966 | 271 | 2.5 | 17.1 / 16.8, 5 |

Run-to-run noise is large in plain mode. React FCP ranged from 3984 to 5656 ms, vanilla's render-5k total from 2836 to 3821 ms. **Differences under about 400 ms in the plain-mode columns are within noise.** The virtual-mode and JS-only (bracketed) numbers are more stable.

Extra experiment (`results-fixed.json`, 3 runs, `?fixed=1` = `table-layout:fixed` + column widths): it did **not** help. Render 5k got slower: vanilla 4510 ms, React 4910 ms, Solid 5063 ms.

Printing (unthrottled): `page.pdf` of the 5k-row plain table took 4.0 s and produced 132 A4 pages (`shots/vanilla-5000-print.pdf`).

## RTL / bidi pitfalls seen (they were the same in every framework, because the DOM and CSS are the same; the screenshots in `shots/` are byte-identical across frameworks)
- With latn digits, `Intl` 'ar' formats negatives as `U+200E -1,234.50`, with a hidden LRM in front. On screen this is correct. The minus sits on the left, as checked by measuring glyph positions, with `td.n {direction:ltr; unicode-bidi:isolate}`. But copy-paste, CSV export and `parseFloat` all get the invisible character.
- In the virtual div-grid, an LTR date (`2026-01-01`) in a narrow RTL `overflow:hidden` cell is clipped at its **start**, showing `026-01-01`. Fix: isolate the date as LTR and give it enough width.
- In an RTL horizontal scroller, `scrollLeft` is **negative** (−295 here). Any horizontal virtualization or "scroll to column" code must handle this (TanStack has an `isRtl` option).
- `<input type="date">` uses the browser or OS locale format (`11/27/2026`), not `lang="ar"`.
- Svelte 5 + `@tanstack/svelte-virtual` is store-based (Svelte 4 style). Reading `$v` inside `$effect` subscribed the effect to the store and set off a feedback loop: average frame 298 ms and 186 dropped frames until it was fixed with `untrack`/`get`.
- Preact: virtualizers that only exist for React need `preact/compat`, so I hand-rolled one.

## Ecosystem (brief, from general knowledge, not measured)
- **i18n/RTL**: React has the most (react-intl/FormatJS, react-i18next, MUI/Mantine/Ant Design with RTL modes). Vue is strong (vue-i18n; Vuetify, Quasar and PrimeVue support RTL). Svelte has svelte-i18n and Paraglide but few RTL-aware UI kits. Solid has @solid-primitives/i18n and a small ecosystem. Preact can reuse React libraries via compat, at a size cost. In vanilla, `Intl` plus CSS logical properties cover it.
- **Print**: `window.print()` of a real `<table>` works the same everywhere (`thead` repeats per page, and the sticky header must become static in `@media print`). A virtual list prints only about 26 rows in every framework, so each one needs a separate "render all rows for print" path. That costs about 3.5 s of rendering for 5k rows on a phone.
- **Packaging**: all six are plain static `dist/` builds, so Tauri, Electron and Capacitor work equally well. Locally packaged apps have no download cost, so only the parse/CPU part of the bundle-size gap remains.

## Conclusions
1. **On a throttled phone, a 5,000-row plain table costs about 3.2–3.8 s per full render whatever the framework.** Framework JS is only 220–630 ms of that (about 7–17%). The rest is Chromium style, layout and paint for 35k cells. Choosing a framework cannot fix this.
2. **Virtualization is the real speed lever.** 10k virtualized rows were on screen in 0.7–1.1 s from navigation, against 4.0–4.8 s for 5k plain rows, with 2–3 MB of JS heap and an almost steady 60 fps fling (p95 16.8 ms) in every stack except React.
3. **Lightest and fastest to first rows:** Preact (7.6 KB gz, virtual first rows 725 ms), then vanilla (12.0 KB gz, which includes TanStack virtual-core; 793 ms) and Solid (19.1 KB, 827 ms). React is the heaviest: 77.9 KB gz, 1147 ms, about 350–420 ms later than Preact/vanilla on this network. It also had the roughest scroll (15 dropped frames, p95 33 ms).
4. **Fastest framework runtime:** Solid had the lowest JS time among the frameworks (render 358 ms, sort 220 ms, the only one faster than vanilla on sort) and the smoothest scroll (1 dropped frame). Svelte and Vue are in the middle. React has the most JS per update (render 633 ms, about 2.2× vanilla).
5. **Memory:** vanilla keeps the JS heap at 2.0 MB with 5k rows. The frameworks use 8.5–12.8 MB (4–6×) for component trees, vnodes and fibers, which matters on low-RAM phones and in WebViews.
6. **Cost/benefit against vanilla:** no framework was measurably faster than vanilla for the user here. The costs are 0–66 KB gz more, 4–6× the JS heap, up to 2× the scripting per update, and a build step. The benefit is developer ergonomics (components, reactive state, i18n and RTL UI kits), not performance.
7. **If a framework is adopted for the phone/desktop/mobile builds**, Preact or Solid keep vanilla-class size and speed. Vue is the best middle ground for ecosystem (i18n, RTL kits) at +24 KB gz. React gives the most ecosystem at the highest phone cost.
8. **The table/print plan matters more than the framework:** virtualized or paginated screens, a separate render-all print path, LTR-isolated numeric and date cells, and care with the hidden LRM in exports.

## Files
`shared/` (data, harness, CSS, index template), `vanilla|react|preact|svelte|solid|vue/` (app source + `vite.config.mjs`; `dist/` = built output), `server.js`, `bench.js` (`node bench.js [runs] [fw,...]`, `QS='&fixed=1'` for the experiment), `shots.js` (screenshots + print PDF), `results-*.json`, `shots/`.
