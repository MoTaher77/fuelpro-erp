# API-REFERENCE — FuelPro
Generated from `src/server.js` on 2026-11-23 (124 routes). VERIFIED route list; request/response shapes are summarised, not exhaustive — read the handler for the exact fields.

## Conventions (VERIFIED in `src/server.js`)
- JSON only. Writes need `Content-Type: application/json` and a same-origin `Origin` (CSRF). Session cookie `sid` (HttpOnly, SameSite=Strict, 7 days).
- All routes need a session unless marked **public**.
- Errors: `{ "error": { "code", "message", "details"? } }` with HTTP status from `HttpError`; DB constraint → 409 `CONSTRAINT`; unknown → 500 `INTERNAL`.
- `:sid` = station id; the station must be in the user's scope or the reply is 404. Permission failures → 403 `FORBIDDEN`.
- Money in replies = integer minor units; quantities in ml; prices `*_e4`. The UI formats them (`money()` in `app.js`).
- Lists accept paging/date filters (`from`, `to`, `limit`, `before` …) via `pageArgs`/`resolveDate` in `services.js` — exact names per handler.
- Sales use an idempotency key `client_id` (unique per station): retrying the same POST returns the same sale.
- 0.26: `limit` (≤ 200) + `before_id` page **in the list's own order**. Journals, vouchers and expenses are ordered by (business_date DESC, id DESC): the next page starts after the `before_id` row in that order (earlier versions used `id < before_id`, which skipped back-dated entries).
- 0.28 employees & payroll (perms `payroll.manage`, `payroll.pay`; reads need `read`/`report.read`): `GET|POST /api/stations/:sid/employees` (`?all=1` = with inactive; each row has derived `advance` and `payable`), `PATCH …/employees/:id`, `GET …/employees/:id/statement?from&to`, `GET|POST …/employee-moves` (`kind` advance | salary_pay, `method` cash | bank), `POST …/employee-moves/:id/void {reason}`, `GET …/payroll/draft?month=YYYY-MM`, `GET|POST …/payroll` (`{month, lines:[{employee_id, base, allowances, deductions, recovered, note}]}`), `GET …/payroll/:id`, `POST …/payroll/:id/void {reason}`; carry-over of old per-employee accounts (owner/admin): `GET …/payroll/carry-groups`, `GET …/payroll/carry?group_account_id=` (preview), `POST …/payroll/carry {group_account_id}` (backup first), `POST …/payroll/carry/undo {reason}`.
- 0.27: `POST /api/auth/register` follows `REGISTRATION` (open | first = only while there is no organisation | closed → 403 `REGISTRATION_CLOSED`); `GET /api/health` → `{ ok, register }` so the sign-in page hides «create account».
- 0.26: replies ≥ 1.4 KB are gzip-compressed when the request has `Accept-Encoding: gzip` (browsers always send it); `Cache-Control: no-store` on every API reply.

## Routes by area

### auth
| Method | Path | Handler | |
|---|---|---|---|
| POST | `/api/auth/register` | inline |  |
| POST | `/api/auth/login` | services.js login | public |
| POST | `/api/auth/logout` | auth.js destroySession | public |
| POST | `/api/auth/change-password` | services.js changePassword |  |
| POST | `/api/auth/forgot` | services.js forgotPassword | public |
| POST | `/api/auth/reset` | services.js resetPassword | public |
| POST | `/api/auth/2fa/setup` | services.js twoFactorSetup |  |
| POST | `/api/auth/2fa/enable` | services.js twoFactorEnable |  |
| POST | `/api/auth/2fa/disable` | services.js twoFactorDisable |  |
| POST | `/api/auth/2fa/recovery-codes` | services.js twoFactorNewCodes |  |

### me
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/me` | services.js recoveryLeft |  |

### users
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/users` | services.js listUsers |  |
| POST | `/api/users` | services.js createUser |  |
| PATCH | `/api/users/:id` | services.js updateUser |  |

### stations
| Method | Path | Handler | |
|---|---|---|---|
| POST | `/api/stations` | services.js createStation |  |

### station: (root)
| Method | Path | Handler | |
|---|---|---|---|
| PATCH | `/api/stations/:sid` | services.js updateStation |  |
| GET | `/api/stations/:sid` | services.js station |  |

### station: fuels
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/stations/:sid/fuels` | services.js listFuels |  |
| POST | `/api/stations/:sid/fuels` | services.js createFuel |  |
| PATCH | `/api/stations/:sid/fuels/:fid` | services.js updateFuelPrice |  |

### station: tanks
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/stations/:sid/tanks` | services.js listTanks |  |
| POST | `/api/stations/:sid/tanks` | services.js createTank |  |
| PATCH | `/api/stations/:sid/tanks/:tid` | ops.js updateTank |  |

### station: pumps
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/stations/:sid/pumps` | services.js listPumps |  |
| POST | `/api/stations/:sid/pumps` | services.js createPump |  |
| POST | `/api/stations/:sid/pumps/:pid/meter` | services.js correctMeter |  |

### station: customers
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/stations/:sid/customers` | services.js listCustomers |  |
| GET | `/api/stations/:sid/customers/:cid/statement` | services.js statement |  |
| POST | `/api/stations/:sid/customers` | services.js createCustomer |  |
| PATCH | `/api/stations/:sid/customers/:cid` | ops.js updateCustomer |  |

### station: sales
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/stations/:sid/sales` | services.js listSales |  |
| GET | `/api/stations/:sid/sales/export` | services.js exportSales |  |
| POST | `/api/stations/:sid/sales` | services.js createSale |  |
| POST | `/api/stations/:sid/sales/:id/void` | services.js voidSale |  |

### station: deliveries
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/stations/:sid/deliveries` | services.js listDeliveries |  |
| POST | `/api/stations/:sid/deliveries` | services.js createDelivery |  |
| POST | `/api/stations/:sid/deliveries/:id/void` | services.js voidDelivery |  |

### station: adjustments
| Method | Path | Handler | |
|---|---|---|---|
| POST | `/api/stations/:sid/adjustments` | services.js createAdjustment |  |

### station: expenses
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/stations/:sid/expenses` | services.js listExpenses |  |
| POST | `/api/stations/:sid/expenses` | services.js createExpense |  |
| POST | `/api/stations/:sid/expenses/:id/void` | services.js voidExpense |  |

### station: payments
| Method | Path | Handler | |
|---|---|---|---|
| POST | `/api/stations/:sid/payments` | services.js createPayment |  |
| POST | `/api/stations/:sid/payments/:id/void` | services.js voidPayment |  |

### station: stock
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/stations/:sid/stock/moves` | ops.js stockMoves |  |
| GET | `/api/stations/:sid/stock/reconciliation` | ops.js stockReconciliation |  |
| GET | `/api/stations/:sid/stock/monthly` | books.js stockMonthly |  |

### station: transfers
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/stations/:sid/transfers` | ops.js listTransfers |  |
| POST | `/api/stations/:sid/transfers` | ops.js createTransfer |  |
| POST | `/api/stations/:sid/transfers/:id/void` | ops.js voidTransfer |  |

### station: shifts
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/stations/:sid/shifts` | ops.js listShifts |  |
| GET | `/api/stations/:sid/shifts/current` | ops.js shiftDetail |  |
| GET | `/api/stations/:sid/shifts/:id` | ops.js shiftDetail |  |
| POST | `/api/stations/:sid/shifts` | ops.js openShiftCmd |  |
| POST | `/api/stations/:sid/shifts/:id/close` | ops.js closeShift |  |
| POST | `/api/stations/:sid/shifts/:id/approve` | ops.js approveShift |  |
| POST | `/api/stations/:sid/shifts/:id/unapprove` | ops.js unapproveShift |  |
| POST | `/api/stations/:sid/shifts/:id/reopen` | ops.js reopenShift |  |

### station: cash-moves
| Method | Path | Handler | |
|---|---|---|---|
| POST | `/api/stations/:sid/cash-moves` | ops.js cashMove |  |
| POST | `/api/stations/:sid/cash-moves/:id/void` | ops.js voidCashMove |  |

### station: suppliers
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/stations/:sid/suppliers` | ops.js listSuppliers |  |
| POST | `/api/stations/:sid/suppliers` | ops.js createSupplier |  |
| PATCH | `/api/stations/:sid/suppliers/:id` | ops.js updateSupplier |  |
| GET | `/api/stations/:sid/suppliers/:id/statement` | ops.js supplierStatement |  |

### station: supplier-payments
| Method | Path | Handler | |
|---|---|---|---|
| POST | `/api/stations/:sid/supplier-payments` | ops.js supplierPayment |  |
| POST | `/api/stations/:sid/supplier-payments/:id/void` | ops.js voidSupplierPayment |  |

### station: ageing
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/stations/:sid/ageing` | ops.js ageing |  |

### accounts
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/accounts` | ops.js listAccounts |  |
| POST | `/api/accounts` | books.js createAccount |  |
| PATCH | `/api/accounts/:id` | books.js updateAccount |  |
| GET | `/api/accounts/tree` | books.js accountTree |  |

### backups
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/backups` | backup.js can |  |
| POST | `/api/backups` | backup.js can |  |
| GET | `/api/backups/:name` | backup.js can |  |

### currencies
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/currencies` | books.js listCurrencies |  |
| POST | `/api/currencies` | books.js saveCurrency |  |
| POST | `/api/currencies/rates` | books.js setRate |  |

### accounting
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/accounting/revaluation` | books.js revaluation |  |
| POST | `/api/accounting/revaluation` | books.js revaluation |  |
| GET | `/api/accounting/profit-by-month` | books.js profitByMonth |  |
| GET | `/api/accounting/year-close` | reports.js yearClose |  |
| POST | `/api/accounting/year-close` | reports.js yearClose |  |
| POST | `/api/accounting/year-reopen` | reports.js yearReopen |  |
| GET | `/api/accounting/trial-balance` | ops.js trialBalance |  |
| GET | `/api/accounting/income-statement` | ops.js incomeStatement |  |
| GET | `/api/accounting/balance-sheet` | ops.js balanceSheet |  |
| GET | `/api/stations/:sid/reports/old-results?year=` | m7archive.js oldResults | old system's saved monthly results (trading + P&L) for one year, `report.read` |
| GET | `/api/stations/:sid/stock/old-values?year=` | m7archive.js oldStockValues | old monthly store value vs FuelPro value |
| GET | `/api/journals/:id/history` | m7archive.js journalHistory | audit rows of a journal incl. old edit copies and approvals, `journal.read` |
| GET | `/api/accounting/cash-flow` | ops.js cashFlow | `from`, `to`, `station_id` or `currency`; returns opening/closing cash, `operating`/`investing`/`financing`/`opening`/`fx` sections (rows, inflow, outflow, total), `boxes`, `reconciled` |
| GET | `/api/accounting/ledger` | ops.js accountLedger |  |
| GET | `/api/accounting/lock` | inline |  |
| POST | `/api/accounting/lock` | ops.js lockPeriod |  |
| GET | `/api/accounting/integrity` | ops.js integrity |  |

### station: assets
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/stations/:sid/assets` | books.js listAssets |  |
| POST | `/api/stations/:sid/assets` | books.js saveAsset |  |
| PATCH | `/api/stations/:sid/assets/:id` | books.js saveAsset |  |
| POST | `/api/stations/:sid/assets/depreciate` | books.js runDepreciation |  |

### station: sales-register
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/stations/:sid/sales-register` | books.js salesRegister |  |
| GET | `/api/stations/:sid/sales-register/:bill` | books.js salesBill |  |

### station: purchases
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/stations/:sid/purchases` | books.js purchases |  |
| GET | `/api/stations/:sid/purchases/:id` | books.js purchaseDetail |  |

### station: price-history
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/stations/:sid/price-history` | books.js priceHistory |  |

### brand
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/brand` | books.js getBrand |  |
| PATCH | `/api/brand` | books.js setBrand |  |

### boxes
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/boxes` | books.js boxes |  |

### station: vouchers
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/stations/:sid/vouchers` | books.js listVouchers |  |
| GET | `/api/stations/:sid/vouchers/:id` | books.js getVoucher |  |
| POST | `/api/stations/:sid/vouchers` | books.js createVoucher |  |
| POST | `/api/stations/:sid/vouchers/:id/void` | books.js voidVoucher |  |

### station: reports
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/stations/:sid/reports/boxes` | reports.js boxReport |  |
| GET | `/api/stations/:sid/reports/collections` | reports.js collections |  |
| GET | `/api/stations/:sid/reports/daily` | reports.js dailyReport |  |
| GET | `/api/stations/:sid/reports/meters` | books.js meterSheet |  |

### station: journals
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/stations/:sid/journals` | ops.js listJournals |  |
| POST | `/api/stations/:sid/journals` | ops.js createJournal |  |

### journals
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/journals/:id` | ops.js getJournal |  |
| POST | `/api/journals/:id/post` | ops.js postJournal |  |
| POST | `/api/journals/:id/reverse` | ops.js reverseJournal |  |
| DELETE | `/api/journals/:id` | ops.js deleteDraft |  |

### station: dashboard
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/stations/:sid/dashboard` | services.js dashboard |  |

### station: summary
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/stations/:sid/summary` | services.js summary |  |

### station: audit
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/stations/:sid/audit` | services.js auditLog |  |

### health
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/health` | inline | public |

### healthz
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/healthz` | inline | public |

### station: analytics and bank reconciliation (0.9.0)
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/stations/:sid/analytics` | analytics.js dashboard | report.read |
| GET | `/api/stations/:sid/bank-recs` | bankrec.js overview | report.read |
| POST | `/api/stations/:sid/bank-recs` | bankrec.js create | bank.reconcile |
| GET | `/api/stations/:sid/bank-recs/:id` | bankrec.js detail | report.read |
| PATCH | `/api/stations/:sid/bank-recs/:id` | bankrec.js update (clear/unclear lines, statement date/balance) | bank.reconcile |
| POST | `/api/stations/:sid/bank-recs/:id/finalize` | bankrec.js finalize | bank.reconcile |
| POST | `/api/stations/:sid/bank-recs/:id/reopen` | bankrec.js reopen | bank.reconcile |
| DELETE | `/api/stations/:sid/bank-recs/:id` | bankrec.js remove (draft only) | bank.reconcile |
Sales POST also accepts `discount` (minor units) or `discount_bp`; errors `DISCOUNT_TOO_LARGE`, 403 without `sale.discount`.

### station: alerts (0.10.0)
| Method | Path | Handler | |
|---|---|---|---|
| GET | `/api/stations/:sid/alerts` | alerts.js alerts | report.read |
