/* One business day at a demo station, written once and played against v1 (src/, the system in use today)
   and against v2 on SQLite and PostgreSQL. Deterministic: a seeded generator, no real data. */
export interface Api {
  register(): Promise<{ org_id: number; station_id: number; user_id: number }>;
  updateStation(b: Record<string, unknown>): Promise<unknown>;
  createFuel(b: Record<string, unknown>): Promise<{ id: number }>;
  createTank(b: Record<string, unknown>): Promise<{ id: number }>;
  createPump(b: Record<string, unknown>): Promise<{ id: number }>;
  createCustomer(b: Record<string, unknown>): Promise<{ id: number }>;
  createSale(b: Record<string, unknown>): Promise<unknown>;
  voidSale(id: number, reason: string): Promise<unknown>;
  openShift(b: Record<string, unknown>): Promise<{ id: number }>;
  closeShift(id: number, b: Record<string, unknown>): Promise<unknown>;
  approveShift(id: number): Promise<unknown>;
  unapproveShift(id: number, b: Record<string, unknown>): Promise<unknown>;
  reopenShift(id: number, b: Record<string, unknown>): Promise<unknown>;
}
export type Outcome = { ok: unknown } | { err: { status: number; code: string } };

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

export async function play(api: Api, seed = 7, nSales = 120): Promise<Outcome[]> {
  const out: Outcome[] = [];
  const step = async (f: () => Promise<unknown>) => {
    try { out.push({ ok: await f() }); }
    catch (e) { const x = e as { status?: number; code?: string }; if (!x.code) throw e; out.push({ err: { status: x.status!, code: x.code } }); }
  };
  const r = rng(seed);
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
  await api.register();
  await step(() => api.updateStation({ require_shift: true }));
  const petrol = await api.createFuel({ name: 'بنزين', price_e4: 6_123_456_789, cost_e4: 5_432_109_876 });
  const diesel = await api.createFuel({ name: 'ديزل', price_e4: 4_999_999_999, cost_e4: 4_111_111_111 });
  const t1 = await api.createTank({ name: 'T1', fuel_id: petrol.id, capacity_ml: 40_000_000, level_ml: 9_000_000 });
  const t2 = await api.createTank({ name: 'T2', fuel_id: diesel.id, capacity_ml: 30_000_000, level_ml: 2_500_000, cost_e4: 4_000_000_001 });
  const pumps = [
    await api.createPump({ name: 'P1', tank_id: t1.id, meter_ml: 123_456_789 }),
    await api.createPump({ name: 'P2', tank_id: t1.id }),
    await api.createPump({ name: 'P3', tank_id: t2.id, meter_ml: 5_000 })
  ];
  const customers = [
    await api.createCustomer({ name: 'عميل أ', opening_balance: 1_250_000, credit_limit: 90_000_000 }),
    await api.createCustomer({ name: 'عميل ب', opening_balance: -40_000 }),
    await api.createCustomer({ name: 'عميل ج', credit_limit: 3_000_000 })
  ];
  // no shift yet: the station requires one
  await step(() => api.createSale({ client_id: 'no-shift-0001', pump_id: pumps[0].id, quantity_ml: 1000 }));
  let sh = await api.openShift({ float_amount: 500_000 });
  await step(() => api.openShift({}));                       // SHIFT_ALREADY_OPEN
  const meters = new Map<number, number>([[pumps[0].id, 123_456_789], [pumps[1].id, 0], [pumps[2].id, 5_000]]);
  const saleIds: number[] = [];
  let n = 0;
  const sale = async (extra: Record<string, unknown> = {}) => {
    const p = pick(pumps), byMeter = r() < 0.5, qty = 1 + Math.floor(r() * 120_000);
    const credit = r() < 0.3, c = pick(customers);
    const disc = r() < 0.15 ? (r() < 0.5 ? { discount_bp: Math.floor(r() * 900) } : { discount: Math.floor(r() * 5000) }) : {};
    const b: Record<string, unknown> = { client_id: `sale-${seed}-${String(++n).padStart(5, '0')}`, pump_id: p.id, pay_type: credit ? 'credit' : 'cash', ...(credit ? { customer_id: c.id } : {}), ...disc, ...extra };
    if (byMeter) b.close_ml = (meters.get(p.id) || 0) + qty; else b.quantity_ml = qty;
    let res: unknown;
    try { res = await api.createSale(b); out.push({ ok: res }); }
    catch (e) { const x = e as { status?: number; code?: string }; if (!x.code) throw e; out.push({ err: { status: x.status!, code: x.code } }); return; }
    const s = res as { id: number; close_ml: number; pump_id: number };
    meters.set(s.pump_id, s.close_ml); saleIds.push(s.id);
  };
  for (let i = 0; i < nSales / 3; i++) await sale();
  await step(() => api.updateStation({ vat_bp: 500, vat_included: true }));
  for (let i = 0; i < nSales / 3; i++) await sale();
  // the same sale sent twice (phone retry) is recorded once
  await step(() => api.createSale({ client_id: `sale-${seed}-00003`, pump_id: pumps[0].id, quantity_ml: 999 }));
  // errors that must match code for code
  await step(() => api.createSale({ client_id: 'bad-meter-01', pump_id: pumps[0].id, close_ml: 1 }));
  await step(() => api.createSale({ client_id: 'too-much-01', pump_id: pumps[2].id, quantity_ml: 4_999_000 }));
  await step(() => api.createSale({ client_id: 'limit-0001', pump_id: pumps[0].id, quantity_ml: 4_000_000, pay_type: 'credit', customer_id: customers[2].id }));
  await step(() => api.createSale({ client_id: 'nocust-001', pump_id: pumps[0].id, quantity_ml: 1000, pay_type: 'credit' }));
  await step(() => api.createSale({ client_id: 'foreign-01', pump_id: 99_999, quantity_ml: 1000 }));
  await step(() => api.createSale({ client_id: 'disc-big-1', pump_id: pumps[0].id, quantity_ml: 1000, discount: 10 ** 12 }));
  for (const id of saleIds.slice(0, 4)) await step(() => api.voidSale(id, 'خطأ إدخال'));
  await step(() => api.voidSale(saleIds[0], 'مرة ثانية'));    // ALREADY_VOIDED
  await step(() => api.closeShift(sh.id, { counted_cash: 1_000_000, note: 'عجز' }));
  await step(() => api.voidSale(saleIds[5], 'بعد الإغلاق'));   // SHIFT_CLOSED
  await step(() => api.approveShift(sh.id));
  await step(() => api.unapproveShift(sh.id, { reason: 'مراجعة' }));
  await step(() => api.reopenShift(sh.id, { reason: 'تصحيح' }));
  await step(() => api.updateStation({ vat_bp: 1000, vat_included: false }));
  for (let i = 0; i < nSales / 3; i++) await sale();
  const closed = await api.closeShift(sh.id, { counted_cash: 987_654_321 }) as { expected_cash: number };
  out.push({ ok: closed });
  await step(() => api.approveShift(sh.id));
  sh = await api.openShift({ float_amount: 0 });
  for (let i = 0; i < 10; i++) await sale();
  await step(() => api.closeShift(sh.id, { counted_cash: 0 }));
  return out;
}
