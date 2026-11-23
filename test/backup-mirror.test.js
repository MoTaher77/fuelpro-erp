'use strict';
/* Second backup copy (0.21): every backup is mirrored to a folder the owner chooses; a broken folder never blocks the real backup;
   backups the folder is missing are copied on the next check; the same 30+30 retention applies there. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../src/db');
const BK = require('../src/backup');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fp-mirror-'));
function setup() {
  const dir = tmp(), main = path.join(dir, 'main'), copy = path.join(dir, 'drive', 'FuelPro'), dbPath = path.join(dir, 'fp.db');
  process.env.BACKUP_DIR = main; process.env.BACKUP_COPY_DIR = copy; process.env.BACKUP_AUTO = '0';
  return { dir, main, copy, dbPath, db: openDb(dbPath) };
}
test.afterEach(() => { delete process.env.BACKUP_DIR; delete process.env.BACKUP_COPY_DIR; });

test('a backup is copied to the second folder, byte for byte, and reported', () => {
  const s = setup(); const r = BK.make(s.db, s.dbPath, 'manual');
  assert.equal(r.mirror.ok, true); assert.equal(r.mirror.copied, 1);
  assert.ok(fs.readFileSync(path.join(s.main, r.name)).equals(fs.readFileSync(path.join(s.copy, r.name))));
  assert.equal(fs.readdirSync(s.copy).filter(n => n.endsWith('.part')).length, 0, 'no half-written files left');
  s.db.close();
});

test('an unusable second folder never stops the real backup; missing copies follow once it works', () => {
  const s = setup(); fs.writeFileSync(path.join(s.dir, 'drive'), 'not a folder');   // "drive" is a file: mkdir fails
  const a = BK.make(s.db, s.dbPath, 'manual');
  assert.equal(fs.existsSync(path.join(s.main, a.name)), true, 'the main backup exists');
  assert.equal(a.mirror.ok, false); assert.ok(a.mirror.error.length > 0);
  fs.rmSync(path.join(s.dir, 'drive')); const m = BK.syncMirror(s.dbPath);   // the drive is back
  assert.equal(m.ok, true); assert.equal(m.copied, 1); assert.equal(fs.existsSync(path.join(s.copy, a.name)), true);
  s.db.close();
});

test('the second folder keeps the newest 30 automatic copies; the folder may also come from data/backup-copy-dir.txt', () => {
  const s = setup(); fs.mkdirSync(s.main, { recursive: true });
  for (let i = 1; i <= 33; i++) fs.writeFileSync(path.join(s.main, `fuelpro-2026-10-${String(i).padStart(2, '0')}-010101-auto.db`), 'x');
  const m = BK.syncMirror(s.dbPath); assert.equal(m.ok, true);
  assert.equal(fs.readdirSync(s.copy).length, 30); assert.equal(fs.existsSync(path.join(s.copy, 'fuelpro-2026-10-33-010101-auto.db')), true);
  delete process.env.BACKUP_COPY_DIR; assert.equal(BK.mirrorDirFor(s.dbPath), '');
  fs.writeFileSync(path.join(s.dir, 'backup-copy-dir.txt'), `"${path.join(s.dir, 'usb')}"\r\n`);
  assert.equal(BK.mirrorDirFor(s.dbPath), path.join(s.dir, 'usb'));
  assert.equal(BK.syncMirror(s.dbPath).ok, true); assert.ok(fs.readdirSync(path.join(s.dir, 'usb')).length > 0);
  s.db.close();
});
