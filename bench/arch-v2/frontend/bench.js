// Usage: node bench.js [runs=5] [fw,fw,...]
const { chromium } = require('/home/user/fuelpro-erp/node_modules/playwright');
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const startServer = require('./server.js');
const RUNS = +(process.argv[2] || 5);
const FWS = (process.argv[3] || 'vanilla,react,preact,svelte,solid,vue').split(',');
const PORT = 4173, BASE = `http://127.0.0.1:${PORT}`;

const INIT = () => {
  window.__lt = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch {}
  window.__nextPaint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  window.__time = async (fn) => { const t = performance.now(); fn(); await new Promise((r) => requestAnimationFrame(r)); const s = performance.now() - t; await new Promise((r) => setTimeout(r, 0)); return [performance.now() - t, s]; };
};

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ar' });
  const page = await ctx.newPage();
  await page.addInitScript(INIT);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  return { ctx, page, cdp };
}
async function heapMB(cdp) {
  await cdp.send('HeapProfiler.enable'); await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage'); return usedSize / 1048576;
}
async function loadMetrics(page) {
  await page.waitForFunction(() => window.__rowsVisible, null, { timeout: 120000 });
  await page.waitForTimeout(1500); // let trailing long tasks finish
  return page.evaluate(() => {
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? NaN;
    const lt = window.__lt; const sum = lt.reduce((a, [, d]) => a + d, 0);
    const tbt = lt.filter(([s]) => s >= fcp).reduce((a, [, d]) => a + Math.max(0, d - 50), 0);
    const tbtAll = lt.reduce((a, [, d]) => a + Math.max(0, d - 50), 0);
    return { fcp, rowsVisible: window.__rowsVisible, longTaskSum: sum, longTasks: lt.length, tbt, tbtAll };
  });
}
const timed = (page, fn) => page.evaluate(fn);

async function runPlain(browser, fw) {
  const { ctx, page, cdp } = await newPage(browser);
  await page.goto(`${BASE}/${fw}/?mode=plain&n=5000${process.env.QS || ''}`);
  const m = await loadMetrics(page);
  m.rowsOk = await page.$$eval('tbody tr', (t) => t.length);
  m.heap = await heapMB(cdp);
  m.create = await timed(page, async () => { document.querySelector('#clear').click(); await window.__nextPaint(); await new Promise((r) => setTimeout(r, 300));
    const d = await window.__time(() => document.querySelector('#create').click());
    if (document.querySelectorAll('tbody tr').length !== 5000) throw new Error('create count'); return d; });
  await page.waitForTimeout(300);
  m.sort = await timed(page, async () => { const d = await window.__time(() => document.querySelector('#sort').click());
    const a = [...document.querySelectorAll('tbody tr')].slice(0, 2).map((tr) => tr.children[0].textContent); return [d, a.join(',')]; });
  m.sortTop = m.sort[1]; m.sort = m.sort[0];
  await page.waitForTimeout(300);
  m.append = await timed(page, async () => { const d = await window.__time(() => document.querySelector('form button[type=submit]').click());
    if (document.querySelectorAll('tbody tr').length !== 5001) throw new Error('append count ' + document.querySelectorAll('tbody tr').length); return d; });
  await ctx.close();
  return m;
}

async function runVirtual(browser, fw) {
  const { ctx, page, cdp } = await newPage(browser);
  await page.goto(`${BASE}/${fw}/?mode=virtual&n=10000`);
  const m = await loadMetrics(page);
  m.heap = await heapMB(cdp);
  Object.assign(m, await page.evaluate(async () => {
    const el = document.querySelector('.vwrap'); const deltas = []; const SPEED = 3; // px per ms = 3000 px/s (~94 rows/s)
    const t0 = performance.now(); let last = t0;
    await new Promise((done) => { const f = (now) => { deltas.push(now - last); last = now; el.scrollTop = (now - t0) * SPEED; if (now - t0 < 3000) requestAnimationFrame(f); else done(); }; requestAnimationFrame(f); });
    deltas.shift();
    const s = deltas.slice().sort((a, b) => a - b);
    const dropped = deltas.reduce((a, d) => a + Math.max(0, Math.round(d / 16.667) - 1), 0);
    const lastRow = [...document.querySelectorAll('.vrow')].map((r) => +r.children[0].textContent);
    return { frames: deltas.length, avgFrame: deltas.reduce((a, b) => a + b, 0) / deltas.length, p95Frame: s[Math.floor(s.length * 0.95)], dropped,
      scrollTop: el.scrollTop, maxIdVisible: Math.max(...lastRow), vrows: lastRow.length };
  }));
  await ctx.close();
  return m;
}

function sizes(fw) {
  const dir = path.join(__dirname, fw, 'dist', 'assets'); const out = { js: 0, jsGz: 0, css: 0, cssGz: 0 };
  for (const f of fs.readdirSync(dir)) { const b = fs.readFileSync(path.join(dir, f)); const gz = zlib.gzipSync(b, { level: 9 }).length;
    if (f.endsWith('.js')) { out.js += b.length; out.jsGz += gz; } else if (f.endsWith('.css')) { out.css += b.length; out.cssGz += gz; } }
  return out;
}
const median = (a) => { const s = a.filter((x) => typeof x === 'number' && !isNaN(x)).sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };

(async () => {
  const srv = await startServer(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox'] });
  const raw = {}; for (const fw of FWS) raw[fw] = { plain: [], virtual: [] };
  for (let r = 0; r < RUNS; r++) {
    const order = FWS.slice(r % FWS.length).concat(FWS.slice(0, r % FWS.length)); // rotate order per run
    for (const fw of order) {
      raw[fw].plain.push(await runPlain(browser, fw));
      raw[fw].virtual.push(await runVirtual(browser, fw));
      process.stderr.write(`run ${r + 1} ${fw} done\n`);
    }
  }
  const summary = {};
  for (const fw of FWS) {
    const P = raw[fw].plain, V = raw[fw].virtual; const k = (arr, key, i = 0) => median(arr.map((x) => (Array.isArray(x[key]) ? x[key][i] : x[key])));
    summary[fw] = { ...sizes(fw), fcp: k(P, 'fcp'), rowsVisible: k(P, 'rowsVisible'), tbt: k(P, 'tbt'), longTaskSum: k(P, 'longTaskSum'), heap: k(P, 'heap'),
      tbtAll: k(P, 'tbtAll'), create: k(P, 'create'), createJs: k(P, 'create', 1), sort: k(P, 'sort'), sortJs: k(P, 'sort', 1), append: k(P, 'append'), appendJs: k(P, 'append', 1),
      vFcp: k(V, 'fcp'), vRowsVisible: k(V, 'rowsVisible'), vTbt: k(V, 'tbtAll'), vLongTaskSum: k(V, 'longTaskSum'), vHeap: k(V, 'heap'), avgFrame: k(V, 'avgFrame'), p95Frame: k(V, 'p95Frame'), dropped: k(V, 'dropped'),
      check: { rows: P[0].rowsOk, sortTop: P[0].sortTop, vrows: V[0].vrows, maxIdVisible: V[0].maxIdVisible, scrollTop: V[0].scrollTop } };
  }
  fs.writeFileSync(path.join(__dirname, 'results-raw.json'), JSON.stringify(raw, null, 1));
  fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify(summary, null, 1));
  await browser.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
