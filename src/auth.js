'use strict';
const crypto = require('node:crypto');
const { unauthorized, HttpError } = require('./errors');

const SESSION_IDLE_MS = 12 * 3600 * 1000;
const SESSION_MAX_MS = 7 * 24 * 3600 * 1000;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const N = 16384, r = 8, p = 1;
  const h = crypto.scryptSync(pw, salt, 64, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${h.toString('base64')}`;
}
function verifyPassword(pw, stored) {
  try {
    const [alg, N, r, p, salt, hash] = stored.split('$');
    if (alg !== 'scrypt') return false;
    const h = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), 64, { N: +N, r: +r, p: +p });
    const want = Buffer.from(hash, 'base64');
    return want.length === h.length && crypto.timingSafeEqual(want, h);
  } catch { return false; }
}
const DUMMY = hashPassword('dummy-password-for-timing');

function checkPasswordPolicy(pw) {
  if (typeof pw !== 'string' || pw.length < 10) throw new HttpError(400, 'WEAK_PASSWORD', 'Password must be at least 10 characters');
  if (pw.length > 200) throw new HttpError(400, 'WEAK_PASSWORD', 'Password is too long');
  if (/^(.)\1+$/.test(pw)) throw new HttpError(400, 'WEAK_PASSWORD', 'Password is too simple');
}

const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

function createSession(db, userId, ip) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO sessions(id,user_id,created_at,expires_at,ip) VALUES(?,?,?,?,?)').run(sha(token), userId, now, now + SESSION_IDLE_MS, ip || null);
  return token;
}
function loadSession(db, token) {
  if (!token) throw unauthorized();
  const id = sha(token), now = Date.now();
  const s = db.prepare(`SELECT s.id, s.created_at, s.expires_at, u.id uid, u.org_id, u.email, u.name, u.role, u.active, u.totp_enabled
                        FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=?`).get(id);
  if (!s || s.expires_at < now || now - s.created_at > SESSION_MAX_MS || !s.active) {
    if (s) db.prepare('DELETE FROM sessions WHERE id=?').run(id);
    throw unauthorized();
  }
  if (s.expires_at - now < SESSION_IDLE_MS - 60000) db.prepare('UPDATE sessions SET expires_at=? WHERE id=?').run(now + SESSION_IDLE_MS, id);
  return { id: s.uid, org_id: s.org_id, email: s.email, name: s.name, role: s.role, totp: !!s.totp_enabled, sid: id };
}
function destroySession(db, token) { if (token) db.prepare('DELETE FROM sessions WHERE id=?').run(sha(token)); }
function destroyUserSessions(db, userId) { db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId); }

/* login throttling: 5 failures per (ip,email) => 15 min lock. In-memory; use Redis if you run several instances. */
const fails = new Map();
const MAX_FAILS = 5, LOCK_MS = 15 * 60 * 1000;
function throttleKey(ip, email) { return `${ip}|${String(email).toLowerCase()}`; }
function assertNotLocked(ip, email) {
  const f = fails.get(throttleKey(ip, email));
  if (f && f.until > Date.now()) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many failed sign-in attempts. Try again later.');
}
function recordFail(ip, email) {
  const k = throttleKey(ip, email), f = fails.get(k) || { n: 0, until: 0 };
  f.n += 1; if (f.n >= MAX_FAILS) { f.until = Date.now() + LOCK_MS; f.n = 0; }
  fails.set(k, f);
  if (fails.size > 10000) fails.clear();
}
function clearFails(ip, email) { fails.delete(throttleKey(ip, email)); }

/* second-factor failures per account (any IP): 10 => 15 min lock. Stops distributed guessing of 6-digit codes. */
const tfFails = new Map();
function assertTfNotLocked(userId) {
  const f = tfFails.get(userId);
  if (f && f.until > Date.now()) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many failed sign-in attempts. Try again later.');
}
function recordTfFail(userId) {
  const f = tfFails.get(userId) || { n: 0, until: 0 };
  f.n += 1; if (f.n >= 10) { f.until = Date.now() + LOCK_MS; f.n = 0; }
  tfFails.set(userId, f); if (tfFails.size > 10000) tfFails.clear();
}
const clearTfFails = (userId) => tfFails.delete(userId);

/* password-reset requests: 5 per IP and 3 per address per hour */
const resetHits = new Map();
function assertResetAllowed(ip, email) {
  const now = Date.now(), hour = 3600_000;
  for (const [k, max] of [['ip|' + ip, 5], ['em|' + String(email).toLowerCase(), 3]]) {
    const arr = (resetHits.get(k) || []).filter(t => now - t < hour);
    if (arr.length >= max) throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many requests. Try again later.');
    arr.push(now); resetHits.set(k, arr);
  }
  if (resetHits.size > 20000) resetHits.clear();
}

/* Server-side permissions. Hiding buttons in the UI is a convenience only; every route checks these. */
const OPS = ['read', 'sale.create', 'customer.create', 'payment.create', 'shift.open', 'shift.close'];
const PERMS = {
  owner:      new Set(['*']),
  admin:      new Set(['*']),
  manager:    new Set([...OPS, 'report.read', 'audit.read', 'sale.void', 'sale.backdate', 'delivery.create', 'delivery.void', 'expense.create', 'expense.void',
                       'payment.void', 'adjust.create', 'transfer.create', 'transfer.void', 'config.edit', 'price.edit', 'supplier.manage', 'supplier.pay',
                       'customer.edit', 'cash.move', 'shift.approve', 'journal.read', 'voucher.create', 'voucher.void', 'sale.discount', 'bank.reconcile']),
  accountant: new Set(['read', 'report.read', 'audit.read', 'customer.create', 'customer.edit', 'payment.create', 'payment.void', 'expense.create', 'expense.void',
                       'supplier.manage', 'supplier.pay', 'shift.approve', 'journal.read', 'journal.create', 'journal.post', 'journal.reverse', 'period.lock', 'account.edit', 'voucher.create', 'voucher.void', 'bank.reconcile']),
  supervisor: new Set([...OPS, 'report.read', 'sale.void', 'sale.discount', 'delivery.create', 'expense.create', 'adjust.create', 'cash.move']),
  cashier:    new Set(OPS),
  viewer:     new Set(['read', 'report.read'])
};
const ROLES = Object.keys(PERMS);
const ORG_WIDE = new Set(['owner', 'admin']);   // see every station; everyone else sees only assigned stations
function can(role, perm) { const p = PERMS[role]; return !!p && (p.has('*') || p.has(perm)); }

module.exports = { PERMS, ROLES, ORG_WIDE, sha, assertTfNotLocked, recordTfFail, clearTfFails, assertResetAllowed, hashPassword, verifyPassword, DUMMY, checkPasswordPolicy, createSession, loadSession, destroySession, destroyUserSessions, assertNotLocked, recordFail, clearFails, can };
