# MODULES — FuelPro functional inventory
Verified 2026-11-23 from `NAV` (`public/app.js`), route list ([API-REFERENCE](API-REFERENCE.md)) and tests. Screen key = URL hash (`#key`).
Status: ✅ VERIFIED (code + test) · 🟡 partial · ⛔ not built.

| Module | Status | Screens (key → file) | Server code | Main tables | Tests | Gaps / notes |
|---|---|---|---|---|---|---|
| Dashboard | ✅ | `dash` → app.js | `GET …/dashboard`, `…/summary` (services/ops) | sales, tanks, shifts | api.test (summary) | — |
| Organisations & stations | ✅ | `setup` → app.js / books-ui.js (brand) | `POST/PATCH /api/stations`, `/api/brand` | orgs, stations, org_brand | api.test | multi-company = multi-org per install |
| Users & permissions | ✅ | `users` → app.js, erp.js | `/api/users`, `/api/auth/*` | users, user_stations, sessions, recovery_codes, reset_tokens | api/erp/auth tests | — |
| Chart of accounts | ✅ | `acct` → erp.js | `/api/accounts`, `/api/accounts/tree` (ops/books) | accounts | books.test | — |
| Journal entries & general ledger | ✅ | `acct` (journals), `jbook` → more-ui.js | `…/journals`, `/api/journals/:id/*`, `/api/accounting/ledger` | journals, journal_lines | erp/books tests | — |
| Financial statements & period lock | ✅ | `fin` → erp.js | `/api/accounting/{trial-balance,income-statement,balance-sheet,cash-flow,lock,integrity,profit-by-month}` | journals | erp/reports tests | |
| Year close | ✅ | `yc` → more-ui.js | `/api/accounting/year-close`, `/year-reopen` (reports.js) | journals (`year_close`) | reports.test | — |
| Cash & banks (boxes, vouchers) | ✅ | `vch`, `box` → books-ui.js, more-ui.js | `/api/boxes`, `…/vouchers`, `…/reports/boxes` | vouchers, voucher_lines, accounts.box | books/reports tests | ✅ bank reconciliation (0.9.0, `bank` → bank-ui.js, `src/bankrec.js`, tables bank_recs/bank_cleared, test discount-bankrec) |
| Currencies & FX | ✅ | `cur` → books-ui.js | `/api/currencies*`, `/api/accounting/revaluation` | currencies, exchange_rates | books.test | — |
| Sales / POS by meter | ✅ | `sales` → app.js; `sreg` sales register, `day` daily report | `…/sales*`, `…/sales-register*`, `…/reports/daily` | sales, pumps, price_history | api/books/reports tests | ⛔ discounts; ⛔ offline save |
| Pumps & meters | ✅ | `mtr` → books-ui.js; setup | `…/pumps`, `…/pumps/:pid/meter`, `…/reports/meters` | pumps, shift_meters | api/books tests | ⛔ nozzles as separate units (pump = one hose) |
| Fuel products & prices | ✅ | `prc` → books-ui.js | `…/fuels`, `…/price-history` | fuels, price_history | books.test | — |
| Tanks & inventory | ✅ | `inv` → erp.js, `stock` → app.js, `cnt` monthly count → books-ui.js | `…/tanks`, `…/stock/*`, `…/adjustments`, `…/transfers*` | tanks, stock_moves, adjustments, transfers | erp/books tests | single warehouse concept = tanks |
| Purchases & suppliers | ✅ | `pur` → books-ui.js, `supp` → erp.js | `…/deliveries*`, `…/purchases*`, `…/suppliers*`, `…/supplier-payments*` | deliveries, suppliers, supplier_payments | api/erp tests | — |
| Customers & credit | ✅ | `cust` → erp.js, `col` collections → more-ui.js, `stm` statements → books-ui.js | `…/customers*`, `…/payments*`, `…/ageing`, `…/reports/collections` | customers, payments | api/erp/reports tests | — |
| Shifts & cash drawer | ✅ | `shift` → erp.js | `…/shifts*`, `…/cash-moves*` | shifts, shift_meters, cash_moves | erp.test | — |
| Expenses | ✅ | `exp` → app.js | `…/expenses*` | expenses | api.test | — |
| Fixed assets | ✅ | `fa` → books-ui.js | `…/assets*`, `…/assets/depreciate` | fixed_assets | books.test | — |
| Reports | ✅ | `rep` → app.js, plus day/box/col/sreg/pur/mtr/cnt/stm | see above | — | several | ⛔ native Excel/PDF (browser print + CSV) |
| Printing | 🟡 | all print buttons → `printNode` (app.js), `F.printDoc` (books-ui.js) | — | org_brand | none automated | owner print check pending (KI-07) |
| Audit log | ✅ | `audit` → app.js | `…/audit` | audit | api.test | — |
| Backups | ✅ | setup (owner/admin) | `/api/backups*` (backup.js) | — | erp/books tests | off-site copy is manual |
| Settings / preferences | ✅ | prefs dialog (language, unit, calendar, theme) → app.js | `PATCH /api/stations/:sid` | stations | — | prefs stored in the browser |
| Old-system history | ✅ | in pl, cnt, acct (history), audit, users | `reports/old-results`, `stock/old-values`, `journals/:id/history` | audit, users, exchange_rates, m7_results, m7_stock_month (v13) | m7-history tests | loaded by `scripts/import-m7-history.js` |
| Data import | 🟡 | none (CLI) | `scripts/import-m7.js`, `exp2sqlite.js`, `import-m7-history.js`, `reconcile-m7.js` | all | none automated | M7-specific; CSV export only for sales |
| Employees / payroll | ⛔ | — | — | — | — | only an expense category «الرواتب» (6010) |
| Notifications | ⛔/🟡 | low-stock warnings in the UI (REPORTED) | — | tanks.min_ml | — | no SMS/e-mail alerts |
| Companies & branches consolidation | 🟡 | station selector; inter-branch account 1190 | — | — | erp.test (transfers) | consolidated reports only for same-currency stations |


## Added in 0.9.0
| Module | Status | Screen → file | Server | Tables | Tests |
|---|---|---|---|---|---|
| Analytics dashboard | ✅ | `ana` → analytics-ui.js | `GET /api/stations/:sid/analytics` (src/analytics.js) | derived only | reports.test |
| Excel export | ✅ | topbar «⇩ Excel» (`exportScreen` in app.js, public/xlsx.js) | none (client side, one sheet per table) | — | xlsx.test |
| Sale discounts | ✅ | sales form «الخصم» (amount or %) | `createSale` accepts `discount`/`discount_bp`; permission `sale.discount` | sales.discount (v14), account 4050 | discount-bankrec.test |
| Bank reconciliation | ✅ | `bank` → bank-ui.js | 7 routes `/api/stations/:sid/bank-recs` (src/bankrec.js); permission `bank.reconcile` | bank_recs, bank_cleared (v14) | discount-bankrec.test |

## Added in 0.10.0
| Module | Status | Screen → file | Server | Tests |
|---|---|---|---|---|
| Smart alerts | ✅ | bell in the top bar → alerts-ui.js (opens the right screen) | `GET /api/stations/:sid/alerts` (src/alerts.js, derived, nothing stored) | alerts.test |
