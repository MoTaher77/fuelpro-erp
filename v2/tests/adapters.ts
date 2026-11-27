/* The same Api over v1 (CommonJS, synchronous node:sqlite) and over the v2 TypeScript core. */
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import type { Ctx, User } from '@fuelpro/core';
import { setup, sales, shifts } from '@fuelpro/core';
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
  return { api, all, sid: () => sid, close: async () => db.close() };
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
  return { api, user: () => user, sid: () => sid };
}
