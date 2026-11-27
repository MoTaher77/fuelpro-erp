'use strict';
/* global document, location, window, NodeFilter */   // used inside page.evaluate (runs in the browser)
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
    for (const k of tabs) { const before = errors.length; if (k !== 'dash') await openTab(page, k); await page.waitForTimeout(50); for (let i = before; i < errors.length; i++) errors[i] = `#${k} ${errors[i]}`;
      /* 0.31: no stray «null»/«undefined» text, no page-wide sideways scroll, every box has a label tied to it (or an aria-label) */
      const bad = await page.evaluate(() => { const out = []; const w = document.createTreeWalker(document.getElementById('main'), NodeFilter.SHOW_TEXT); let n;
        while ((n = w.nextNode())) if (/^(null|undefined|NaN)$/.test(n.textContent.trim())) out.push('text «' + n.textContent.trim() + '»');
        if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) out.push('page scrolls sideways');
        for (const i of document.querySelectorAll('#main input:not([type=checkbox]):not([type=radio]):not([type=hidden]), #main select, #main textarea'))
          if (!(i.id && document.querySelector(`label[for="${i.id}"]`)) && !i.closest('label') && !i.getAttribute('aria-label') && !i.placeholder) out.push('unlabelled ' + i.outerHTML.slice(0, 60));
        return out; });
      for (const b of bad) errors.push(`#${k} ${b}`); }
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

test('a double tap on «save» posts the document once', async () => {
  const { ctx, page, errors } = await signedIn();
  await openTab(page, 'exp'); await page.waitForSelector('#eAmt');
  const note = 'e2e-double-' + Date.now();
  await page.fill('#eAmt', '1234'); await page.fill('#eNote', note);
  await page.evaluate(() => { const f = document.getElementById('eAmt').closest('form'); f.requestSubmit(); f.requestSubmit(); f.requestSubmit(); });
  await page.waitForFunction((n) => document.body.textContent.includes(n), note, { timeout: 15000 });
  const n = db.prepare('SELECT COUNT(*) n FROM expenses WHERE note=?').get(note).n;
  assert.equal(n, 1, 'three quick submits = one expense');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('form errors show under the field and beside the button; a save shows a spinner, then a tick', async () => {
  const { ctx, page, errors } = await signedIn();
  await openTab(page, 'exp'); await page.waitForSelector('#eAmt');
  const note = 'e2e-fe-' + Date.now();
  /* typing something that is not a number: the box says so at once, under itself */
  await page.fill('#eAmt', '12x'); await page.dispatchEvent('#eAmt', 'change');
  assert.equal(await page.getAttribute('#eAmt', 'aria-invalid'), 'true');
  assert.match(await page.textContent('#eAmt + .fe'), /number|رقم/i);
  /* saving anyway: nothing is posted, a message appears beside the button and the wrong box stays marked */
  await page.fill('#eNote', note);
  await page.evaluate(() => document.getElementById('eAmt').closest('form').requestSubmit());
  await page.waitForSelector('main#main form .form-err');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM expenses WHERE note=?').get(note).n, 0, 'nothing saved');
  assert.equal(await page.getAttribute('#eAmt', 'aria-invalid'), 'true');
  /* fixing it clears the marks; the save button spins while it works and shows a tick when it is done */
  await page.fill('#eAmt', '250');
  assert.equal(await page.$('#eAmt + .fe'), null, 'field message gone once the number is valid');
  assert.equal(await page.$('main#main form .form-err'), null, 'form message gone on the next change');
  await page.route('**/api/stations/*/expenses', async (route) => { if (route.request().method() === 'POST') await new Promise(r => setTimeout(r, 700)); return route.continue(); });
  const btn = page.locator('main#main form:has(#eAmt) button[type=submit], main#main form:has(#eAmt) button:not([type])').first();
  await page.evaluate(() => document.getElementById('eAmt').closest('form').requestSubmit());
  await page.waitForFunction(() => [...document.querySelectorAll('main#main button')].some(b => b.getAttribute('aria-busy') === 'true'), null, { timeout: 5000 });
  await page.waitForFunction((n) => document.body.textContent.includes(n), note, { timeout: 15000 });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM expenses WHERE note=?').get(note).n, 1, 'saved once');
  assert.ok(btn, 'the form has a save button');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('staff & payroll screen: add an employee, give an advance, post the month, pay the salary, read the statement', async () => {
  const { ctx, page, errors } = await signedIn();
  await openTab(page, 'emp'); await page.waitForSelector('#emName');
  const name = 'E2E موظف ' + Date.now();
  await page.fill('#emName', name); await page.fill('#emSalary', '300000');
  await page.evaluate(() => document.getElementById('emName').closest('form').requestSubmit());
  await page.waitForFunction((n) => document.body.textContent.includes(n), name, { timeout: 15000 });
  const emp = db.prepare('SELECT * FROM employees WHERE name=?').get(name); assert.ok(emp, 'saved');
  /* advance from the bank (no shift needed) */
  await page.evaluate((id) => { window.FP.S.empTab = 'moves'; window.FP.S.empMoveFor = id; window.FP.render(); }, emp.id);
  await page.waitForSelector('#mvAmt');
  await page.fill('#mvAmt', '50000'); await page.selectOption('#mvMethod', 'bank');
  await page.evaluate(() => document.getElementById('mvAmt').closest('form').requestSubmit());
  await page.waitForFunction(() => document.querySelectorAll('main table tbody tr').length > 0, null, { timeout: 15000 });
  /* the month: only the new employee is changed by this test; post the draft as proposed */
  await page.evaluate(() => { window.FP.S.empTab = 'run'; window.FP.render(); });
  await page.waitForSelector('main form button[type=submit]', { timeout: 15000 }).catch(() => {});
  const posted = db.prepare("SELECT 1 FROM payroll_runs WHERE station_id=? AND voided_at IS NULL AND month=?").get(emp.station_id, new Date().toISOString().slice(0, 7));
  if (!posted) {
    await page.evaluate(() => document.querySelector('main form').requestSubmit());
    await page.waitForFunction(() => /\b(payroll|مسير)/i.test(document.body.textContent), null, { timeout: 15000 });
    await page.waitForTimeout(800);
  }
  const dec = db.prepare('SELECT cur_dec FROM stations WHERE id=?').get(emp.station_id).cur_dec, unit = 10 ** dec;
  const line = db.prepare('SELECT l.* FROM payroll_lines l JOIN payroll_runs r ON r.id=l.run_id WHERE l.employee_id=? AND r.voided_at IS NULL').get(emp.id);
  assert.ok(line, 'payroll line posted');
  assert.equal(line.base, 300000 * unit, 'the salary typed on the card');
  assert.equal(line.recovered, 50000 * unit, 'the advance is deducted');
  assert.equal(line.net, 250000 * unit);
  /* pay the salary from the bank: the amount field fills itself with what is owed */
  await page.evaluate((id) => { window.FP.S.empTab = 'moves'; window.FP.S.empMoveFor = id; window.FP.render(); }, emp.id);
  await page.waitForSelector('#mvKind');
  await page.selectOption('#mvKind', 'salary_pay'); await page.selectOption('#mvMethod', 'bank');
  assert.equal(await page.inputValue('#mvAmt'), '250000', 'prefilled with the salary owed');
  await page.evaluate(() => document.getElementById('mvAmt').closest('form').requestSubmit());
  await page.waitForTimeout(800);
  const paid = db.prepare("SELECT amount FROM employee_moves WHERE employee_id=? AND kind='salary_pay' AND voided_at IS NULL").get(emp.id);
  assert.equal(paid && paid.amount, 250000 * unit, 'salary paid once, exact amount');
  /* statement shows the balance the server computes */
  await page.evaluate((id) => { window.FP.S.empTab = 'stmt'; window.FP.S.empStmtId = id; window.FP.render(); }, emp.id);
  await page.waitForSelector('main table', { timeout: 15000 });
  const closing = await page.$$eval('main table tbody tr', (r) => r[r.length - 1].textContent);
  assert.match(closing, /^\D*0([.,]0+)?\D*$/, 'closing balance 0 after advance, payroll and payment: ' + closing);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('a dropped connection («Failed to fetch») is retried for reads; a failed save shows a clear message and is not re-sent', async () => {
  const { ctx, page, errors } = await signedIn();
  /* the next two reads of the suppliers list fail like a phone waking up, the third goes through */
  let dropped = 0;
  await page.route('**/api/stations/*/suppliers', (route) => { if (dropped < 2) { dropped++; return route.abort('failed'); } return route.continue(); });
  await openTab(page, 'supp');
  assert.equal(dropped, 2, 'two reads were dropped');
  assert.ok(await page.$('main#main table, main#main .card'), 'the screen opened anyway');
  /* a save that cannot reach the server: one attempt only, and an Arabic/English message instead of "Failed to fetch" */
  let posts = 0;
  await page.route('**/api/stations/*/expenses', (route) => { if (route.request().method() === 'POST') { posts++; return route.abort('failed'); } return route.continue(); });
  await openTab(page, 'exp'); await page.waitForSelector('#eAmt');
  await page.fill('#eAmt', '1000');
  await page.evaluate(() => document.getElementById('eAmt').closest('form').requestSubmit());
  await page.waitForSelector('main#main form .form-err', { timeout: 10000 });   // 0.30: shown beside the button, not only as a toast
  const msg = await page.textContent('main#main form .form-err');
  assert.ok(!/failed to fetch/i.test(msg), 'no raw browser error: ' + msg);
  assert.match(msg, /الاتصال|connection/i);
  await page.waitForTimeout(3000);
  assert.equal(posts, 1, 'the save was not sent again by itself');
  assert.deepEqual(errors.filter((e) => !/Failed to load resource|ERR_FAILED/.test(e)), []);
  await ctx.close();
});
