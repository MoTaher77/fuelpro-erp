# ACCOUNTING-RULES — FuelPro
Financial invariants. Every rule below is VERIFIED in code (path given) and covered by a test unless marked.
Changing any of them needs an ADR in [DECISIONS](DECISIONS.md) and a new test.

## 1. Numbers
- Amounts are integers in the station currency's minor unit. Stored decimals `stations.cur_dec` (YER at the real station: 3), shown `disp_dec` (2). `src/money.js`: `amountMinor(qty_ml, price_e4, dec)` with BigInt and half-away-from-zero rounding (`divRound`); `vatSplit` guarantees net + vat = gross.
- Quantities: ml. Prices/costs: `*_e4` (×10⁴). FX rates: `rate_e6`. VAT: basis points (`vat_bp`).

## 2. Double entry (`src/ledger.js`)
- `L.post()`: checks the period is open (`assertOpen`), drops zero lines, nets Dr/Cr per line, refuses unbalanced journals (`JOURNAL_UNBALANCED`). Amounts must be safe non-negative integers.
- DB triggers (`src/db.js`): a journal can only become `posted` if balanced; a posted journal cannot be un-posted, edited (date/station/org), deleted; its lines cannot be inserted/updated/deleted.
- Each line may carry a party (`party_type` customer/supplier + `party_id`) and foreign-currency data (`fc_code`, `fc_amount`, `fc_rate_e6`).
- Group accounts (`is_group=1`) cannot be posted to. Receivable lines need a customer; manual journals cannot touch stock accounts (`books.test.js`).
- Journal `source` names the origin: sale, delivery, expense, payment, voucher, shift, cash_move, transfer, supplier_payment, stock_count, stock_fix, depreciation, fx_reval, opening, tank_opening, supplier_opening, manual, year_close, (import sources from `scripts/import-m7.js`).

## 3. Correction = reversal, never edit
- Void of a document (sale, delivery, expense, payment, voucher, transfer, cash move, supplier payment) requires a reason, stamps `voided_at/void_reason/void_by`, reverses its journal (`L.reverseSource`) and its stock move. Double void is refused.
- Operation journals cannot be reversed directly — void the document instead. Manual journals: draft → post → reverse (`reversal_of`/`reversed_by`).
- Voiding a delivery whose fuel has already been sold is refused (stock would go negative).

## 4. Inventory (perpetual, weighted average)
- `stock_moves` is append-only (triggers). Tank `level_ml`/`value`/`avg_cost_e4` always equal the last move's balance.
- `L.stockMove` prices outgoing quantities at the current average; incoming deliveries recompute the average.
  Example in tests: 1000 L @1000 + 1000 L @1200 → sale of 500 L costs 1100/L.
- Each sale posts COGS: Dr 5010 / Cr 1200. Stock count (`adjustments`) posts shortage to 5100 or surplus to 4900. Monthly stock count can charge a shortage to the supplier (`books.test.js`).
- Tanks: `0 ≤ level_ml ≤ capacity_ml` unless the station allows negative stock (`allow_negative`).
- **Old-system difference:** M7 used periodic stock; balances of accounts 33807 and 411005 differ for that reason only (REPORTED, accepted).

## 5. Sales and receivables
- Sale = meter reading: `close_ml` must exceed the pump's meter; a stale form is detected; `client_id` makes retries idempotent.
- Cash sale: Dr box. Credit sale: Dr 1100 with the customer as party; credit limit enforced; overpayment refused.
- VAT per station (`vat_bp`, included or excluded). Output VAT → 2100, input VAT → 1150.

## 6. Cash, boxes, shifts
- Boxes = accounts flagged `box` (cash, bank, cashier), optionally in a foreign currency.
- Shift: one open shift per station (unique partial index); expected cash = float + cash sales + cash receipts − cash payouts (credit and bank excluded). Variance = counted − expected, posted at approval (5200 shortage / 4900 surplus), reversed at un-approval. A closed shift freezes its operations.
- Receipt/payment vouchers move customer and supplier balances and appear on statements, ageing and the shift.
- Foreign-currency boxes keep both amounts; revaluation posts the difference to 4950.

## 7. Periods and year end
- Period lock: `orgs.locked_through` — no posting on or before that date. Reopen needs `period.lock`.
- Year close (`src/reports.js`): needs `period.lock` + an org-wide role, date ≥ 31 Dec of the year, no draft journals. Posts one journal per station (`source='year_close'`, `source_id=<year>`, doc type «قيد إقفال», ref `YC<year>`) moving all income/expense balances into **3900**. Optional lock. Reopen = reverse with a reason.
- The income statement excludes year-close journals (`balances(..., noClose)` in `src/ops.js`), so a closed year still shows its profit; the trial balance has `pre_close=1`.

## 8. Branches
- Each station is its own cost centre; every journal carries `station_id`. Inter-station transfers post through 1190 «جاري الفروع» so each branch balances (`erp.test.js`). Consolidated reports only sum stations with the same currency.

## 9. Integrity check (`GET /api/accounting/integrity`, `src/ops.js`)
Compares stock value in tanks with account 1200, customer balances with 1100, supplier balances with 2010, and checks every journal is balanced. Run it after any import, restore or data fix.

## 10. System chart (`CHART` in `src/ledger.js`)
1010 cash · 1020 bank · 1100 AR · 1150 input VAT · 1190 inter-branch · 1200 fuel inventory · 1290 accumulated depreciation ·
2010 AP · 2100 output VAT · 3010 capital/opening · 3200 drawings · 3900 retained earnings · 4010 fuel sales · 4900 other income ·
4950 FX differences · 5010 COGS · 5100 stock shortage · 5200 cash shortage · 6010–6090 expenses (6070 depreciation).
The real station also has the imported M7 tree (443 accounts) mapped onto these system accounts.

## 11. Cash-flow statement (`cashFlow` in `src/ops.js`, `GET /api/accounting/cash-flow`) — 0.7.0
- Direct method. Cash = accounts with `box` set (cash/bank) plus system 1010/1020.
- For each posted journal that touches a box, each non-box line contributes `credit − debit` to its account's class. A balanced journal makes the contributions equal the box change exactly; `reconciled` proves it on every run.
- Box-to-box journals contribute nothing. Inside `sale` journals the cost pair (5010 / 1200, equal) is left out because it moves no cash.
- Class: sources `*opening*`/`migration` → «opening balances entered in the period»; `fx_reval` → «effect of exchange rates»;
  system capital/drawings/retained/interbranch → financing; accum_dep → investing; other system accounts → operating;
  accounts in the fixed-asset register → investing; under imported groups `11`, `214` → investing, `216`, `217`, `224`, `227` → financing;
  other equity → financing; everything else → operating. Test: `reports.test.js` "cash-flow statement…".

## 12. Sale discounts (0.9.0)
- Journal of a discounted sale: Dr cash/receivable (what the customer pays) · Cr sales (list price net of VAT) · Dr `sales_disc` 4050 «خصومات المبيعات» (net list − net paid) · Cr output VAT (VAT on the amount paid). Revenue = sales − discounts.
- Void reverses the whole journal, discount included. Discount larger than the sale → `DISCOUNT_TOO_LARGE`. Only roles with `sale.discount` (manager, supervisor, owner/admin).
- `ensureChart` picks another code if 4050 is already used by imported accounts.

## 13. Bank reconciliation (0.9.0)
- A reconciliation = one bank/cash account of one station + statement date + statement closing balance. Cleared marks live in `bank_cleared(line_id, rec_id)`; journals are never touched.
- Finalise only when statement balance = Σ every cleared line (earlier final reconciliations + this one) → else `REC_NOT_BALANCED`. Lines already cleared in another reconciliation are not offered again (`LINE_ALREADY_CLEARED`).
- One open draft per account; only the latest reconciliation can be reopened (`NOT_LATEST`); final ones cannot be deleted.
- Foreign-currency accounts reconcile in their own currency using `fc_amount`. Bank charges/interest are recorded with a normal voucher, then ticked.

## 14. Smart alerts (0.10.0)
Read-only checks over the live books, no table: stock at/below the tank minimum or ≤ 3 days of sales (critical) and ≤ 7 days (warning); shift open ≥ 16 h (warning) / ≥ 30 h (critical); cash variances in the last 7 days; customers over their credit limit; customer debts > 90 days late; overdue supplier payments; cash/bank accounts in the station currency below zero (critical); no sales yesterday after ≥ 5 selling days in the week before; bank reconciliation draft older than 30 days; failed integrity check (critical). One failing check never hides the others.
