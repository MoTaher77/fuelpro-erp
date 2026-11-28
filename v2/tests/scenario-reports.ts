/* Phase 5 parity scenario: financial reports. Two months of station life written on past dates (cash and credit sales on
   three pumps, deliveries, expenses, receipt and payment vouchers, manual journals, a stock count, a void), then every
   report at several dates and scopes: income statement, balance sheet, cash flow, profit by month, meter sheet, boxes,
   collections, the daily report, and the letterhead. Deterministic, demo data only. */
import type { Outcome } from './scenario.ts';
import type { StockApi } from './scenario-stock.ts';
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
// a 1x1 PNG (demo letterhead logo)
const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export async function playReports(api: StockApi, seed = 51): Promise<Outcome[]> {
  const out: Outcome[] = [];
  const step = async (fn: string, ...args: unknown[]) => {
    try { const r = await api.call(fn, ...args); out.push({ ok: r }); return r as Record<string, number>; }
    catch (e) { const x = e as { status?: number; code?: string }; if (!x.code) throw e; out.push({ err: { status: x.status!, code: x.code } }); return null; }
  };
  const must = async (fn: string, ...args: unknown[]) => { const r = await step(fn, ...args); if (!r) throw new Error(fn + ' failed: ' + JSON.stringify(out[out.length - 1])); return r; };
  const r = rng(seed);
  const { station_id: s1 } = await api.register();
  const usd = (await must('createStation', { name: 'فرع دولار', currency: 'USD', timezone: 'Asia/Aden' })).id;
  const today = (await must('today', s1)).today as unknown as string;
  const start = addDays(today, -64);
  const fA = (await must('createFuel', s1, { name: 'بنزين', price_e4: 6_000_000_000 + seed, cost_e4: 5_000_000_000 })).id;
  const fB = (await must('createFuel', s1, { name: 'ديزل', price_e4: 5_500_000_000, cost_e4: 4_700_000_000 })).id;
  const tA = (await must('createTank', s1, { name: 'خزان البنزين', fuel_id: fA, capacity_ml: 90_000_000, level_ml: 30_000_000 })).id;
  const tB = (await must('createTank', s1, { name: 'خزان الديزل', fuel_id: fB, capacity_ml: 90_000_000, level_ml: 25_000_000 })).id;
  const pumps = [(await must('createPump', s1, { name: 'م1', tank_id: tA })).id, (await must('createPump', s1, { name: 'م2', tank_id: tA })).id, (await must('createPump', s1, { name: 'م3', tank_id: tB })).id];
  const cust = [
    (await must('createCustomer', s1, { name: 'شركة النقل', opening_balance: 2_500_000, credit_limit: 250_000_000 })).id,
    (await must('createCustomer', s1, { name: 'مؤسسة البناء', terms_days: 15 })).id,
    (await must('createCustomer', s1, { name: 'عميل متأخر', opening_balance: 900_000 })).id,
    (await must('createCustomer', s1, { name: 'عميل بلا دين' })).id
  ];
  const sup = (await must('createSupplier', s1, { name: 'شركة النفط', opening_balance: 4_000_000 })).id;
  const accts = await must('listAccounts') as unknown as Array<{ id: number; sys: string | null; code: string }>;
  const sysId = (k: string) => accts.find((a) => a.sys === k)!.id;
  const grp = (await must('createAccount', { code: '6100', type: 'expense', name_ar: 'مصاريف إدارية', is_group: true })).id;
  const office = (await must('createAccount', { code: '6110', type: 'expense', name_ar: 'قرطاسية', parent_id: grp })).id;
  const other = (await must('createAccount', { code: '4910', type: 'income', name_ar: 'إيرادات متنوعة' })).id;
  const box2 = (await must('createAccount', { code: '1030', type: 'asset', name_ar: 'صندوق الإدارة', box: 'cash' })).id;
  // two months of days; credit sales get distinct amounts so «largest first» never ties
  let k = 0;
  const sales: number[] = [];
  for (let d = 0; d <= 64; d += 4) {
    const date = addDays(start, d);
    for (let i = 0; i < 3; i++) {
      const s = await step('createSale', s1, { client_id: `rep-${seed}-${String(++k).padStart(4, '0')}`, pump_id: pumps[i], quantity_ml: 20_000 + Math.floor(r() * 500_000), date });
      if (s) sales.push(s.id);
    }
    const c = cust[(d / 4) % 3];
    await step('createSale', s1, { client_id: `rep-${seed}-${String(++k).padStart(4, '0')}`, pump_id: pumps[(d / 4) % 3], quantity_ml: 30_000 + d * 1_001 + Math.floor(r() * 100_000), pay_type: 'credit', customer_id: c, date });
    if (d % 16 === 0) await step('createDelivery', s1, { tank_id: d % 32 ? tB : tA, quantity_ml: 2_000_000 + Math.floor(r() * 3_000_000), cost_e4: 5_050_000_000, pay_type: d % 32 ? 'cash' : 'credit', supplier_id: sup, date });
    if (d % 12 === 0) await step('createExpense', s1, { category: d % 24 ? 'power' : 'rent', gross: 40_000 + d * 100, vat: d % 24 ? 0 : 2_000, method: d % 24 ? 'cash' : 'bank', note: 'مصروف', date });
    if (d % 20 === 8) await step('createVoucher', s1, { kind: 'receipt', box_account_id: sysId('cash'), date, memo: 'تحصيل', lines: [{ account_id: sysId('ar'), party_id: cust[1], amount: 150_000 + d }] });
  }
  await step('createVoucher', s1, { kind: 'payment', box_account_id: sysId('bank'), date: addDays(today, -30), lines: [{ account_id: sysId('ap'), party_type: 'supplier', party_id: sup, amount: 2_000_000 }, { account_id: office, amount: 15_000 }] });
  await step('createVoucher', s1, { kind: 'receipt', box_account_id: sysId('bank'), date: addDays(today, -40), lines: [{ account_id: sysId('capital'), amount: 9_000_000 }] });
  await step('createVoucher', s1, { kind: 'receipt', box_account_id: box2, date: addDays(today, -3), ref_no: 'R-9', lines: [{ account_id: other, amount: 77_000, memo: 'بيع براميل' }] });
  await step('createVoucher', s1, { kind: 'receipt', box_account_id: sysId('cash'), date: today, lines: [{ account_id: sysId('ar'), party_id: cust[0], amount: 400_000 }] });
  await step('createJournal', s1, { memo: 'سحب المالك', post: true, date: addDays(today, -10), lines: [{ account_id: sysId('drawings'), debit: 300_000 }, { account_id: sysId('cash'), credit: 300_000 }] });
  await step('createJournal', s1, { memo: 'تحويل بين الصندوقين', post: true, date: addDays(today, -2), lines: [{ account_id: box2, debit: 50_000 }, { account_id: sysId('cash'), credit: 50_000 }] });
  await step('createJournal', s1, { memo: 'مسودة لا تظهر', date: addDays(today, -2), lines: [{ account_id: office, debit: 99_999 }, { account_id: sysId('bank'), credit: 99_999 }] });
  await step('createAdjustment', s1, { tank_id: tA, after_ml: 1_000_000, note: 'جرد' });
  await step('createPayment', s1, { customer_id: cust[1], amount: 123_456, method: 'bank' });
  if (sales.length > 4) await step('voidSale', s1, sales[sales.length - 2], 'خطأ في الكمية');
  // income statement
  await step('incomeStatement', { to: today });                                                    // MIXED_CURRENCY
  await step('incomeStatement', { to: today, currency: 'YER' });
  await step('incomeStatement', { to: today, station_id: s1, from: start });
  await step('incomeStatement', { to: addDays(today, -32), station_id: s1 });
  await step('incomeStatement', { station_id: s1 });                                               // VALIDATION (to)
  await step('incomeStatement', { to: today, station_id: usd });
  // balance sheet
  await step('balanceSheet', { as_of: today, currency: 'YER' });
  await step('balanceSheet', { to: addDays(today, -20), station_id: s1 });
  await step('balanceSheet', { as_of: addDays(start, -1), station_id: s1 });
  await step('balanceSheet', { as_of: today });                                                    // MIXED_CURRENCY
  // cash flow
  await step('cashFlow', { to: today, from: start, currency: 'YER' });
  await step('cashFlow', { to: today, station_id: s1 });
  await step('cashFlow', { to: addDays(today, -5), from: addDays(today, -40), station_id: s1 });
  await step('cashFlow', { to: start, from: today, station_id: s1 });                              // VALIDATION
  // profit by month
  await step('profitByMonth', { station_id: s1 });
  await step('profitByMonth', { station_id: s1, year: Number(today.slice(0, 4)) - 1 });
  await step('profitByMonth', {});                                                                // VALIDATION
  await step('profitByMonth', { station_id: 999_999 });                                           // NOT_FOUND
  // meter sheet
  await step('meterSheet', s1, { from: start, to: today });
  await step('meterSheet', s1, { from: addDays(today, -8), to: addDays(today, -8) });
  await step('meterSheet', s1, { from: today, to: start });                                        // VALIDATION
  // boxes
  await step('boxReport', s1, {});
  await step('boxReport', s1, { from: start, to: today });
  await step('boxReport', s1, { from: addDays(today, -40), to: today, box_account_id: sysId('cash') });
  await step('boxReport', s1, { from: addDays(today, -40), to: today, box_account_id: box2 });
  await step('boxReport', s1, { box_account_id: office });                                         // NOT_A_BOX
  await step('boxReport', s1, { from: '2020-01-01', to: today });                                  // VALIDATION (too long)
  // collections
  await step('collections', s1, {});
  await step('collections', s1, { days: 30 });
  await step('collections', s1, { as_of: addDays(today, 100) });
  await step('collections', s1, { as_of: addDays(today, -33) });
  // the daily report: today, a busy past day, a day with nothing
  await step('dailyReport', s1, {});
  await step('dailyReport', s1, { date: start });
  await step('dailyReport', s1, { date: addDays(start, 16) });
  await step('dailyReport', s1, { date: addDays(start, 1) });
  await step('dailyReport', s1, { date: 'أمس' });                                                  // VALIDATION
  // letterhead
  await step('getBrand');
  await step('setBrand', { name: 'محطة تجريبية للوقود', activity: 'بيع المشتقات النفطية', address: 'عدن', phones: '02-000000', footer: 'شكراً لتعاملكم' });
  await step('setBrand', { logo: 'http://example.test/logo.png' });                                // VALIDATION
  await step('setBrand', { logo: LOGO, phones: '' });
  await step('getBrand');
  await step('setBrand', { logo: null });
  await step('getBrand');
  return out;
}
