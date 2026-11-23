'use strict';
/* Bank reconciliation («تسوية البنك»): match the bank statement with the books.
   A reconciliation is for one bank/cash account of one station, up to a statement date, with the statement's closing balance.
   The user ticks the book lines that appear on the statement (cleared). Cleared marks live in bank_cleared — posted journal
   lines are never changed. Statement balance must equal the total of every cleared line (all final reconciliations + this one)
   before it can be finalised. Foreign-currency accounts reconcile in their own currency (fc_amount). */
const V = require('./validate');
const { tx } = require('./db');
const { bad, conflict, notFound } = require('./errors');
const S = require('./services');
const { need, audit, station } = S;

function account(db, user, id) {
  const a = db.prepare('SELECT * FROM accounts WHERE id=? AND org_id=?').get(id, user.org_id);
  if (!a || !(a.box || a.sys === 'cash' || a.sys === 'bank')) throw notFound('Bank account');
  const st = db.prepare('SELECT currency FROM stations WHERE org_id=? LIMIT 1').get(user.org_id);
  const fc = a.currency && st && a.currency !== st.currency ? a.currency : null;
  const decimals = fc ? (db.prepare('SELECT decimals FROM currencies WHERE org_id=? AND code=?').get(user.org_id, fc) || { decimals: 2 }).decimals : null;
  return { ...a, fc, fc_decimals: decimals };
}
const amtSql = (fc) => fc ? 'CASE WHEN l.fc_amount IS NULL THEN 0 WHEN l.debit>0 THEN l.fc_amount ELSE -l.fc_amount END' : '(l.debit - l.credit)';
function getRec(db, user, sid, id) {
  const r = db.prepare('SELECT * FROM bank_recs WHERE id=? AND station_id=? AND org_id=?').get(id, sid, user.org_id);
  if (!r) throw notFound('Reconciliation'); return r;
}

/** bank/cash accounts of the station with their book balance and last finalised reconciliation */
function overview(db, user, sid) {
  need(user, 'report.read'); station(db, user, sid);
  const accts = db.prepare("SELECT id FROM accounts WHERE org_id=? AND active=1 AND is_group=0 AND (box IS NOT NULL OR sys IN('cash','bank')) ORDER BY (box='bank' OR sys='bank') DESC, code").all(user.org_id);
  return accts.map(({ id }) => { const a = account(db, user, id);
    const bal = db.prepare(`SELECT COALESCE(SUM(${amtSql(a.fc)}),0) v FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE l.account_id=? AND j.station_id=? AND j.status='posted'`).get(id, sid).v;
    const last = db.prepare("SELECT id, statement_date, statement_balance FROM bank_recs WHERE station_id=? AND account_id=? AND status='final' ORDER BY statement_date DESC, id DESC LIMIT 1").get(sid, id) || null;
    const draft = db.prepare("SELECT id, statement_date FROM bank_recs WHERE station_id=? AND account_id=? AND status='draft'").get(sid, id) || null;
    return { account_id: id, code: a.code, name_ar: a.name_ar, name_en: a.name_en, kind: a.box || a.sys, currency: a.fc, book_balance: bal, last_final: last, draft,
      recs: db.prepare('SELECT id, statement_date, statement_balance, status, finalized_at FROM bank_recs WHERE station_id=? AND account_id=? ORDER BY statement_date DESC, id DESC LIMIT 24').all(sid, id) }; });
}

function create(db, user, sid, b) {
  need(user, 'bank.reconcile'); station(db, user, sid); V.obj(b, 'body');
  const a = account(db, user, V.int(b.account_id, 'account_id', { min: 1 }));
  const date = V.date(b.statement_date, 'statement_date');
  const bal = V.int(b.statement_balance, 'statement_balance', { min: -(10 ** 15), max: 10 ** 15 });
  return tx(db, () => {
    if (db.prepare("SELECT 1 FROM bank_recs WHERE station_id=? AND account_id=? AND status='draft'").get(sid, a.id)) throw conflict('DRAFT_EXISTS', 'Finish or delete the open reconciliation of this account first');
    const last = db.prepare("SELECT statement_date FROM bank_recs WHERE station_id=? AND account_id=? AND status='final' ORDER BY statement_date DESC LIMIT 1").get(sid, a.id);
    if (last && date < last.statement_date) throw bad('DATE_BEFORE_LAST', 'The statement date is before the last finalised reconciliation', { last: last.statement_date });
    const id = Number(db.prepare('INSERT INTO bank_recs(org_id,station_id,account_id,statement_date,statement_balance,note,created_by) VALUES(?,?,?,?,?,?,?)')
      .run(user.org_id, sid, a.id, date, bal, V.str(b.note, 'note', { max: 200, optional: true }) || null, user.id).lastInsertRowid);
    audit(db, user, sid, 'bankrec.create', 'bank_rec', id, { account: a.code, date, balance: bal });
    return detail(db, user, sid, id);
  });
}

function detail(db, user, sid, id) {
  need(user, 'report.read'); station(db, user, sid);
  const r = getRec(db, user, sid, id), a = account(db, user, r.account_id), amt = amtSql(a.fc);
  const lines = db.prepare(`SELECT l.id, j.id journal_id, j.business_date date, j.source, j.ref, j.doc_type, COALESCE(l.memo, j.memo) memo, ${amt} amount, c.rec_id
      FROM journal_lines l JOIN journals j ON j.id=l.journal_id LEFT JOIN bank_cleared c ON c.line_id=l.id
      WHERE l.account_id=? AND j.station_id=? AND j.status='posted' AND j.business_date<=? AND (c.rec_id IS NULL OR c.rec_id=?)
      ORDER BY j.business_date, j.id, l.id`).all(a.id, sid, r.statement_date, r.id)
    .filter(l => l.amount !== 0).map(l => ({ ...l, cleared: l.rec_id === r.id }));
  const book = db.prepare(`SELECT COALESCE(SUM(${amt}),0) v FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE l.account_id=? AND j.station_id=? AND j.status='posted' AND j.business_date<=?`).get(a.id, sid, r.statement_date).v;
  const before = db.prepare(`SELECT COALESCE(SUM(${amt}),0) v FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN bank_cleared c ON c.line_id=l.id JOIN bank_recs br ON br.id=c.rec_id
    WHERE l.account_id=? AND j.station_id=? AND br.status='final' AND br.id<>?`).get(a.id, sid, r.id).v;
  const now = lines.filter(l => l.cleared).reduce((t, l) => t + l.amount, 0);
  const open = lines.filter(l => !l.cleared);
  const deposits = open.filter(l => l.amount > 0).reduce((t, l) => t + l.amount, 0), payments = open.filter(l => l.amount < 0).reduce((t, l) => t + l.amount, 0);
  const cleared = before + now;
  return { ...r, account: { id: a.id, code: a.code, name_ar: a.name_ar, name_en: a.name_en, currency: a.fc, decimals: a.fc_decimals },
    lines, summary: { book_balance: book, cleared_before: before, cleared_now: now, cleared_balance: cleared, outstanding_deposits: deposits, outstanding_payments: payments,
      statement_balance: r.statement_balance, difference: r.statement_balance - cleared, balanced: r.statement_balance === cleared } };
}

function update(db, user, sid, id, b) {
  need(user, 'bank.reconcile'); station(db, user, sid); V.obj(b, 'body');
  return tx(db, () => {
    const r = getRec(db, user, sid, id); if (r.status !== 'draft') throw conflict('REC_FINAL', 'This reconciliation is final; reopen it first');
    if (b.statement_date !== undefined) db.prepare('UPDATE bank_recs SET statement_date=? WHERE id=?').run(V.date(b.statement_date, 'statement_date'), id);
    if (b.statement_balance !== undefined) db.prepare('UPDATE bank_recs SET statement_balance=? WHERE id=?').run(V.int(b.statement_balance, 'statement_balance', { min: -(10 ** 15), max: 10 ** 15 }), id);
    if (b.note !== undefined) db.prepare('UPDATE bank_recs SET note=? WHERE id=?').run(V.str(b.note, 'note', { max: 200, optional: true }) || null, id);
    const ids = (k) => { const v = b[k]; if (v === undefined) return []; if (!Array.isArray(v) || v.length > 20000) throw bad('VALIDATION', k + ' must be a list'); return v.map(x => V.int(x, k, { min: 1 })); };
    const cur = getRec(db, user, sid, id);
    const ok = db.prepare(`SELECT 1 FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE l.id=? AND l.account_id=? AND j.station_id=? AND j.status='posted' AND j.business_date<=?`);
    const ins = db.prepare('INSERT OR IGNORE INTO bank_cleared(line_id, rec_id) VALUES(?,?)');
    for (const lid of ids('clear')) { if (!ok.get(lid, cur.account_id, sid, cur.statement_date)) throw bad('LINE_NOT_ON_ACCOUNT', 'A line does not belong to this account and period', { line_id: lid });
      const other = db.prepare('SELECT rec_id FROM bank_cleared WHERE line_id=?').get(lid); if (other && other.rec_id !== id) throw conflict('LINE_ALREADY_CLEARED', 'A line is already cleared in another reconciliation', { line_id: lid });
      ins.run(lid, id); }
    const del = db.prepare('DELETE FROM bank_cleared WHERE line_id=? AND rec_id=?');
    for (const lid of ids('unclear')) del.run(lid, id);
    /* a later statement date may not keep lines dated after it */
    db.prepare('DELETE FROM bank_cleared WHERE rec_id=? AND line_id IN (SELECT l.id FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE j.business_date>?)').run(id, cur.statement_date);
    return detail(db, user, sid, id);
  });
}

function finalize(db, user, sid, id) {
  need(user, 'bank.reconcile');
  return tx(db, () => {
    const d = detail(db, user, sid, id); if (d.status !== 'draft') throw conflict('REC_FINAL', 'Already final');
    if (!d.summary.balanced) throw conflict('REC_NOT_BALANCED', 'The cleared items do not add up to the statement balance', { difference: d.summary.difference });
    db.prepare("UPDATE bank_recs SET status='final', finalized_by=?, finalized_at=datetime('now') WHERE id=?").run(user.id, id);
    audit(db, user, sid, 'bankrec.finalize', 'bank_rec', id, { date: d.statement_date, balance: d.statement_balance });
    return detail(db, user, sid, id);
  });
}
function reopen(db, user, sid, id) {
  need(user, 'bank.reconcile');
  return tx(db, () => {
    const r = getRec(db, user, sid, id); if (r.status !== 'final') throw conflict('REC_NOT_FINAL', 'Only a final reconciliation can be reopened');
    const later = db.prepare("SELECT 1 FROM bank_recs WHERE station_id=? AND account_id=? AND id<>? AND (status='draft' OR statement_date>? OR (statement_date=? AND id>?))").get(sid, r.account_id, id, r.statement_date, r.statement_date, id);
    if (later) throw conflict('NOT_LATEST', 'Only the latest reconciliation of an account can be reopened');
    db.prepare("UPDATE bank_recs SET status='draft', finalized_by=NULL, finalized_at=NULL WHERE id=?").run(id);
    audit(db, user, sid, 'bankrec.reopen', 'bank_rec', id); return detail(db, user, sid, id);
  });
}
function remove(db, user, sid, id) {
  need(user, 'bank.reconcile');
  return tx(db, () => {
    const r = getRec(db, user, sid, id); if (r.status !== 'draft') throw conflict('REC_FINAL', 'A final reconciliation cannot be deleted; reopen it first');
    db.prepare('DELETE FROM bank_cleared WHERE rec_id=?').run(id); db.prepare('DELETE FROM bank_recs WHERE id=?').run(id);
    audit(db, user, sid, 'bankrec.delete', 'bank_rec', id); return { ok: true };
  });
}

module.exports = { overview, create, detail, update, finalize, reopen, remove };
