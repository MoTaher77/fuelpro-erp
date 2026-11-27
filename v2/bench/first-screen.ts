/* First screen of the server edition on a mid-range phone profile — the same profile as v1's scripts/bench-pages.js
   (CPU ×4 slower, 150 ms latency, 1.6 Mbit/s down). Cold (empty cache) and reload. Demo data from --db (v2 SQLite copy).
   node bench/first-screen.ts --db <demo-v2.db> [--runs 5] */
import { chromium } from 'playwright';
import { copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, openFromEnv } from '../apps/server/src/main.ts';
const arg = (k: string, d?: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const f = join(tmpdir(), 'fs-' + process.pid + '.db'); copyFileSync(arg('--db')!, f);
const ctx = await openFromEnv(f), token = 'fs-token-' + process.pid;
const srv = createServer(ctx, token).listen(0, '127.0.0.1'); await new Promise((r) => srv.once('listening', r));
const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}/#t=${token}`;
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const runs = Number(arg('--runs', '5')), cold: number[] = [], warm: number[] = []; let bytes = 0;
for (let i = 0; i < runs; i++) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await c.newPage(), cdp = await c.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  let b = 0; page.on('response', async (r) => { try { b += (await r.body()).length; } catch { /* redirect */ } });
  let t = Date.now(); await page.goto(url); await page.waitForSelector('.tiles .tile'); cold.push(Date.now() - t); bytes = b;
  t = Date.now(); await page.reload(); await page.waitForSelector('.tiles .tile'); warm.push(Date.now() - t);
  await c.close();
}
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log(JSON.stringify({ cold_ms: med(cold), reload_ms: med(warm), transferred_kb: Math.round(bytes / 1024), runs }));
await browser.close(); srv.close(); await ctx.close();
