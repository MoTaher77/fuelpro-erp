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
