'use strict';
// Same data as pg-seed.sql. Usage: node seed-sqlite.js out.db
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs'); const out = process.argv[2]; try { fs.unlinkSync(out); } catch {}
const db = new DatabaseSync(out);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=OFF; PRAGMA cache_size=-200000;
CREATE TABLE orgs(id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE stations(id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES orgs(id), name TEXT NOT NULL);
CREATE TABLE sales(id INTEGER PRIMARY KEY, station_id INTEGER NOT NULL REFERENCES stations(id), pump_id INTEGER NOT NULL, qty_ml INTEGER NOT NULL, price_e4 INTEGER NOT NULL, amount INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE stock_moves(id INTEGER PRIMARY KEY, station_id INTEGER NOT NULL, tank_id INTEGER NOT NULL, qty_ml INTEGER NOT NULL, ref_sale INTEGER NOT NULL);
CREATE TABLE journals(id INTEGER PRIMARY KEY, station_id INTEGER NOT NULL, source TEXT NOT NULL, ref INTEGER NOT NULL);
CREATE TABLE journal_lines(id INTEGER PRIMARY KEY, journal_id INTEGER NOT NULL REFERENCES journals(id), account_id INTEGER NOT NULL, debit INTEGER NOT NULL DEFAULT 0, credit INTEGER NOT NULL DEFAULT 0);
CREATE TABLE audit(id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, action TEXT NOT NULL, ref INTEGER NOT NULL);
INSERT INTO orgs VALUES (1,'Org A'),(2,'Org B');
INSERT INTO stations VALUES (1,1,'S1'),(2,1,'S2'),(3,1,'S3'),(4,2,'S4'),(5,2,'S5'),(6,2,'S6');`);
const sS = db.prepare('INSERT INTO sales VALUES (?,?,?,?,?,?,?)'), sM = db.prepare('INSERT INTO stock_moves VALUES (?,?,?,?,?)');
const sJ = db.prepare("INSERT INTO journals VALUES (?,?,'sale',?)"), sL = db.prepare('INSERT INTO journal_lines VALUES (?,?,?,?,?)');
const sA = db.prepare("INSERT INTO audit VALUES (?,?,'sale.create',?)");
db.exec('BEGIN');
for (let i = 1; i <= 1200000; i++) {
  const st = ((i - 1) % 6) + 1, pump = (Math.floor((i - 1) / 6) % 8) + 1, q = 5000 + ((i * 7919) % 60000);
  const amt = Math.floor(q * 3500000 / 10000), cost = Math.floor(amt * 9 / 10);
  sS.run(i, st, pump, q, 3500000, amt, 1735689600 + (i - 1) * 26);
  sM.run(i, st, (pump % 2) + 1, -q, i); sJ.run(i, st, i);
  sL.run(4 * i - 3, i, 1100, amt, 0); sL.run(4 * i - 2, i, 4100, 0, amt); sL.run(4 * i - 1, i, 5100, cost, 0); sL.run(4 * i, i, 1300, 0, cost);
  sA.run(i, st <= 3 ? 1 : 2, i);
}
db.exec('COMMIT');
db.exec(`CREATE INDEX sales_station_id ON sales(station_id, id);
CREATE INDEX sales_station_day ON sales(station_id, created_at);
CREATE INDEX stock_station ON stock_moves(station_id);
CREATE INDEX journals_station ON journals(station_id, id);
CREATE INDEX jl_journal ON journal_lines(journal_id, debit, credit);
ANALYZE; PRAGMA wal_checkpoint(TRUNCATE);`);
console.log(db.prepare('SELECT count(*) n, sum(debit)-sum(credit) d FROM journal_lines').get());
db.close();
