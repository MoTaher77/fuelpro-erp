// @ts-check
'use strict';
/* A new, EMPTY organisation with its own owner account — for a trial user, a demo for a customer, or a second company.
   It sees nothing of any other organisation (every query is scoped by org). Works even when REGISTRATION=first|closed.
   Usage (on the VPS):
     sudo -u fuelpro node /opt/fuelpro/scripts/new-org.js --db /var/lib/fuelpro/fuelpro.db --email demo@example.com \
          [--org "منشأة تجريبية"] [--name "مستخدم تجريبي"] [--station "محطة تجريبية"] [--currency YER] [--tz Asia/Aden]
   The password is random and printed ONCE on this screen; the user can change it after signing in. */
const crypto = require('node:crypto');
const path = require('node:path');
const { openDb } = require('../src/db');
const S = require('../src/services');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const dbPath = arg('db', process.env.DB_PATH || '');
const email = String(arg('email', '')).trim().toLowerCase();
if (!dbPath || !email) { console.error('usage: node scripts/new-org.js --db <fuelpro.db> --email <email> [--org name] [--name user] [--station name] [--currency YER] [--tz Asia/Aden]'); process.exit(2); }
const db = openDb(path.resolve(dbPath));
if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) { console.error(`${email} already has an account`); process.exit(1); }
const password = 'Fp-' + crypto.randomBytes(9).toString('base64url');
const r = S.registerOrg(db, {
  org_name: arg('org', 'منشأة تجريبية'), name: arg('name', 'مستخدم تجريبي'), email, password,
  station: { name: arg('station', 'محطة تجريبية'), currency: arg('currency', 'YER'), timezone: arg('tz', 'Asia/Aden') }
}, 'cli');
db.close();
console.log(`\n  new empty organisation #${r.org_id} (station #${r.station_id})\n  البريد: ${email}\n  كلمة المرور: ${password}\n`);
