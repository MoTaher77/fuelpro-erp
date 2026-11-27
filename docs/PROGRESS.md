# PROGRESS — FuelPro
Updated 2026-11-24. No percentages: each line is VERIFIED (code + test), REPORTED, or PLANNED.

## Done
| Area | Status | Evidence |
|---|---|---|
| **v2 phase 3** customers, suppliers & collections (payments, supplier payments, statements, ageing) | VERIFIED (parity on 3 engines, invariants, browser) | `v2/tests/parity.test.ts`, `docs/V2-PHASE3.md` |
| **v2 phase 2** stock & deliveries (suppliers, deliveries, counts, transfers, reconciliation) | VERIFIED (parity on 3 engines, invariants, browser) | `v2/tests/parity.test.ts`, `docs/V2-PHASE2.md` |
| **v2 phase 1** (`v2/`): TypeScript core for sales & shifts on SQLite + PostgreSQL + desktop/phone bridge; parity with v1 to the minor unit; migration tool with in-transaction proof; server, Tauri desktop, Capacitor phone editions | VERIFIED (tests + browser + Linux desktop build); phone/Windows built by CI, not yet on a device (KI-23) | `v2/tests/*.test.ts`, `docs/V2-PHASE1.md` |
| Core: orgs, users, stations, fuels, tanks, pumps, meter sales, deliveries, expenses, VAT, void with reason | VERIFIED | `test/api.test.js` |
| Sign-in history + «online now» + sign out everywhere (0.35.0) | VERIFIED | `test/logins.test.js` |
| Roles (7) + station isolation + org isolation | VERIFIED | `erp.test.js` "roles and station access…", `api.test.js` |
| Security: CSRF, login throttle, password reset, TOTP 2FA, sealed secrets | VERIFIED | `api.test.js`, `auth-units.test.js` |
| Stock ledger, weighted average, counts, transfers, reconciliation, monthly count | VERIFIED | `erp.test.js`, `books.test.js` |
| Shifts and cash: open/close/approve/unapprove/reopen, variance posting | VERIFIED | `erp.test.js` |
| Customers & suppliers: credit, limits, statements, ageing, payments | VERIFIED | `erp.test.js`, `api.test.js` |
| Double entry: auto journals, manual journals, reversal, ledger, trial balance, P&L, balance sheet, period lock, integrity check | VERIFIED | `erp.test.js` |
| Account tree, boxes, receipt/payment vouchers | VERIFIED | `books.test.js` |
| Multi-currency boxes, exchange rates, revaluation | VERIFIED | `books.test.js` |
| Fixed assets, straight-line depreciation | VERIFIED | `books.test.js` |
| Sales register, purchase invoices, profit by month, price history, meter sheet | VERIFIED | `books.test.js` |
| Daily station report, box report, collections, journal book | VERIFIED | `reports.test.js` |
| Year close / reopen | VERIFIED | `reports.test.js` |
| Old-system (M7) history 0.8.0: DMP converter; edit copies/approvals/runs/log → audit (journal «سجل القيد», audit filters); users inactive + «تفعيل»; rates → exchange_rates; earlier-year results in «الأرباح الشهرية»; old stock value in «الجرد الشهري». Tried on a copy of the real DB | VERIFIED (code + tests + browser on a copy); **not yet loaded into the live DB** | `m7-history.test.js` |
| Cash-flow statement, direct method (0.7.0): operating / investing / financing, reconciles to the boxes; checked read-only on the real books (reconciled) | VERIFIED | `reports.test.js` "cash-flow statement…" |
| Backups (auto daily + manual, VACUUM INTO, restore) | VERIFIED | `erp.test.js`, `books.test.js` |
| Import of the real M7 year for محطة التميز; balances match except 33807/411005 | REPORTED (checked in earlier sessions with `scripts/reconcile-m7.js`) | — |
| UI: 3 languages, dark mode, PWA, phone layout, emerald/gold identity | REPORTED + browser sweeps | — |
| Column auto-fit + unified print + Dubai font (0.6.1): 39 screens with no overflow in the owner's Chrome | REPORTED (checked 2026-11-22 in the owner's Chrome) | — |
| Speed 0.26.0: compression + ETag, schema v16 covering indexes, N+1 removed (ageing, integrity, party lists, dashboard), faster balances/ledger/integrity, cached formatters, batched table fitting, long lists in parts | VERIFIED (identical answers on the snapshot copy and at 100k journals; numbers in PERFORMANCE.md) | `test/perf.test.js`, `test-e2e/ui.e2e.test.js`, `scripts/compare-dump.js` |
| Fixes 0.26.0: boot race (KI-13), CSP-blocked styles (KI-14), (date,id) paging (KI-15), double submit (KI-16) | VERIFIED | `test/perf.test.js`, e2e tests (the double-submit test fails without the fix: 3 expenses) |
| Concurrency: 20 users, reads + writes + sale retries | VERIFIED: 0 5xx, 0 duplicates, retries answered with the first sale, books balanced | `scripts/stress-api.js` |
| Employees & payroll 0.28.0 (`emp` screen, src/payroll.js, v17) | VERIFIED | `test/payroll.test.js`, e2e «staff & payroll» |
| VPS kit 0.27.0 (`deploy/vps/`, docs/VPS.md), `REGISTRATION` setting, `check-books.js` | VERIFIED in a container with stubbed systemd/ufw/caddy + tests; real server pending (KI-19) | `test/vps.test.js`, VPS.md «ما تم التحقق منه» |
| CI: lint, typecheck, audit, unit + PostgreSQL bridge, e2e, perf report, Artifact | VERIFIED locally; GitHub run pending on the PR | `.github/workflows/test.yml` |
| Windows install/run scripts | VERIFIED (scripts exist and are in use) | `Downloads\start-fuelpro.ps1` |

## Open / not built (PLANNED unless noted)
- Printed output check by the owner (statement, daily report, sales register) — **waiting on the owner**.
- Cloud deployment (Render/Railway configs ready, never deployed).
- Sale discounts; bank reconciliation; nozzles as separate units inside a pump (verified absent: no matches in `src/`).
- Native PDF/Excel export (today: browser print/PDF + CSV).
- Offline sale entry (UI shell works offline, saving needs the server).
- PostgreSQL / multi-server; subscriptions/billing; error monitoring.
- Employees/payroll module: UNKNOWN whether wanted; no code exists.
- Notifications module: only low-stock alerts in the UI (REPORTED); no messaging.
- Remote Git hosting (local repo exists since 2026-11-23, no remote) and tagged releases.

- 0.9.0 VERIFIED (68 tests, browser-checked on a copy): analytics dashboard, Excel export, sale discounts, bank reconciliation. Browser check found and fixed a display-scale bug in bank-ui (amounts shown ×10 on a 3-decimal station); sw cache v24.

- 0.10.0 VERIFIED (69 tests, browser-checked on a copy of the live data): smart alerts + bell; 0.9.2 sidebar keeps its scroll position.

- 0.11.0 VERIFIED: online through Cloudflare quick tunnel on the live laptop (HTTPS 200, HSTS + CSP headers, API 401 without sign-in); proxy test added (70 tests).

- 2026-11-26 — 0.29.0 off-site backup to Google Drive (rclone, daily timer) + status/alert + «download a fresh copy»: VERIFIED with a stub rclone (test/offsite.test.js); real Drive upload PLANNED (owner runs `fuelpro-offsite setup`).
