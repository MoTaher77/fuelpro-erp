'use strict';
/* global document, window, location, getComputedStyle */   // used inside page.evaluate (runs in the browser)
/* print-check — renders FuelPro's printed documents on a throwaway DEMO database and measures them.
   For every document: the app's own print code runs in Chromium (window.print is caught), the page is turned into a PDF with the
   document's own @page size, then into PNG pages (pdftoppm), and checked:
     pages, page size, «page X of Y» text, fonts embedded in the PDF (pdffonts) and any fallback face,
     content wider than the page (clipped or overflowing), time from the click to the print call.
   Usage:
     node scripts/print-check.js [--out <dir>] [--docs receipt,stmt,day,jbook,box,col,vch,pay] [--lang ar|en|fr] [--days 90] [--dpi 110]
   Never touches data/: it seeds its own demo database in a temp folder (scripts/seed-demo.js) and deletes it afterwards. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('out', path.join(os.tmpdir(), 'fuelpro-print-check')));
const LANG = arg('lang', 'ar');
const DPI = Number(arg('dpi', 110));
const DAYS = arg('days', '90');
const WANT = String(arg('docs', 'receipt,receipt58,receiptVoid,stmt,day,jbook,box,col')).split(',').map(s => s.trim()).filter(Boolean);
const has = (bin) => spawnSync('sh', ['-c', `command -v ${bin}`]).status === 0;

/* a document: open a screen, prepare it, press the print button. `paper` = width in CSS px of the printable area for the overflow check */
const yesterday = () => { const d = new Date(Date.now() - 86400000); return d.toISOString().slice(0, 10); };
const clickText = (page, re, scope = 'main#main') => page.evaluate(([src, flags, scope]) => {
  const r = new RegExp(src, flags); const b = [...document.querySelectorAll(scope + ' button, ' + scope + ' a.btn')].find(x => r.test(x.textContent) && x.offsetParent !== null);
  if (!b) throw new Error('no button ' + src); window.__clickAt = performance.now(); b.click();
}, [re.source, re.flags, scope]);
const printBtn = (page) => clickText(page, /⎙|طباعة|Print|Imprimer/);
const DOCS = {
  receipt: { title: 'Sale receipt 80 mm', hash: 'sales', prep: async (page, ctx) => { await ctx.makeSale(); await ctx.open('sales'); await page.evaluate(() => { try { localStorage.setItem('fpReceiptW', '80'); } catch { /* */ } }); await clickText(page, /^\s*(فاتورة|إيصال|Receipt|Reçu)\s*$/); } },
  receipt58: { title: 'Sale receipt 58 mm', hash: 'sales', prep: async (page, ctx) => { await ctx.open('sales'); await page.evaluate(() => { try { localStorage.setItem('fpReceiptW', '58'); } catch { /* */ } }); await clickText(page, /^\s*(فاتورة|إيصال|Receipt|Reçu)\s*$/); } },
  receiptVoid: { title: 'Voided sale receipt 80 mm', hash: 'sales', prep: async (page, ctx) => { await ctx.makeSale(true); await ctx.open('sales'); await page.evaluate(() => { try { localStorage.setItem('fpReceiptW', '80'); } catch { /* */ } }); await clickText(page, /^\s*(فاتورة|إيصال|Receipt|Reçu)\s*$/); } },
  stmt: { title: 'Customer statement (A4)', hash: 'cust', prep: async (page, ctx) => { await ctx.open('cust'); await clickText(page, /كشف الحساب|Statement|Relevé/); await page.waitForTimeout(900); await printBtn(page); } },
  day: { title: 'Daily station report (A4)', hash: 'day', prep: async (page, ctx) => { await ctx.open('day'); await page.evaluate((d) => { const i = document.querySelector('main#main input[type=date]'); i.value = d; i.dispatchEvent(new Event('change', { bubbles: true })); }, yesterday()); await clickText(page, /^\s*(عرض|Run|Show|Afficher)\s*$/); await page.waitForTimeout(900); await printBtn(page); } },
  jbook: { title: 'Journal book, several pages (A4)', hash: 'jbook', prep: async (page, ctx) => { await ctx.open('jbook'); await clickText(page, /^\s*(عرض|Run|Show|Afficher)\s*$/); await page.waitForTimeout(1200); await printBtn(page); } },
  box: { title: 'Cash & bank boxes (A4)', hash: 'box', prep: async (page, ctx) => { await ctx.open('box'); await clickText(page, /^\s*(عرض|Run|Show|Afficher)\s*$/); await page.waitForTimeout(900); await printBtn(page); } },
  col: { title: 'Collections follow-up (A4)', hash: 'col', prep: async (page, ctx) => { await ctx.open('col'); await page.waitForTimeout(600); await printBtn(page); } }
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-print-')); const dbPath = path.join(tmp, 'demo.db'); const PW = 'pc-' + Math.random().toString(36).slice(2, 12);
  execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'scripts', 'seed-demo.js'), '--days', DAYS], { env: { ...process.env, DB_PATH: dbPath, DEMO_PASSWORD: PW }, stdio: 'ignore' });
  const { createApp } = require('../src/server'); const { server, db } = createApp({ dbPath, mailer: { send: async () => {} } });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}`;
  const { chromium } = require('playwright'); const exe = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const results = [];
  try {
    for (const key of WANT) {
      const spec = DOCS[key]; if (!spec) { console.error('unknown document: ' + key); continue; }
      const ctxB = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' }); const page = await ctxB.newPage();
      const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await page.addInitScript((lang) => { try { localStorage.setItem('prefs', JSON.stringify({ lang })); } catch { /* */ }
        window.__printed = 0; window.print = () => { window.__printed++; window.__printClass = document.body.className; window.__printAt = performance.now(); }; }, LANG);
      await page.request.post(base + '/api/auth/login', { data: { email: 'demo@fuelpro.demo', password: PW } });
      await page.goto(base + '/#dash'); await page.waitForSelector('main#main');
      const ctx = {
        open: async (k) => { await page.evaluate(() => { const m = document.getElementById('main'); if (m) m.id = 'old-main'; }); await page.evaluate((k) => { location.hash = '#' + k; }, k); await page.waitForSelector('main#main', { timeout: 30000 }); await page.waitForTimeout(500); },
        makeSale: async (andVoid) => page.evaluate(async (andVoid) => {   /* a sale today on the demo station, so the sales list has a receipt to print */
          const me = await (await fetch('/api/me')).json(); const sid = (me.stations || [])[0]?.id || me.station_id || 1;
          const pumps = await (await fetch(`/api/stations/${sid}/pumps`)).json(); const p = (pumps.rows || pumps)[0];
          const r = await fetch(`/api/stations/${sid}/sales`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: 'pc-' + Date.now(), pump_id: p.id, quantity_ml: 42500, pay_type: 'cash' }) });
          const sale = await r.json();
          if (andVoid) await fetch(`/api/stations/${sid}/sales/${sale.id || (sale.sale && sale.sale.id)}/void`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'print-check: demo void' }) });
          return r.status; }, andVoid)
      };
      const t0 = Date.now(); let res = { key, title: spec.title };
      try {
        await spec.prep(page, ctx);
        await page.waitForFunction(() => window.__printed > 0, null, { timeout: 15000 });
        res.ms = Math.round(await page.evaluate(() => window.__printAt - window.__clickAt));   // from the click on the print button
        await page.evaluate(() => { document.body.className = window.__printClass; });
        await page.emulateMedia({ media: 'print' });
        await page.evaluate(async () => { await document.fonts.ready; });
        /* overflow: anything inside #print reaching past the printable width */
        res.overflow = await page.evaluate(() => {
          const box = document.getElementById('print'); if (!box) return ['no #print'];
          const W = box.getBoundingClientRect(); const out = [];
          for (const el of box.querySelectorAll('*')) { const r = el.getBoundingClientRect(); if (!r.width) continue;
            if (r.right > W.right + 1.5 || r.left < W.left - 1.5) out.push(`${el.tagName}.${String(el.className).slice(0, 24)} ${Math.round(r.left - W.left)}..${Math.round(r.right - W.left)} / ${Math.round(W.width)}`);
            const cs = getComputedStyle(el); if (/(hidden|clip)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 2) out.push(`clipped ${el.tagName}.${String(el.className).slice(0, 24)} ${el.scrollWidth}>${el.clientWidth}`); }
          return out.slice(0, 12); });
        const pdf = path.join(OUT, key + '.pdf');
        await page.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true });
        res.pdf = pdf;
        if (has('pdfinfo')) { const info = execFileSync('pdfinfo', [pdf]).toString(); res.pages = Number((/Pages:\s+(\d+)/.exec(info) || [])[1]); res.size = (/Page size:\s+(.+)/.exec(info) || [])[1]; }
        if (has('pdffonts')) { const f = execFileSync('pdffonts', [pdf]).toString().split('\n').slice(2).filter(Boolean).map(l => l.split(/\s+/)[0]); res.fonts = [...new Set(f.map(n => n.replace(/^[A-Z]{6}\+/, '')))]; }
        if (has('pdftotext')) { const txt = execFileSync('pdftotext', ['-layout', pdf, '-']).toString(); const plain = txt.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ''); res.pageNumbers = /(صفحة|Page|page)\s*\d+\s*(من|of|sur)\s*\d+/.test(plain); res.tofu = (txt.match(/[�□]/g) || []).length; }
        if (has('pdftoppm')) { execFileSync('pdftoppm', ['-r', String(DPI), '-png', pdf, path.join(OUT, key)]); res.png = fs.readdirSync(OUT).filter(n => n.startsWith(key + '-') && n.endsWith('.png')).sort(); }
      } catch (e) { res.error = String(e.message || e).split('\n')[0]; }
      res.errors = errors; res.totalMs = Date.now() - t0; results.push(res);
      await ctxB.close();
    }
  } finally { await browser.close(); await new Promise(r => server.close(r)); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(results, null, 1));
  for (const r of results) console.log(`${r.key.padEnd(10)} ${r.error ? 'ERROR ' + r.error : `${r.pages}p ${r.size || ''} · ${r.ms} ms · page-no ${r.pageNumbers ? 'yes' : 'no'} · overflow ${r.overflow.length} · fonts ${(r.fonts || []).join(', ')}${r.tofu ? ' · TOFU ' + r.tofu : ''}${r.errors.length ? ' · JS ' + r.errors.length : ''}`}`);
  console.log('\nPDF + PNG + report.json in ' + OUT);
})().catch(e => { console.error(e); process.exit(1); });
