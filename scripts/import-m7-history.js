'use strict';
/* Carry the old M7 system's history into an EXISTING FuelPro database, without duplicates (src/m7archive.js):
   edit copies, approvals, closing runs and the sign-in log -> audit; old users -> users (inactive); exchange-rate history -> exchange_rates;
   saved period results -> m7_results («الأرباح الشهرية»); monthly store values -> m7_stock_month («الجرد الشهري»).
   Usage:
     node scripts/import-m7-history.js --dmp M7.DMP --db data/fuelpro.db [--station 1] [--dry-run]
     node scripts/import-m7-history.js --src m7.sqlite --db data/fuelpro.db [--station 1] [--dry-run]
   Safe to run again: rows already carried over are skipped. Journals and stock are never touched.
   Stop the FuelPro server and take a backup (npm run backup) before running it on the live database. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { openDb } = require('../src/db');
const M7 = require('../src/m7archive');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes('--' + k);
let SRC = arg('src'); const DMP = arg('dmp'), OUT = arg('db');
if ((!SRC && !DMP) || !OUT) { console.error('Usage: node scripts/import-m7-history.js (--dmp file.DMP | --src m7.sqlite) --db fuelpro.db [--station id] [--dry-run]'); process.exit(1); }
if (!fs.existsSync(OUT)) { console.error(`${OUT} does not exist`); process.exit(1); }
let tmp = null;
if (DMP) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'm7-')); SRC = path.join(tmp, 'm7.sqlite');
  execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, 'exp2sqlite.js'), DMP, SRC], { stdio: 'inherit' });
}
const src = new DatabaseSync(SRC, { readOnly: true });
const db = openDb(OUT);
const st = arg('station') ? db.prepare('SELECT * FROM stations WHERE id=?').get(Number(arg('station'))) : db.prepare('SELECT * FROM stations ORDER BY id LIMIT 1').get();
if (!st) { console.error('Station not found'); process.exit(1); }
const owner = db.prepare("SELECT id FROM users WHERE org_id=? AND role='owner' ORDER BY id LIMIT 1").get(st.org_id);
try {
  const dry = flag('dry-run');
  if (dry) { db.exec('BEGIN IMMEDIATE'); db.__inTx = true; }           // load() then runs inside this transaction, which is rolled back
  let counts;
  try { counts = M7.load(db, src, { orgId: st.org_id, stationId: st.id, userId: owner ? owner.id : null }); }
  finally { if (dry) { db.exec('ROLLBACK'); db.__inTx = false; } }
  console.log(`Station #${st.id}${dry ? ' (dry run — nothing saved)' : ''}`);
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(18)} source ${String(v.source).padStart(6)}   added ${String(v.added).padStart(6)}`);
} finally {
  db.close(); src.close();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
}
