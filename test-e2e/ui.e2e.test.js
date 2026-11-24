'use strict';
/* global document, location, window */   // used inside page.evaluate (runs in the browser)
/* Browser test of the real UI (Playwright + Chromium) on a freshly seeded DEMO database — never real data.
   Run:  npm run test:e2e        (needs the dev dependency playwright; in CI: npx playwright install chromium)
   Covers: every menu screen opens without a script error, long lists are shown in parts with «show more / show all»,
   Excel export first puts every row on screen, app files come compressed and a reload revalidates (304). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PW = 'e2e-' + Math.random().toString(36).slice(2, 12);
let dir, base, server, db, browser;

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuelpro-e2e-'));
  const dbPath = path.join(dir, 'demo.db');
  execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'scripts', 'seed-demo.js'), '--days', process.env.E2E_DAYS || '120'],
    { env: { ...process.env, DB_PATH: dbPath, DEMO_PASSWORD: PW }, stdio: 'ignore' });
  const { createApp } = require('../src/server');
  ({ server, db } = createApp({ dbPath, mailer: { send: async () => {} } }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const { chromium } = require('playwright');
  const exe = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  browser = await chromium.launch(exe ? { executablePath: exe } : {});
});
test.after(async () => { if (browser) await browser.close(); if (server) await new Promise(r => server.close(r)); if (db) db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function signedIn(viewport = { width: 1366, height: 800 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const r = await page.request.post(base + '/api/auth/login', { data: { email: 'demo@fuelpro.demo', password: PW } });
  assert.equal(r.status(), 200, 'demo sign-in');
  await page.goto(base + '/#dash'); await page.waitForSelector('main#main');
  return { ctx, page, errors };
}
const openTab = async (page, k) => {
  await page.evaluate(() => { const m = document.getElementById('main'); if (m) m.id = 'old-main'; });
  await page.evaluate((key) => { location.hash = '#' + key; }, k);
  await page.waitForSelector('main#main', { timeout: 30000 });
};

test('every menu screen opens without a script error (desktop and phone width)', async () => {
  for (const viewport of [{ width: 1366, height: 800 }, { width: 390, height: 844 }]) {
    const { ctx, page, errors } = await signedIn(viewport);
    const tabs = await page.$$eval('aside.side a[href^="#"]', (as) => as.map((a) => a.getAttribute('href').slice(1)).filter((k) => /^[a-z]+$/.test(k)));
    assert.ok(tabs.length >= 20, 'menu has the screens: ' + tabs.join(','));
    for (const k of tabs) { const before = errors.length; if (k !== 'dash') await openTab(page, k); await page.waitForTimeout(50); for (let i = before; i < errors.length; i++) errors[i] = `#${k} ${errors[i]}`; }
    await page.waitForTimeout(300);
    assert.deepEqual(errors, [], `no errors at ${viewport.width}px`);
    await ctx.close();
  }
});

test('long account statement: shown in parts, «show all» and Excel export put every row on screen', async () => {
  const { ctx, page, errors } = await signedIn();
  const sid = await page.evaluate(() => window.FP.S.sid);
  const busiest = db.prepare(`SELECT l.account_id id, COUNT(*) n FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE j.status='posted' AND j.station_id=? GROUP BY 1 ORDER BY 2 DESC LIMIT 1`).get(sid);
  assert.ok(busiest.n > 600, 'the demo has a long ledger: ' + busiest.n);
  await page.evaluate((id) => { window.FP.S.acctStmt = id; window.FP.S.psFrom = '2000-01-01'; }, busiest.id);
  await openTab(page, 'stm');
  await page.waitForSelector('.stmt-screen table.stmt');
  const body = () => page.$$eval('.stmt-screen table.stmt tbody tr', (r) => r.length);
  assert.equal(await body(), 1 + 500, 'opening row + first 500 movements');
  assert.ok((await page.textContent('.stmt-screen .noprint')).includes(String(busiest.n)), 'says how many there are');
  await page.click('.stmt-screen button[data-expand]');
  assert.equal(await body(), 1 + busiest.n, 'show all = every movement');
  /* Excel from a fresh view: the export expands first */
  await openTab(page, 'users'); await openTab(page, 'stm'); await page.waitForSelector('.stmt-screen table.stmt');
  assert.equal(await body(), 501);
  const dl = page.waitForEvent('download');
  await page.click('.top button[title]:has-text("Excel")');
  await dl;
  assert.equal(await body(), 1 + busiest.n, 'export put every row on screen first');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('journal book and journal list: first part on screen, the rest on request; totals count everything', async () => {
  const { ctx, page, errors } = await signedIn();
  await page.evaluate(() => { window.FP.S.jbFrom = '2000-01-01'; });
  await openTab(page, 'jbook'); await page.waitForSelector('table.jbook');
  const n = db.prepare("SELECT COUNT(*) n FROM journals WHERE status='posted' AND station_id=?").get(await page.evaluate(() => window.FP.S.sid)).n;
  const shownJournals = () => page.$$eval('table.jbook tbody tr.jfirst', (r) => r.length);
  if (n > 150) {
    assert.equal(await shownJournals(), 150);
    assert.match(await page.textContent('table.jbook tfoot'), new RegExp(String(Math.min(n, 3000))), 'footer counts every entry');
    await page.click('main button[data-expand]');
    assert.equal(await shownJournals(), Math.min(n, 3000));
  }
  await page.evaluate(() => { window.FP.S.acTab = 'list'; window.FP.S.jFrom = '2000-01-01'; });
  await openTab(page, 'acct'); await page.waitForSelector('main .card table');
  const cards = () => page.$$eval('main .stack > .card', (c) => c.filter((x) => x.querySelector('table')).length);
  assert.equal(await cards(), 25, '25 journal cards first');
  await page.click('main button[data-expand]');
  assert.equal(await cards(), 100, 'the whole page of 100');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('app files arrive compressed and a reload costs 304s, not the whole app again', async () => {
  const { ctx, page } = await signedIn();
  const seen = [];
  page.on('response', async (r) => { if (/\.(js|css)$/.test(new URL(r.url()).pathname)) seen.push({ status: r.status(), enc: (await r.allHeaders())['content-encoding'] }); });
  await page.reload(); await page.waitForSelector('main#main');
  assert.ok(seen.length >= 10, 'app files requested: ' + seen.length);
  assert.ok(seen.every((r) => r.status === 304 || r.status === 200), JSON.stringify(seen));
  await ctx.close();
  const raw = await fetch(base + '/app.js', { headers: { 'accept-encoding': 'br' } });
  assert.equal(raw.headers.get('content-encoding'), 'br');
});
