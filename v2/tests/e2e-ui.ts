/* Browser check of the shared UI on the server edition: first run, open shift, two sales, void, close.
   node tests/e2e-ui.ts <outdir> [postgres-url]. Throwaway DB, demo values only. */
import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { createServer, openFromEnv } from '../apps/server/src/main.ts';
const require = createRequire(import.meta.url);
void require;
const out = process.argv[2] || '.';
const ctx = await openFromEnv(process.argv[3] || ':memory:');
const token = 'e2e-token-0123456789';
const srv = createServer(ctx, token).listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r));
const port = (srv.address() as { port: number }).port;
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const errors: string[] = [];
for (const [name, vp] of [['desktop', { width: 1280, height: 860 }], ['phone', { width: 390, height: 844 }]] as const) {
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(name + ': ' + m.text()); });
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/#t=${token}`);
  if (name === 'desktop') {
    await page.waitForSelector('#fr-st');
    await page.screenshot({ path: `${out}/1-first-run.png` });
    await page.click('button[type=submit]');
  }
  await page.waitForSelector('.tiles .tile');
  console.log(name, 'first screen ms', Date.now() - t0);
  if (name === 'desktop') {
    await page.fill('#sh-float', '1000');
    await page.click('text=فتح وردية'); await page.waitForSelector('#sh-count');
    await page.selectOption('#s-mode', 'qty'); await page.fill('#s-val', '20');
    await page.click('text=تسجيل البيع'); await page.waitForSelector('tbody tr');
    await page.selectOption('#s-mode', 'meter'); await page.fill('#s-val', '35.5');
    await page.click('text=تسجيل البيع'); await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 2);
    page.once('dialog', (d) => d.accept('خطأ إدخال'));
    await page.click('tbody tr:last-child .btn.link'); await page.waitForSelector('tr.void');
    await page.screenshot({ path: `${out}/2-sales.png`, fullPage: true });
    await page.fill('#sh-count', '13000');
    await page.click('text=إغلاق الوردية'); await page.waitForSelector('#sh-float');
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/3-closed.png`, fullPage: true });
  } else {
    await page.screenshot({ path: `${out}/4-phone.png`, fullPage: true });
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    if (sideways) errors.push('phone: page scrolls sideways');
  }
  await page.close();
}
const tb = await ctx.db.selectFrom('sales').selectAll().execute();
console.log('sales rows', tb.length, 'gross', tb.map((s) => s.gross), 'voided', tb.filter((s) => s.voided_at).length);
const sh = await ctx.db.selectFrom('shifts').selectAll().execute();
console.log('shift', sh.map((s) => ({ status: s.status, expected: s.expected_cash, counted: s.counted_cash, variance: s.variance })));
console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
await browser.close(); srv.close(); await ctx.close();
if (errors.length) process.exit(1);
