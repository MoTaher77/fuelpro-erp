// @ts-check
'use strict';
/* Sign-in history (owner's «سجل الدخول»): every sign-in, sign-out and failed attempt on a known account, with the time
   (UTC), the address and a short device label. Read by the owner/admin only (users.manage), always inside his organisation. */
const V = require('./validate');
const { bad, notFound, forbidden } = require('./errors');
const auth = require('./auth');

const KEEP_DAYS = 365;
const ONLINE_MS = 10 * 60 * 1000;     // a session used in the last 10 minutes counts as «online now»

/** "Chrome · Android" from a User-Agent header; never stores the raw header. */
function deviceLabel(ua) {
  const s = String(ua || '');
  if (!s) return null;
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /SamsungBrowser/.test(s) ? 'Samsung Internet' : /Firefox\//.test(s) ? 'Firefox'
    : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : /curl|node|undici|python|Go-http/i.test(s) ? 'Script' : 'Browser';
  const os = /Android/.test(s) ? 'Android' : /iPhone|iPad|iPod/.test(s) ? 'iOS' : /Windows/.test(s) ? 'Windows' : /Mac OS X|Macintosh/.test(s) ? 'macOS'
    : /Linux/.test(s) ? 'Linux' : '';
  return os ? `${browser} · ${os}` : browser;
}

/** Record one event; never lets a logging problem stop a sign-in. */
function record(db, u, kind, { ip = null, device = null, reason = null } = {}) {
  try {
    db.prepare('INSERT INTO login_events(org_id,user_id,kind,reason,ip,device) VALUES(?,?,?,?,?,?)').run(u.org_id, u.id, kind, reason, ip || null, device || null);
    if (Math.random() < 0.01) db.prepare(`DELETE FROM login_events WHERE at < datetime('now', ?)`).run(`-${KEEP_DAYS} days`);
  } catch { /* history is informative; the sign-in itself must not fail because of it */ }
}

/** Users of the org with their last sign-in and whether they are signed in now. */
function presence(db, orgId) {
  const now = Date.now();
  const last = new Map(db.prepare(`SELECT user_id, MAX(id) id FROM login_events WHERE org_id=? AND kind='login' GROUP BY user_id`).all(orgId)
    .map((r) => [r.user_id, db.prepare('SELECT at, ip, device FROM login_events WHERE id=?').get(r.id)]));
  const sess = db.prepare(`SELECT s.user_id, COUNT(*) n, MAX(s.expires_at) exp FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE u.org_id=? AND s.expires_at>? GROUP BY s.user_id`).all(orgId, now);
  const map = new Map();
  for (const r of sess) {
    const seen = r.exp - auth.SESSION_IDLE_MS;        // sessions are extended on use, so expiry − idle window = last activity (±1 min)
    map.set(r.user_id, { sessions: r.n, last_seen_at: new Date(seen).toISOString().slice(0, 19).replace('T', ' '), online: now - seen < ONLINE_MS });
  }
  return (uid) => {
    const l = last.get(uid), p = map.get(uid);
    return { last_login_at: l ? l.at : null, last_login_ip: l ? l.ip : null, last_login_device: l ? l.device : null,
      sessions: p ? p.sessions : 0, last_seen_at: p ? p.last_seen_at : null, online: p ? p.online : false };
  };
}

/** The history, newest first, filtered by user / kind / dates (UTC days), paged with `before` (an id). */
function list(db, user, q) {
  if (!auth.can(user.role, 'users.manage')) throw forbidden();
  const uid = V.int(q.user_id === undefined || q.user_id === '' ? undefined : Number(q.user_id), 'user_id', { min: 1, optional: true });
  const kind = q.kind ? V.oneOf(q.kind, 'kind', ['login', 'logout', 'failed', 'signed_out']) : null;
  const from = V.date(q.from, 'from', { optional: true }), to = V.date(q.to, 'to', { optional: true });
  if (from && to && from > to) throw bad('VALIDATION', 'from must not be after to');
  const limit = Math.min(V.int(q.limit === undefined ? 100 : Number(q.limit), 'limit', { min: 1, max: 500 }), 500);
  const before = V.int(q.before === undefined || q.before === '' ? Number.MAX_SAFE_INTEGER : Number(q.before), 'before', { min: 1 });
  if (uid && !db.prepare('SELECT 1 FROM users WHERE id=? AND org_id=?').get(uid, user.org_id)) throw notFound('User');
  return db.prepare(`SELECT e.id, e.at, e.user_id, u.name, u.email, u.role, e.kind, e.reason, e.ip, e.device FROM login_events e JOIN users u ON u.id=e.user_id
    WHERE e.org_id=? AND e.id<? AND (? IS NULL OR e.user_id=?) AND (? IS NULL OR e.kind=?) AND (? IS NULL OR e.at>=?) AND (? IS NULL OR e.at<?)
    ORDER BY e.id DESC LIMIT ?`).all(user.org_id, before, uid ?? null, uid ?? null, kind, kind, from ?? null, from ?? null, to ?? null,
    to ? to + ' 99' : null, limit);   // 'YYYY-MM-DD 99' sorts after every time of that day
}

module.exports = { deviceLabel, record, presence, list, KEEP_DAYS };
