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
/* ---- second copy (off the laptop's disk): every backup is also copied to BACKUP_COPY_DIR, or to the folder written in data/backup-copy-dir.txt.
   Point it at a Google Drive / OneDrive / Dropbox folder or a USB stick and that program carries the copy off the machine.
   A failure here never stops the real backup; files the second folder is missing are copied on the next check (drive plugged in later). ---- */
const mirror = { dir: '', ok: null, error: '', at: null, copied: 0 };
function mirrorDirFor(dbPath) {
  if (process.env.BACKUP_COPY_DIR) return process.env.BACKUP_COPY_DIR.trim();
  try { const f = path.join(path.dirname(path.resolve(dbPath)), 'backup-copy-dir.txt'); if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').split(/\r?\n/)[0].trim().replace(/^"|"$/g, ''); } catch { /* optional */ }
  return '';
}
function syncMirror(dbPath) {
  const to = mirrorDirFor(dbPath); mirror.dir = to; if (!to) { mirror.ok = null; mirror.error = ''; return mirror; }
  try {
    const from = dirFor(dbPath); if (path.resolve(to) === path.resolve(from)) throw new Error('the second folder must differ from the backups folder');
    fs.mkdirSync(to, { recursive: true });
    const have = new Set(fs.readdirSync(to).filter(n => NAME_RE.test(n)));
    let copied = 0;
    for (const b of list(dbPath)) if (!have.has(b.name)) { const tmp = path.join(to, b.name + '.part'); fs.copyFileSync(path.join(from, b.name), tmp); fs.renameSync(tmp, path.join(to, b.name)); copied++; }
    /* the same retention as the main folder */
    const names = fs.readdirSync(to).filter(n => NAME_RE.test(n)).sort().reverse();
    for (const kind of ['auto', 'other']) names.filter(n => (NAME_RE.exec(n)[3] === 'auto') === (kind === 'auto')).slice(30).forEach(n => { try { fs.unlinkSync(path.join(to, n)); } catch { /* keep going */ } });
    mirror.ok = true; mirror.error = ''; mirror.at = new Date().toISOString(); mirror.copied = copied;
  } catch (e) { mirror.ok = false; mirror.error = String(e && e.message || e); console.error('[backup] second copy failed:', mirror.error); }
  return mirror;
}
function make(db, dbPath, kind = 'manual') {
  const dir = dirFor(dbPath); fs.mkdirSync(dir, { recursive: true });
  const name = `fuelpro-${stamp()}-${kind}.db`, dest = path.join(dir, name);
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  prune(dbPath);
  syncMirror(dbPath);
  return { name, bytes: fs.statSync(dest).size, mirror: { ...mirror } };
}
/* keep the newest 30 automatic copies and the newest 30 others */
function prune(dbPath) {
  const dir = dirFor(dbPath); const all = list(dbPath);
  for (const kind of ['auto', 'other']) all.filter(b => (kind === 'auto') === (b.kind === 'auto')).slice(30).forEach(b => { try { fs.unlinkSync(path.join(dir, b.name)); } catch {} });
}
/** One automatic backup per calendar day; checked at start and every hour. */
function schedule(db, dbPath) {
  if (!dbPath || dbPath === ':memory:' || process.env.BACKUP_AUTO === '0') return null;
  const tick = () => { try { syncMirror(dbPath); } catch { /* reported in mirror.error */ } try { const today = stamp().slice(0, 10); if (!list(dbPath).some(b => b.kind === 'auto' && b.date === today)) { const r = make(db, dbPath, 'auto'); console.log('[backup] daily copy written:', r.name); } } catch (e) { console.error('[backup] failed:', e.message); } };
  setTimeout(tick, 5_000).unref();
  const t = setInterval(tick, 3_600_000); t.unref(); return t;
}
const can = (user) => { if (!auth.ORG_WIDE.has(user.role)) throw new HttpError(403, 'FORBIDDEN', 'Only the owner or an administrator can manage backups'); };
function file(dbPath, name) {
  if (!NAME_RE.test(name)) throw notFound('Backup');
  const f = path.join(dirFor(dbPath), name); if (!fs.existsSync(f)) throw notFound('Backup');
  return f;
}
/* ---- off-site copy (0.29): on the VPS the program `fuelpro-offsite` (deploy/vps/offsite.sh, a daily systemd timer) uploads a fresh,
   compressed copy to Google Drive and writes the result into offsite-status.json beside the database. The app only READS that file:
   it shows the state on the backup screen and raises an alert when the copy fails or stops arriving. No file = not set up. ---- */
const OFFSITE_STALE_H = 36, OFFSITE_CRITICAL_H = 72;
function offsiteFile(dbPath) { return process.env.OFFSITE_STATUS_FILE || path.join(path.dirname(path.resolve(dbPath)), 'offsite-status.json'); }
function offsite(dbPath, now = Date.now()) {
  let j; try { j = JSON.parse(fs.readFileSync(offsiteFile(dbPath), 'utf8')); } catch { return { configured: false, state: 'none' }; }
  if (!j || typeof j !== 'object') return { configured: false, state: 'none' };
  const okMs = Date.parse(j.last_ok_at || ''), age = Number.isFinite(okMs) ? Math.max(0, (now - okMs) / 3600000) : null;
  const failed = j.ok === false, stale = age == null ? true : age > OFFSITE_STALE_H;
  return {
    configured: true, remote: String(j.remote || ''), name: String(j.name || ''), bytes: Number(j.bytes) || 0, kept: Number(j.kept) || 0,
    at: j.at || null, last_ok_at: j.last_ok_at || null, ok: !failed && !stale, error: failed ? String(j.error || '') : '',
    age_hours: age == null ? null : Math.round(age), state: failed ? 'failed' : stale ? 'stale' : 'ok',
    critical: (failed || stale) && (age == null || age > OFFSITE_CRITICAL_H)
  };
}

module.exports = { list, make, prune, schedule, can, file, dirFor, syncMirror, mirrorDirFor, mirror, offsite, offsiteFile };
