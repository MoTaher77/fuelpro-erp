'use strict';
/* PostgreSQL bridge (Phase 2, stage A). The dialect tests always run; the live tests need a PostgreSQL server:
   FUELPRO_TEST_PG=postgres://user:pass@127.0.0.1:5433/dbname npm test  (CI starts one). */
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../src/pg/dialect');

test('dialect: ? placeholders become $n but never inside string literals; datetime(\'now\') and INSERT OR IGNORE are translated', () => {
  const t = D.translate("SELECT a FROM t WHERE x=? AND note='what? is \"it\"' AND y=? AND ts<datetime('now')");
  assert.equal(t.params, 2); assert.match(t.sql, /x=\$1 AND note='what\? is "it"' AND y=\$2/); assert.match(t.sql, /to_char\(now\(\) at time zone 'utc'/); assert.doesNotMatch(t.sql, /datetime/);
  assert.equal(D.translate('INSERT OR IGNORE INTO m(a,b) VALUES(?,?)').sql, 'INSERT INTO m(a,b) VALUES($1,$2) ON CONFLICT DO NOTHING');
  assert.equal(D.translate("SELECT 'it''s ?' || ?").sql, "SELECT 'it''s ?' || $1");
  assert.equal(D.insertTable('INSERT INTO sales(a) VALUES(?)'), 'sales'); assert.equal(D.insertTable('SELECT 1'), null);
  assert.ok(D.isNoop('PRAGMA foreign_keys=ON')); assert.equal(D.simple('BEGIN IMMEDIATE'), 'BEGIN');
});

const url = process.env.FUELPRO_TEST_PG;
test('PostgreSQL bridge: sync exec/prepare/run/get/all, ids, types, transactions, savepoints and errors', { skip: url ? false : 'set FUELPRO_TEST_PG to run against a PostgreSQL server' }, () => {
  const { PgSync } = require('../src/pg/sync');
  const db = new PgSync(url);
  try {
    db.exec('DROP TABLE IF EXISTS fp_t CASCADE; CREATE TABLE fp_t(id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, qty BIGINT NOT NULL DEFAULT 0, ok BOOLEAN NOT NULL DEFAULT true, at TEXT)');
    db.idTables.add('fp_t');
    const ins = db.prepare('INSERT INTO fp_t(name, qty, at) VALUES(?,?,datetime(\'now\'))');
    const a = ins.run('alpha', 41), b = ins.run('beta', 9007199254740991);
    assert.equal(a.changes, 1); assert.equal(a.lastInsertRowid, 1); assert.equal(b.lastInsertRowid, 2);
    const row = db.prepare('SELECT * FROM fp_t WHERE name=?').get('beta');
    assert.equal(row.qty, 9007199254740991); assert.equal(typeof row.qty, 'number'); assert.equal(row.ok, 1); assert.match(row.at, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
    assert.deepEqual(db.prepare('SELECT name FROM fp_t ORDER BY id').all().map(r => r.name), ['alpha', 'beta']);
    assert.equal(db.prepare('SELECT * FROM fp_t WHERE name=?').get('nope'), undefined);
    assert.equal(db.prepare('SELECT COALESCE(SUM(qty),0) v FROM fp_t WHERE id=?').get(1).v, 41);
    /* the same transaction idiom as src/db.js tx(): BEGIN IMMEDIATE, nested SAVEPOINT, rollback */
    db.exec('BEGIN IMMEDIATE'); ins.run('gamma', 1);
    db.exec('SAVEPOINT sp1'); ins.run('delta', 2); db.exec('ROLLBACK TO sp1'); db.exec('RELEASE sp1'); db.exec('COMMIT');
    assert.deepEqual(db.prepare('SELECT name FROM fp_t ORDER BY id').all().map(r => r.name), ['alpha', 'beta', 'gamma']);
    db.exec('BEGIN IMMEDIATE'); ins.run('epsilon', 5); db.exec('ROLLBACK');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM fp_t').get().n, 3);
    assert.throws(() => ins.run('alpha', 1), (e) => /constraint/i.test(e.message) && e.code === '23505');   // server.js maps messages containing "constraint" to 409
    assert.equal(db.prepare('INSERT OR IGNORE INTO fp_t(name, qty) VALUES(?,?)').run('alpha', 3).changes, 0);
    assert.equal(db.prepare('SELECT 1 v').get().v, 1); db.exec('PRAGMA foreign_keys=ON');   // pragmas are ignored
    assert.equal(db.prepare('UPDATE fp_t SET qty=qty+1 WHERE name=?').run('alpha').changes, 1);
    const t0 = Date.now(); for (let i = 0; i < 300; i++) db.prepare('SELECT qty FROM fp_t WHERE id=?').get(1); const ms = Date.now() - t0;
    assert.ok(ms < 3000, `300 round trips took ${ms} ms`);
  } finally { try { db.exec('DROP TABLE IF EXISTS fp_t'); } catch { /* cleanup */ } db.close(); }
});
