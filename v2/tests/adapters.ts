/* The same Api over v1 (CommonJS, synchronous node:sqlite) and over the v2 TypeScript core. */
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import type { Ctx, User } from '@fuelpro/core';
import { setup, sales, shifts, stock, parties } from '@fuelpro/core';
import type { Api } from './scenario.ts';

const require = createRequire(import.meta.url);
const ORG = { org_name: 'محطة تجريبية', name: 'Demo Owner', email: 'owner@example.test', currency: 'YER', timezone: 'Asia/Aden' };

export function v1Api() {
  const { openDb } = require('../../src/db.js');
  const S = require('../../src/services.js'), O = require('../../src/ops.js');
  const db = openDb(':memory:');
  let user: { id: number; org_id: number; role: string }, sid = 0;
  const api: Api = {
    async register() {
      // a random throwaway password: v1 requires one, nothing reads it again
      const r = S.registerOrg(db, { ...ORG, password: 'Aa1!' + randomBytes(12).toString('hex'), station: { name: ORG.org_name, currency: ORG.currency, timezone: ORG.timezone } }, '127.0.0.1');
      user = { id: r.user_id, org_id: r.org_id, role: 'owner' }; sid = r.station_id; return r;
    },
    async updateStation(b) { return S.updateStation(db, user, sid, b); },
    async createFuel(b) { return S.createFuel(db, user, sid, b); },
    async createTank(b) { return S.createTank(db, user, sid, b); },
    async createPump(b) { return S.createPump(db, user, sid, b); },
    async createCustomer(b) { return S.createCustomer(db, user, sid, b); },
    async createSale(b) { return S.createSale(db, user, sid, b); },
    async voidSale(id, reason) { return S.voidSale(db, user, sid, id, reason); },
    async openShift(b) { return O.openShiftCmd(db, user, sid, b); },
    async closeShift(id, b) { return O.closeShift(db, user, sid, id, b); },
    async approveShift(id) { return O.approveShift(db, user, sid, id); },
    async unapproveShift(id, b) { return O.unapproveShift(db, user, sid, id, b); },
    async reopenShift(id, b) { return O.reopenShift(db, user, sid, id, b); }
  };
  const all = async (s: string) => db.prepare(s).all();
  const V1: Record<string, (...a: unknown[]) => unknown> = {
    updateStation: (s, b) => S.updateStation(db, user, s, b), createStation: (b) => S.createStation(db, user, b),
    createFuel: (s, b) => S.createFuel(db, user, s, b), createTank: (s, b) => S.createTank(db, user, s, b), createPump: (s, b) => S.createPump(db, user, s, b),
    createSupplier: (s, b) => O.createSupplier(db, user, s, b), listSuppliers: (s) => O.listSuppliers(db, user, s),
    openShift: (s, b) => O.openShiftCmd(db, user, s, b), closeShift: (s, id, b) => O.closeShift(db, user, s, id, b),
    createSale: (s, b) => S.createSale(db, user, s, b), createDelivery: (s, b) => S.createDelivery(db, user, s, b), voidDelivery: (s, id, r) => S.voidDelivery(db, user, s, id, r),
    createAdjustment: (s, b) => S.createAdjustment(db, user, s, b), transfer: (s, b) => O.createTransfer(db, user, s, b), voidTransfer: (s, id, b) => O.voidTransfer(db, user, s, id, b),
    stockReconciliation: (s, q) => O.stockReconciliation(db, user, s, q),
    createCustomer: (s, b) => S.createCustomer(db, user, s, b), updateCustomer: (s, id, b) => O.updateCustomer(db, user, s, id, b), updateSupplier: (s, id, b) => O.updateSupplier(db, user, s, id, b),
    createPayment: (s, b) => S.createPayment(db, user, s, b), voidPayment: (s, id, r) => S.voidPayment(db, user, s, id, r),
    supplierPayment: (s, b) => O.supplierPayment(db, user, s, b), voidSupplierPayment: (s, id, r) => O.voidSupplierPayment(db, user, s, id, r),
    customerStatement: (s, id, q) => S.statement(db, user, s, id, q), supplierStatement: (s, id, q) => O.supplierStatement(db, user, s, id, q),
    ageing: (s, q) => O.ageing(db, user, s, q), listCustomers: (s) => S.listCustomers(db, user, s),
    today: (s) => ({ today: S.tzToday(db.prepare('SELECT timezone FROM stations WHERE id=?').get(s).timezone) })
  };
  const stockApi = { register: api.register, call: async (fn: string, ...a: unknown[]) => V1[fn](...a) };
  return { api, stockApi, all, sid: () => sid, close: async () => db.close() };
}

export function v2Api(ctx: Ctx) {
  let user: User, sid = 0;
  const api: Api = {
    async register() { const r = await setup.createOrg(ctx, ORG); user = { id: r.user_id, org_id: r.org_id, role: 'owner' }; sid = r.station_id; return r; },
    updateStation: (b) => setup.updateStation(ctx, user, sid, b),
    createFuel: (b) => setup.createFuel(ctx, user, sid, b),
    createTank: (b) => setup.createTank(ctx, user, sid, b),
    createPump: (b) => setup.createPump(ctx, user, sid, b),
    createCustomer: (b) => setup.createCustomer(ctx, user, sid, b),
    createSale: (b) => sales.createSale(ctx, user, sid, b as unknown as sales.SaleInput),
    voidSale: (id, reason) => sales.voidSale(ctx, user, sid, id, reason),
    openShift: (b) => shifts.openShiftCmd(ctx, user, sid, b),
    closeShift: (id, b) => shifts.closeShift(ctx, user, sid, id, b as { counted_cash: number }),
    approveShift: (id) => shifts.approveShift(ctx, user, sid, id),
    unapproveShift: (id, b) => shifts.unapproveShift(ctx, user, sid, id, b),
    reopenShift: (id, b) => shifts.reopenShift(ctx, user, sid, id, b)
  };
  const V2: Record<string, (...a: never[]) => Promise<unknown>> = {
    updateStation: (s: number, b: Record<string, unknown>) => setup.updateStation(ctx, user, s, b), createStation: (b: Record<string, unknown>) => setup.createStation(ctx, user, b),
    createFuel: (s: number, b: Record<string, unknown>) => setup.createFuel(ctx, user, s, b), createTank: (s: number, b: Record<string, unknown>) => setup.createTank(ctx, user, s, b),
    createPump: (s: number, b: Record<string, unknown>) => setup.createPump(ctx, user, s, b),
    createSupplier: (s: number, b: Record<string, unknown>) => stock.createSupplier(ctx, user, s, b), listSuppliers: (s: number) => stock.listSuppliers(ctx, user, s),
    openShift: (s: number, b: Record<string, unknown>) => shifts.openShiftCmd(ctx, user, s, b), closeShift: (s: number, id: number, b: { counted_cash: number }) => shifts.closeShift(ctx, user, s, id, b),
    createSale: (s: number, b: sales.SaleInput) => sales.createSale(ctx, user, s, b), createDelivery: (s: number, b: stock.DeliveryInput) => stock.createDelivery(ctx, user, s, b),
    voidDelivery: (s: number, id: number, r: string) => stock.voidDelivery(ctx, user, s, id, r), createAdjustment: (s: number, b: never) => stock.createAdjustment(ctx, user, s, b),
    transfer: (s: number, b: never) => stock.createTransfer(ctx, user, s, b), voidTransfer: (s: number, id: number, b: { reason?: string }) => stock.voidTransfer(ctx, user, s, id, b),
    stockReconciliation: (s: number, q: Record<string, string>) => stock.stockReconciliation(ctx, user, s, q),
    createCustomer: (s: number, b: Record<string, unknown>) => setup.createCustomer(ctx, user, s, b),
    updateCustomer: (s: number, id: number, b: Record<string, unknown>) => parties.updateCustomer(ctx, user, s, id, b),
    updateSupplier: (s: number, id: number, b: Record<string, unknown>) => parties.updateSupplier(ctx, user, s, id, b),
    createPayment: (s: number, b: never) => parties.createPayment(ctx, user, s, b), voidPayment: (s: number, id: number, r: string) => parties.voidPayment(ctx, user, s, id, r),
    supplierPayment: (s: number, b: never) => parties.supplierPayment(ctx, user, s, b), voidSupplierPayment: (s: number, id: number, r: string) => parties.voidSupplierPayment(ctx, user, s, id, r),
    customerStatement: (s: number, id: number, q: Record<string, string>) => parties.customerStatement(ctx, user, s, id, q),
    supplierStatement: (s: number, id: number, q: Record<string, string>) => parties.supplierStatement(ctx, user, s, id, q),
    ageing: (s: number, q: Record<string, string>) => parties.ageing(ctx, user, s, q), listCustomers: (s: number) => setup.listCustomers(ctx, user, s),
    today: async (s: number) => ({ today: ctx.clock.today((await ctx.db.selectFrom('stations').select('timezone').where('id', '=', s).executeTakeFirstOrThrow()).timezone) })
  };
  const stockApi = { register: api.register, call: async (fn: string, ...a: unknown[]) => V2[fn](...(a as never[])) };
  return { api, stockApi, user: () => user, sid: () => sid };
}
