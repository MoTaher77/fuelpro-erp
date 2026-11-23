'use strict';
/* RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30 s) + secret sealing + recovery codes. No dependencies. */
const crypto = require('node:crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32encode(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) { val = ((val << 8) | b) & 0xffff; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function b32decode(str) {
  const s = String(str).toUpperCase().replace(/[\s=-]/g, ''); let bits = 0, val = 0; const out = [];
  for (const ch of s) { const i = B32.indexOf(ch); if (i < 0) throw new Error('bad base32'); val = ((val << 5) | i) & 0xffff; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}

const STEP_MS = 30_000;
function hotp(key, counter, digits = 6) {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac('sha1', key).update(c).digest();
  const o = mac[mac.length - 1] & 15;
  const n = ((mac[o] & 0x7f) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3];
  return String(n % 10 ** digits).padStart(digits, '0');
}
const stepAt = (ms) => Math.floor(ms / STEP_MS);
const totp = (key, ms = Date.now(), digits = 6) => hotp(key, stepAt(ms), digits);

/** Returns the matched time step, or null. Accepts one step of clock drift each way; never a step <= lastStep (replay). */
function verifyTotp(key, code, lastStep = 0, ms = Date.now()) {
  if (!/^\d{6}$/.test(String(code))) return null;
  const now = stepAt(ms); let hit = null;
  for (const s of [now - 1, now, now + 1]) {           // check all three so timing does not leak which one matched
    const ok = crypto.timingSafeEqual(Buffer.from(hotp(key, s)), Buffer.from(String(code)));
    if (ok && s > lastStep && hit === null) hit = s;
  }
  return hit;
}

/* Secrets at rest: AES-256-GCM with a key derived from APP_SECRET when it is set. */
function sealKey() { const s = process.env.APP_SECRET; return s ? crypto.createHash('sha256').update('fuelpro-totp:' + s).digest() : null; }
function seal(buf) {
  const k = sealKey(); if (!k) return 'p:' + b32encode(buf);
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return 'g:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function unseal(s) {
  if (s.startsWith('p:')) return b32decode(s.slice(2));
  if (s.startsWith('g:')) {
    const k = sealKey(); if (!k) throw new Error('APP_SECRET is required to read 2FA secrets');
    const raw = Buffer.from(s.slice(2), 'base64'), d = crypto.createDecipheriv('aes-256-gcm', k, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28)); return Buffer.concat([d.update(raw.subarray(28)), d.final()]);
  }
  throw new Error('unknown secret format');
}

const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
const hashCode = (c) => crypto.createHash('sha256').update('rc:' + normCode(c)).digest('hex');
function newRecoveryCodes(n = 10) {
  return Array.from({ length: n }, () => { const s = b32encode(crypto.randomBytes(7)).slice(0, 10); return s.slice(0, 5) + '-' + s.slice(5); });
}

module.exports = { b32encode, b32decode, hotp, totp, verifyTotp, stepAt, seal, unseal, normCode, hashCode, newRecoveryCodes };
