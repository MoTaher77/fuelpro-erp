'use strict';
/* Make the development snapshot of the real data for cloud sessions (owner's request, 2026-11-23, ADR-18).
   Usage (on the laptop):  node scripts/dev-snapshot.js [--src data/fuelpro.db] [--out dev-data/fuelpro-snapshot.db]
   A consistent copy (VACUUM INTO) with every sign-in secret removed: password hashes, sessions, reset tokens,
   recovery codes and two-factor secrets. The books, customers and history are kept as they are.
   Nobody can sign in to the snapshot until `node scripts/dev-admin.js` adds a throwaway admin to a working copy. */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const root = path.join(__dirname, '..');
const src = path.resolve(arg('--src', path.join(root, 'data', 'fuelpro.db')));
const out = path.resolve(arg('--out', path.join(root, 'dev-data', 'fuelpro-snapshot.db')));
if (!fs.existsSync(src)) { console.error('source not found: ' + src); process.exit(1); }
fs.mkdirSync(path.dirname(out), { recursive: true });
const tmp = out + '.tmp';
for (const f of [tmp, tmp + '-wal', tmp + '-shm']) fs.rmSync(f, { force: true });

const s = new DatabaseSync(src, { readOnly: true });
s.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`); s.close();

const d = new DatabaseSync(tmp);
const has = (t) => !!d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
d.exec('BEGIN');
for (const t of ['sessions', 'reset_tokens', 'recovery_codes']) if (has(t)) d.exec(`DELETE FROM ${t}`);
d.exec("UPDATE users SET pw_hash='disabled-in-snapshot', totp_secret=NULL, totp_enabled=0, totp_last_step=0");
d.exec('COMMIT');
d.exec('PRAGMA journal_mode=DELETE'); d.exec('VACUUM'); d.close();
for (const f of [out, out + '-wal', out + '-shm']) fs.rmSync(f, { force: true });
fs.renameSync(tmp, out);

const c = new DatabaseSync(out, { readOnly: true });
const n = (q) => c.prepare(q).get().n;
console.log(`snapshot: ${out} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
console.log(`journals ${n('SELECT COUNT(*) n FROM journals')} · sales ${n('SELECT COUNT(*) n FROM sales')} · users ${n('SELECT COUNT(*) n FROM users')} · usable passwords ${n("SELECT COUNT(*) n FROM users WHERE pw_hash<>'disabled-in-snapshot'")} · 2FA ${n('SELECT COUNT(*) n FROM users WHERE totp_secret IS NOT NULL')}`);
c.close();
