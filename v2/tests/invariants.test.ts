/* The fixed rules, checked on both engines: integer money, one transaction per operation, derived balances,
   no edits/deletes of posted data, isolation (foreign id = 404), permissions in the core, concurrency on PostgreSQL. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'kysely';
import { openSqlite, openPostgres, openBridge } from '@fuelpro/db';
import { nodeBridge } from './bridge-fake.ts';
import { setup, sales, shifts, reports, type Ctx, type User } from '@fuelpro/core';
import { withPgDatabase } from './pg-temp.ts';

async function station(ctx: Ctx, email: string) {
  const r = await setup.createOrg(ctx, { org_name: 'Org ' + email, name: 'Owner', email, currency: 'YER', timezone: 'Asia/Aden' });
  const u: User = { id: r.user_id, org_id: r.org_id, role: 'owner' }, sid = r.station_id;
  const f = await setup.createFuel(ctx, u, sid, { name: 'Petrol', price_e4: 5_000_000_000, cost_e4: 4_000_000_000 });
  const t = await setup.createTank(ctx, u, sid, { name: 'T', fuel_id: f.id, capacity_ml: 50_000_000, level_ml: 20_000_000 });
  const p = await setup.createPump(ctx, u, sid, { name: 'P', tank_id: t.id });
  return { u, sid, pump: p.id, tank: t.id };
}
const engines: Array<[string, (fn: (ctx: Ctx) => Promise<void>) => Promise<void>, string | false]> = [
  ['SQLite', async (fn) => { const c = await openSqlite(':memory:'); try { await fn(c); } finally { await c.close(); } }, false],
  ['SQLite bridge (desktop/phone)', async (fn) => { const c = await openBridge(nodeBridge()); try { await fn(c); } finally { await c.close(); } }, false],
  ['PostgreSQL', (fn) => withPgDatabase(process.env.V2_PG_URL!, async (url) => { const c = await openPostgres(url, { max: 12 }); try { await fn(c); } finally { await c.close(); } }),
    !process.env.V2_PG_URL && 'set V2_PG_URL to run']
];
const rejects = async (p: Promise<unknown>, re: RegExp) => { await assert.rejects(p, (e: Error) => re.test(e.message)); };

for (const [name, withDb, skip] of engines) {
  test(`${name}: posted journals and stock moves cannot be changed or deleted`, { skip }, async () => withDb(async (ctx) => {
    const s = await station(ctx, 'a@example.test');
    await sales.createSale(ctx, s.u, s.sid, { client_id: 'inv-sale-001', pump_id: s.pump, quantity_ml: 10_000 });
    const j = await ctx.db.selectFrom('journals').select('id').where('source', '=', 'sale').executeTakeFirstOrThrow();
    await rejects(ctx.db.updateTable('journal_lines').set({ debit: 1 }).where('journal_id', '=', j.id).execute(), /immutable/);
    await rejects(ctx.db.deleteFrom('journals').where('id', '=', j.id).execute(), /cannot be deleted/);
    await rejects(ctx.db.updateTable('journals').set({ business_date: '2000-01-01' }).where('id', '=', j.id).execute(), /immutable/);
    await rejects(ctx.db.updateTable('journals').set({ status: 'draft' }).where('id', '=', j.id).execute(), /un-posted/);
    await rejects(ctx.db.updateTable('stock_moves').set({ qty_ml: 1 }).execute(), /append-only/);
    await rejects(ctx.db.deleteFrom('sales').execute(), /never deleted/);
  }));
  test(`${name}: an unbalanced journal is refused by the database itself`, { skip }, async () => withDb(async (ctx) => {
    const s = await station(ctx, 'b@example.test');
    const acc = await ctx.db.selectFrom('accounts').select('id').where('org_id', '=', s.u.org_id).where('sys', '=', 'cash').executeTakeFirstOrThrow();
    const j = await ctx.db.insertInto('journals').values({ org_id: s.u.org_id, station_id: s.sid, business_date: '2026-01-01', created_at: 'x', source: 'test' }).returning('id').executeTakeFirstOrThrow();
    await ctx.db.insertInto('journal_lines').values({ journal_id: j.id, account_id: acc.id, debit: 5, credit: 0 }).execute();
    await rejects(ctx.db.updateTable('journals').set({ status: 'posted' }).where('id', '=', j.id).execute(), /not balanced/);
  }));
  test(`${name}: a failed operation leaves nothing behind (one transaction)`, { skip }, async () => withDb(async (ctx) => {
    const s = await station(ctx, 'c@example.test');
    await ctx.db.updateTable('orgs').set({ locked_through: '9999-01-01' }).where('id', '=', s.u.org_id).execute();
    const before = await ctx.db.selectFrom('stock_moves').select(sql<number>`count(*)`.as('n')).executeTakeFirstOrThrow();
    await assert.rejects(sales.createSale(ctx, s.u, s.sid, { client_id: 'locked-0001', pump_id: s.pump, quantity_ml: 1000 }), { code: 'PERIOD_LOCKED' });
    const after = await ctx.db.selectFrom('stock_moves').select(sql<number>`count(*)`.as('n')).executeTakeFirstOrThrow();
    assert.equal(Number(after.n), Number(before.n));
    assert.equal((await ctx.db.selectFrom('sales').selectAll().execute()).length, 0);
  }));
  test(`${name}: another organisation's ids are not found; permissions are checked in the core`, { skip }, async () => withDb(async (ctx) => {
    const a = await station(ctx, 'd@example.test'), b = await station(ctx, 'e@example.test');
    await assert.rejects(sales.createSale(ctx, a.u, b.sid, { client_id: 'foreign-001', pump_id: b.pump, quantity_ml: 1000 }), { status: 404 });
    await assert.rejects(sales.createSale(ctx, a.u, a.sid, { client_id: 'foreign-002', pump_id: b.pump, quantity_ml: 1000 }), { status: 404 });
    await assert.rejects(sales.listSales(ctx, a.u, b.sid), { status: 404 });
    const cashier: User = { ...a.u, role: 'cashier' };
    await assert.rejects(sales.createSale(ctx, cashier, a.sid, { client_id: 'cashier-001', pump_id: a.pump, quantity_ml: 1000 }), { status: 404 });   // not assigned to the station
    await ctx.db.insertInto('user_stations').values({ user_id: a.u.id, station_id: a.sid }).execute();
    await assert.rejects(sales.createSale(ctx, cashier, a.sid, { client_id: 'cashier-002', pump_id: a.pump, quantity_ml: 1000, discount: 5 }), { status: 403 });
    await assert.rejects(shifts.approveShift(ctx, cashier, a.sid, 1), { status: 403 });
    const ok = await sales.createSale(ctx, cashier, a.sid, { client_id: 'cashier-003', pump_id: a.pump, quantity_ml: 1000 });
    assert.equal(ok.gross, 500_000);   // 1 L at 500.000 YER, 3 stored decimals
  }));
  test(`${name}: 40 sales at once on one pump — no lost meter, stock or ledger update`, { skip }, async () => withDb(async (ctx) => {
    const s = await station(ctx, 'f@example.test');
    const n = 40, qty = 1234;
    const res = await Promise.all(Array.from({ length: n }, (_, i) =>
      sales.createSale(ctx, s.u, s.sid, { client_id: 'race-' + String(i).padStart(6, '0'), pump_id: s.pump, quantity_ml: qty })));
    // the same client_id from two devices at once is still one sale
    const twice = await Promise.all([0, 1].map(() => sales.createSale(ctx, s.u, s.sid, { client_id: 'race-dup-0001', pump_id: s.pump, quantity_ml: qty })));
    assert.equal(twice.filter((x) => 'duplicate' in x && x.duplicate).length, 1);
    const pump = await ctx.db.selectFrom('pumps').selectAll().where('id', '=', s.pump).executeTakeFirstOrThrow();
    assert.equal(pump.meter_ml, (n + 1) * qty);
    const meters = res.map((r) => [r.open_ml, r.close_ml]).sort((x, y) => x[0] - y[0]);
    meters.forEach(([o, c], i) => { assert.equal(o, i * qty); assert.equal(c, (i + 1) * qty); });
    const tank = await ctx.db.selectFrom('tanks').selectAll().where('id', '=', s.tank).executeTakeFirstOrThrow();
    assert.equal(tank.level_ml, 20_000_000 - (n + 1) * qty);
    const tb = await reports.trialBalance(ctx, s.u, s.sid);
    assert.equal(tb.reduce((t, r) => t + r.debit, 0), tb.reduce((t, r) => t + r.credit, 0));
    const inv = tb.find((r) => r.code === '1200')!;
    assert.equal(inv.debit - inv.credit, tank.value, 'inventory account = stock value');
  }));
}

/* ---------- phase 2: stock & deliveries ---------- */
import { stock } from '@fuelpro/core';
for (const [name, withDb, skip] of engines) {
  test(`${name}: deliveries, counts and transfers are never deleted; another org's tanks are not found`, { skip }, async () => withDb(async (ctx) => {
    const a = await station(ctx, 'stk-a@example.test'), b = await station(ctx, 'stk-b@example.test');
    await stock.createDelivery(ctx, a.u, a.sid, { tank_id: a.tank, quantity_ml: 1_000_000, cost_e4: 4_000_000_000 });
    await stock.createAdjustment(ctx, a.u, a.sid, { tank_id: a.tank, after_ml: 20_500_000, note: 'جرد' });
    const t2 = await setup.createTank(ctx, a.u, a.sid, { name: 'T2', fuel_id: (await ctx.db.selectFrom('tanks').select('fuel_id').where('id', '=', a.tank).executeTakeFirstOrThrow()).fuel_id, capacity_ml: 9_000_000 });
    await stock.createTransfer(ctx, a.u, a.sid, { from_tank_id: a.tank, to_tank_id: t2.id, quantity_ml: 10_000 });
    for (const t of ['deliveries', 'adjustments', 'transfers'] as const) await rejects(ctx.db.deleteFrom(t).execute(), /never deleted/);
    await assert.rejects(stock.createDelivery(ctx, a.u, a.sid, { tank_id: b.tank, quantity_ml: 1000, cost_e4: 1 }), { status: 404 });
    await assert.rejects(stock.createTransfer(ctx, a.u, a.sid, { to_station_id: b.sid, from_tank_id: a.tank, to_tank_id: b.tank, quantity_ml: 1000 }), { status: 404 });
    const cashier: User = { ...a.u, role: 'cashier' };
    await ctx.db.insertInto('user_stations').values({ user_id: a.u.id, station_id: a.sid }).execute();
    await assert.rejects(stock.createDelivery(ctx, cashier, a.sid, { tank_id: a.tank, quantity_ml: 1000, cost_e4: 1 }), { status: 403 });
    await assert.rejects(stock.createAdjustment(ctx, cashier, a.sid, { tank_id: a.tank, after_ml: 1, note: 'سرقة' }), { status: 403 });
  }));
  test(`${name}: deliveries, sales and opposite transfers at the same moment keep every tank exact`, { skip }, async () => withDb(async (ctx) => {
    const s = await station(ctx, 'stk-race@example.test');
    const fuelId = (await ctx.db.selectFrom('tanks').select('fuel_id').where('id', '=', s.tank).executeTakeFirstOrThrow()).fuel_id;
    const t2 = (await setup.createTank(ctx, s.u, s.sid, { name: 'T2', fuel_id: fuelId, capacity_ml: 40_000_000, level_ml: 10_000_000, cost_e4: 3_000_000_000 })).id;
    const jobs: Promise<unknown>[] = [];
    for (let i = 0; i < 15; i++) {
      jobs.push(stock.createDelivery(ctx, s.u, s.sid, { tank_id: s.tank, quantity_ml: 100_000, cost_e4: 4_500_000_000 }));
      jobs.push(sales.createSale(ctx, s.u, s.sid, { client_id: 'mix-race-' + String(i).padStart(4, '0'), pump_id: s.pump, quantity_ml: 50_000 }));
      jobs.push(stock.createTransfer(ctx, s.u, s.sid, { from_tank_id: s.tank, to_tank_id: t2, quantity_ml: 7_000 }));
      jobs.push(stock.createTransfer(ctx, s.u, s.sid, { from_tank_id: t2, to_tank_id: s.tank, quantity_ml: 3_000 }));
    }
    const res = await Promise.allSettled(jobs);
    assert.deepEqual(res.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason)), [], 'no deadlock, no error');
    for (const id of [s.tank, t2]) {
      const t = await ctx.db.selectFrom('tanks').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
      const m = await ctx.db.selectFrom('stock_moves').select([sql<number>`sum(qty_ml)`.as('q'), sql<number>`sum(value)`.as('v')]).where('tank_id', '=', id).executeTakeFirstOrThrow();
      assert.equal(Number(m.q), t.level_ml, 'tank level = Σ moves'); assert.equal(Number(m.v), t.value, 'tank value = Σ moves');
    }
    const t1 = await ctx.db.selectFrom('tanks').select('level_ml').where('id', '=', s.tank).executeTakeFirstOrThrow();
    assert.equal(t1.level_ml, 20_000_000 + 15 * (100_000 - 50_000 - 7_000 + 3_000));
    const tb = await reports.trialBalance(ctx, s.u, s.sid);
    assert.equal(tb.reduce((t, r) => t + r.debit, 0), tb.reduce((t, r) => t + r.credit, 0));
    const inv = tb.find((r) => r.code === '1200')!;
    const tv = await ctx.db.selectFrom('tanks').select(sql<number>`sum(value)`.as('v')).where('station_id', '=', s.sid).executeTakeFirstOrThrow();
    assert.equal(inv.debit - inv.credit, Number(tv.v), 'inventory account = value of all tanks');
  }));
}
