/* Phase 3 parity scenario: customers, suppliers & collections. Credit sales, customer payments (cash / bank), supplier
   deliveries on credit and supplier payments, voids, edits, statements (whole and cut to a period) and debt ageing at
   several dates — then the shift drawer. Deterministic, demo data only.
   Statements: lines on the same day are ordered by creation time, which v1 takes from SQLite's clock and v2 from its
   own; so a statement is compared by its lines (sorted by kind and id) and its totals, opening and closing balance. */
import type { Outcome } from './scenario.ts';
import type { StockApi } from './scenario-stock.ts';
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
type St = { balance: number; opening?: number; total_debit: number; total_credit: number; from: string | null; to: string | null; entries: Array<Record<string, unknown>> };
const canon = (s: St) => ({ balance: s.balance, opening: s.opening ?? 0, total_debit: s.total_debit, total_credit: s.total_credit, from: s.from, to: s.to,
  entries: s.entries.map(({ balance: _b, created_at: _c, ...e }) => e).sort((a, b) => String(a.kind).localeCompare(String(b.kind)) || Number(a.id) - Number(b.id)) });

export async function playParties(api: StockApi, seed = 21): Promise<Outcome[]> {
  const out: Outcome[] = [];
  const step = async (fn: string, ...args: unknown[]) => {
    try { let r = await api.call(fn, ...args) as Record<string, unknown>; if (fn.endsWith('Statement')) r = canon(r as unknown as St); out.push({ ok: r }); return r as Record<string, number>; }
    catch (e) { const x = e as { status?: number; code?: string }; if (!x.code) throw e; out.push({ err: { status: x.status!, code: x.code } }); return null; }
  };
  const must = async (fn: string, ...args: unknown[]) => { const r = await step(fn, ...args); if (!r) throw new Error(fn + ' failed: ' + JSON.stringify(out[out.length - 1])); return r; };
  const r = rng(seed);
  const { station_id: s1 } = await api.register();
  await must('updateStation', s1, { require_shift: true });
  const s2 = (await must('createStation', { name: 'فرع 2', currency: 'YER', timezone: 'Asia/Aden' })).id;
  const f = (await must('createFuel', s1, { name: 'بنزين', price_e4: 6_000_000_000, cost_e4: 5_000_000_000 })).id;
  const t = (await must('createTank', s1, { name: 'T', fuel_id: f, capacity_ml: 50_000_000, level_ml: 30_000_000 })).id;
  const p = (await must('createPump', s1, { name: 'P', tank_id: t })).id;
  const cust = [
    (await must('createCustomer', s1, { name: 'شركة النقل', opening_balance: 2_500_000, credit_limit: 500_000_000, terms_days: 0 })).id,
    (await must('createCustomer', s1, { name: 'مؤسسة البناء', opening_balance: -100_000, terms_days: 15 })).id,
    (await must('createCustomer', s1, { name: 'عميل نقدي', terms_days: 30 })).id
  ];
  const c2 = (await must('createCustomer', s2, { name: 'عميل الفرع' })).id;
  const supA = (await must('createSupplier', s1, { name: 'شركة النفط', opening_balance: 9_000_000, terms_days: 10 })).id;
  const supB = (await must('createSupplier', s1, { name: 'ناقل', terms_days: 0 })).id;
  // a payment before any shift: the station requires one for cash, not for bank
  await step('createPayment', s1, { customer_id: cust[0], amount: 1000 });
  await step('createPayment', s1, { customer_id: cust[0], amount: 1000, method: 'bank', note: 'تحويل' });
  const sh = (await must('openShift', s1, { float_amount: 50_000 })).id;
  let k = 0;
  for (let i = 0; i < 24; i++) {
    await step('createSale', s1, { client_id: `pty-${seed}-${String(++k).padStart(4, '0')}`, pump_id: p, quantity_ml: 20_000 + Math.floor(r() * 300_000), pay_type: 'credit', customer_id: cust[i % 3] });
    if (i % 4 === 3) await step('createPayment', s1, { customer_id: cust[i % 3], amount: 50_000 + Math.floor(r() * 900_000), method: i % 8 === 3 ? 'cash' : 'bank' });
  }
  const pays: number[] = [];
  for (const c of cust) { const x = await step('createPayment', s1, { customer_id: c, amount: 333_333, method: 'cash', note: 'دفعة' }); if (x) pays.push(x.id); }
  await step('createPayment', s1, { customer_id: cust[2], amount: 10 ** 12 });                 // OVERPAYMENT
  await step('createPayment', s1, { customer_id: c2, amount: 1000 });                          // NOT_FOUND (other station)
  await step('createPayment', s1, { customer_id: cust[0], amount: 0 });                        // VALIDATION
  await step('createPayment', s1, { customer_id: cust[0], amount: 1000, method: 'card' });     // VALIDATION
  // suppliers: credit deliveries, then payments
  for (let i = 0; i < 6; i++) await step('createDelivery', s1, { tank_id: t, quantity_ml: 400_000 + Math.floor(r() * 600_000), cost_e4: 5_100_000_000, pay_type: 'credit', supplier_id: i % 2 ? supA : supB });
  const sps: number[] = [];
  for (const [sup, m] of [[supA, 'bank'], [supB, 'cash'], [supA, 'cash']] as const) { const x = await step('supplierPayment', s1, { supplier_id: sup, amount: 1_234_567, method: m }); if (x) sps.push(x.id); }
  await step('supplierPayment', s1, { supplier_id: supB, amount: 10 ** 12 });                // OVERPAYMENT
  // voids
  if (pays[0]) await step('voidPayment', s1, pays[0], 'دفعة مكررة');
  if (pays[0]) await step('voidPayment', s1, pays[0], 'مرة أخرى');                               // ALREADY_VOIDED
  if (sps[1]) await step('voidSupplierPayment', s1, sps[1], 'خطأ');
  // edits
  await step('updateCustomer', s1, cust[1], { credit_limit: 9_000_000, terms_days: 45, phone: '777000000' });
  await step('updateCustomer', s1, cust[2], { active: false });
  await step('updateSupplier', s1, supB, { terms_days: 7, name: 'ناقل الوقود' });
  await step('updateCustomer', s1, c2, { name: 'x' });                                          // NOT_FOUND
  // statements: whole, cut to today, and a period that starts tomorrow (all as opening)
  const today = (await must('today', s1)).today as unknown as string;
  for (const c of cust) {
    await step('customerStatement', s1, c, {});
    await step('customerStatement', s1, c, { from: today, to: today });
    await step('customerStatement', s1, c, { from: addDays(today, 1) });
  }
  await step('customerStatement', s1, c2, {});                                                   // NOT_FOUND
  await step('customerStatement', s1, cust[0], { from: addDays(today, 2), to: today });          // VALIDATION
  for (const s of [supA, supB]) { await step('supplierStatement', s1, s, {}); await step('supplierStatement', s1, s, { to: today }); }
  // ageing at several dates
  for (const n of [0, 12, 40, 75, 100, 200]) {
    await step('ageing', s1, { type: 'customer', as_of: addDays(today, n) });
    await step('ageing', s1, { type: 'supplier', as_of: addDays(today, n) });
  }
  await step('ageing', s1, { type: 'staff' });                                                   // VALIDATION
  await step('closeShift', s1, sh, { counted_cash: 777_777 });
  if (pays[1]) await step('voidPayment', s1, pays[1], 'بعد الإغلاق');                             // SHIFT_CLOSED
  await step('listCustomers', s1);
  await step('listSuppliers', s1);
  return out;
}
