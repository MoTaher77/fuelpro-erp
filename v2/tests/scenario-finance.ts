/* Phase 4 parity scenario: finance. Chart of accounts (groups, a second cash box), expenses, cash moves, receipt and
   payment vouchers (customer, supplier, expense and bank lines), manual journals (draft, post, delete, reverse), voids,
   period lock, then trial balance, account ledger, journal / voucher / expense lists and the shift drawer.
   Deterministic, demo data only. Not compared: accounts in a foreign currency (v2 refuses them until the currencies
   module is ported; v1 needs its currencies table). */
import type { Outcome } from './scenario.ts';
import type { StockApi } from './scenario-stock.ts';
const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export async function playFinance(api: StockApi, seed = 31): Promise<Outcome[]> {
  const out: Outcome[] = [];
  const step = async (fn: string, ...args: unknown[]) => {
    try { const r = await api.call(fn, ...args); out.push({ ok: r }); return r as Record<string, number>; }
    catch (e) { const x = e as { status?: number; code?: string }; if (!x.code) throw e; out.push({ err: { status: x.status!, code: x.code } }); return null; }
  };
  const must = async (fn: string, ...args: unknown[]) => { const r = await step(fn, ...args); if (!r) throw new Error(fn + ' failed: ' + JSON.stringify(out[out.length - 1])); return r; };
  const { station_id: s1 } = await api.register();
  await must('updateStation', s1, { require_shift: true });
  await must('createStation', { name: 'فرع دولار', currency: 'USD', timezone: 'Asia/Aden' });
  const today = (await must('today', s1)).today as unknown as string;
  const f = (await must('createFuel', s1, { name: 'بنزين', price_e4: 6_000_000_000 + seed, cost_e4: 5_000_000_000 })).id;
  const t = (await must('createTank', s1, { name: 'T', fuel_id: f, capacity_ml: 50_000_000, level_ml: 20_000_000 })).id;
  const p = (await must('createPump', s1, { name: 'P', tank_id: t })).id;
  const cust = (await must('createCustomer', s1, { name: 'عميل', opening_balance: 3_000_000 })).id;
  const sup = (await must('createSupplier', s1, { name: 'مورد', opening_balance: 4_000_000 })).id;
  // chart of accounts
  const accts = await must('listAccounts') as unknown as Array<{ id: number; sys: string | null; code: string }>;
  const sysId = (k: string) => accts.find((a) => a.sys === k)!.id;
  const grp = (await must('createAccount', { code: '6100', type: 'expense', name_ar: 'مصاريف تشغيلية', is_group: true })).id;
  const child = (await must('createAccount', { code: '6110', type: 'expense', name_ar: 'نظافة', parent_id: grp })).id;
  const box2 = (await must('createAccount', { code: '1030', type: 'asset', name_ar: 'صندوق الإدارة', box: 'cash' })).id;
  await step('createAccount', { code: '6110', type: 'expense', name_ar: 'مكرر' });                         // CODE_TAKEN
  await step('createAccount', { code: '61a', type: 'expense', name_ar: 'خطأ' });                           // VALIDATION
  await step('createAccount', { code: '6120', type: 'expense', name_ar: 'تحت حساب تفصيلي', parent_id: child }); // PARENT_NOT_GROUP
  await step('createAccount', { code: '6130', type: 'income', name_ar: 'صندوق دخل', box: 'cash' });         // VALIDATION (box must be asset)
  await step('updateAccount', grp, { parent_id: grp });                                                   // PARENT_CYCLE
  await step('updateAccount', sysId('cash'), { active: false });                                          // SYSTEM_ACCOUNT
  await step('updateAccount', child, { name_ar: 'نظافة وصيانة', name_en: 'Cleaning' });
  await step('boxes');
  // money in the drawer, then out of it
  await step('expenseNoShift', s1, { category: 'power', gross: 1000 });                                   // SHIFT_REQUIRED
  const sh = (await must('openShift', s1, { float_amount: 200_000 })).id;
  for (let i = 0; i < 6; i++) await step('createSale', s1, { client_id: `fin-${seed}-${i}`, pump_id: p, quantity_ml: 100_000 + i * 7_777 });
  const exps = [];
  for (const [cat, gross, vat, m] of [['power', 150_000, 0, 'cash'], ['rent', 900_000, 45_000, 'bank'], ['coffee', 12_345, 0, 'cash'], ['maint', 70_000, 3_500, 'cash']] as const) {
    const x = await step('createExpense', s1, { category: cat, gross, vat, method: m, note: 'مصروف ' + cat }); if (x) exps.push(x.id);
  }
  await step('createExpense', s1, { category: 'power', gross: 1000, date: addDays(today, 1) });         // FUTURE_DATE
  await step('createExpense', s1, { category: 'power', gross: 1000, vat: 2000 });                       // VALIDATION
  const mv1 = await step('cashMove', s1, { kind: 'withdrawal', counterpart: 'bank', amount: 300_000, note: 'إيداع بنكي' });
  await step('cashMove', s1, { kind: 'deposit', counterpart: 'owner', amount: 50_000 });
  await step('cashMove', s1, { kind: 'withdrawal', counterpart: 'owner', amount: 10 ** 12 });            // CASH_INSUFFICIENT
  // vouchers
  const v1 = await step('createVoucher', s1, { kind: 'receipt', box_account_id: sysId('cash'), memo: 'تحصيل', lines: [{ account_id: sysId('ar'), party_id: cust, amount: 700_000 }] });
  await step('createVoucher', s1, { kind: 'payment', box_account_id: sysId('bank'), lines: [{ account_id: sysId('ap'), party_type: 'supplier', party_id: sup, amount: 1_500_000 },
    { account_id: child, amount: 25_000, memo: 'تنظيف' }] });
  await step('createVoucher', s1, { kind: 'payment', box_account_id: box2, ref_no: 'A-7', lines: [{ account_id: sysId('exp_other'), amount: 9_999 }] });
  await step('createVoucher', s1, { kind: 'receipt', box_account_id: sysId('bank'), lines: [{ account_id: sysId('capital'), amount: 5_000_000 }] });
  await step('createVoucher', s1, { kind: 'payment', box_account_id: sysId('cash'), lines: [{ account_id: grp, amount: 1 }] });           // GROUP_ACCOUNT
  await step('createVoucher', s1, { kind: 'payment', box_account_id: sysId('cash'), lines: [{ account_id: sysId('inventory'), amount: 1 }] });   // USE_STOCK_SCREENS
  await step('createVoucher', s1, { kind: 'receipt', box_account_id: sysId('cash'), lines: [{ account_id: sysId('ar'), amount: 1 }] });   // VALIDATION (party)
  await step('createVoucher', s1, { kind: 'receipt', box_account_id: sysId('ar'), lines: [{ account_id: child, amount: 1 }] });          // NOT_A_BOX
  await step('createVoucher', s1, { kind: 'receipt', box_account_id: box2, lines: [{ account_id: box2, amount: 1 }] });                  // VALIDATION (same box)
  await step('createVoucher', s1, { kind: 'payment', box_account_id: sysId('cash'), lines: [] });                                         // VALIDATION
  // manual journals
  const jl = (dr: number, cr: number) => [{ account_id: child, debit: dr }, { account_id: sysId('bank'), credit: cr }];
  // drafts dated yesterday: the lock below is set through yesterday (never «today», which is still in the future in UTC
  // for part of the day in Aden) so DRAFTS_PENDING is reached at any hour
  const d1 = await must('createJournal', s1, { memo: 'قيد مسودة أول', date: addDays(today, -1), lines: jl(11_000, 11_000) });
  const d2 = await must('createJournal', s1, { memo: 'قيد مسودة ثان', date: addDays(today, -1), lines: jl(22_000, 22_000) });
  const pj = await must('createJournal', s1, { memo: 'قيد مرحّل', post: true, lines: [{ account_id: sysId('drawings'), debit: 40_000 }, { account_id: sysId('cash'), credit: 40_000, memo: 'سحب' }] });
  await step('createJournal', s1, { memo: 'غير متوازن', lines: jl(1000, 999) });                          // JOURNAL_UNBALANCED
  await step('createJournal', s1, { memo: 'سطر واحد', lines: [{ account_id: child, debit: 1 }] });          // VALIDATION
  await step('createJournal', s1, { memo: 'مدين ودائن معاً', lines: [{ account_id: child, debit: 1, credit: 1 }, { account_id: sysId('bank'), credit: 1 }] }); // VALIDATION
  await step('createJournal', s1, { memo: 'مخزون', lines: [{ account_id: sysId('inventory'), debit: 1 }, { account_id: sysId('bank'), credit: 1 }] });   // USE_STOCK_SCREENS
  await step('lockPeriod', { through: addDays(today, -1) });                                              // DRAFTS_PENDING
  await step('deleteDraft', d1.id);                                                                       // not the newest journal: ids continue the same way
  await step('postJournal', d2.id);
  await step('postJournal', d2.id);                                                                       // NOT_DRAFT
  await step('deleteDraft', pj.id);                                                                       // NOT_DRAFT
  await step('reverseJournal', pj.id, { reason: 'خطأ' });
  await step('reverseJournal', pj.id, { reason: 'مرة أخرى' });                                             // ALREADY_REVERSED
  const saleJ = (await must('listJournals', s1, { source: 'sale' }) as unknown as Array<{ id: number }>)[0].id;
  await step('reverseJournal', saleJ, { reason: 'من بيع' });                                               // USE_DOCUMENT_VOID
  await step('getJournal', d2.id);
  // voids
  if (exps[2]) await step('voidExpense', s1, exps[2], 'مصروف مكرر');
  if (exps[2]) await step('voidExpense', s1, exps[2], 'مرة أخرى');                                         // ALREADY_VOIDED
  if (mv1) await step('voidCashMove', s1, mv1.id, 'خطأ في المبلغ');
  if (v1) await step('voidVoucher', s1, v1.id, 'سند مكرر');
  // reports and lists
  await step('trialBalance', { to: today });                                                              // MIXED_CURRENCY (two currencies)
  await step('trialBalance', { to: today, currency: 'YER' });
  await step('trialBalance', { to: today, station_id: s1, from: addDays(today, -400) });
  await step('ledger', { account_id: sysId('cash'), to: today, currency: 'YER' });
  await step('ledger', { account_id: sysId('ap'), to: today, station_id: s1, from: addDays(today, -1) });
  await step('listJournals', s1, {});
  await step('listJournals', s1, { q: 'مسودة' });
  await step('listJournals', s1, { status: 'posted', account_id: child });
  await step('listVouchers', s1, {});
  await step('listVouchers', s1, { kind: 'payment' });
  await step('listExpenses', s1, {});
  await step('customerStatement', s1, cust, {});
  // period lock
  await step('lockPeriod', { through: addDays(today, -1) });
  await step('createExpense', s1, { category: 'fees', gross: 5_000, method: 'bank', date: addDays(today, -1) });   // PERIOD_LOCKED
  await step('lockPeriod', { through: addDays(today, 5) });                                                         // FUTURE_DATE
  await step('closeShift', s1, sh, { counted_cash: 1_234_567 });
  await step('lockPeriod', { through: null });
  return out;
}
