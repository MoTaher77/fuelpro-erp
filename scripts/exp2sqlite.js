'use strict';
/* Convert a classic Oracle EXP dump (.DMP, "EXPORT:V11.02.00") into a NEW SQLite file, read-only on the source.
   Every table becomes a table of TEXT columns with the same names; numbers are kept as exact decimal strings,
   dates as ISO "YYYY-MM-DDTHH:MM:SS", text decoded from Windows-1256 — the layout scripts/import-m7.js reads.

   Usage: node scripts/exp2sqlite.js <dump.DMP> <out.sqlite>

   Format (per table): text line `INSERT INTO "T" ("A", "B") VALUES (:1, :2)\n`, then u16 column count,
   per column u16 type + u16 max length (+ u16 charset + u16 form for character types), 4 zero bytes, then rows:
   per column u16 length + bytes (0xFFFE = NULL), u16 0 at the end of each row, u16 0xFFFF after the last row. */
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const [, , SRC, OUT] = process.argv;
if (!SRC || !OUT) { console.error('Usage: node scripts/exp2sqlite.js <dump.DMP> <out.sqlite>'); process.exit(1); }
if (fs.existsSync(OUT)) { console.error(`${OUT} already exists; the converter only writes a new file.`); process.exit(1); }

const buf = fs.readFileSync(SRC);
const head = buf.subarray(0, 64).toString('latin1');
if (!/EXPORT:V\d/.test(head)) { console.error('Not a classic Oracle EXP dump'); process.exit(1); }
const cp1256 = new TextDecoder('windows-1256');
const CHAR_TYPES = new Set([1, 96]);          // VARCHAR2, CHAR (carry charset id + form)

function oraNumber(b) {
  if (b.length === 1 && b[0] === 0x80) return '0';
  const neg = !(b[0] & 0x80);
  const exp = (neg ? (~b[0] & 0x7f) : (b[0] & 0x7f)) - 65;
  let digits = [];
  for (let i = 1; i < b.length; i++) { if (neg && b[i] === 102) break; digits.push(neg ? 101 - b[i] : b[i] - 1); }
  const pairs = digits.map(d => String(d).padStart(2, '0'));
  const intPairs = exp + 1;
  let ip, fp;
  if (intPairs <= 0) { ip = '0'; fp = '00'.repeat(-intPairs) + pairs.join(''); }
  else if (intPairs >= pairs.length) { ip = pairs.join('') + '00'.repeat(intPairs - pairs.length); fp = ''; }
  else { ip = pairs.slice(0, intPairs).join(''); fp = pairs.slice(intPairs).join(''); }
  ip = ip.replace(/^0+(?=\d)/, ''); fp = fp.replace(/0+$/, '');
  return (neg ? '-' : '') + ip + (fp ? '.' + fp : '');
}
const p2 = (n) => String(n).padStart(2, '0');
function oraDate(b) {
  const y = (b[0] - 100) * 100 + (b[1] - 100);
  return `${String(y).padStart(4, '0')}-${p2(b[2])}-${p2(b[3])}T${p2(b[4] - 1)}:${p2(b[5] - 1)}:${p2(b[6] - 1)}`;
}
function decode(type, b) {
  switch (type) {
    case 2: return oraNumber(b);
    case 12: return oraDate(b);
    case 180: case 181: case 231: return oraDate(b) + (b.length >= 11 ? '.' + String(b.readUInt32BE(7)).padStart(9, '0').replace(/0+$/, '') : '');
    case 1: case 96: case 8: return cp1256.decode(b);
    default: return b.toString('hex');
  }
}

const db = new DatabaseSync(OUT);
db.exec('PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;');
db.exec('CREATE TABLE _tables(name TEXT, rows INTEGER, columns TEXT, types TEXT, note TEXT)');
const MARK = Buffer.from('INSERT INTO "', 'latin1');
const seen = new Map(); let pos = 0, total = 0;
const problems = [];
while ((pos = buf.indexOf(MARK, pos)) >= 0) {
  const nl = buf.indexOf(0x0a, pos); if (nl < 0) break;
  const stmt = buf.subarray(pos, nl).toString('latin1');
  const m = /^INSERT INTO "([^"]+)" \((.*)\) VALUES \(/.exec(stmt);
  if (!m) { pos = nl; continue; }
  const name = m[1], cols = [...m[2].matchAll(/"([^"]+)"/g)].map(x => x[1]);
  let p = nl + 1;
  const n = buf.readUInt16LE(p); p += 2;
  if (n !== cols.length) { problems.push(`${name}: header has ${n} columns, statement ${cols.length}`); pos = nl; continue; }
  const types = [];
  for (let i = 0; i < n; i++) { const t = buf.readUInt16LE(p); p += 4; if (CHAR_TYPES.has(t)) p += 4; types.push(t); }
  p += 4;                                           // 4 zero bytes before the first row
  const tname = seen.has(name) ? `${name}__${seen.get(name) + 1}` : name;
  seen.set(name, (seen.get(name) || 0) + 1);
  db.exec(`CREATE TABLE "${tname}" (${cols.map(c => `"${c}" TEXT`).join(', ')})`);
  const ins = db.prepare(`INSERT INTO "${tname}" VALUES (${cols.map(() => '?').join(',')})`);
  let rows = 0, note = null;
  db.exec('BEGIN');
  try {
    for (;;) {
      if (buf.readUInt16LE(p) === 0xffff) { p += 2; break; }
      const vals = new Array(n);
      for (let i = 0; i < n; i++) {
        const len = buf.readUInt16LE(p); p += 2;
        if (len === 0xfffe) { vals[i] = null; continue; }
        vals[i] = decode(types[i], buf.subarray(p, p + len)); p += len;
      }
      const end = buf.readUInt16LE(p); p += 2;
      if (end !== 0) throw new Error(`row ${rows + 1} not terminated at byte ${p - 2}`);
      ins.run(...vals); rows++;
    }
  } catch (e) { note = e.message; problems.push(`${name}: ${e.message} (kept ${rows} rows)`); }
  db.exec('COMMIT');
  db.prepare('INSERT INTO _tables VALUES (?,?,?,?,?)').run(tname, rows, cols.join(','), types.join(','), note);
  total += rows; pos = p;
}
db.close();
console.log(`${seen.size} tables, ${total} rows -> ${OUT}`);
if (problems.length) { console.log(`${problems.length} problem(s):`); for (const x of problems) console.log('  ' + x); }
