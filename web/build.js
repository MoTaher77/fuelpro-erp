'use strict';
/* Build the FuelPro Artifact edition (ADR-20) into web/dist/:
     fuelpro-core.js  the unchanged src/*.js wrapped as browser modules + the Node shims + the sql.js adapter
     seed.js          a freshly generated DEMO database (gzip + base64), used until the page has saved data
     app files        public/*.js + app.css copied as they are (service-worker registration removed)
     index.html       the page: loads sql.js, the core, runtime.js, then the app
   Usage:  DEMO_PASSWORD=<pw> node web/build.js [--days 120]
   The demo password is never written to the output in clear text (only its scrypt hash inside the DB).
   Real data never enters the build: the seed is made by scripts/seed-demo.js, which refuses non-demo databases. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const OUT = path.resolve(arg_('out', path.join(__dirname, 'dist')));
const SEED_DB = arg_('seed-db', null);   // an existing database to start from instead of a fresh demo (owner's OK required for real data)
function arg_(k, d) { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; }
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const days = String(Number(arg('days', 120)) || 120);
if (!SEED_DB && !process.env.DEMO_PASSWORD) { console.error('Set DEMO_PASSWORD (the sign-in password for the demo users).'); process.exit(1); }

fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });

/* 1) core bundle (web/bundle.js) */
const core = require('./bundle').bundleCore();
fs.writeFileSync(path.join(OUT, 'fuelpro-core.js'), core);

/* 2) demo seed made by the project's own seeder in a temp dir, then compacted for the page */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-artifact-'));
const dbPath = path.join(tmp, 'demo.db'), clean = path.join(tmp, 'seed.db');
if (SEED_DB) fs.copyFileSync(path.resolve(SEED_DB), dbPath);
else execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(ROOT, 'scripts', 'seed-demo.js'), '--days', days],
  { env: { ...process.env, DB_PATH: dbPath, BACKUP_AUTO: '0' }, stdio: ['ignore', 'ignore', 'inherit'] });
require('../src/db').openDb(dbPath).close();   // bring the seed to the current schema (and its statistics) before shipping
{ const d = new DatabaseSync(dbPath); d.exec('DELETE FROM sessions'); d.exec(`VACUUM INTO '${clean.replace(/'/g, "''")}'`); d.close(); }
{ const d = new DatabaseSync(clean); d.exec('PRAGMA journal_mode=DELETE'); d.close(); }
const raw = fs.readFileSync(clean), gz = zlib.gzipSync(raw, { level: 9 });
fs.writeFileSync(path.join(OUT, 'seed.js'), `/* ${SEED_DB ? 'starting database: ' + path.basename(SEED_DB) : 'DEMO data (scripts/seed-demo.js --days ' + days + ')'} */\nwindow.__FP_SEED_GZ_B64=${JSON.stringify(gz.toString('base64'))};\n`);
fs.rmSync(tmp, { recursive: true, force: true });

/* 3) the existing front end, unchanged except for the service worker (a page inside claude.ai cannot register one) */
const appFiles = ['qr.js', 'xlsx.js', 'i18n-erp.js', 'app.js', 'erp.js', 'stmt-pdf.js', 'books-ui.js', 'more-ui.js', 'analytics-ui.js', 'bank-ui.js', 'alerts-ui.js', 'wizard-ui.js', 'payroll-ui.js', 'app.css', 'ui-2.css'];
for (const f of appFiles) {
  let t = fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  if (f === 'app.js') { const before = t; t = t.replace(/if \('serviceWorker' in navigator[^\n]*\n/, '/* service worker: not used in the Artifact edition */\n'); if (t === before) throw new Error('service-worker line not found in app.js'); }
  if (f === 'bank-ui.js') { const before = t; t = t.replace(/if \(!confirm\(/g, 'if (!await window.__fpConfirm('); if (t === before) throw new Error('confirm() not found in bank-ui.js'); }
  fs.writeFileSync(path.join(OUT, f), t);
}
fs.copyFileSync(path.join(__dirname, 'runtime.js'), path.join(OUT, 'runtime.js'));
/* the WebAssembly engine's binary must match the sql.js version runtime.js loads (1.10.3); without it the page uses the JS build */
{ let wasm = null; try { const pj = require.resolve('sql.js/package.json'); if (require(pj).version === '1.10.3') wasm = path.join(path.dirname(pj), 'dist', 'sql-wasm.wasm'); } catch { /* not installed */ }
  if (wasm && fs.existsSync(wasm)) fs.copyFileSync(wasm, path.join(OUT, 'sql-wasm.wasm'));
  else console.warn('sql.js@1.10.3 not installed: the page will use the slower JavaScript engine (npm i --no-save --no-package-lock sql.js@1.10.3)'); }
fs.writeFileSync(path.join(OUT, 'index.html'), fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8').replace('__APP_FILES__', JSON.stringify(appFiles.filter(f => f.endsWith('.js')))).replace('__BUILD__', JSON.stringify(require('../package.json').version))
  .replace('window.__FP_BUILD = ', SEED_DB ? 'window.__FP_NO_REGISTER = true; window.__FP_STATION = true; window.__FP_BUILD = ' : 'window.__FP_BUILD = ')
  .replace('<title>FuelPro تجريبي</title>', SEED_DB ? '<title>FuelPro المحطة</title>' : '<title>FuelPro تجريبي</title>')
  .replace('نسخة تجريبية تعمل بالكود الحقيقي للنظام وبيانات تجريبية، وتُحفظ عملياتك في تخزين هذه الصفحة.', SEED_DB ? 'نسخة من بيانات المحطة تعمل بالكود الحقيقي للنظام، وتُحفظ عملياتك في تخزين هذه الصفحة. لا تشاركها مع أحد.' : 'نسخة تجريبية تعمل بالكود الحقيقي للنظام وبيانات تجريبية، وتُحفظ عملياتك في تخزين هذه الصفحة.'));

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
fs.writeFileSync(path.join(OUT, 'build-info.json'), JSON.stringify({ version: pkg.version, built: new Date().toISOString(), seed_days: Number(days), seed_bytes: raw.length, seed_gz: gz.length, modules: fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.js')).length }, null, 2));
console.log(`web/dist ready: core ${(core.length / 1024).toFixed(0)} KB, seed ${(raw.length / 1048576).toFixed(1)} MB (${(gz.length / 1024).toFixed(0)} KB gz), version ${pkg.version}`);
