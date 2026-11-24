// @ts-check
'use strict';
/* Read-only check of a FuelPro database file: schema version, SQLite integrity, and the books' own self-check
   (every posted journal balances; stock, receivables and payables agree with the ledger) for every organisation.
   Usage: node scripts/check-books.js <path/to/fuelpro.db>     exit 0 = all good, 1 = something failed.
   It never writes (the file is opened read-only, so no migration runs either); safe on a copy or on the server's file. */
const { DatabaseSync } = require('node:sqlite');
const file = process.argv[2];
if (!file) { console.error('usage: node scripts/check-books.js <db file>'); process.exit(2); }
const db = new DatabaseSync(file, { readOnly: true });
const n = (sql, ...a) => Number(Object.values(/** @type {object} */ (db.prepare(sql).get(...a)))[0]);
let bad = 0;
const say = (ok, msg) => { console.log((ok ? 'OK   ' : 'FAIL ') + msg); if (!ok) bad++; };
say(db.prepare('PRAGMA integrity_check').get().integrity_check === 'ok', 'SQLite integrity_check');
console.log(`     schema version ${n('PRAGMA user_version')} · orgs ${n('SELECT COUNT(*) FROM orgs')} · stations ${n('SELECT COUNT(*) FROM stations')} · journals ${n('SELECT COUNT(*) FROM journals')} · sales ${n('SELECT COUNT(*) FROM sales')}`);
const O = require('../src/ops');
for (const org of db.prepare('SELECT id, name FROM orgs ORDER BY id').all()) {
  const r = O.integrity(db, { id: 0, org_id: org.id, role: 'owner' });
  for (const c of r.checks) say(c.ok, `org ${org.id}: ${c.name}`);
}
db.close();
console.log(bad ? `\n${bad} check(s) FAILED` : '\nall checks passed');
process.exit(bad ? 1 : 0);
