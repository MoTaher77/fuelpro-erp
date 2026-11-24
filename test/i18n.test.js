'use strict';
/* Every action the server writes to the audit log has a label in the three languages (the audit screen showed raw codes such as
   "voucher.payment" before 0.28.0). Reads the source: static audit(...) calls, the two built from a kind, and voidRow's "<table>.void". */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const code = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
const ui = ['app.js', 'i18n-erp.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8')).join('\n');

test('every audit action has an Arabic/English/French label for the audit screen', () => {
  const actions = new Set();
  for (const m of code.matchAll(/audit\(db, [a-z]+, [^,]+, '([a-z_.0-9]+)'/g)) actions.add(m[1]);
  for (const m of code.matchAll(/voidRow\(db, user, sid, '([a-z_]+)', id, reason/g)) actions.add(m[1] + '.void');
  for (const k of ['receipt', 'payment']) actions.add('voucher.' + k);          // books.js: 'voucher.' + kind
  for (const k of ['withdrawal', 'deposit']) actions.add('cash.' + k);          // ops.js: 'cash.' + kind
  for (const k of ['advance', 'salary_pay']) actions.add('employee.' + k);      // payroll.js: 'employee.' + kind
  for (const a of [...actions]) if (a.endsWith('.')) actions.delete(a);
  assert.ok(actions.size > 40, 'found the audit calls: ' + actions.size);
  const missing = [...actions].filter((a) => !new RegExp(`'au\\.${a.replace(/\./g, '\\.')}':\\s*\\[\\s*'[^']+',\\s*'[^']+',\\s*["'][^"']+["']\\s*\\]`).test(ui));
  assert.deepEqual(missing, [], 'add these keys to public/app.js (au.<action>: [ar, en, fr])');
});
