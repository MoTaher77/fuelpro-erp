'use strict';
const { DatabaseSync } = require('node:sqlite');

const MIGRATIONS = [
`
CREATE TABLE orgs(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE users(
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES orgs(id),
  email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, pw_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN('owner','manager','cashier')),
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE sessions(
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ip TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE stations(
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES orgs(id), name TEXT NOT NULL,
  currency TEXT NOT NULL, cur_dec INTEGER NOT NULL, timezone TEXT NOT NULL,
  vat_bp INTEGER NOT NULL DEFAULT 0 CHECK(vat_bp BETWEEN 0 AND 10000),
  vat_included INTEGER NOT NULL DEFAULT 1, allow_negative INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE fuels(
  id INTEGER PRIMARY KEY, station_id INTEGER NOT NULL REFERENCES stations(id), name TEXT NOT NULL,
  price_e4 INTEGER NOT NULL DEFAULT 0 CHECK(price_e4>=0), cost_e4 INTEGER NOT NULL DEFAULT 0 CHECK(cost_e4>=0),
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE tanks(
  id INTEGER PRIMARY KEY, station_id INTEGER NOT NULL REFERENCES stations(id), name TEXT NOT NULL,
  fuel_id INTEGER NOT NULL REFERENCES fuels(id),
  capacity_ml INTEGER NOT NULL CHECK(capacity_ml>0), level_ml INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  CHECK(level_ml>=0 AND level_ml<=capacity_ml)
);
CREATE TABLE pumps(
  id INTEGER PRIMARY KEY, station_id INTEGER NOT NULL REFERENCES stations(id), name TEXT NOT NULL,
  tank_id INTEGER NOT NULL REFERENCES tanks(id), fuel_id INTEGER NOT NULL REFERENCES fuels(id),
  meter_ml INTEGER NOT NULL DEFAULT 0 CHECK(meter_ml>=0), active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE customers(
  id INTEGER PRIMARY KEY, station_id INTEGER NOT NULL REFERENCES stations(id), name TEXT NOT NULL,
  phone TEXT, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE sales(
  id INTEGER PRIMARY KEY, station_id INTEGER NOT NULL REFERENCES stations(id),
  client_id TEXT NOT NULL, pump_id INTEGER NOT NULL REFERENCES pumps(id),
  fuel_id INTEGER NOT NULL, tank_id INTEGER NOT NULL,
  business_date TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  quantity_ml INTEGER NOT NULL CHECK(quantity_ml>0), price_e4 INTEGER NOT NULL CHECK(price_e4>0), cost_e4 INTEGER NOT NULL,
  net INTEGER NOT NULL, vat INTEGER NOT NULL, gross INTEGER NOT NULL,
  vat_bp INTEGER NOT NULL, vat_included INTEGER NOT NULL,
  pay_type TEXT NOT NULL CHECK(pay_type IN('cash','credit')),
  customer_id INTEGER REFERENCES customers(id),
  open_ml INTEGER NOT NULL, close_ml INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  voided_at TEXT, void_reason TEXT, void_by INTEGER REFERENCES users(id),
  UNIQUE(station_id, client_id),
  CHECK(pay_type='cash' OR customer_id IS NOT NULL)
);
CREATE INDEX sales_day ON sales(station_id, business_date);
CREATE TABLE deliveries(
  id INTEGER PRIMARY KEY, station_id INTEGER NOT NULL REFERENCES stations(id),
  tank_id INTEGER NOT NULL REFERENCES tanks(id), fuel_id INTEGER NOT NULL,
  business_date TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  quantity_ml INTEGER NOT NULL CHECK(quantity_ml>0), cost_e4 INTEGER NOT NULL CHECK(cost_e4>=0),
  net INTEGER NOT NULL, vat INTEGER NOT NULL DEFAULT 0, supplier TEXT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  voided_at TEXT, void_reason TEXT, void_by INTEGER REFERENCES users(id)
);
CREATE INDEX deliveries_day ON deliveries(station_id, business_date);
CREATE TABLE expenses(
  id INTEGER PRIMARY KEY, station_id INTEGER NOT NULL REFERENCES stations(id),
  business_date TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  category TEXT NOT NULL, gross INTEGER NOT NULL CHECK(gross>0), vat INTEGER NOT NULL DEFAULT 0,
  note TEXT, user_id INTEGER NOT NULL REFERENCES users(id),
  voided_at TEXT, void_reason TEXT, void_by INTEGER REFERENCES users(id),
  CHECK(vat>=0 AND vat<=gross)
);
CREATE INDEX expenses_day ON expenses(station_id, business_date);
CREATE TABLE payments(
  id INTEGER PRIMARY KEY, station_id INTEGER NOT NULL REFERENCES stations(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  business_date TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  amount INTEGER NOT NULL CHECK(amount>0), note TEXT, user_id INTEGER NOT NULL REFERENCES users(id),
  voided_at TEXT, void_reason TEXT, void_by INTEGER REFERENCES users(id)
);
CREATE TABLE adjustments(
  id INTEGER PRIMARY KEY, station_id INTEGER NOT NULL REFERENCES stations(id),
  tank_id INTEGER NOT NULL REFERENCES tanks(id), business_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  before_ml INTEGER NOT NULL, after_ml INTEGER NOT NULL, note TEXT,
  user_id INTEGER NOT NULL REFERENCES users(id)
);
CREATE TABLE audit(
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL, station_id INTEGER, user_id INTEGER,
  action TEXT NOT NULL, entity TEXT, entity_id INTEGER, detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX audit_org ON audit(org_id, id DESC);
`,
/* v2: password reset + two-factor authentication */
`
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN totp_last_step INTEGER NOT NULL DEFAULT 0;
CREATE TABLE recovery_codes(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), code_hash TEXT NOT NULL, used_at TEXT
);
CREATE INDEX recovery_user ON recovery_codes(user_id);
CREATE TABLE reset_tokens(
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, ip TEXT
);
CREATE INDEX reset_user ON reset_tokens(user_id);
`,
/* v3: roles + station access, inventory ledger, shifts, suppliers, general ledger. Rebuilds users (needs foreign_keys OFF). */
{ fkOff: true, sql: `
CREATE TABLE users_new(
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES orgs(id),
  email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, pw_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN('owner','admin','manager','accountant','supervisor','cashier','viewer')),
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  totp_secret TEXT, totp_enabled INTEGER NOT NULL DEFAULT 0, totp_last_step INTEGER NOT NULL DEFAULT 0
);
INSERT INTO users_new(id,org_id,email,name,pw_hash,role,active,created_at,totp_secret,totp_enabled,totp_last_step)
  SELECT id,org_id,email,name,pw_hash,role,active,created_at,totp_secret,totp_enabled,totp_last_step FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE TABLE user_stations(
  user_id INTEGER NOT NULL REFERENCES users(id), station_id INTEGER NOT NULL REFERENCES stations(id), PRIMARY KEY(user_id, station_id)
);
INSERT INTO user_stations SELECT u.id, s.id FROM users u JOIN stations s ON s.org_id=u.org_id WHERE u.role<>'owner';

ALTER TABLE orgs ADD COLUMN locked_through TEXT;
ALTER TABLE stations ADD COLUMN require_shift INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tanks ADD COLUMN min_ml INTEGER NOT NULL DEFAULT 0 CHECK(min_ml>=0);
ALTER TABLE tanks ADD COLUMN value INTEGER NOT NULL DEFAULT 0 CHECK(value>=0);
ALTER TABLE tanks ADD COLUMN avg_cost_e4 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN credit_limit INTEGER NOT NULL DEFAULT 0 CHECK(credit_limit>=0);
ALTER TABLE customers ADD COLUMN terms_days INTEGER NOT NULL DEFAULT 30;
ALTER TABLE customers ADD COLUMN opening_balance INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN created_on TEXT;

CREATE TABLE shifts(
  id INTEGER PRIMARY KEY, station_id INTEGER NOT NULL REFERENCES stations(id), business_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','closed','approved')),
  float_amount INTEGER NOT NULL DEFAULT 0 CHECK(float_amount>=0),
  opened_by INTEGER NOT NULL REFERENCES users(id), opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_by INTEGER REFERENCES users(id), closed_at TEXT, counted_cash INTEGER, expected_cash INTEGER, variance INTEGER, close_note TEXT,
  approved_by INTEGER REFERENCES users(id), approved_at TEXT,
  CHECK(status='open' OR (counted_cash IS NOT NULL AND expected_cash IS NOT NULL AND variance=counted_cash-expected_cash))
);
CREATE UNIQUE INDEX shifts_one_open ON shifts(station_id) WHERE status='open';
CREATE INDEX shifts_station ON shifts(station_id, id DESC);
CREATE TABLE shift_meters(
  shift_id INTEGER NOT NULL REFERENCES shifts(id), pump_id INTEGER NOT NULL REFERENCES pumps(id),
  open_ml INTEGER NOT NULL, close_ml INTEGER, PRIMARY KEY(shift_id, pump_id)
);
CREATE TABLE cash_moves(
  id INTEGER PRIMARY KEY, station_id INTEGER NOT NULL REFERENCES stations(id), shift_id INTEGER NOT NULL REFERENCES shifts(id),
  business_date TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT NOT NULL CHECK(kind IN('withdrawal','deposit')), counterpart TEXT NOT NULL CHECK(counterpart IN('bank','owner')),
  amount INTEGER NOT NULL CHECK(amount>0), note TEXT, user_id INTEGER NOT NULL REFERENCES users(id),
  voided_at TEXT, void_reason TEXT, void_by INTEGER REFERENCES users(id)
);
ALTER TABLE sales ADD COLUMN cogs INTEGER;
ALTER TABLE sales ADD COLUMN shift_id INTEGER REFERENCES shifts(id);
ALTER TABLE payments ADD COLUMN shift_id INTEGER REFERENCES shifts(id);
ALTER TABLE payments ADD COLUMN method TEXT NOT NULL DEFAULT 'cash' CHECK(method IN('cash','bank'));
ALTER TABLE expenses ADD COLUMN shift_id INTEGER REFERENCES shifts(id);
ALTER TABLE expenses ADD COLUMN method TEXT NOT NULL DEFAULT 'cash' CHECK(method IN('cash','bank'));
CREATE INDEX sales_shift ON sales(shift_id);
CREATE INDEX sales_customer ON sales(customer_id);
CREATE INDEX payments_customer ON payments(customer_id);

CREATE TABLE suppliers(
  id INTEGER PRIMARY KEY, station_id INTEGER NOT NULL REFERENCES stations(id), name TEXT NOT NULL, phone TEXT,
  opening_balance INTEGER NOT NULL DEFAULT 0, terms_days INTEGER NOT NULL DEFAULT 30, created_on TEXT, active INTEGER NOT NULL DEFAULT 1
);
ALTER TABLE deliveries ADD COLUMN shift_id INTEGER REFERENCES shifts(id);
ALTER TABLE deliveries ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id);
ALTER TABLE deliveries ADD COLUMN pay_type TEXT NOT NULL DEFAULT 'cash' CHECK(pay_type IN('cash','bank','credit'));
ALTER TABLE deliveries ADD COLUMN due_date TEXT;
CREATE TABLE supplier_payments(
  id INTEGER PRIMARY KEY, station_id INTEGER NOT NULL REFERENCES stations(id), supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  shift_id INTEGER REFERENCES shifts(id), business_date TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  amount INTEGER NOT NULL CHECK(amount>0), method TEXT NOT NULL DEFAULT 'cash' CHECK(method IN('cash','bank')), note TEXT,
  user_id INTEGER NOT NULL REFERENCES users(id), voided_at TEXT, void_reason TEXT, void_by INTEGER REFERENCES users(id)
);
CREATE INDEX deliveries_supplier ON deliveries(supplier_id);
CREATE INDEX supplier_payments_sup ON supplier_payments(supplier_id);

CREATE TABLE transfers(
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES orgs(id),
  from_station_id INTEGER NOT NULL REFERENCES stations(id), to_station_id INTEGER NOT NULL REFERENCES stations(id),
  from_tank_id INTEGER NOT NULL REFERENCES tanks(id), to_tank_id INTEGER NOT NULL REFERENCES tanks(id),
  business_date TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  quantity_ml INTEGER NOT NULL CHECK(quantity_ml>0), value INTEGER NOT NULL CHECK(value>=0), note TEXT,
  user_id INTEGER NOT NULL REFERENCES users(id), voided_at TEXT, void_reason TEXT, void_by INTEGER REFERENCES users(id),
  CHECK(from_tank_id<>to_tank_id)
);
CREATE TABLE stock_moves(
  id INTEGER PRIMARY KEY, station_id INTEGER NOT NULL REFERENCES stations(id), tank_id INTEGER NOT NULL REFERENCES tanks(id),
  business_date TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT NOT NULL CHECK(kind IN('opening','sale','delivery','count','transfer_in','transfer_out','void')),
  ref_type TEXT, ref_id INTEGER, qty_ml INTEGER NOT NULL, value INTEGER NOT NULL,
  balance_ml INTEGER NOT NULL, balance_value INTEGER NOT NULL, avg_cost_e4 INTEGER NOT NULL, user_id INTEGER
);
CREATE INDEX stock_moves_tank ON stock_moves(tank_id, id);
CREATE INDEX stock_moves_day ON stock_moves(station_id, business_date);
CREATE TRIGGER stock_moves_append_only_u BEFORE UPDATE ON stock_moves BEGIN SELECT RAISE(ABORT, 'stock ledger is append-only'); END;
CREATE TRIGGER stock_moves_append_only_d BEFORE DELETE ON stock_moves BEGIN SELECT RAISE(ABORT, 'stock ledger is append-only'); END;

CREATE TABLE accounts(
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES orgs(id), code TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN('asset','liability','equity','income','expense')),
  name_ar TEXT NOT NULL, name_en TEXT NOT NULL, sys TEXT, active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(org_id, code), UNIQUE(org_id, sys)
);
CREATE TABLE journals(
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES orgs(id), station_id INTEGER NOT NULL REFERENCES stations(id),
  business_date TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','posted')), posted_at TEXT,
  source TEXT NOT NULL, source_id INTEGER, memo TEXT, user_id INTEGER REFERENCES users(id),
  reversal_of INTEGER REFERENCES journals(id), reversed_by INTEGER REFERENCES journals(id)
);
CREATE INDEX journals_day ON journals(org_id, station_id, business_date);
CREATE INDEX journals_src ON journals(org_id, source, source_id);
CREATE TABLE journal_lines(
  id INTEGER PRIMARY KEY, journal_id INTEGER NOT NULL REFERENCES journals(id), account_id INTEGER NOT NULL REFERENCES accounts(id),
  debit INTEGER NOT NULL DEFAULT 0, credit INTEGER NOT NULL DEFAULT 0, party_type TEXT, party_id INTEGER, memo TEXT,
  CHECK(debit>=0 AND credit>=0 AND (debit=0 OR credit=0) AND debit+credit>0)
);
CREATE INDEX jl_journal ON journal_lines(journal_id);
CREATE INDEX jl_account ON journal_lines(account_id);
CREATE INDEX jl_party ON journal_lines(party_type, party_id);
CREATE TRIGGER journal_post_balanced BEFORE UPDATE OF status ON journals WHEN OLD.status='draft' AND NEW.status='posted'
BEGIN
  SELECT RAISE(ABORT, 'journal is not balanced') WHERE
    (SELECT COALESCE(SUM(debit),0) - COALESCE(SUM(credit),0) FROM journal_lines WHERE journal_id=NEW.id) <> 0
    OR (SELECT COUNT(*) FROM journal_lines WHERE journal_id=NEW.id) < 2;
END;
CREATE TRIGGER journal_no_unpost BEFORE UPDATE OF status ON journals WHEN OLD.status='posted' AND NEW.status<>'posted'
BEGIN SELECT RAISE(ABORT, 'posted journals cannot be un-posted'); END;
CREATE TRIGGER journal_no_edit BEFORE UPDATE OF business_date, station_id, org_id ON journals WHEN OLD.status='posted'
BEGIN SELECT RAISE(ABORT, 'posted journals are immutable'); END;
CREATE TRIGGER journal_no_delete BEFORE DELETE ON journals WHEN OLD.status='posted'
BEGIN SELECT RAISE(ABORT, 'posted journals cannot be deleted'); END;
CREATE TRIGGER jl_no_insert_posted BEFORE INSERT ON journal_lines WHEN (SELECT status FROM journals WHERE id=NEW.journal_id)='posted'
BEGIN SELECT RAISE(ABORT, 'posted journals are immutable'); END;
CREATE TRIGGER jl_no_update_posted BEFORE UPDATE ON journal_lines WHEN (SELECT status FROM journals WHERE id=OLD.journal_id)='posted'
BEGIN SELECT RAISE(ABORT, 'posted journals are immutable'); END;
CREATE TRIGGER jl_no_delete_posted BEFORE DELETE ON journal_lines WHEN (SELECT status FROM journals WHERE id=OLD.journal_id)='posted'
BEGIN SELECT RAISE(ABORT, 'posted journals are immutable'); END;
`, after: (db) => require('./ledger').migrateV3(db) },
/* v4: account tree (groups), cash & bank boxes, receipt / payment vouchers, legacy reference numbers for imported data */
`
ALTER TABLE accounts ADD COLUMN parent_id INTEGER REFERENCES accounts(id);
ALTER TABLE accounts ADD COLUMN is_group INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN box TEXT CHECK(box IN('cash','bank'));
CREATE INDEX accounts_parent ON accounts(parent_id);
UPDATE accounts SET box='cash' WHERE sys='cash';
UPDATE accounts SET box='bank' WHERE sys='bank';
ALTER TABLE customers ADD COLUMN ref TEXT;
ALTER TABLE suppliers ADD COLUMN ref TEXT;
ALTER TABLE deliveries ADD COLUMN payable INTEGER;
CREATE TABLE vouchers(
  id INTEGER PRIMARY KEY, station_id INTEGER NOT NULL REFERENCES stations(id),
  kind TEXT NOT NULL CHECK(kind IN('receipt','payment')), ref_no TEXT,
  business_date TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  box_account_id INTEGER NOT NULL REFERENCES accounts(id), amount INTEGER NOT NULL CHECK(amount>0),
  memo TEXT, shift_id INTEGER REFERENCES shifts(id), user_id INTEGER NOT NULL REFERENCES users(id),
  voided_at TEXT, void_reason TEXT, void_by INTEGER REFERENCES users(id)
);
CREATE INDEX vouchers_day ON vouchers(station_id, business_date);
CREATE TABLE voucher_lines(
  id INTEGER PRIMARY KEY, voucher_id INTEGER NOT NULL REFERENCES vouchers(id), account_id INTEGER NOT NULL REFERENCES accounts(id),
  party_type TEXT CHECK(party_type IN('customer','supplier')), party_id INTEGER, amount INTEGER NOT NULL CHECK(amount>0), memo TEXT
);
CREATE INDEX voucher_lines_v ON voucher_lines(voucher_id);
`,

/* v5: keep a document's own wording and number (sales statements read exactly like the source documents) */
`
ALTER TABLE sales ADD COLUMN note TEXT;
ALTER TABLE sales ADD COLUMN ref TEXT;
ALTER TABLE journals ADD COLUMN ref TEXT;
`,
/* v6: letterhead — the name, activity, address and logo printed at the head of statements and documents */
`
CREATE TABLE org_brand(
  org_id INTEGER PRIMARY KEY REFERENCES orgs(id), name TEXT, activity TEXT, address TEXT, phones TEXT, footer TEXT, logo TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`,
/* v7: price history (every change of a fuel's selling price, with the cost at that moment) */
`
CREATE TABLE price_history(
  id INTEGER PRIMARY KEY, station_id INTEGER NOT NULL REFERENCES stations(id), fuel_id INTEGER NOT NULL REFERENCES fuels(id),
  effective_at TEXT NOT NULL, price_e4 INTEGER NOT NULL, cost_e4 INTEGER, old_price_e4 INTEGER, user_id INTEGER REFERENCES users(id), note TEXT
);
CREATE INDEX price_history_fuel ON price_history(fuel_id, effective_at);
`,
/* v8: purchase invoices carry their own number and wording */
`
ALTER TABLE deliveries ADD COLUMN ref TEXT;
ALTER TABLE deliveries ADD COLUMN note TEXT;
CREATE INDEX deliveries_supplier_day ON deliveries(supplier_id, business_date);
CREATE INDEX sales_ref ON sales(station_id, ref);
`,
/* v9: currencies & exchange rates (foreign-currency boxes, banks and lines), fixed assets & depreciation */
`
CREATE TABLE currencies(
  org_id INTEGER NOT NULL REFERENCES orgs(id), code TEXT NOT NULL, name_ar TEXT NOT NULL, name_en TEXT NOT NULL, decimals INTEGER NOT NULL DEFAULT 2, active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(org_id, code)
);
CREATE TABLE exchange_rates(
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES orgs(id), code TEXT NOT NULL, rate_date TEXT NOT NULL, rate_e6 INTEGER NOT NULL CHECK(rate_e6>0),
  user_id INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(org_id, code, rate_date)
);
ALTER TABLE accounts ADD COLUMN currency TEXT;
ALTER TABLE journal_lines ADD COLUMN fc_code TEXT;
ALTER TABLE journal_lines ADD COLUMN fc_amount INTEGER;
ALTER TABLE journal_lines ADD COLUMN fc_rate_e6 INTEGER;
ALTER TABLE vouchers ADD COLUMN fc_code TEXT;
ALTER TABLE vouchers ADD COLUMN fc_rate_e6 INTEGER;
ALTER TABLE vouchers ADD COLUMN fc_amount INTEGER;
ALTER TABLE voucher_lines ADD COLUMN fc_amount INTEGER;
CREATE TABLE fixed_assets(
  id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES orgs(id), station_id INTEGER NOT NULL REFERENCES stations(id), name TEXT NOT NULL, ref TEXT,
  account_id INTEGER NOT NULL REFERENCES accounts(id), accum_account_id INTEGER NOT NULL REFERENCES accounts(id), expense_account_id INTEGER NOT NULL REFERENCES accounts(id),
  acquired_on TEXT NOT NULL, cost INTEGER NOT NULL CHECK(cost>=0), salvage INTEGER NOT NULL DEFAULT 0 CHECK(salvage>=0), life_months INTEGER NOT NULL DEFAULT 0 CHECK(life_months>=0),
  opening_accum INTEGER NOT NULL DEFAULT 0, disposed_on TEXT, note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX fixed_assets_station ON fixed_assets(station_id);
`,
/* v10: allowed evaporation / handling loss per station (basis points of litres sold) */
`
ALTER TABLE stations ADD COLUMN loss_tolerance_bp INTEGER NOT NULL DEFAULT 50 CHECK(loss_tolerance_bp BETWEEN 0 AND 2000);
`,
/* v11: documents keep their kind and reference as the source printed them (نوع الحركة / المرجع) */
`
ALTER TABLE journals ADD COLUMN doc_type TEXT;
ALTER TABLE journals ADD COLUMN doc_ref TEXT;
ALTER TABLE sales ADD COLUMN bill TEXT;
`,
/* v12: amounts may be kept more precisely than they are shown (the old books kept rials to the thousandth, printed to the fils) */
`
ALTER TABLE stations ADD COLUMN disp_dec INTEGER CHECK(disp_dec IS NULL OR disp_dec BETWEEN 0 AND 4);
`







];

function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;');
  let v = db.prepare('PRAGMA user_version').get().user_version;
  for (; v < MIGRATIONS.length; v++) {
    const m = typeof MIGRATIONS[v] === 'string' ? { sql: MIGRATIONS[v] } : MIGRATIONS[v];
    if (m.fkOff) db.exec('PRAGMA foreign_keys=OFF');          // table rebuilds (SQLite 12-step procedure)
    db.exec('BEGIN');
    try {
      db.exec(m.sql); if (m.after) m.after(db);
      if (m.fkOff) { const bad = db.prepare('PRAGMA foreign_key_check').all(); if (bad.length) throw new Error('Foreign key check failed after migration ' + (v + 1)); }
      db.exec(`PRAGMA user_version=${v + 1}`); db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    finally { if (m.fkOff) db.exec('PRAGMA foreign_keys=ON'); }
  }
  return db;
}

/** Run fn inside an IMMEDIATE transaction (writers serialize; no lost updates). Nested calls become savepoints. */
function tx(db, fn) {
  if (db.__inTx) {
    const sp = 'sp' + (db.__sp = (db.__sp || 0) + 1);
    db.exec(`SAVEPOINT ${sp}`);
    try { const r = fn(); db.exec(`RELEASE ${sp}`); return r; }
    catch (e) { try { db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`); } catch {} throw e; }
  }
  db.exec('BEGIN IMMEDIATE'); db.__inTx = true;
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
  finally { db.__inTx = false; }
}

module.exports = { openDb, tx, MIGRATIONS };
