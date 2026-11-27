const { chromium } = require('/home/user/fuelpro-erp/node_modules/playwright');
const start = require('./server.js');
(async () => { const s = await start(4180); const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 }); const p = await ctx.newPage();
  for (const fw of ['vanilla', 'react', 'preact', 'svelte', 'solid', 'vue']) for (const mode of ['plain', 'virtual']) {
    await p.goto(`http://127.0.0.1:4180/${fw}/?mode=${mode}&n=${mode === 'plain' ? 300 : 10000}`); await p.waitForFunction(() => window.__rowsVisible);
    await p.screenshot({ path: `shots/${fw}-${mode}.png` }); }
  await p.goto('http://127.0.0.1:4180/vanilla/?mode=plain&n=5000'); await p.waitForFunction(() => window.__rowsVisible);
  let t = Date.now(); await p.emulateMedia({ media: 'print' }); await p.pdf({ path: 'shots/vanilla-5000-print.pdf', format: 'A4' }); console.log('pdf 5000 rows ms', Date.now() - t);
  await b.close(); s.close(); })();
