/* A comparable picture of the books: every row the sales & shifts module writes, minus wall-clock timestamps.
   Accounts are named by code so the two systems' ids may differ without hiding a real difference. */
export const DUMP_SQL: Record<string, string> = {
  sales: `SELECT id, station_id, client_id, pump_id, fuel_id, tank_id, business_date, quantity_ml, price_e4, cost_e4, net, vat, gross, vat_bp, vat_included,
          pay_type, customer_id, open_ml, close_ml, user_id, CASE WHEN voided_at IS NULL THEN 0 ELSE 1 END voided, void_reason, void_by, cogs, shift_id, discount
          FROM sales ORDER BY id`,
  stock_moves: `SELECT id, tank_id, business_date, kind, ref_type, ref_id, qty_ml, value, balance_ml, balance_value, avg_cost_e4, user_id FROM stock_moves ORDER BY id`,
  tanks: `SELECT id, name, fuel_id, capacity_ml, level_ml, value, avg_cost_e4 FROM tanks ORDER BY id`,
  pumps: `SELECT id, name, tank_id, fuel_id, meter_ml FROM pumps ORDER BY id`,
  shifts: `SELECT id, business_date, status, float_amount, opened_by, closed_by, counted_cash, expected_cash, variance, close_note, approved_by FROM shifts ORDER BY id`,
  shift_meters: `SELECT shift_id, pump_id, open_ml, close_ml FROM shift_meters ORDER BY shift_id, pump_id`,
  journals: `SELECT j.id, j.business_date, j.status, j.source, j.source_id, j.memo, j.user_id, j.reversal_of, j.reversed_by FROM journals j ORDER BY j.id`,
  journal_lines: `SELECT l.id, l.journal_id, a.code, l.debit, l.credit, l.party_type, l.party_id, l.memo FROM journal_lines l JOIN accounts a ON a.id=l.account_id ORDER BY l.id`,
  trial_balance: `SELECT a.code, SUM(l.debit) debit, SUM(l.credit) credit FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id
          WHERE j.status='posted' GROUP BY a.code ORDER BY a.code`,
  customer_balances: `SELECT l.party_id, SUM(l.debit - l.credit) balance FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id
          WHERE l.party_type='customer' AND a.sys='ar' AND j.status='posted' GROUP BY l.party_id ORDER BY l.party_id`,
  accounts: `SELECT code, type, sys, name_ar, name_en, box FROM accounts ORDER BY code`,
  audit: `SELECT action, entity, entity_id, detail FROM audit ORDER BY id`,
  suppliers: `SELECT id, station_id, name, opening_balance, terms_days, created_on, active FROM suppliers ORDER BY id`,
  deliveries: `SELECT id, station_id, tank_id, fuel_id, business_date, quantity_ml, cost_e4, net, vat, supplier, supplier_id, pay_type, due_date, shift_id, user_id, ref, note,
          CASE WHEN voided_at IS NULL THEN 0 ELSE 1 END voided, void_reason, void_by FROM deliveries ORDER BY id`,
  adjustments: `SELECT id, station_id, tank_id, business_date, before_ml, after_ml, note, user_id FROM adjustments ORDER BY id`,
  transfers: `SELECT id, from_station_id, to_station_id, from_tank_id, to_tank_id, business_date, quantity_ml, value, note, CASE WHEN voided_at IS NULL THEN 0 ELSE 1 END voided, void_reason FROM transfers ORDER BY id`,
  fuels: `SELECT id, station_id, name, price_e4, cost_e4 FROM fuels ORDER BY id`,
  payments: `SELECT id, station_id, customer_id, business_date, amount, note, user_id, method, shift_id, CASE WHEN voided_at IS NULL THEN 0 ELSE 1 END voided, void_reason FROM payments ORDER BY id`,
  supplier_payments: `SELECT id, station_id, supplier_id, business_date, amount, note, user_id, method, shift_id, CASE WHEN voided_at IS NULL THEN 0 ELSE 1 END voided, void_reason FROM supplier_payments ORDER BY id`,
  customers: `SELECT id, station_id, name, phone, active, credit_limit, terms_days, opening_balance, created_on FROM customers ORDER BY id`,
  supplier_balances: `SELECT l.party_id, SUM(l.credit - l.debit) balance FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id
          WHERE l.party_type='supplier' AND a.sys='ap' AND j.status='posted' GROUP BY l.party_id ORDER BY l.party_id`,
  expenses: `SELECT id, station_id, business_date, category, gross, vat, note, user_id, method, shift_id, CASE WHEN voided_at IS NULL THEN 0 ELSE 1 END voided, void_reason FROM expenses ORDER BY id`,
  cash_moves: `SELECT id, station_id, shift_id, business_date, kind, counterpart, amount, note, CASE WHEN voided_at IS NULL THEN 0 ELSE 1 END voided FROM cash_moves ORDER BY id`,
  vouchers: `SELECT id, station_id, kind, ref_no, business_date, box_account_id, amount, memo, shift_id, user_id, CASE WHEN voided_at IS NULL THEN 0 ELSE 1 END voided, void_reason FROM vouchers ORDER BY id`,
  voucher_lines: `SELECT id, voucher_id, account_id, party_type, party_id, amount, memo FROM voucher_lines ORDER BY id`,
  account_tree: `SELECT id, code, type, name_ar, name_en, sys, active, parent_id, is_group, box FROM accounts ORDER BY id`,
  journal_docs: `SELECT id, doc_type, ref, status FROM journals ORDER BY id`,
  locks: `SELECT id, locked_through FROM orgs ORDER BY id`,
  journal_refs: `SELECT id, ref FROM journals WHERE ref IS NOT NULL ORDER BY id`,
  counts: `SELECT (SELECT COUNT(*) FROM sales) sales, (SELECT COUNT(*) FROM journals) journals, (SELECT COUNT(*) FROM journal_lines) lines, (SELECT COUNT(*) FROM stock_moves) moves`
};
/** numbers as numbers (PostgreSQL may hand back text for SUM), every key in a fixed order */
export function norm(rows: Array<Record<string, unknown>>) {
  return rows.map((r) => Object.fromEntries(Object.keys(r).sort().map((k) => {
    const v = r[k];
    return [k, typeof v === 'bigint' ? Number(v) : typeof v === 'string' && /^-?\d+$/.test(v) && ['debit', 'credit', 'balance', 'sales', 'journals', 'lines', 'moves'].includes(k) ? Number(v) : v];
  })));
}
/** v1/v2 results without timestamps (they differ by design: wall clock) */
export function stripTimes(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(stripTimes);
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).filter(([k]) => !/(_at)$/.test(k)).map(([k, v]) => [k, stripTimes(v)]));
  return x;
}
