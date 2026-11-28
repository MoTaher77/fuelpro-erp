/* One table of operations for every run mode. The server maps HTTP onto it; the desktop and phone editions call it
   in-process. Same names, same inputs, same answers — so the UI does not know which mode it runs in. */
import type { Ctx, User } from './ctx.ts';
import { AppError, notFound } from './errors.ts';
import * as reports from './reports.ts';
import * as sales from './sales.ts';
import * as setup from './setup.ts';
import * as shifts from './shifts.ts';
import * as stock from './stock.ts';
import * as parties from './parties.ts';
import * as finance from './finance.ts';
import * as statements from './statements.ts';

type Args = { sid: number; id: number; body: Record<string, unknown>; query: Record<string, string> };
type Op = (ctx: Ctx, user: User, a: Args) => Promise<unknown>;
const n = (v: string | undefined) => (v ? Number(v) : undefined);

export const OPS: Record<string, Op> = {
  'GET /stations/:sid': (c, u, a) => setup.getStation(c, u, a.sid),
  'GET /stations/:sid/pumps': (c, u, a) => setup.listPumps(c, u, a.sid),
  'GET /stations/:sid/tanks': (c, u, a) => setup.listTanks(c, u, a.sid),
  'GET /stations/:sid/customers': (c, u, a) => setup.listCustomers(c, u, a.sid),
  'POST /stations/:sid/fuels': (c, u, a) => setup.createFuel(c, u, a.sid, a.body),
  'POST /stations/:sid/tanks': (c, u, a) => setup.createTank(c, u, a.sid, a.body),
  'POST /stations/:sid/pumps': (c, u, a) => setup.createPump(c, u, a.sid, a.body),
  'POST /stations/:sid/customers': (c, u, a) => setup.createCustomer(c, u, a.sid, a.body),
  'PATCH /stations/:sid': (c, u, a) => setup.updateStation(c, u, a.sid, a.body),
  'GET /stations/:sid/sales': (c, u, a) => sales.listSales(c, u, a.sid, { date: a.query.date, before: n(a.query.before), limit: n(a.query.limit) }),
  'POST /stations/:sid/sales': (c, u, a) => sales.createSale(c, u, a.sid, a.body as unknown as sales.SaleInput),
  'POST /stations/:sid/sales/:id/void': (c, u, a) => sales.voidSale(c, u, a.sid, a.id, a.body.reason),
  'GET /stations/:sid/shift': (c, u, a) => shifts.currentShift(c, u, a.sid),
  'GET /stations/:sid/shifts': (c, u, a) => shifts.listShifts(c, u, a.sid),
  'POST /stations/:sid/shifts': (c, u, a) => shifts.openShiftCmd(c, u, a.sid, a.body),
  'POST /stations/:sid/shifts/:id/close': (c, u, a) => shifts.closeShift(c, u, a.sid, a.id, a.body as { counted_cash: number }),
  'POST /stations/:sid/shifts/:id/approve': (c, u, a) => shifts.approveShift(c, u, a.sid, a.id),
  'GET /stations/:sid/suppliers': (c, u, a) => stock.listSuppliers(c, u, a.sid),
  'POST /stations/:sid/suppliers': (c, u, a) => stock.createSupplier(c, u, a.sid, a.body),
  'GET /stations/:sid/deliveries': (c, u, a) => stock.listDeliveries(c, u, a.sid, { limit: n(a.query.limit), before_id: n(a.query.before_id) }),
  'POST /stations/:sid/deliveries': (c, u, a) => stock.createDelivery(c, u, a.sid, a.body as unknown as stock.DeliveryInput),
  'POST /stations/:sid/deliveries/:id/void': (c, u, a) => stock.voidDelivery(c, u, a.sid, a.id, a.body.reason),
  'POST /stations/:sid/adjustments': (c, u, a) => stock.createAdjustment(c, u, a.sid, a.body as never),
  'GET /stations/:sid/transfers': (c, u, a) => stock.listTransfers(c, u, a.sid, { limit: n(a.query.limit), before_id: n(a.query.before_id) }),
  'POST /stations/:sid/transfers': (c, u, a) => stock.createTransfer(c, u, a.sid, a.body as never),
  'POST /stations/:sid/transfers/:id/void': (c, u, a) => stock.voidTransfer(c, u, a.sid, a.id, a.body),
  'GET /stations/:sid/stock-moves': (c, u, a) => stock.stockMoves(c, u, a.sid, { tank_id: n(a.query.tank_id), from: a.query.from, to: a.query.to, limit: n(a.query.limit), before_id: n(a.query.before_id) }),
  'GET /stations/:sid/stock-reconciliation': (c, u, a) => stock.stockReconciliation(c, u, a.sid, { from: a.query.from, to: a.query.to }),
  'PATCH /stations/:sid/customers/:id': (c, u, a) => parties.updateCustomer(c, u, a.sid, a.id, a.body),
  'GET /stations/:sid/customers/:id/statement': (c, u, a) => parties.customerStatement(c, u, a.sid, a.id, { from: a.query.from, to: a.query.to }),
  'PATCH /stations/:sid/suppliers/:id': (c, u, a) => parties.updateSupplier(c, u, a.sid, a.id, a.body),
  'GET /stations/:sid/suppliers/:id/statement': (c, u, a) => parties.supplierStatement(c, u, a.sid, a.id, { from: a.query.from, to: a.query.to }),
  'POST /stations/:sid/payments': (c, u, a) => parties.createPayment(c, u, a.sid, a.body as never),
  'POST /stations/:sid/payments/:id/void': (c, u, a) => parties.voidPayment(c, u, a.sid, a.id, a.body.reason),
  'POST /stations/:sid/supplier-payments': (c, u, a) => parties.supplierPayment(c, u, a.sid, a.body as never),
  'POST /stations/:sid/supplier-payments/:id/void': (c, u, a) => parties.voidSupplierPayment(c, u, a.sid, a.id, a.body.reason),
  'GET /stations/:sid/ageing': (c, u, a) => parties.ageing(c, u, a.sid, { type: a.query.type, as_of: a.query.as_of }),
  'GET /accounts': (c, u) => finance.listAccounts(c, u),
  'POST /accounts': (c, u, a) => finance.createAccount(c, u, a.body),
  'PATCH /accounts/:id': (c, u, a) => finance.updateAccount(c, u, a.id, a.body),
  'GET /boxes': (c, u) => finance.boxes(c, u),
  'GET /stations/:sid/expenses': (c, u, a) => finance.listExpenses(c, u, a.sid, { from: a.query.from, to: a.query.to, limit: n(a.query.limit), before_id: n(a.query.before_id) }),
  'POST /stations/:sid/expenses': (c, u, a) => finance.createExpense(c, u, a.sid, a.body),
  'POST /stations/:sid/expenses/:id/void': (c, u, a) => finance.voidExpense(c, u, a.sid, a.id, a.body.reason),
  'POST /stations/:sid/cash-moves': (c, u, a) => finance.cashMove(c, u, a.sid, a.body),
  'POST /stations/:sid/cash-moves/:id/void': (c, u, a) => finance.voidCashMove(c, u, a.sid, a.id, a.body.reason),
  'GET /stations/:sid/vouchers': (c, u, a) => finance.listVouchers(c, u, a.sid, { from: a.query.from, to: a.query.to, kind: a.query.kind, box_account_id: n(a.query.box_account_id), limit: n(a.query.limit), before_id: n(a.query.before_id) }),
  'GET /stations/:sid/vouchers/:id': (c, u, a) => finance.getVoucher(c, u, a.sid, a.id),
  'POST /stations/:sid/vouchers': (c, u, a) => finance.createVoucher(c, u, a.sid, a.body),
  'POST /stations/:sid/vouchers/:id/void': (c, u, a) => finance.voidVoucher(c, u, a.sid, a.id, a.body.reason),
  'GET /stations/:sid/journals': (c, u, a) => finance.listJournals(c, u, a.sid, { ...a.query, account_id: n(a.query.account_id), limit: n(a.query.limit), before_id: n(a.query.before_id) }),
  'POST /stations/:sid/journals': (c, u, a) => finance.createJournal(c, u, a.sid, a.body),
  'GET /journals/:id': (c, u, a) => finance.getJournal(c, u, a.id),
  'POST /journals/:id/post': (c, u, a) => finance.postJournal(c, u, a.id),
  'POST /journals/:id/reverse': (c, u, a) => finance.reverseJournal(c, u, a.id, a.body),
  'DELETE /journals/:id': (c, u, a) => finance.deleteDraft(c, u, a.id),
  'GET /period-lock': (c, u) => finance.lockStatus(c, u),
  'POST /period-lock': (c, u, a) => finance.lockPeriod(c, u, a.body as never),
  'GET /accounting/trial-balance': (c, u, a) => finance.trialBalanceOrg(c, u, a.query),
  'GET /accounting/ledger': (c, u, a) => finance.accountLedger(c, u, a.query),
  'GET /accounting/income-statement': (c, u, a) => statements.incomeStatement(c, u, a.query),
  'GET /accounting/balance-sheet': (c, u, a) => statements.balanceSheet(c, u, a.query),
  'GET /accounting/cash-flow': (c, u, a) => statements.cashFlow(c, u, a.query),
  'GET /accounting/profit-by-month': (c, u, a) => statements.profitByMonth(c, u, a.query),
  'GET /stations/:sid/reports/meters': (c, u, a) => statements.meterSheet(c, u, a.sid, a.query),
  'GET /stations/:sid/reports/boxes': (c, u, a) => statements.boxReport(c, u, a.sid, a.query),
  'GET /stations/:sid/reports/collections': (c, u, a) => statements.collections(c, u, a.sid, a.query),
  'GET /stations/:sid/reports/daily': (c, u, a) => statements.dailyReport(c, u, a.sid, a.query),
  'GET /brand': (c, u) => statements.getBrand(c, u),
  'PATCH /brand': (c, u, a) => statements.setBrand(c, u, a.body),
  'GET /stations/:sid/summary': (c, u, a) => reports.daySummary(c, u, a.sid, a.query.date),
  'GET /stations/:sid/trial-balance': (c, u, a) => reports.trialBalance(c, u, a.sid)
};
const compiled = Object.entries(OPS).map(([k, op]) => {
  const [method, path] = k.split(' ');
  const names: string[] = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, nm) => { names.push(nm); return '(\\d{1,15})'; }) + '$');
  return { method, re, names, op };
});
/** Run one operation. `path` has no prefix ("/stations/1/sales"). Throws AppError (404 for an unknown route). */
export async function call(ctx: Ctx, user: User, method: string, path: string, body?: unknown, query: Record<string, string> = {}): Promise<unknown> {
  for (const r of compiled) {
    if (r.method !== method) continue;
    const m = r.re.exec(path); if (!m) continue;
    const p: Record<string, number> = {};
    r.names.forEach((nm, i) => { p[nm] = Number(m[i + 1]); });
    const b = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
    return r.op(ctx, user, { sid: p.sid ?? 0, id: p.id ?? 0, body: b, query });
  }
  throw notFound('Route');
}
/** The error as every edition shows it. Unknown errors never leak internals. */
export function errorBody(e: unknown): { status: number; body: { error: { code: string; message: string; extra?: unknown } } } {
  if (e instanceof AppError) return { status: e.status, body: { error: { code: e.code, message: e.message, ...(e.extra ? { extra: e.extra } : {}) } } };
  return { status: 500, body: { error: { code: 'INTERNAL', message: 'Unexpected error' } } };
}
