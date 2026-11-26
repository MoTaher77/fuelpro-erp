'use strict';
/* Off-site backup (0.29): deploy/vps/offsite.sh run against a stub rclone that "uploads" into a local folder.
   Covers: a good run (copy is a valid SQLite file, gzip'd, verified by size, status written), a failing upload keeps the last success time,
   retention (young files + every 1st-of-month copy stay), token paste parsing in `setup`, and the app side (status file → API, alert, roles). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { openDb } = require('../src/db');
const BK = require('../src/backup');
const { createApp } = require('../src/server');

const SH = path.join(__dirname, '..', 'deploy', 'vps', 'offsite.sh');
const hasBash = process.platform !== 'win32' && spawnSync('bash', ['-c', 'true']).status === 0;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fp-off-'));

/* a stand-in for rclone: remote "fuelpro-gdrive:<folder>" is the local folder $FAKE_DRIVE/<folder>; FAKE_FAIL=copyto makes the upload fail */
const STUB = `#!/usr/bin/env bash
set -e
args=(); while [ $# -gt 0 ]; do case "$1" in --config|--retries|--low-level-retries|--format|--separator|--min-age|--exclude|--include) k="$1"; v="$2"; shift 2
  case "$k" in --format) FMT="$v";; --min-age) MIN="\${v%d}";; --exclude) EXC="$v";; --include) INC="$v";; esac ;; --*) shift ;; *) args+=("$1"); shift ;; esac; done
cmd="\${args[0]}"; dir() { echo "$FAKE_DRIVE/\${1#*:}"; }
case "$cmd" in
  copyto) [ "$FAKE_FAIL" = copyto ] && { echo "Failed to copyto: googleapi: Error 403: storage quota exceeded" >&2; exit 1; }
          d="$(dir "\${args[2]}")"; mkdir -p "$(dirname "$d")"; cp "\${args[1]}" "$d" ;;
  lsf) d="$(dir "\${args[1]}")"; mkdir -p "$d"; for f in "$d"/*; do [ -f "$f" ] || continue; if [ -n "$FMT" ]; then echo "$(stat -c %s "$f");$(basename "$f")"; else basename "$f"; fi; done; true ;;
  delete) d="$(dir "\${args[1]}")"; for f in $(find "$d" -type f -mtime +"$MIN"); do b=$(basename "$f"); case "$b" in $EXC) continue;; esac; case "$b" in $INC) rm -f "$f";; esac; done ;;
  *) echo "stub: unsupported $cmd" >&2; exit 9 ;;
esac`;

function env(extra = {}) {
  const dir = tmp(), data = path.join(dir, 'data'), etc = path.join(dir, 'etc'), drive = path.join(dir, 'drive'), stub = path.join(dir, 'rclone');
  fs.mkdirSync(data); fs.mkdirSync(etc); fs.mkdirSync(drive); fs.writeFileSync(stub, STUB, { mode: 0o755 });
  const db = openDb(path.join(data, 'fuelpro.db')); db.close();
  const run = (args, e = {}, input) => spawnSync('bash', [SH, ...args], { encoding: 'utf8', input, env: { ...process.env, FP_TEST: '1', FP_RUN_USER: '', FP_DATA: data, FP_ETC: etc, FP_RCLONE: stub, FAKE_DRIVE: drive, TMPDIR: dir, ...extra, ...e } });
  return { dir, data, etc, drive, run, status: () => JSON.parse(fs.readFileSync(path.join(data, 'offsite-status.json'), 'utf8')) };
}
const folder = (x) => path.join(x.drive, 'FuelPro-backups');

test('offsite run: a fresh copy is gzip-compressed, uploaded, verified and reported', { skip: !hasBash }, () => {
  const x = env(); fs.writeFileSync(path.join(x.etc, 'rclone.conf'), '[fuelpro-gdrive]\n');
  const r = x.run(['run']); assert.equal(r.status, 0, r.stdout + r.stderr);
  const files = fs.readdirSync(folder(x)); assert.equal(files.length, 1); assert.match(files[0], /^fuelpro-\d{4}-\d{2}-\d{2}-\d{6}-offsite\.db\.gz$/);
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(folder(x), files[0]))), f = path.join(x.dir, 'restored.db'); fs.writeFileSync(f, raw);
  const d = new DatabaseSync(f); assert.equal(Object.values(d.prepare('PRAGMA integrity_check').get())[0], 'ok'); assert.ok(d.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='users'").get().n === 1); d.close();
  const s = x.status(); assert.equal(s.ok, true); assert.equal(s.name, files[0]); assert.equal(s.kept, 1); assert.equal(s.error, ''); assert.ok(s.bytes > 0);
  assert.equal(fs.readdirSync(x.dir).filter(n => n.startsWith('fuelpro-offsite.')).length, 0, 'no temporary folder left behind');
});

test('offsite run: not connected → clear message and no upload; failing upload → status says why and keeps the last success', { skip: !hasBash }, () => {
  const x = env(); const no = x.run(['run']); assert.notEqual(no.status, 0); assert.match(no.stdout, /not connected/);
  fs.writeFileSync(path.join(x.etc, 'rclone.conf'), '[fuelpro-gdrive]\n');
  assert.equal(x.run(['run']).status, 0); const good = x.status();
  const bad = x.run(['run'], { FAKE_FAIL: 'copyto' }); assert.notEqual(bad.status, 0);
  const s = x.status(); assert.equal(s.ok, false); assert.match(s.error, /upload to Google Drive failed.*quota/);
  assert.equal(s.last_ok_at, good.last_ok_at, 'the time of the last good copy is kept'); assert.equal(s.name, good.name);
  assert.equal(fs.readdirSync(folder(x)).length, 1, 'nothing half-uploaded was added');
});

test('offsite run: tidy-up removes old copies but keeps the young ones and every 1st-of-month copy', { skip: !hasBash }, () => {
  const x = env(); fs.writeFileSync(path.join(x.etc, 'rclone.conf'), '[fuelpro-gdrive]\n'); fs.mkdirSync(folder(x), { recursive: true });
  const old = new Date(Date.now() - 90 * 86400000), mk = (n, d) => { const p = path.join(folder(x), n); fs.writeFileSync(p, 'x'); fs.utimesSync(p, d, d); };
  mk('fuelpro-2026-08-15-024000-offsite.db.gz', old); mk('fuelpro-2026-08-01-024000-offsite.db.gz', old); mk('fuelpro-2026-11-20-024000-offsite.db.gz', new Date());
  mk('notes.txt', old);   // not ours: never touched
  assert.equal(x.run(['run']).status, 0);
  const left = fs.readdirSync(folder(x)).filter(n => !/-offsite\.db\.gz$/.test(n) || n.startsWith('fuelpro-2026-')).sort();
  assert.ok(left.includes('fuelpro-2026-08-01-024000-offsite.db.gz'), 'month-start copy kept'); assert.ok(left.includes('fuelpro-2026-11-20-024000-offsite.db.gz'));
  assert.ok(!left.includes('fuelpro-2026-08-15-024000-offsite.db.gz'), 'old mid-month copy removed'); assert.ok(left.includes('notes.txt'));
  assert.equal(x.status().kept, 3);   // 08-01, 11-20 and today's
});

test('offsite setup: the pasted token (with text around it, even over several lines) is stored 0600 and the first upload runs', { skip: !hasBash }, () => {
  const x = env(); const tok = { access_token: 'ya29.test', token_type: 'Bearer', refresh_token: '1//refresh', expiry: '2026-11-26T10:00:00Z' };
  const file = path.join(x.dir, 'paste.txt'); fs.writeFileSync(file, `Paste the following into your remote machine --->\n${JSON.stringify(tok, null, 1)}\n<---End paste\n`);
  const r = x.run(['setup', '--token-file', file]); assert.equal(r.status, 0, r.stdout + r.stderr);
  const conf = fs.readFileSync(path.join(x.etc, 'rclone.conf'), 'utf8'); assert.match(conf, /^\[fuelpro-gdrive\]\ntype = drive\nscope = drive\.file\ntoken = \{/);
  assert.equal(JSON.parse(conf.split('token = ')[1]).refresh_token, '1//refresh'); assert.equal(fs.statSync(path.join(x.etc, 'rclone.conf')).mode & 0o777, 0o600);
  assert.equal(x.status().ok, true); assert.equal(fs.readdirSync(folder(x)).length, 1);
  const none = path.join(x.dir, 'bad.txt'); fs.writeFileSync(none, 'hello'); assert.notEqual(x.run(['setup', '--token-file', none]).status, 0);
  fs.writeFileSync(none, '{"access_token":"a"}'); assert.notEqual(x.run(['setup', '--token-file', none]).status, 0, 'a token without refresh_token is refused');
});

test('offsite status in the app: not set up → none; fresh → ok; failed / stale → states, and critical after 72 h', () => {
  const dir = tmp(), dbPath = path.join(dir, 'fp.db'), now = Date.parse('2026-11-26T12:00:00Z'); process.env.OFFSITE_STATUS_FILE = path.join(dir, 'st.json');
  try {
    assert.deepEqual(BK.offsite(dbPath, now), { configured: false, state: 'none' });
    const put = (o) => fs.writeFileSync(process.env.OFFSITE_STATUS_FILE, JSON.stringify(o));
    put({ configured: true, ok: true, last_ok_at: '2026-11-26T02:41:00Z', name: 'a.db.gz', bytes: 5, kept: 3 }); let s = BK.offsite(dbPath, now);
    assert.equal(s.state, 'ok'); assert.equal(s.ok, true); assert.equal(s.age_hours, 9); assert.equal(s.critical, false);
    put({ configured: true, ok: true, last_ok_at: '2026-11-24T02:41:00Z' }); s = BK.offsite(dbPath, now); assert.equal(s.state, 'stale'); assert.equal(s.critical, false);
    put({ configured: true, ok: true, last_ok_at: '2026-11-20T02:41:00Z' }); assert.equal(BK.offsite(dbPath, now).critical, true);
    put({ configured: true, ok: false, error: 'quota', last_ok_at: '2026-11-26T02:41:00Z' }); s = BK.offsite(dbPath, now); assert.equal(s.state, 'failed'); assert.equal(s.error, 'quota'); assert.equal(s.critical, false);
    fs.writeFileSync(process.env.OFFSITE_STATUS_FILE, 'not json'); assert.equal(BK.offsite(dbPath, now).configured, false);
  } finally { delete process.env.OFFSITE_STATUS_FILE; }
});

test('offsite in the API: backup screen carries the status, the alert appears for the owner and only when set up', async () => {
  const dir = tmp(); process.env.OFFSITE_STATUS_FILE = path.join(dir, 'st.json'); process.env.BACKUP_DIR = path.join(dir, 'b'); process.env.BACKUP_AUTO = '0';
  const app = createApp({ dbPath: path.join(dir, 'fp.db'), mailer: { send: async () => {} } });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${app.server.address().port}`; let cookie = '';
  const call = async (method, p, body) => { const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0]; const t = await res.text(); return { status: res.status, body: t ? JSON.parse(t) : undefined }; };
  try {
    const reg = await call('POST', '/api/auth/register', { org_name: 'O', name: 'Own', email: 'o@x.com', password: 'correct horse battery', station: { name: 'S', currency: 'YER', timezone: 'Asia/Aden' } });
    assert.equal(reg.status, 201, JSON.stringify(reg.body)); const sid = reg.body.station_id;
    const none = await call('GET', '/api/backups'); assert.equal(none.status, 200); assert.equal(none.body.offsite.configured, false);
    assert.ok(!(await call('GET', `/api/stations/${sid}/alerts`)).body.alerts.some(a => a.kind === 'offsite'), 'no alert when never set up');
    fs.writeFileSync(process.env.OFFSITE_STATUS_FILE, JSON.stringify({ configured: true, ok: false, error: 'invalid_grant', last_ok_at: new Date(Date.now() - 3600000).toISOString() }));
    assert.equal((await call('GET', '/api/backups')).body.offsite.state, 'failed');
    const al = (await call('GET', `/api/stations/${sid}/alerts`)).body.alerts.find(a => a.kind === 'offsite');
    assert.ok(al); assert.equal(al.severity, 'warning'); assert.equal(al.items[0].error, 'invalid_grant');
    fs.writeFileSync(process.env.OFFSITE_STATUS_FILE, JSON.stringify({ configured: true, ok: true, last_ok_at: new Date().toISOString() }));
    assert.ok(!(await call('GET', `/api/stations/${sid}/alerts`)).body.alerts.some(a => a.kind === 'offsite'), 'a fresh copy raises nothing');
  } finally { await new Promise(r => app.server.close(r)); delete process.env.OFFSITE_STATUS_FILE; delete process.env.BACKUP_DIR; delete process.env.BACKUP_AUTO; }
});
