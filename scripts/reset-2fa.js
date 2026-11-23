'use strict';
/* Support tool: turn off two-factor authentication for an account that lost its phone AND its recovery codes.
   Verify the person's identity out of band first.  Usage: node scripts/reset-2fa.js user@example.com */
const path = require('node:path');
const { openDb, tx } = require('../src/db');
const email = process.argv[2];
if (!email) { console.error('Usage: node scripts/reset-2fa.js <email>'); process.exit(1); }
const db = openDb(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'fuelpro.db'));
const u = db.prepare('SELECT id, org_id, totp_enabled FROM users WHERE email=?').get(email);
if (!u) { console.error('No such user'); process.exit(1); }
tx(db, () => {
  db.prepare('UPDATE users SET totp_enabled=0, totp_secret=NULL, totp_last_step=0 WHERE id=?').run(u.id);
  db.prepare('DELETE FROM recovery_codes WHERE user_id=?').run(u.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
  db.prepare("INSERT INTO audit(org_id,user_id,action,entity,entity_id,detail) VALUES(?,?,?,?,?,?)").run(u.org_id, u.id, 'user.2fa.support_reset', 'user', u.id, JSON.stringify({ by: 'support-cli' }));
});
console.log(u.totp_enabled ? 'Two-factor authentication turned off; all sessions signed out.' : 'Two-factor was already off.');
