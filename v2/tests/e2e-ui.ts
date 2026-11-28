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
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errors.push(name + ': ' + m.text()); });   // 4xx = the rule the test triggers on purpose
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
    // stock & deliveries
    await page.click('[data-tab=stock]'); await page.waitForSelector('#d-qty');
    await page.fill('#s-name', 'مورد تجريبي'); await page.fill('#s-open', '1500'); await page.click('text=إضافة'); await page.waitForSelector('td:has-text("مورد تجريبي")');
    await page.fill('#d-qty', '5000'); await page.fill('#d-cost', '512.5'); await page.selectOption('#d-pay', 'credit');
    await page.selectOption('#d-sup', { label: 'مورد تجريبي' }); await page.click('text=تسجيل التوريد'); await page.waitForSelector('text=آخر التوريدات');
    // the first delivery is saved and the screen redrawn (empty form) before the next entry
    await page.waitForSelector('.toast:has-text("سُجّل التوريد")');
    await page.waitForFunction(() => { const q = document.querySelector<HTMLInputElement>('#d-qty'); return !!q && q.value === '' && !document.querySelector('button.busy'); });
    await page.fill('#d-qty', '30000'); await page.fill('#d-cost', '500'); await page.selectOption('#d-pay', 'cash'); await page.click('text=تسجيل التوريد');
    await page.waitForSelector('.toast.err'); const capErr = await page.textContent('.toast.err');
    if (!/المساحة الفارغة/.test(capErr || '')) errors.push('capacity error text: ' + capErr);
    await page.fill('#c-qty', '14900'); await page.click('text=تسجيل الجرد');
    await page.waitForSelector('.toast:has-text("عجز")');
    await page.screenshot({ path: `${out}/6-stock.png`, fullPage: true });
    // customers & suppliers
    await page.click('[data-tab=parties]'); await page.waitForSelector('#n-name');
    await page.fill('#n-name', 'عميل تجريبي'); await page.fill('#n-open', '5000'); await page.click('text=إضافة عميل');
    await page.waitForSelector('#p-amt');
    await page.fill('#p-amt', '1200'); await page.selectOption('#p-method', 'bank'); await page.click('text=تسجيل السداد');
    await page.waitForSelector('.toast:has-text("سُجّل السداد")');
    await page.waitForFunction(() => !document.querySelector('button.busy'));
    await page.fill('#p-amt', '999999'); await page.selectOption('#p-method', 'bank'); await page.click('text=تسجيل السداد');
    await page.waitForSelector('.toast.err:has-text("أكبر من الرصيد")');
    await page.fill('#sp-amt', '1000'); await page.click('text=سداد للمورد'); await page.waitForSelector('.toast:has-text("المتبقي للمورد")');
    await page.waitForFunction(() => !document.querySelector('button.busy'));
    await page.click('text=كشف الحساب'); await page.waitForSelector('text=كشف حساب: عميل تجريبي');
    await page.waitForSelector('dd.strong');
    const bal = await page.textContent('dd.strong');
    if ((bal || '').trim() !== '3,800') errors.push('statement balance ' + bal);
    page.once('dialog', (d) => d.accept('سداد مكرر'));
    await page.click('section.wide:has(h2:has-text("كشف حساب")) .btn.link:has-text("إلغاء")'); await page.waitForSelector('.toast:has-text("أُلغي السداد")');
    await page.waitForFunction(() => !document.querySelector('button.busy'));
    await page.screenshot({ path: `${out}/7-parties.png`, fullPage: true });
    // finance
    const idle = () => page.waitForFunction(() => !document.querySelector('button.busy'));
    await page.click('[data-tab=finance]'); await page.waitForSelector('#e-gross');
    await page.fill('#e-gross', '1500'); await page.selectOption('#e-method', 'bank'); await page.click('text=تسجيل المصروف');
    await page.waitForSelector('.toast:has-text("سُجّل المصروف")'); await idle();
    await page.selectOption('#v-kind', 'receipt'); await page.selectOption('#v-acct', { label: '1100 — ذمم العملاء' });
    await page.waitForSelector('#v-party option', { state: 'attached' }); await page.fill('#v-amt', '1000'); await page.click('text=حفظ السند');
    await page.waitForSelector('.toast:has-text("حُفظ السند")'); await idle();
    await page.fill('#j-amt', '250'); await page.fill('#j-memo', 'قيد تجربة'); await page.click('text=حفظ القيد');
    await page.waitForSelector('.toast:has-text("مسودة")'); await idle();
    await page.click('section:has(h2:has-text("قيد يدوي")) button:has-text("ترحيل")'); await page.waitForSelector('.toast:has-text("رُحّل القيد")'); await idle();
    const tbRow = await page.textContent('section:has(h2:has-text("ميزان المراجعة")) tbody tr:last-child');
    if (!/متوازن ✓/.test(tbRow || '')) errors.push('trial balance not balanced: ' + tbRow);
    await page.screenshot({ path: `${out}/8-finance.png`, fullPage: true });
  } else {
    await page.screenshot({ path: `${out}/4-phone.png`, fullPage: true });
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    if (sideways) errors.push('phone: page scrolls sideways');
  }
  await page.close();
}
const dl = await ctx.db.selectFrom('deliveries').selectAll().execute();
console.log('deliveries', dl.map((d) => [d.quantity_ml, d.cost_e4, d.net, d.pay_type, d.ref]));
const adj = await ctx.db.selectFrom('adjustments').selectAll().execute();
console.log('counts', adj.map((a) => [a.before_ml, a.after_ml]));
const pm = await ctx.db.selectFrom('payments').selectAll().execute();
console.log('payments', pm.map((p) => [p.amount, p.method, p.voided_at ? 'void' : 'ok']));
const spm = await ctx.db.selectFrom('supplier_payments').selectAll().execute();
console.log('supplier payments', spm.map((p) => [p.amount, p.method]));
const ex = await ctx.db.selectFrom('expenses').selectAll().execute(), vo = await ctx.db.selectFrom('vouchers').selectAll().execute();
const mj = await ctx.db.selectFrom('journals').selectAll().where('source', '=', 'manual').execute();
console.log('finance', ex.map((e) => [e.gross, e.method]), vo.map((v) => [v.kind, v.amount, v.ref_no]), mj.map((j) => j.status));
const tb = await ctx.db.selectFrom('sales').selectAll().execute();
console.log('sales rows', tb.length, 'gross', tb.map((s) => s.gross), 'voided', tb.filter((s) => s.voided_at).length);
const sh = await ctx.db.selectFrom('shifts').selectAll().execute();
console.log('shift', sh.map((s) => ({ status: s.status, expected: s.expected_cash, counted: s.counted_cash, variance: s.variance })));
console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
await browser.close(); srv.close(); await ctx.close();
if (errors.length) process.exit(1);
