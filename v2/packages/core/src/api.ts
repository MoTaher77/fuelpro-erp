/* One table of operations for every run mode. The server maps HTTP onto it; the desktop and phone editions call it
   in-process. Same names, same inputs, same answers — so the UI does not know which mode it runs in. */
import type { Ctx, User } from './ctx.ts';
import { AppError, notFound } from './errors.ts';
import * as reports from './reports.ts';
import * as sales from './sales.ts';
import * as setup from './setup.ts';
import * as shifts from './shifts.ts';

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
