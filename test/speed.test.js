'use strict';
/* v15 speed migration: the M7 "latest result" index exists and the planner has statistics, so account totals start
   from the account (index probe) instead of walking every journal of the station. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb, MIGRATIONS } = require('../src/db');

test('schema v15: m7_results_latest index, planner statistics, account totals use the account index', () => {
  const db = openDb(':memory:');
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, MIGRATIONS.length);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='m7_results_latest'").get(), 'index created');
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='sqlite_stat1'").get(), 'ANALYZE ran');
  const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT r.id FROM m7_results r WHERE r.station_id=1 AND r.kind IN (2,3) AND r.as_of BETWEEN '2025-01-01' AND '2025-12-31'
    AND r.id = (SELECT y.id FROM m7_results y WHERE y.station_id=r.station_id AND y.acno=r.acno AND y.as_of=r.as_of AND y.kind=r.kind ORDER BY y.made_at DESC, y.id DESC LIMIT 1)`).all().map(r => r.detail).join(' | ');
  assert.match(plan, /m7_results_latest/, plan);
  db.close();
});
