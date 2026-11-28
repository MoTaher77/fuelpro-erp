/* The same Api over v1 (CommonJS, synchronous node:sqlite) and over the v2 TypeScript core. */
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import type { Ctx, User } from '@fuelpro/core';
import { setup, sales, shifts, stock, parties, finance, statements } from '@fuelpro/core';
import type { Api } from './scenario.ts';

const require = createRequire(import.meta.url);
const ORG = { org_name: 'محطة تجريبية', name: 'Demo Owner', email: 'owner@example.test', currency: 'YER', timezone: 'Asia/Aden' };

export function v1Api() {
  const { openDb } = require('../../src/db.js');
  const S = require('../../src/services.js'), O = require('../../src/ops.js'), B = require('../../src/books.js'), R = require('../../src/reports.js');
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
    today: (s) => ({ today: S.tzToday(db.prepare('SELECT timezone FROM stations WHERE id=?').get(s).timezone) }),
    listAccounts: () => O.listAccounts(db, user), createAccount: (b) => B.createAccount(db, user, b), updateAccount: (id, b) => B.updateAccount(db, user, id, b), boxes: () => B.boxes(db, user),
    createExpense: (s, b) => S.createExpense(db, user, s, b), expenseNoShift: (s, b) => S.createExpense(db, user, s, b), voidExpense: (s, id, r) => S.voidExpense(db, user, s, id, r),
    listExpenses: (s, q) => S.listExpenses(db, user, s, q), cashMove: (s, b) => O.cashMove(db, user, s, b), voidCashMove: (s, id, r) => O.voidCashMove(db, user, s, id, r),
    createVoucher: (s, b) => B.createVoucher(db, user, s, b), voidVoucher: (s, id, r) => B.voidVoucher(db, user, s, id, r), listVouchers: (s, q) => B.listVouchers(db, user, s, q),
    createJournal: (s, b) => O.createJournal(db, user, s, b), postJournal: (id) => O.postJournal(db, user, id), deleteDraft: (id) => O.deleteDraft(db, user, id),
    reverseJournal: (id, b) => O.reverseJournal(db, user, id, b), getJournal: (id) => O.getJournal(db, user, id), listJournals: (s, q) => O.listJournals(db, user, s, q),
    lockPeriod: (b) => O.lockPeriod(db, user, b), trialBalance: (q) => O.trialBalance(db, user, q), ledger: (q) => O.accountLedger(db, user, q),
    voidSale: (s, id, r) => S.voidSale(db, user, s, id, r),
    incomeStatement: (q) => O.incomeStatement(db, user, q), balanceSheet: (q) => O.balanceSheet(db, user, q), cashFlow: (q) => O.cashFlow(db, user, q),
    profitByMonth: (q) => B.profitByMonth(db, user, q), meterSheet: (s, q) => B.meterSheet(db, user, s, q), boxReport: (s, q) => R.boxReport(db, user, s, q),
    collections: (s, q) => R.collections(db, user, s, q), dailyReport: (s, q) => R.dailyReport(db, user, s, q),
    getBrand: () => B.getBrand(db, user), setBrand: (b) => B.setBrand(db, user, b)
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
    today: async (s: number) => ({ today: ctx.clock.today((await ctx.db.selectFrom('stations').select('timezone').where('id', '=', s).executeTakeFirstOrThrow()).timezone) }),
    listAccounts: () => finance.listAccounts(ctx, user), createAccount: (b: Record<string, unknown>) => finance.createAccount(ctx, user, b),
    updateAccount: (id: number, b: Record<string, unknown>) => finance.updateAccount(ctx, user, id, b), boxes: () => finance.boxes(ctx, user),
    createExpense: (s: number, b: Record<string, unknown>) => finance.createExpense(ctx, user, s, b), expenseNoShift: (s: number, b: Record<string, unknown>) => finance.createExpense(ctx, user, s, b),
    voidExpense: (s: number, id: number, r: string) => finance.voidExpense(ctx, user, s, id, r), listExpenses: (s: number, q: Record<string, never>) => finance.listExpenses(ctx, user, s, q),
    cashMove: (s: number, b: Record<string, unknown>) => finance.cashMove(ctx, user, s, b), voidCashMove: (s: number, id: number, r: string) => finance.voidCashMove(ctx, user, s, id, r),
    createVoucher: (s: number, b: Record<string, unknown>) => finance.createVoucher(ctx, user, s, b), voidVoucher: (s: number, id: number, r: string) => finance.voidVoucher(ctx, user, s, id, r),
    listVouchers: (s: number, q: Record<string, never>) => finance.listVouchers(ctx, user, s, q),
    createJournal: (s: number, b: Record<string, unknown>) => finance.createJournal(ctx, user, s, b), postJournal: (id: number) => finance.postJournal(ctx, user, id),
    deleteDraft: (id: number) => finance.deleteDraft(ctx, user, id), reverseJournal: (id: number, b: { reason?: string }) => finance.reverseJournal(ctx, user, id, b),
    getJournal: (id: number) => finance.getJournal(ctx, user, id), listJournals: (s: number, q: Record<string, never>) => finance.listJournals(ctx, user, s, q),
    lockPeriod: (b: { through: string | null }) => finance.lockPeriod(ctx, user, b), trialBalance: (q: Record<string, never>) => finance.trialBalanceOrg(ctx, user, q),
    ledger: (q: Record<string, never>) => finance.accountLedger(ctx, user, q),
    voidSale: (s: number, id: number, r: string) => sales.voidSale(ctx, user, s, id, r),
    incomeStatement: (q: Record<string, never>) => statements.incomeStatement(ctx, user, q), balanceSheet: (q: Record<string, never>) => statements.balanceSheet(ctx, user, q),
    cashFlow: (q: Record<string, never>) => statements.cashFlow(ctx, user, q), profitByMonth: (q: Record<string, never>) => statements.profitByMonth(ctx, user, q),
    meterSheet: (s: number, q: Record<string, never>) => statements.meterSheet(ctx, user, s, q), boxReport: (s: number, q: Record<string, never>) => statements.boxReport(ctx, user, s, q),
    collections: (s: number, q: Record<string, never>) => statements.collections(ctx, user, s, q), dailyReport: (s: number, q: Record<string, never>) => statements.dailyReport(ctx, user, s, q),
    getBrand: () => statements.getBrand(ctx, user), setBrand: (b: Record<string, unknown>) => statements.setBrand(ctx, user, b)
  };
  const stockApi = { register: api.register, call: async (fn: string, ...a: unknown[]) => V2[fn](...(a as never[])) };
  return { api, stockApi, user: () => user, sid: () => sid };
}
