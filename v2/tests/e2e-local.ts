/* The desktop/phone path end to end in Chromium: UI → core → Kysely → bridge → SQLite (WASM). No server involved.
   node tests/e2e-local.ts <outdir> */
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
const out = process.argv[2] || '.';
const dir = join(tmpdir(), 'fpv2-local-' + process.pid); mkdirSync(join(dir, 'fonts'), { recursive: true });
const root = fileURLToPath(new URL('..', import.meta.url));
await build({ entryPoints: [join(root, 'tests/local-harness.ts')], bundle: true, format: 'esm', platform: 'browser', outfile: join(dir, 'app.js'), logLevel: 'warning' });
cpSync(join(root, '../node_modules/sql.js/dist/sql-wasm.wasm'), join(dir, 'sql-wasm.wasm'));
cpSync(join(root, '../node_modules/sql.js/dist/sql-wasm.js'), join(dir, 'sql-wasm.js'));
cpSync(join(root, 'apps/desktop/dist/app.css'), join(dir, 'app.css'));
cpSync(join(root, 'apps/desktop/dist/fonts'), join(dir, 'fonts'), { recursive: true });
writeFileSync(join(dir, 'index.html'), '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="app.css"><script src="sql-wasm.js"></script><script type="module" src="app.js"></script></head><body><div id="app"></div></body></html>');
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
const srv = http.createServer(async (q, s) => { const f = join(dir, q.url === '/' ? 'index.html' : q.url!.slice(1)); const d = await readFile(f).catch(() => null); s.writeHead(d ? 200 : 404, { 'content-type': MIME[extname(f)] || 'application/octet-stream' }); s.end(d); }).listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r));
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 820 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${(srv.address() as { port: number }).port}/`);
await page.waitForSelector('#fr-st', { timeout: 8000 }).catch(async (e) => { console.log('page:', await page.textContent('body'), errors); throw e; }); await page.click('button[type=submit]');
await page.waitForSelector('#sh-float'); await page.fill('#sh-float', '500'); await page.click('text=فتح وردية'); await page.waitForSelector('#sh-count');
await page.selectOption('#s-mode', 'qty'); await page.fill('#s-val', '12.5'); await page.click('text=تسجيل البيع'); await page.waitForSelector('tbody tr');
await page.fill('#s-val', '99999'); await page.click('text=تسجيل البيع'); await page.waitForSelector('.toast.err');
const errToast = await page.textContent('.toast.err');
await page.fill('#sh-count', '8000'); await page.click('text=إغلاق الوردية'); await page.waitForSelector('#sh-float');
await page.screenshot({ path: join(out, '5-local-edition.png') });
const books = await page.evaluate(() => {
  const db = (window as unknown as { __db: { exec(s: string): Array<{ values: unknown[][] }> } }).__db;
  const one = (s: string) => db.exec(s)[0]?.values ?? [];
  return { sales: one('select quantity_ml, gross from sales'), tb: one("select a.code, sum(l.debit), sum(l.credit) from journal_lines l join accounts a on a.id=l.account_id group by a.code order by a.code"),
    shift: one('select status, expected_cash, counted_cash, variance from shifts') };
});
console.log(JSON.stringify(books), '| error toast:', errToast);
console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
await browser.close(); srv.close();
if (errors.length) process.exit(1);
