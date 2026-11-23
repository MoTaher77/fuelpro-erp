'use strict';
/* Backups: a consistent copy of the live database (VACUUM INTO), one automatic copy a day, the last 30 kept. */
const fs = require('node:fs');
const path = require('node:path');
const { HttpError, notFound } = require('./errors');
const auth = require('./auth');

const NAME_RE = /^fuelpro-(\d{4}-\d{2}-\d{2})-(\d{6})-(auto|manual|pre-update)\.db$/;
function dirFor(dbPath) { return process.env.BACKUP_DIR || path.join(path.dirname(path.resolve(dbPath)), 'backups'); }
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function list(dbPath) {
  const dir = dirFor(dbPath); if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(n => NAME_RE.test(n)).map(n => { const st = fs.statSync(path.join(dir, n)); const m = NAME_RE.exec(n);
    return { name: n, date: m[1], kind: m[3], bytes: st.size, created_at: st.mtime.toISOString() }; }).sort((a, b) => b.name.localeCompare(a.name));
}
function make(db, dbPath, kind = 'manual') {
  const dir = dirFor(dbPath); fs.mkdirSync(dir, { recursive: true });
  const name = `fuelpro-${stamp()}-${kind}.db`, dest = path.join(dir, name);
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  prune(dbPath);
  return { name, bytes: fs.statSync(dest).size };
}
/* keep the newest 30 automatic copies and the newest 30 others */
function prune(dbPath) {
  const dir = dirFor(dbPath); const all = list(dbPath);
  for (const kind of ['auto', 'other']) all.filter(b => (kind === 'auto') === (b.kind === 'auto')).slice(30).forEach(b => { try { fs.unlinkSync(path.join(dir, b.name)); } catch {} });
}
/** One automatic backup per calendar day; checked at start and every hour. */
function schedule(db, dbPath) {
  if (!dbPath || dbPath === ':memory:' || process.env.BACKUP_AUTO === '0') return null;
  const tick = () => { try { const today = stamp().slice(0, 10); if (!list(dbPath).some(b => b.kind === 'auto' && b.date === today)) { const r = make(db, dbPath, 'auto'); console.log('[backup] daily copy written:', r.name); } } catch (e) { console.error('[backup] failed:', e.message); } };
  setTimeout(tick, 5_000).unref();
  const t = setInterval(tick, 3_600_000); t.unref(); return t;
}
const can = (user) => { if (!auth.ORG_WIDE.has(user.role)) throw new HttpError(403, 'FORBIDDEN', 'Only the owner or an administrator can manage backups'); };
function file(dbPath, name) {
  if (!NAME_RE.test(name)) throw notFound('Backup');
  const f = path.join(dirFor(dbPath), name); if (!fs.existsSync(f)) throw notFound('Backup');
  return f;
}
module.exports = { list, make, prune, schedule, can, file, dirFor };
