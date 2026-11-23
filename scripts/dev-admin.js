'use strict';
/* Cloud development on the real-data snapshot: copy it to a working file and add a throwaway admin.
   Usage:  node scripts/dev-admin.js [--snapshot dev-data/fuelpro-snapshot.db] [--db /tmp/fuelpro-dev.db]
   Then:   DB_PATH=/tmp/fuelpro-dev.db npm start   and sign in as dev@local.test with the printed password.
   The snapshot itself is never modified; the working copy is disposable. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const A = require('../src/auth');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const snap = path.resolve(arg('--snapshot', path.join(__dirname, '..', 'dev-data', 'fuelpro-snapshot.db')));
const db = path.resolve(arg('--db', path.join(os.tmpdir(), 'fuelpro-dev.db')));
if (!fs.existsSync(snap)) { console.error('snapshot not found: ' + snap); process.exit(1); }
if (path.resolve(db) === snap) { console.error('refusing to write into the snapshot'); process.exit(1); }
for (const f of [db, db + '-wal', db + '-shm']) fs.rmSync(f, { force: true });
fs.copyFileSync(snap, db);

const d = new DatabaseSync(db);
const org = (d.prepare("SELECT org_id FROM users WHERE role='owner' ORDER BY id LIMIT 1").get() || d.prepare('SELECT id org_id FROM orgs ORDER BY id LIMIT 1').get()).org_id;
const pw = 'dev-' + crypto.randomBytes(9).toString('base64url');
d.prepare("INSERT INTO users(org_id,email,name,pw_hash,role,active) VALUES(?,?,?,?,'admin',1)").run(org, 'dev@local.test', 'Dev', A.hashPassword(pw));
d.close();
console.log(`working copy: ${db}`);
console.log(`sign in: dev@local.test / ${pw}   (start with DB_PATH=${db})`);
