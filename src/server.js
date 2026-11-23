'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('./db');
const { createMailer } = require('./mailer');
const S = require('./services');
const O = require('./ops');
const B = require('./books');
const R = require('./reports');
const M7 = require('./m7archive');
const AN = require('./analytics');
const AL = require('./alerts');
const BR = require('./bankrec');
const auth = require('./auth');
const { HttpError, unauthorized, notFound } = require('./errors');

const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const COOKIE = 'sid';

function createApp({ dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'fuelpro.db'), secureCookie = process.env.COOKIE_SECURE === '1', trustProxy = process.env.TRUST_PROXY === '1', mailer = createMailer(), appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}` } = {}) {
  const db = openDb(dbPath);
  const BK = require('./backup');
  const backupTimer = BK.schedule(db, dbPath);
  appUrl = String(appUrl).replace(/\/+$/, '');   // reset links use this fixed address, never the request's Host header
  const routes = [];
  const route = (method, pattern, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler, public: !!opts.public });
  };
  const id = (v) => { const n = Number(v); if (!Number.isSafeInteger(n) || n < 1) throw new HttpError(400, 'VALIDATION', 'Invalid id'); return n; };

  /* ----- auth ----- */
  route('POST', '/api/auth/register', (c) => {
    const r = S.registerOrg(db, c.body, c.ip);
    const l = S.login(db, { email: c.body.email, password: c.body.password }, c.ip);
    c.setSession(l.token); return { status: 201, body: { ...r, user: l.user } };
  }, { public: true });
  route('POST', '/api/auth/login', (c) => { const l = S.login(db, c.body, c.ip); c.setSession(l.token); return { body: { user: l.user } }; }, { public: true });
  route('POST', '/api/auth/logout', (c) => { auth.destroySession(db, c.token); c.clearSession(); return { body: { ok: true } }; }, { public: true });
  route('POST', '/api/auth/change-password', (c) => ({ body: S.changePassword(db, c.user, c.body) }));
  route('POST', '/api/auth/forgot', (c) => ({ body: S.forgotPassword(db, c.body, c.ip, { mailer, appUrl }) }), { public: true });
  route('POST', '/api/auth/reset', (c) => ({ body: S.resetPassword(db, c.body, c.ip) }), { public: true });
  route('POST', '/api/auth/2fa/setup', (c) => ({ body: S.twoFactorSetup(db, c.user, c.body) }));
  route('POST', '/api/auth/2fa/enable', (c) => ({ body: S.twoFactorEnable(db, c.user, c.body) }));
  route('POST', '/api/auth/2fa/disable', (c) => ({ body: S.twoFactorDisable(db, c.user, c.body) }));
  route('POST', '/api/auth/2fa/recovery-codes', (c) => ({ body: S.twoFactorNewCodes(db, c.user, c.body) }));
  route('GET', '/api/me', (c) => ({ body: { user: { ...c.user, sid: undefined, recovery_left: c.user.totp ? S.recoveryLeft(db, c.user) : 0 }, perms: [...auth.PERMS[c.user.role]], stations: S.listStations(db, c.user) } }));

  /* ----- users & stations ----- */
  route('GET', '/api/users', (c) => ({ body: S.listUsers(db, c.user) }));
  route('POST', '/api/users', (c) => ({ status: 201, body: S.createUser(db, c.user, c.body) }));
  route('PATCH', '/api/users/:id', (c) => ({ body: S.updateUser(db, c.user, id(c.p.id), c.body) }));
  route('POST', '/api/stations', (c) => ({ status: 201, body: S.createStation(db, c.user, c.body) }));
  route('PATCH', '/api/stations/:sid', (c) => ({ body: S.updateStation(db, c.user, id(c.p.sid), c.body) }));
  route('GET', '/api/stations/:sid', (c) => ({ body: S.station(db, c.user, id(c.p.sid)) }));

  /* ----- configuration ----- */
  const st = (c) => id(c.p.sid);
  route('GET', '/api/stations/:sid/fuels', (c) => ({ body: S.listFuels(db, c.user, st(c)) }));
  route('POST', '/api/stations/:sid/fuels', (c) => ({ status: 201, body: S.createFuel(db, c.user, st(c), c.body) }));
  route('PATCH', '/api/stations/:sid/fuels/:fid', (c) => ({ body: S.updateFuelPrice(db, c.user, st(c), id(c.p.fid), c.body) }));
  route('GET', '/api/stations/:sid/tanks', (c) => ({ body: S.listTanks(db, c.user, st(c)) }));
  route('POST', '/api/stations/:sid/tanks', (c) => ({ status: 201, body: S.createTank(db, c.user, st(c), c.body) }));
  route('GET', '/api/stations/:sid/pumps', (c) => ({ body: S.listPumps(db, c.user, st(c)) }));
  route('POST', '/api/stations/:sid/pumps', (c) => ({ status: 201, body: S.createPump(db, c.user, st(c), c.body) }));
  route('POST', '/api/stations/:sid/pumps/:pid/meter', (c) => ({ body: S.correctMeter(db, c.user, st(c), id(c.p.pid), c.body) }));
  route('GET', '/api/stations/:sid/customers', (c) => ({ body: S.listCustomers(db, c.user, st(c)) }));
  route('GET', '/api/stations/:sid/customers/:cid/statement', (c) => ({ body: S.statement(db, c.user, st(c), id(c.p.cid), c.q) }));
  route('POST', '/api/stations/:sid/customers', (c) => ({ status: 201, body: S.createCustomer(db, c.user, st(c), c.body) }));

  /* ----- operations ----- */
  route('GET', '/api/stations/:sid/sales', (c) => ({ body: S.listSales(db, c.user, st(c), c.q) }));
  route('GET', '/api/stations/:sid/sales/export', (c) => ({ body: S.exportSales(db, c.user, st(c), c.q) }));
  route('POST', '/api/stations/:sid/sales', (c) => { const r = S.createSale(db, c.user, st(c), c.body); return { status: r.duplicate ? 200 : 201, body: r }; });
  route('POST', '/api/stations/:sid/sales/:id/void', (c) => ({ body: S.voidSale(db, c.user, st(c), id(c.p.id), c.body && c.body.reason) }));
  route('GET', '/api/stations/:sid/deliveries', (c) => ({ body: S.listDeliveries(db, c.user, st(c), c.q) }));
  route('POST', '/api/stations/:sid/deliveries', (c) => ({ status: 201, body: S.createDelivery(db, c.user, st(c), c.body) }));
  route('POST', '/api/stations/:sid/deliveries/:id/void', (c) => ({ body: S.voidDelivery(db, c.user, st(c), id(c.p.id), c.body && c.body.reason) }));
  route('POST', '/api/stations/:sid/adjustments', (c) => ({ status: 201, body: S.createAdjustment(db, c.user, st(c), c.body) }));
  route('GET', '/api/stations/:sid/expenses', (c) => ({ body: S.listExpenses(db, c.user, st(c), c.q) }));
  route('POST', '/api/stations/:sid/expenses', (c) => ({ status: 201, body: S.createExpense(db, c.user, st(c), c.body) }));
  route('POST', '/api/stations/:sid/expenses/:id/void', (c) => ({ body: S.voidExpense(db, c.user, st(c), id(c.p.id), c.body && c.body.reason) }));
  route('POST', '/api/stations/:sid/payments', (c) => ({ status: 201, body: S.createPayment(db, c.user, st(c), c.body) }));
  route('POST', '/api/stations/:sid/payments/:id/void', (c) => ({ body: S.voidPayment(db, c.user, st(c), id(c.p.id), c.body && c.body.reason) }));

  route('PATCH', '/api/stations/:sid/tanks/:tid', (c) => ({ body: O.updateTank(db, c.user, st(c), id(c.p.tid), c.body) }));
  route('PATCH', '/api/stations/:sid/customers/:cid', (c) => ({ body: O.updateCustomer(db, c.user, st(c), id(c.p.cid), c.body) }));

  /* ----- inventory ----- */
  route('GET', '/api/stations/:sid/stock/moves', (c) => ({ body: O.stockMoves(db, c.user, st(c), c.q) }));
  route('GET', '/api/stations/:sid/stock/reconciliation', (c) => ({ body: O.stockReconciliation(db, c.user, st(c), c.q) }));
  route('GET', '/api/stations/:sid/transfers', (c) => ({ body: O.listTransfers(db, c.user, st(c), c.q) }));
  route('POST', '/api/stations/:sid/transfers', (c) => ({ status: 201, body: O.createTransfer(db, c.user, st(c), c.body) }));
  route('POST', '/api/stations/:sid/transfers/:id/void', (c) => ({ body: O.voidTransfer(db, c.user, st(c), id(c.p.id), c.body) }));

  /* ----- shifts & cash ----- */
  route('GET', '/api/stations/:sid/shifts', (c) => ({ body: O.listShifts(db, c.user, st(c), c.q) }));
  route('GET', '/api/stations/:sid/shifts/current', (c) => ({ body: { shift: O.shiftDetail(db, c.user, st(c), 'current') } }));
  route('GET', '/api/stations/:sid/shifts/:id', (c) => ({ body: O.shiftDetail(db, c.user, st(c), id(c.p.id)) }));
  route('POST', '/api/stations/:sid/shifts', (c) => ({ status: 201, body: O.openShiftCmd(db, c.user, st(c), c.body || {}) }));
  route('POST', '/api/stations/:sid/shifts/:id/close', (c) => ({ body: O.closeShift(db, c.user, st(c), id(c.p.id), c.body) }));
  route('POST', '/api/stations/:sid/shifts/:id/approve', (c) => ({ body: O.approveShift(db, c.user, st(c), id(c.p.id)) }));
  route('POST', '/api/stations/:sid/shifts/:id/unapprove', (c) => ({ body: O.unapproveShift(db, c.user, st(c), id(c.p.id), c.body) }));
  route('POST', '/api/stations/:sid/shifts/:id/reopen', (c) => ({ body: O.reopenShift(db, c.user, st(c), id(c.p.id), c.body) }));
  route('POST', '/api/stations/:sid/cash-moves', (c) => ({ status: 201, body: O.cashMove(db, c.user, st(c), c.body) }));
  route('POST', '/api/stations/:sid/cash-moves/:id/void', (c) => ({ body: O.voidCashMove(db, c.user, st(c), id(c.p.id), c.body && c.body.reason) }));

  /* ----- suppliers ----- */
  route('GET', '/api/stations/:sid/suppliers', (c) => ({ body: O.listSuppliers(db, c.user, st(c)) }));
  route('POST', '/api/stations/:sid/suppliers', (c) => ({ status: 201, body: O.createSupplier(db, c.user, st(c), c.body) }));
  route('PATCH', '/api/stations/:sid/suppliers/:id', (c) => ({ body: O.updateSupplier(db, c.user, st(c), id(c.p.id), c.body) }));
  route('GET', '/api/stations/:sid/suppliers/:id/statement', (c) => ({ body: O.supplierStatement(db, c.user, st(c), id(c.p.id), c.q) }));
  route('POST', '/api/stations/:sid/supplier-payments', (c) => ({ status: 201, body: O.supplierPayment(db, c.user, st(c), c.body) }));
  route('POST', '/api/stations/:sid/supplier-payments/:id/void', (c) => ({ body: O.voidSupplierPayment(db, c.user, st(c), id(c.p.id), c.body && c.body.reason) }));
  route('GET', '/api/stations/:sid/ageing', (c) => ({ body: O.ageing(db, c.user, st(c), c.q) }));

  /* ----- accounting ----- */
  route('GET', '/api/accounts', (c) => ({ body: O.listAccounts(db, c.user) }));
  route('POST', '/api/accounts', (c) => ({ status: 201, body: B.createAccount(db, c.user, c.body) }));
  route('PATCH', '/api/accounts/:id', (c) => ({ body: B.updateAccount(db, c.user, id(c.p.id), c.body) }));
  route('GET', '/api/accounts/tree', (c) => ({ body: B.accountTree(db, c.user, c.q) }));
  route('GET', '/api/backups', (c) => { BK.can(c.user); return { body: { dir: BK.dirFor(dbPath), rows: BK.list(dbPath) } }; });
  route('POST', '/api/backups', (c) => { BK.can(c.user); return { status: 201, body: BK.make(db, dbPath, 'manual') }; });
  route('GET', '/api/backups/:name', (c) => { BK.can(c.user); return { file: BK.file(dbPath, c.p.name) }; });
  route('GET', '/api/stations/:sid/stock/monthly', (c) => ({ body: B.stockMonthly(db, c.user, st(c), c.q) }));
  route('GET', '/api/currencies', (c) => ({ body: B.listCurrencies(db, c.user) }));
  route('POST', '/api/currencies', (c) => ({ body: B.saveCurrency(db, c.user, c.body) }));
  route('POST', '/api/currencies/rates', (c) => ({ body: B.setRate(db, c.user, c.body) }));
  route('GET', '/api/accounting/revaluation', (c) => ({ body: B.revaluation(db, c.user, c.q) }));
  route('POST', '/api/accounting/revaluation', (c) => ({ status: 201, body: B.revaluation(db, c.user, c.body || {}, true) }));
  route('GET', '/api/stations/:sid/assets', (c) => ({ body: B.listAssets(db, c.user, st(c)) }));
  route('POST', '/api/stations/:sid/assets', (c) => ({ status: 201, body: B.saveAsset(db, c.user, st(c), c.body) }));
  route('PATCH', '/api/stations/:sid/assets/:id', (c) => ({ body: B.saveAsset(db, c.user, st(c), c.body, id(c.p.id)) }));
  route('POST', '/api/stations/:sid/assets/depreciate', (c) => ({ status: 201, body: B.runDepreciation(db, c.user, st(c), c.body) }));
  route('GET', '/api/stations/:sid/sales-register', (c) => ({ body: B.salesRegister(db, c.user, st(c), c.q) }));
  route('GET', '/api/stations/:sid/sales-register/:bill', (c) => ({ body: B.salesBill(db, c.user, st(c), decodeURIComponent(c.p.bill)) }));
  route('GET', '/api/stations/:sid/purchases', (c) => ({ body: B.purchases(db, c.user, st(c), c.q) }));
  route('GET', '/api/stations/:sid/purchases/:id', (c) => ({ body: B.purchaseDetail(db, c.user, st(c), id(c.p.id)) }));
  route('GET', '/api/accounting/profit-by-month', (c) => ({ body: B.profitByMonth(db, c.user, c.q) }));
  route('GET', '/api/stations/:sid/price-history', (c) => ({ body: B.priceHistory(db, c.user, st(c)) }));
  route('GET', '/api/brand', (c) => ({ body: B.getBrand(db, c.user) }));
  route('PATCH', '/api/brand', (c) => ({ body: B.setBrand(db, c.user, c.body) }));
  route('GET', '/api/boxes', (c) => ({ body: B.boxes(db, c.user) }));
  route('GET', '/api/stations/:sid/vouchers', (c) => ({ body: B.listVouchers(db, c.user, st(c), c.q) }));
  route('GET', '/api/stations/:sid/vouchers/:id', (c) => ({ body: B.getVoucher(db, c.user, st(c), id(c.p.id)) }));
  route('POST', '/api/stations/:sid/vouchers', (c) => ({ status: 201, body: B.createVoucher(db, c.user, st(c), c.body) }));
  route('POST', '/api/stations/:sid/vouchers/:id/void', (c) => ({ body: B.voidVoucher(db, c.user, st(c), id(c.p.id), c.body && c.body.reason) }));
  route('GET', '/api/stations/:sid/reports/boxes', (c) => ({ body: R.boxReport(db, c.user, st(c), c.q) }));
  route('GET', '/api/stations/:sid/reports/collections', (c) => ({ body: R.collections(db, c.user, st(c), c.q) }));
  route('GET', '/api/stations/:sid/reports/daily', (c) => ({ body: R.dailyReport(db, c.user, st(c), c.q) }));
  /* bank reconciliation */
  route('GET', '/api/stations/:sid/bank-recs', (c) => ({ body: BR.overview(db, c.user, st(c)) }));
  route('POST', '/api/stations/:sid/bank-recs', (c) => ({ status: 201, body: BR.create(db, c.user, st(c), c.body) }));
  route('GET', '/api/stations/:sid/bank-recs/:id', (c) => ({ body: BR.detail(db, c.user, st(c), id(c.p.id)) }));
  route('PATCH', '/api/stations/:sid/bank-recs/:id', (c) => ({ body: BR.update(db, c.user, st(c), id(c.p.id), c.body) }));
  route('POST', '/api/stations/:sid/bank-recs/:id/finalize', (c) => ({ body: BR.finalize(db, c.user, st(c), id(c.p.id)) }));
  route('POST', '/api/stations/:sid/bank-recs/:id/reopen', (c) => ({ body: BR.reopen(db, c.user, st(c), id(c.p.id)) }));
  route('DELETE', '/api/stations/:sid/bank-recs/:id', (c) => ({ body: BR.remove(db, c.user, st(c), id(c.p.id)) }));
  route('GET', '/api/stations/:sid/analytics', (c) => ({ body: AN.dashboard(db, c.user, st(c), c.q) }));
  route('GET', '/api/stations/:sid/alerts', (c) => ({ body: AL.alerts(db, c.user, st(c)) }));
  /* history carried over from the old M7 system */
  route('GET', '/api/stations/:sid/reports/old-results', (c) => ({ body: M7.oldResults(db, c.user, st(c), c.q) }));
  route('GET', '/api/stations/:sid/stock/old-values', (c) => ({ body: M7.oldStockValues(db, c.user, st(c), c.q) }));
  route('GET', '/api/journals/:id/history', (c) => ({ body: M7.journalHistory(db, c.user, id(c.p.id)) }));
  route('GET', '/api/accounting/year-close', (c) => ({ body: R.yearClose(db, c.user, c.q, false) }));
  route('POST', '/api/accounting/year-close', (c) => ({ status: 201, body: R.yearClose(db, c.user, c.body, true) }));
  route('POST', '/api/accounting/year-reopen', (c) => ({ body: R.yearReopen(db, c.user, c.body) }));
  route('GET', '/api/stations/:sid/reports/meters', (c) => ({ body: B.meterSheet(db, c.user, st(c), c.q) }));
  route('GET', '/api/stations/:sid/journals', (c) => ({ body: O.listJournals(db, c.user, st(c), c.q) }));
  route('POST', '/api/stations/:sid/journals', (c) => ({ status: 201, body: O.createJournal(db, c.user, st(c), c.body) }));
  route('GET', '/api/journals/:id', (c) => ({ body: O.getJournal(db, c.user, id(c.p.id)) }));
  route('POST', '/api/journals/:id/post', (c) => ({ body: O.postJournal(db, c.user, id(c.p.id)) }));
  route('POST', '/api/journals/:id/reverse', (c) => ({ body: O.reverseJournal(db, c.user, id(c.p.id), c.body) }));
  route('DELETE', '/api/journals/:id', (c) => ({ body: O.deleteDraft(db, c.user, id(c.p.id)) }));
  route('GET', '/api/accounting/trial-balance', (c) => ({ body: O.trialBalance(db, c.user, c.q) }));
  route('GET', '/api/accounting/income-statement', (c) => ({ body: O.incomeStatement(db, c.user, c.q) }));
  route('GET', '/api/accounting/balance-sheet', (c) => ({ body: O.balanceSheet(db, c.user, c.q) }));
  route('GET', '/api/accounting/cash-flow', (c) => ({ body: O.cashFlow(db, c.user, c.q) }));
  route('GET', '/api/accounting/ledger', (c) => ({ body: O.accountLedger(db, c.user, c.q) }));
  route('GET', '/api/accounting/lock', (c) => ({ body: { locked_through: require('./ledger').lockedThrough(db, c.user.org_id) } }));
  route('POST', '/api/accounting/lock', (c) => ({ body: O.lockPeriod(db, c.user, c.body) }));
  route('GET', '/api/accounting/integrity', (c) => ({ body: O.integrity(db, c.user) }));

  /* ----- reports ----- */
  route('GET', '/api/stations/:sid/dashboard', (c) => ({ body: S.dashboard(db, c.user, st(c)) }));
  route('GET', '/api/stations/:sid/summary', (c) => ({ body: S.summary(db, c.user, st(c), c.q) }));
  route('GET', '/api/stations/:sid/audit', (c) => ({ body: S.auditLog(db, c.user, st(c), c.q) }));
  route('GET', '/api/health', () => ({ body: { ok: true } }), { public: true });
  route('GET', '/healthz', () => { db.prepare('SELECT 1').get(); return { body: { ok: true } }; }, { public: true });

  /* ----- plumbing ----- */
  const parseCookies = (h) => Object.fromEntries((h || '').split(';').map(s => s.trim().split('=')).filter(a => a[0]).map(([k, ...v]) => [k, v.join('=')]));
  function readBody(req, limit = 1_000_000) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (d) => { size += d.length; if (size > limit) { reject(new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large')); req.destroy(); } else chunks.push(d); });
      req.on('end', () => {
        if (!chunks.length) return resolve(undefined);
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'BAD_JSON', 'Body is not valid JSON')); }
      });
      req.on('error', reject);
    });
  }
  function send(res, status, body, headers = {}) {
    const data = body === undefined ? '' : JSON.stringify(body, (_, v) => typeof v === 'bigint' ? Number(v) : v);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...secHeaders(), ...headers });
    res.end(data);
  }
  function secHeaders() {
    return {
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      ...(secureCookie ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {})
    };
  }
  function serveStatic(req, res, pathname) {
    let p = decodeURIComponent(pathname); if (p === '/' || !path.extname(p)) p = '/index.html';
    const file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, secHeaders()); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...secHeaders() });
      res.end(buf);
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    /* behind a proxy: Cloudflare's own CF-Connecting-IP (clients cannot forge it), else the last X-Forwarded-For hop the proxy added */
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(x => x.trim()).filter(Boolean);
    const ip = (trustProxy ? (req.headers['cf-connecting-ip'] || xff[xff.length - 1]) : null) || req.socket.remoteAddress || '';
    try {
      if (!url.pathname.startsWith('/api/') && url.pathname !== '/healthz') {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
        return serveStatic(req, res, url.pathname);
      }
      let matched = null;
      for (const r of routes) {
        const m = r.re.exec(url.pathname);
        if (m) { if (r.method === req.method) { matched = { r, m }; break; } else matched = matched || { wrongMethod: true }; }
      }
      if (!matched) throw notFound('Route');
      if (matched.wrongMethod) throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
      const { r, m } = matched;
      const mutating = req.method !== 'GET' && req.method !== 'HEAD';
      if (mutating) {   // CSRF: same-origin only + JSON only (cookies are SameSite=Strict as well)
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'CSRF', 'Cross-origin request blocked');
        const ct = String(req.headers['content-type'] || '');
        if (!ct.startsWith('application/json') && Number(req.headers['content-length'] || 0) > 0) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json');
      }
      const body = mutating ? await readBody(req) : undefined;
      const token = parseCookies(req.headers.cookie)[COOKIE];
      const out = { headers: {} };
      const ctx = {
        p: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])),
        q: Object.fromEntries(url.searchParams), body, ip, token,
        setSession: (t) => { out.headers['Set-Cookie'] = `${COOKIE}=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${7 * 24 * 3600}${secureCookie ? '; Secure' : ''}`; },
        clearSession: () => { out.headers['Set-Cookie'] = `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie ? '; Secure' : ''}`; }
      };
      if (!r.public) ctx.user = auth.loadSession(db, token);
      const result = r.handler(ctx);
      if (result.file) {   // a download (backups): stream the file
        const st = fs.statSync(result.file);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': st.size, 'Content-Disposition': `attachment; filename="${path.basename(result.file)}"`, 'Cache-Control': 'no-store', ...secHeaders() });
        return fs.createReadStream(result.file).pipe(res);
      }
      send(res, result.status || 200, result.body, out.headers);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: { code: e.code, message: e.message, ...(e.extra ? { details: e.extra } : {}) } });
      if (e && /constraint/i.test(String(e.message))) return send(res, 409, { error: { code: 'CONSTRAINT', message: 'The change violates a data integrity rule' } });
      console.error('Unhandled error:', e);
      send(res, 500, { error: { code: 'INTERNAL', message: 'Internal error' } });
    }
  });
  server.on('close', () => { if (backupTimer) clearInterval(backupTimer); });
  return { server, db };
}

if (require.main === module) {
  const { server } = createApp();
  if (!process.env.SMTP_HOST) console.warn('[mail] SMTP_HOST is not set: password-reset emails are printed to this log instead of being sent.');
  if (!process.env.APP_URL) console.warn('[mail] APP_URL is not set: reset links will point to http://localhost. Set APP_URL=https://your-domain.');
  if (!process.env.APP_SECRET) console.warn('[2fa] APP_SECRET is not set: two-factor secrets are stored unencrypted in the database.');
  const port = Number(process.env.PORT || 3000);
  server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`FuelPro listening on :${port}`));
  const stop = () => server.close(() => process.exit(0)); process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
module.exports = { createApp };
