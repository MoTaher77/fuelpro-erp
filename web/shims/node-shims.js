'use strict';
/* Browser stand-ins for the few Node built-ins that src/ uses, so the unchanged server code runs inside a page
   (FuelPro Artifact edition, ADR-20). Pure JS, synchronous like the Node originals:
   Buffer (subset), crypto (sha1/sha256, HMAC, scrypt, randomBytes, timingSafeEqual), path, fs (no files),
   http (captures the request handler), net/tls (unused: no SMTP in the page). */
(function (G) {
  /* ---------------- Buffer (only what src/ uses) ---------------- */
  const te = new TextEncoder(), td = new TextDecoder();
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function toB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 3) { const a = u8[i], b = u8[i + 1], c = u8[i + 2], n = (a << 16) | ((b || 0) << 8) | (c || 0);
    s += B64[n >> 18 & 63] + B64[n >> 12 & 63] + (i + 1 < u8.length ? B64[n >> 6 & 63] : '=') + (i + 2 < u8.length ? B64[n & 63] : '='); } return s; }
  function fromB64(s) { s = String(s).replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, ''); const out = [];
    for (let i = 0; i < s.length; i += 4) { const n = (B64.indexOf(s[i]) << 18) | (B64.indexOf(s[i + 1]) << 12) | ((s[i + 2] ? B64.indexOf(s[i + 2]) : 0) << 6) | (s[i + 3] ? B64.indexOf(s[i + 3]) : 0);
      out.push(n >> 16 & 255); if (s[i + 2]) out.push(n >> 8 & 255); if (s[i + 3]) out.push(n & 255); } return out; }
  class Buffer extends Uint8Array {
    static from(v, enc) {
      if (typeof v === 'string') {
        if (enc === 'base64' || enc === 'base64url') return new Buffer(fromB64(v));
        if (enc === 'hex') { const a = []; for (let i = 0; i + 1 < v.length; i += 2) a.push(parseInt(v.substr(i, 2), 16)); return new Buffer(a); }
        if (enc === 'latin1' || enc === 'binary') return new Buffer([...v].map(c => c.charCodeAt(0) & 255));
        return new Buffer(te.encode(v));
      }
      if (v instanceof ArrayBuffer) return new Buffer(new Uint8Array(v));
      return new Buffer(v);
    }
    static alloc(n, fill) { const b = new Buffer(n); if (fill) b.fill(fill); return b; }
    static isBuffer(b) { return b instanceof Buffer; }
    static byteLength(s) { return te.encode(String(s)).length; }
    static concat(list, total) { total = total ?? list.reduce((n, b) => n + b.length, 0); const out = new Buffer(total); let o = 0; for (const b of list) { out.set(b, o); o += b.length; } return out; }
    toString(enc) {
      if (enc === 'base64') return toB64(this);
      if (enc === 'base64url') return toB64(this).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      if (enc === 'hex') return [...this].map(b => b.toString(16).padStart(2, '0')).join('');
      if (enc === 'latin1' || enc === 'binary') return String.fromCharCode(...this);
      return td.decode(this);
    }
    equals(o) { if (o.length !== this.length) return false; for (let i = 0; i < o.length; i++) if (o[i] !== this[i]) return false; return true; }
    readUInt32BE(o = 0) { return ((this[o] << 24) >>> 0) + (this[o + 1] << 16) + (this[o + 2] << 8) + this[o + 3]; }
    writeUInt32BE(v, o = 0) { this[o] = v >>> 24; this[o + 1] = v >>> 16; this[o + 2] = v >>> 8; this[o + 3] = v; return o + 4; }
    toJSON() { return { type: 'Buffer', data: [...this] }; }
  }
  const bytes = (d) => typeof d === 'string' ? te.encode(d) : d instanceof Uint8Array ? d : new Uint8Array(d);

  /* ---------------- SHA-256 / SHA-1 / HMAC ---------------- */
  const K256 = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function pad(msg) { const l = msg.length, n = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(n); m.set(msg); m[l] = 0x80; const bits = l * 8;
    m[n - 4] = bits >>> 24; m[n - 3] = bits >>> 16; m[n - 2] = bits >>> 8; m[n - 1] = bits; m[n - 5] = Math.floor(bits / 2 ** 32); return m; }
  function sha256(msg) {
    const m = pad(msg), H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]), W = new Uint32Array(64);
    for (let o = 0; o < m.length; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = (m[o + 4 * i] << 24) | (m[o + 4 * i + 1] << 16) | (m[o + 4 * i + 2] << 8) | m[o + 4 * i + 3];
      for (let i = 16; i < 64; i++) { const x = W[i - 15], y = W[i - 2];
        W[i] = (((x >>> 7 | x << 25) ^ (x >>> 18 | x << 14) ^ (x >>> 3)) + W[i - 7] + ((y >>> 17 | y << 15) ^ (y >>> 19 | y << 13) ^ (y >>> 10)) + W[i - 16]) | 0; }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) + ((e & f) ^ (~e & g)) + K256[i] + W[i]) | 0;
        const t2 = (((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    const out = new Buffer(32); for (let i = 0; i < 8; i++) { out[4 * i] = H[i] >>> 24; out[4 * i + 1] = H[i] >>> 16; out[4 * i + 2] = H[i] >>> 8; out[4 * i + 3] = H[i]; } return out;
  }
  function sha1(msg) {
    const m = pad(msg), H = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]), W = new Uint32Array(80);
    for (let o = 0; o < m.length; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = (m[o + 4 * i] << 24) | (m[o + 4 * i + 1] << 16) | (m[o + 4 * i + 2] << 8) | m[o + 4 * i + 3];
      for (let i = 16; i < 80; i++) { const x = W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16]; W[i] = x << 1 | x >>> 31; }
      let [a, b, c, d, e] = H;
      for (let i = 0; i < 80; i++) {
        const f = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
        const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
        const t = ((a << 5 | a >>> 27) + f + e + k + W[i]) | 0; e = d; d = c; c = b << 30 | b >>> 2; b = a; a = t;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e;
    }
    const out = new Buffer(20); for (let i = 0; i < 5; i++) { out[4 * i] = H[i] >>> 24; out[4 * i + 1] = H[i] >>> 16; out[4 * i + 2] = H[i] >>> 8; out[4 * i + 3] = H[i]; } return out;
  }
  const HASH = { sha256, sha1 };
  function hmac(alg, key, msg) {
    const f = HASH[alg]; key = bytes(key); if (key.length > 64) key = f(key);
    const k = new Uint8Array(64); k.set(key); const ip = new Uint8Array(64 + msg.length), op = new Uint8Array(64 + (alg === 'sha1' ? 20 : 32));
    for (let i = 0; i < 64; i++) { ip[i] = k[i] ^ 0x36; op[i] = k[i] ^ 0x5c; } ip.set(msg, 64); op.set(f(ip), 64); return f(op);
  }
  const digester = (fn) => { const parts = []; const o = { update(d) { parts.push(bytes(d)); return o; }, digest(enc) { const out = fn(Buffer.concat(parts)); return enc ? out.toString(enc) : out; } }; return o; };
  const needAlg = (a) => { a = String(a).toLowerCase().replace('-', ''); if (!HASH[a]) throw new Error('Unsupported hash in the page: ' + a); return a; };

  /* ---------------- scrypt (RFC 7914), synchronous like crypto.scryptSync ---------------- */
  function pbkdf2(pw, salt, len) {   // one iteration, HMAC-SHA-256 (that is all scrypt needs)
    const out = new Uint8Array(len), blk = new Uint8Array(salt.length + 4); blk.set(salt);
    for (let i = 1, o = 0; o < len; i++, o += 32) { blk[salt.length] = i >>> 24; blk[salt.length + 1] = i >>> 16; blk[salt.length + 2] = i >>> 8; blk[salt.length + 3] = i;
      const t = hmac('sha256', pw, blk); out.set(t.subarray(0, Math.min(32, len - o)), o); }
    return out;
  }
  function salsa(B, x) {
    for (let i = 0; i < 16; i++) x[i] = B[i];
    for (let i = 0; i < 8; i += 2) {
      const R = (a, b) => (a << b) | (a >>> (32 - b));
      x[4] ^= R(x[0] + x[12], 7); x[8] ^= R(x[4] + x[0], 9); x[12] ^= R(x[8] + x[4], 13); x[0] ^= R(x[12] + x[8], 18);
      x[9] ^= R(x[5] + x[1], 7); x[13] ^= R(x[9] + x[5], 9); x[1] ^= R(x[13] + x[9], 13); x[5] ^= R(x[1] + x[13], 18);
      x[14] ^= R(x[10] + x[6], 7); x[2] ^= R(x[14] + x[10], 9); x[6] ^= R(x[2] + x[14], 13); x[10] ^= R(x[6] + x[2], 18);
      x[3] ^= R(x[15] + x[11], 7); x[7] ^= R(x[3] + x[15], 9); x[11] ^= R(x[7] + x[3], 13); x[15] ^= R(x[11] + x[7], 18);
      x[1] ^= R(x[0] + x[3], 7); x[2] ^= R(x[1] + x[0], 9); x[3] ^= R(x[2] + x[1], 13); x[0] ^= R(x[3] + x[2], 18);
      x[6] ^= R(x[5] + x[4], 7); x[7] ^= R(x[6] + x[5], 9); x[4] ^= R(x[7] + x[6], 13); x[5] ^= R(x[4] + x[7], 18);
      x[11] ^= R(x[10] + x[9], 7); x[8] ^= R(x[11] + x[10], 9); x[9] ^= R(x[8] + x[11], 13); x[10] ^= R(x[9] + x[8], 18);
      x[12] ^= R(x[15] + x[14], 7); x[13] ^= R(x[12] + x[15], 9); x[14] ^= R(x[13] + x[12], 13); x[15] ^= R(x[14] + x[13], 18);
    }
    for (let i = 0; i < 16; i++) B[i] = (B[i] + x[i]) | 0;
  }
  function blockMix(B, Y, r, x, t) {   // B: 32*r words
    t.set(B.subarray((2 * r - 1) * 16, 2 * r * 16));
    for (let i = 0; i < 2 * r; i++) { for (let j = 0; j < 16; j++) t[j] ^= B[i * 16 + j]; salsa(t, x); Y.set(t, (i >> 1) * 16 + (i & 1) * r * 16); }
    B.set(Y);
  }
  function scryptSync(pw, salt, keylen, opt = {}) {
    const N = opt.N || opt.cost || 16384, r = opt.r || opt.blockSize || 8, p = opt.p || opt.parallelization || 1;
    pw = bytes(pw); salt = bytes(salt);
    const Bb = pbkdf2(pw, salt, p * 128 * r), W = 32 * r, V = new Int32Array(N * W), X = new Int32Array(W), Y = new Int32Array(W), x = new Int32Array(16), t = new Int32Array(16);
    for (let k = 0; k < p; k++) {
      const off = k * 128 * r;
      for (let i = 0; i < W; i++) { const o = off + 4 * i; X[i] = Bb[o] | (Bb[o + 1] << 8) | (Bb[o + 2] << 16) | (Bb[o + 3] << 24); }
      for (let i = 0; i < N; i++) { V.set(X, i * W); blockMix(X, Y, r, x, t); }
      for (let i = 0; i < N; i++) { const j = X[(2 * r - 1) * 16] & (N - 1); for (let q = 0; q < W; q++) X[q] ^= V[j * W + q]; blockMix(X, Y, r, x, t); }
      for (let i = 0; i < W; i++) { const o = off + 4 * i; Bb[o] = X[i]; Bb[o + 1] = X[i] >> 8; Bb[o + 2] = X[i] >> 16; Bb[o + 3] = X[i] >> 24; }
    }
    return new Buffer(pbkdf2(pw, Bb, keylen));
  }
  function randomBytes(n) { const b = new Buffer(n); G.crypto.getRandomValues(b); return b; }
  const cryptoShim = {
    createHash: (a) => digester(HASH[needAlg(a)]),
    createHmac: (a, key) => { a = needAlg(a); return digester((m) => hmac(a, key, m)); },
    randomBytes, scryptSync, randomUUID: () => G.crypto.randomUUID(),
    timingSafeEqual: (a, b) => { if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length'); let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; },
    createCipheriv: () => { throw new Error('APP_SECRET encryption is not available in the page'); },
    createDecipheriv: () => { throw new Error('APP_SECRET encryption is not available in the page'); }
  };

  /* ---------------- path / fs / http / net / tls / process ---------------- */
  const pathShim = {
    sep: '/', join: (...a) => pathShim.normalize(a.filter(Boolean).join('/')), resolve: (...a) => pathShim.normalize('/' + a.filter(Boolean).join('/')),
    normalize: (p) => { const out = []; for (const s of String(p).split('/')) { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); } return (String(p).startsWith('/') ? '/' : '') + out.join('/'); },
    basename: (p) => String(p).split('/').pop(), dirname: (p) => String(p).split('/').slice(0, -1).join('/') || '/',
    extname: (p) => { const b = String(p).split('/').pop(); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; }
  };
  const noFile = () => { const e = new Error('Files are not available in the page edition'); e.code = 'ENOENT'; return e; };
  const fsShim = {
    existsSync: () => false, readdirSync: () => [], mkdirSync: () => {}, statSync: () => { throw noFile(); }, readFileSync: () => { throw noFile(); },
    writeFileSync: () => { throw noFile(); }, unlinkSync: () => {}, rmSync: () => {}, copyFileSync: () => { throw noFile(); },
    readFile: (f, cb) => cb(noFile()), createReadStream: () => { throw noFile(); }
  };
  const httpShim = { createServer(handler) { G.__FP_HTTP_HANDLER = handler; return { on() {}, listen() {}, close(cb) { if (cb) cb(); } }; } };
  const process = G.process || { env: {}, on() {}, exit() {}, platform: 'browser', versions: {} };
  process.env = Object.assign({ BACKUP_AUTO: '0' }, process.env || {});

  G.FP_NODE_SHIMS = { Buffer, crypto: cryptoShim, path: pathShim, fs: fsShim, http: httpShim, net: {}, tls: {}, process };
})(typeof globalThis !== 'undefined' ? globalThis : window);
