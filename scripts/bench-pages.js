'use strict';
/* global document, location  */   // used inside page.evaluate (runs in the browser)
/* Repeatable page-speed benchmark in a real browser (Playwright + the pre-installed Chromium). docs/PERFORMANCE.md.
   Measures: first open (cold cache) until the dashboard is on screen, bytes transferred, reload with a warm cache,
   then every screen in the menu: time from clicking the menu link until the screen replaced its skeleton.
   Two profiles: "desktop" (no throttling) and "phone" (4x CPU slowdown + ~1.6 Mbps / 150 ms network, a mid-range phone on 3G/4G).
   Usage:  node scripts/bench-pages.js --db <copy> --password <pw> [--email dev@local.test] [--profile phone|desktop|both] [--json out.json]
   Needs the dev dependency playwright (npm ci). Never point it at data/fuelpro.db. */
const path = require('path');
const fs = require('fs');
const { createApp } = require('../src/server');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const dbPath = path.resolve(arg('--db', ''));
const email = arg('--email', 'dev@local.test');
const password = arg('--password', process.env.BENCH_PASSWORD || '');
const profileArg = arg('--profile', 'both');
const jsonOut = arg('--json', '');
const only = (arg('--tabs', '') || '').split(',').filter(Boolean);
if (!dbPath || !fs.existsSync(dbPath)) { console.error('--db <copy of a FuelPro database> is required'); process.exit(1); }
if (/[\\/]data[\\/]fuelpro\.db$/.test(dbPath)) { console.error('refusing to benchmark the live database'); process.exit(1); }

const PROFILES = {
  desktop: { cpu: 1, net: null },
  phone: { cpu: 4, net: { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 } }
};

async function runProfile(browser, base, name) {
  const prof = PROFILES[name];
  const ctx = await browser.newContext({ viewport: name === 'phone' ? { width: 390, height: 844 } : { width: 1366, height: 800 }, locale: 'ar' });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  let bytes = 0; cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength; });
  /* sign in through the API (no throttling yet), so the measured open is the real "open the app" path */
  const r = await page.request.post(base + '/api/auth/login', { data: { email, password } });
  if (!r.ok()) throw new Error('sign-in failed ' + r.status());
  if (prof.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: prof.cpu });
  if (prof.net) await cdp.send('Network.emulateNetworkConditions', prof.net);
  const shown = () => page.waitForSelector('main#main', { timeout: 60000 });

  let t = Date.now(); await page.goto(base + '/#dash'); await shown(); const cold = Date.now() - t; const coldBytes = bytes;
  bytes = 0; t = Date.now(); await page.reload(); await shown(); const warm = Date.now() - t; const warmBytes = bytes;
  const tabs = await page.$$eval('aside.side a[href^="#"]', (as) => as.map((a) => a.getAttribute('href').slice(1)).filter((k) => /^[a-z]+$/.test(k)));
  const screens = [];
  for (const k of tabs) {
    if (only.length && !only.includes(k)) continue;
    await page.evaluate(() => { const m = document.getElementById('main'); if (m) m.id = 'old-main'; });
    bytes = 0; t = Date.now();
    await page.evaluate((key) => { location.hash = '#' + key; }, k);
    try { await shown(); screens.push({ tab: k, ms: Date.now() - t, kb: +(bytes / 1024).toFixed(1) }); } catch { screens.push({ tab: k, ms: null }); }
    await page.waitForTimeout(150);
  }
  const heap = await page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null));
  const dom = await page.evaluate(() => document.getElementsByTagName('*').length);
  await ctx.close();
  return { profile: name, cold_ms: cold, cold_kb: +(coldBytes / 1024).toFixed(1), warm_ms: warm, warm_kb: +(warmBytes / 1024).toFixed(1), heap_mb: heap, dom_nodes_last: dom, screens };
}

(async () => {
  const { chromium } = require('playwright');
  const { server, db } = createApp({ dbPath, mailer: { send: async () => {} } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const exe = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch(exe && fs.statSync(exe).isFile() ? { executablePath: exe } : {});
  const out = [];
  for (const p of profileArg === 'both' ? ['desktop', 'phone'] : [profileArg]) out.push(await runProfile(browser, base, p));
  await browser.close(); server.close(); db.close();
  for (const o of out) {
    console.log(`\n[${o.profile}] first open ${o.cold_ms} ms (${o.cold_kb} KB) · reload ${o.warm_ms} ms (${o.warm_kb} KB) · JS heap ${o.heap_mb} MB`);
    const ok = o.screens.filter((s) => s.ms != null);
    for (const s of o.screens) console.log('  ' + s.tab.padEnd(8) + String(s.ms == null ? 'FAIL' : s.ms).padStart(7) + ' ms' + (s.kb != null ? String(s.kb).padStart(9) + ' KB' : ''));
    const sorted = ok.map((s) => s.ms).sort((a, b) => a - b);
    console.log(`  median ${sorted[Math.floor(sorted.length / 2)]} ms · slowest ${sorted[sorted.length - 1]} ms · over 2 s: ${ok.filter((s) => s.ms > 2000).map((s) => s.tab).join(', ') || 'none'}`);
  }
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ at: new Date().toISOString(), profiles: out }, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
