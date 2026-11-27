/* Phase 2 parity scenario: two stations, suppliers, deliveries (cash / bank / credit, VAT on and off), sales that use the
   stock, stock counts (shortage, surplus, shortage charged to a supplier), transfers inside and between stations, voids,
   and the errors v1 raises — then the shift cash and the tank reconciliation. Deterministic, demo data only. */
import type { Outcome } from './scenario.ts';
export interface StockApi {
  register(): Promise<{ org_id: number; station_id: number; user_id: number }>;
  call(fn: string, ...args: unknown[]): Promise<unknown>;
}
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

export async function playStock(api: StockApi, seed = 11): Promise<Outcome[]> {
  const out: Outcome[] = [];
  const step = async (fn: string, ...args: unknown[]) => {
    try { const r = await api.call(fn, ...args); out.push({ ok: r }); return r as Record<string, number>; }
    catch (e) { const x = e as { status?: number; code?: string }; if (!x.code) throw e; out.push({ err: { status: x.status!, code: x.code } }); return null; }
  };
  const must = async (fn: string, ...args: unknown[]) => { const r = await step(fn, ...args); if (!r) throw new Error(fn + ' failed: ' + JSON.stringify(out[out.length - 1])); return r; };
  const r = rng(seed);
  const { station_id: s1 } = await api.register();
  await must('updateStation', s1, { require_shift: true, vat_bp: 500, vat_included: false });
  const s2 = (await must('createStation', { name: 'فرع 2', currency: 'YER', timezone: 'Asia/Aden' })).id;
  const s3 = (await must('createStation', { name: 'فرع دولار', currency: 'USD', timezone: 'Asia/Aden' })).id;
  const fuel = async (sid: number, name: string, price: number, cost: number) => (await must('createFuel', sid, { name, price_e4: price, cost_e4: cost })).id;
  const p1 = await fuel(s1, 'بنزين', 6_100_000_000, 5_400_000_000), d1 = await fuel(s1, 'ديزل', 4_900_000_000, 4_100_000_000);
  const p2 = await fuel(s2, 'بنزين', 6_100_000_000, 5_000_000_000);
  const p3 = await fuel(s3, 'بنزين', 6_100_000, 5_000_000);
  const tank = async (sid: number, fid: number, cap: number, lvl: number, cost?: number) => (await must('createTank', sid, { name: 'T', fuel_id: fid, capacity_ml: cap, level_ml: lvl, ...(cost ? { cost_e4: cost } : {}) })).id;
  const tA = await tank(s1, p1, 30_000_000, 4_000_000), tB = await tank(s1, p1, 20_000_000, 0), tD = await tank(s1, d1, 25_000_000, 2_000_000, 3_999_999_999);
  const t2 = await tank(s2, p2, 30_000_000, 1_000_000), t3 = await tank(s3, p3, 30_000_000, 1_000_000);
  const pumpA = (await must('createPump', s1, { name: 'P-A', tank_id: tA })).id, pumpD = (await must('createPump', s1, { name: 'P-D', tank_id: tD })).id;
  const supX = (await must('createSupplier', s1, { name: 'مورد س', opening_balance: 7_000_000, terms_days: 15 })).id;
  const supY = (await must('createSupplier', s1, { name: 'مورد ص', opening_balance: -250_000 })).id;
  await step('createSupplier', s2, { name: 'مورد الفرع', terms_days: 0 });
  const sh = (await must('openShift', s1, { float_amount: 100_000 })).id;

  const dels: number[] = [];
  const delivery = async (b: Record<string, unknown>) => { const d = await step('createDelivery', s1, b); if (d) dels.push(d.id); return d; };
  for (let i = 0; i < 12; i++) {
    const pay = ['cash', 'bank', 'credit'][i % 3], t = [tA, tB, tD][i % 3];
    await delivery({ tank_id: t, quantity_ml: 500_000 + Math.floor(r() * 3_000_000), cost_e4: 5_000_000_000 + Math.floor(r() * 900_000_000), pay_type: pay,
      ...(pay === 'credit' ? { supplier_id: i % 2 ? supX : supY } : {}), ...(i === 4 ? { vat: 0 } : {}), ...(i === 7 ? { ref: 'INV-7' } : {}) });
  }
  // voided before any of it is sold: the stock and the payable come back exactly
  await step('voidDelivery', s1, dels[1], 'فاتورة مكررة');
  await step('voidDelivery', s1, dels[5], 'كمية خاطئة');
  // sales consume the stock between deliveries
  let k = 0;
  for (let i = 0; i < 40; i++) await step('createSale', s1, { client_id: `stk-${seed}-${String(++k).padStart(4, '0')}`, pump_id: i % 2 ? pumpA : pumpD, quantity_ml: 10_000 + Math.floor(r() * 400_000) });
  // errors that must match code for code
  await step('createDelivery', s1, { tank_id: tA, quantity_ml: 99_000_000, cost_e4: 1 });                      // EXCEEDS_CAPACITY
  await step('createDelivery', s1, { tank_id: tA, quantity_ml: 1000, cost_e4: 1, pay_type: 'credit' });        // VALIDATION (supplier)
  await step('createDelivery', s1, { tank_id: t2, quantity_ml: 1000, cost_e4: 1 });                            // NOT_FOUND (other station's tank)
  await step('createDelivery', s1, { tank_id: tA, quantity_ml: 1000, cost_e4: 1, date: '2999-01-01' });       // FUTURE_DATE
  // stock counts: shortage, surplus, shortage charged to a supplier
  await step('createAdjustment', s1, { tank_id: tA, after_ml: 1_234_567, note: 'جرد آخر اليوم' });
  await step('createAdjustment', s1, { tank_id: tD, after_ml: 3_000_000, note: 'زيادة في الجرد' });
  await step('createAdjustment', s1, { tank_id: tB, after_ml: 100_000, note: 'نقص من المورد', charge_supplier_id: supX });
  await step('createAdjustment', s1, { tank_id: tA, after_ml: 1_234_567, note: 'بلا فرق' });
  await step('createAdjustment', s1, { tank_id: tA, after_ml: 99_000_000, note: 'خطأ' });                       // VALIDATION
  // transfers
  const tr1 = await step('transfer', s1, { from_tank_id: tA, to_tank_id: tB, quantity_ml: 200_000, note: 'داخلي' });
  const tr2 = await step('transfer', s1, { to_station_id: s2, from_tank_id: tB, to_tank_id: t2, quantity_ml: 50_000 });
  await step('transfer', s1, { from_tank_id: tA, to_tank_id: tD, quantity_ml: 1000 });                         // FUEL_MISMATCH
  await step('transfer', s1, { from_tank_id: tA, to_tank_id: tA, quantity_ml: 1000 });                         // VALIDATION
  await step('transfer', s1, { to_station_id: s3, from_tank_id: tA, to_tank_id: t3, quantity_ml: 1000 });     // CURRENCY_MISMATCH
  await step('transfer', s1, { from_tank_id: tB, to_tank_id: tA, quantity_ml: 50_000_000 });                   // VALIDATION (max) / INSUFFICIENT
  // voids
  if (tr1) await step('voidTransfer', s1, tr1.id, { reason: 'خطأ' });
  if (tr2) await step('voidTransfer', s2, tr2.id, { reason: 'من الفرع' });
  if (tr2) await step('voidTransfer', s1, tr2.id, { reason: 'مرة ثانية' });                                       // ALREADY_VOIDED
  for (const id of dels.slice(0, 6)) await step('voidDelivery', s1, id, 'فاتورة خاطئة');                       // some STOCK_ALREADY_SOLD
  await step('voidDelivery', s1, dels[dels.length - 1], 'فاتورة خاطئة');
  await step('voidDelivery', s1, dels[dels.length - 1], 'مرة ثانية');                                           // ALREADY_VOIDED
  // the drawer: cash purchases leave it
  await step('closeShift', s1, sh, { counted_cash: 5_000_000 });
  await step('voidDelivery', s1, dels[0], 'بعد الإغلاق');                                                        // SHIFT_CLOSED (cash) or other
  await step('stockReconciliation', s1, {});
  await step('stockReconciliation', s2, {});
  await step('listSuppliers', s1);
  return out;
}
