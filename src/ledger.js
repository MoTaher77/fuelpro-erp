'use strict';
/* Double-entry general ledger + perpetual stock ledger (weighted average cost).
   Every operational document posts one balanced journal inside the same transaction as the document itself.
   The database refuses to post an unbalanced journal and refuses to change or delete a posted one (see triggers in db.js). */
const { divRound, amountMinor } = require('./money');
const { HttpError, conflict, bad } = require('./errors');

/* [system key, code, type, Arabic name, English name] */
const CHART = [
  ['cash', '1010', 'asset', 'الصندوق (النقدية)', 'Cash on hand'],
  ['bank', '1020', 'asset', 'البنك', 'Bank'],
  ['ar', '1100', 'asset', 'ذمم العملاء', 'Accounts receivable'],
  ['vat_in', '1150', 'asset', 'ضريبة المدخلات', 'Input VAT'],
  ['interbranch', '1190', 'asset', 'جاري الفروع', 'Inter-branch current account'],
  ['inventory', '1200', 'asset', 'مخزون الوقود', 'Fuel inventory'],
  ['ap', '2010', 'liability', 'ذمم الموردين', 'Accounts payable'],
  ['vat_out', '2100', 'liability', 'ضريبة المخرجات', 'Output VAT'],
  ['capital', '3010', 'equity', 'رأس المال والأرصدة الافتتاحية', 'Capital & opening balances'],
  ['drawings', '3200', 'equity', 'مسحوبات المالك', 'Owner drawings'],
  ['retained', '3900', 'equity', 'الأرباح المحتجزة', 'Retained earnings'],
  ['sales', '4010', 'income', 'مبيعات الوقود', 'Fuel sales'],
  ['other_income', '4900', 'income', 'إيرادات أخرى (زيادات المخزون والصندوق)', 'Other income (stock & cash surpluses)'],
  ['cogs', '5010', 'expense', 'تكلفة الوقود المباع', 'Cost of fuel sold'],
  ['stock_loss', '5100', 'expense', 'عجز المخزون', 'Stock shortage'],
  ['cash_short', '5200', 'expense', 'عجز الصندوق', 'Cash shortage'],
  ['exp_salaries', '6010', 'expense', 'الرواتب والأجور', 'Salaries & wages'],
  ['exp_power', '6020', 'expense', 'الكهرباء والمولدات', 'Power & generators'],
  ['exp_maint', '6030', 'expense', 'الصيانة', 'Maintenance'],
  ['exp_transport', '6040', 'expense', 'النقل', 'Transport'],
  ['exp_rent', '6050', 'expense', 'الإيجار', 'Rent'],
  ['exp_fees', '6060', 'expense', 'الرسوم والضرائب', 'Fees & taxes'],
  ['exp_other', '6090', 'expense', 'مصروفات أخرى', 'Other expenses'],
  ['exp_dep', '6070', 'expense', 'مصروف الإهلاك', 'Depreciation expense'],
  ['accum_dep', '1290', 'asset', 'مجمع إهلاك الأصول الثابتة', 'Accumulated depreciation'],
  ['fx', '4950', 'income', 'فروق أسعار الصرف', 'Exchange differences']
];
const EXPENSE_KEYS = new Set(['salaries', 'power', 'maint', 'transport', 'rent', 'fees', 'other']);
const expenseKey = (cat) => 'exp_' + (EXPENSE_KEYS.has(cat) ? cat : 'other');

function ensureChart(db, orgId) {
  const ins = db.prepare('INSERT OR IGNORE INTO accounts(org_id,code,type,name_ar,name_en,sys) VALUES(?,?,?,?,?,?)');
  for (const [sys, code, type, ar, en] of CHART) ins.run(orgId, code, type, ar, en, sys);
  try { db.prepare("UPDATE accounts SET box=sys WHERE org_id=? AND sys IN('cash','bank') AND box IS NULL").run(orgId); } catch { /* before migration v4 */ }
}
function acct(db, orgId, sys) {
  let r = db.prepare('SELECT id FROM accounts WHERE org_id=? AND sys=?').get(orgId, sys);
  if (!r) { ensureChart(db, orgId); r = db.prepare('SELECT id FROM accounts WHERE org_id=? AND sys=?').get(orgId, sys); }
  if (!r) throw new Error('Unknown system account ' + sys);
  return r.id;
}

function lockedThrough(db, orgId) { return db.prepare('SELECT locked_through FROM orgs WHERE id=?').get(orgId).locked_through; }
function assertOpen(db, orgId, date) {
  const l = lockedThrough(db, orgId);
  if (l && date <= l) throw conflict('PERIOD_LOCKED', `The accounting period is closed through ${l}`, { locked_through: l });
}

/** Insert a journal. lines: [{ a: sysKey | accountId, dr, cr, party_type?, party_id?, memo? }]. Zero lines are dropped. */
function post(db, { org_id, station_id, date, source, source_id = null, memo = null, user_id = null, lines, status = 'posted', reversal_of = null }) {
  assertOpen(db, org_id, date);
  const clean = [];
  for (const l of lines) {
    const dr = l.dr || 0, cr = l.cr || 0;
    if (!Number.isSafeInteger(dr) || !Number.isSafeInteger(cr) || dr < 0 || cr < 0) throw new Error('Bad journal amount');
    const net = dr - cr; if (net === 0) continue;
    clean.push({ ...l, dr: net > 0 ? net : 0, cr: net < 0 ? -net : 0, account_id: typeof l.a === 'number' ? l.a : acct(db, org_id, l.a) });
  }
  if (!clean.length) return null;
  const d = clean.reduce((s, l) => s + l.dr, 0), c = clean.reduce((s, l) => s + l.cr, 0);
  if (d !== c) throw bad('JOURNAL_UNBALANCED', 'Total debit must equal total credit', { debit: d, credit: c });
  const jid = Number(db.prepare('INSERT INTO journals(org_id,station_id,business_date,status,source,source_id,memo,user_id,reversal_of) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(org_id, station_id, date, 'draft', source, source_id, memo, user_id, reversal_of).lastInsertRowid);
  const ins = db.prepare('INSERT INTO journal_lines(journal_id,account_id,debit,credit,party_type,party_id,memo) VALUES(?,?,?,?,?,?,?)');
  const fcIns = (id, l) => { if (l.fc_code) db.prepare('UPDATE journal_lines SET fc_code=?, fc_amount=?, fc_rate_e6=? WHERE id=?').run(l.fc_code, l.fc_amount ?? null, l.fc_rate_e6 ?? null, id); };
  for (const l of clean) { const r = ins.run(jid, l.account_id, l.dr, l.cr, l.party_type || null, l.party_id || null, l.memo || null); fcIns(Number(r.lastInsertRowid), l); }
  if (status === 'posted') db.prepare("UPDATE journals SET status='posted', posted_at=datetime('now') WHERE id=?").run(jid);   // trigger re-checks the balance
  return jid;
}

/** Reverse one posted journal with a mirror entry on the same business date. */
function reverse(db, j, userId, memo) {
  if (j.status !== 'posted') throw conflict('NOT_POSTED', 'Only posted journals can be reversed');
  if (j.reversed_by) throw conflict('ALREADY_REVERSED', 'This journal is already reversed');
  if (j.reversal_of) throw conflict('IS_REVERSAL', 'A reversal cannot itself be reversed; post a new entry instead');
  const lines = db.prepare('SELECT * FROM journal_lines WHERE journal_id=?').all(j.id);
  const rid = post(db, { org_id: j.org_id, station_id: j.station_id, date: j.business_date, source: j.source, source_id: j.source_id, memo: memo || ('Reversal of #' + j.id), user_id: userId, reversal_of: j.id,
    lines: lines.map(l => ({ a: l.account_id, dr: l.credit, cr: l.debit, party_type: l.party_type, party_id: l.party_id, fc_code: l.fc_code, fc_amount: l.fc_amount, fc_rate_e6: l.fc_rate_e6 })) });
  db.prepare('UPDATE journals SET reversed_by=? WHERE id=?').run(rid, j.id);
  return rid;
}
function reverseSource(db, orgId, source, sourceId, userId, memo) {
  const js = db.prepare("SELECT * FROM journals WHERE org_id=? AND source=? AND source_id=? AND status='posted' AND reversed_by IS NULL AND reversal_of IS NULL").all(orgId, source, sourceId);
  for (const j of js) reverse(db, j, userId, memo);
  return js.length;
}

/* ---------- stock ledger ---------- */
const E7 = 10_000_000n;
const atCost = (ml, costE4) => Number(divRound(BigInt(ml) * BigInt(costE4), E7));
/**
 * Move stock in or out of a tank and keep level, value and weighted average cost consistent.
 * qty is signed (ml). value is the signed value change in minor units; omit it to move at the current average cost.
 * Returns the value actually moved (an issue that empties the tank takes the whole remaining value).
 */
function stockMove(db, tankId, { qty, value, kind, ref_type = null, ref_id = null, date, user_id = null }) {
  const t = db.prepare('SELECT * FROM tanks WHERE id=?').get(tankId);
  const level = t.level_ml + qty;
  if (level < 0 || level > t.capacity_ml) throw conflict(level < 0 ? 'INSUFFICIENT_STOCK' : 'EXCEEDS_CAPACITY', 'Stock movement out of tank range', { level_ml: t.level_ml, capacity_ml: t.capacity_ml });
  let v = value;
  if (v === undefined || v === null) v = qty < 0 ? (level === 0 ? -t.value : -atCost(-qty, t.avg_cost_e4)) : atCost(qty, t.avg_cost_e4);
  let nv = t.value + v;
  if (level === 0 || nv < 0) nv = 0;          // an empty tank carries no value; rounding residue is absorbed by the caller
  const moved = nv - t.value;
  const avg = level > 0 ? Number(divRound(BigInt(nv) * E7, BigInt(level))) : t.avg_cost_e4;   // keep last average while empty
  db.prepare('UPDATE tanks SET level_ml=?, value=?, avg_cost_e4=? WHERE id=?').run(level, nv, avg, tankId);
  db.prepare('INSERT INTO stock_moves(station_id,tank_id,business_date,kind,ref_type,ref_id,qty_ml,value,balance_ml,balance_value,avg_cost_e4,user_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(t.station_id, tankId, date, kind, ref_type, ref_id, qty, moved, level, nv, avg, user_id);
  return moved;
}

/* Inventory book value vs. intended posting: route any difference to cost of sales so GL inventory always equals stock value. */
function inventoryFix(intended, actual) {
  const d = actual - intended;
  return d > 0 ? [{ a: 'inventory', dr: d }, { a: 'cogs', cr: d }] : d < 0 ? [{ a: 'cogs', dr: -d }, { a: 'inventory', cr: -d }] : [];
}

/* ---------- v3 data migration: chart of accounts + opening balances for data created before the ledger existed ---------- */
function migrateV3(db) {
  for (const o of db.prepare('SELECT id FROM orgs').all()) ensureChart(db, o.id);
  const today = new Date().toISOString().slice(0, 10);
  for (const s of db.prepare('SELECT * FROM stations').all()) {
    const lines = [];
    for (const t of db.prepare('SELECT t.*, f.cost_e4 fcost FROM tanks t JOIN fuels f ON f.id=t.fuel_id WHERE t.station_id=?').all(s.id)) {
      const value = atCost(t.level_ml, t.fcost);
      db.prepare('UPDATE tanks SET value=?, avg_cost_e4=? WHERE id=?').run(value, t.level_ml ? t.fcost : 0, t.id);
      db.prepare("INSERT INTO stock_moves(station_id,tank_id,business_date,kind,ref_type,qty_ml,value,balance_ml,balance_value,avg_cost_e4) VALUES(?,?,?,'opening','migration',?,?,?,?,?)")
        .run(s.id, t.id, today, t.level_ml, value, t.level_ml, value, t.fcost);
      lines.push({ a: 'inventory', dr: value }, { a: 'capital', cr: value });
    }
    for (const c of db.prepare('SELECT id FROM customers WHERE station_id=?').all(s.id)) {
      const bal = db.prepare('SELECT COALESCE((SELECT SUM(gross) FROM sales WHERE customer_id=? AND voided_at IS NULL),0) - COALESCE((SELECT SUM(amount) FROM payments WHERE customer_id=? AND voided_at IS NULL),0) b').get(c.id, c.id).b;
      if (bal) { lines.push({ a: 'ar', dr: Math.max(bal, 0), cr: Math.max(-bal, 0), party_type: 'customer', party_id: c.id }, { a: 'capital', dr: Math.max(-bal, 0), cr: Math.max(bal, 0) }); }
      db.prepare('UPDATE customers SET opening_balance=0 WHERE id=?').run(c.id);
    }
    post(db, { org_id: s.org_id, station_id: s.id, date: today, source: 'migration', memo: 'Opening balances at ledger go-live', lines });
  }
}

module.exports = { CHART, ensureChart, acct, assertOpen, lockedThrough, post, reverse, reverseSource, stockMove, atCost, inventoryFix, expenseKey, migrateV3 };
