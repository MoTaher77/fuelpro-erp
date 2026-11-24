# TESTING — FuelPro

## Commands (VERIFIED 2026-11-24)
| Command | What | Result |
|---|---|---|
| `npm test` | `node --test test/*.test.js` — real HTTP server on a random port, in-memory SQLite per test | **81 pass, 1 skipped (PostgreSQL, needs `FUELPRO_TEST_PG`), 0 fail, ~6 s** |
| `npm run test:e2e` | `test-e2e/*.test.js` — Playwright + Chromium on a freshly seeded **demo** DB (120 days) | **5 pass, ~25 s** |
| `npm run test:artifact` | the whole suite on sql.js (the Artifact page engine), file backups excluded | **77 pass, 1 skipped** |
| `npm run lint` | eslint (errors fail CI) | 0 errors |
| `npm run typecheck` | `tsc` on files that start with `// @ts-check` (money, validate, errors, bench/stress scripts) | 0 errors |
| `npm audit --omit=dev --audit-level=high` | runtime dependencies | 0 vulnerabilities |
| `node scripts/stress-api.js --db <demo copy> --password <pw>` | 20 concurrent users, reads + writes + sale retries, then checks the books | PASS (see PERFORMANCE.md) |
| `node scripts/bench-api.js` / `bench-pages.js` / `compare-dump.js` | speed + "same answers" proof | see [PERFORMANCE.md](PERFORMANCE.md) |

CI (`.github/workflows/test.yml`): `test` (lint, typecheck, audit, unit + PostgreSQL bridge tests), `e2e` (Playwright), `perf` (seeded 365-day demo → API + page report as a build artifact, informative), `artifact` (sql.js suite + bundle).

## Suites
| File | Covers |
|---|---|
| `test/api.test.js` | register/login, meter sales, stock limits, idempotent `client_id`, VAT, void, cashier limits, org isolation, credit/overpayment, deliveries, stock count, summary, throttling, CSRF, validation, statements, password change/reset, 2FA |
| `test/erp.test.js` | balanced journals + weighted average, void reversal + append-only, stock count, transfers, shifts, suppliers/ageing/credit limit, manual journals + period lock, roles, parallel duplicates, v2→v3 upgrade, backup restore |
| `test/books.test.js` | account tree/boxes, vouchers, manual journal rules, meter sheet, price history, sales register/purchases/profit by month, FX boxes + revaluation, fixed assets, monthly stock, backups API |
| `test/reports.test.js` | daily/box/collections agree with the day's operations; year close + reopen + statements + integrity |
| `test/perf.test.js` | 0.26: brotli/gzip + ETag/304 for app files, content-hashed `?v=` URLs (immutable), gzip for big API answers, journal paging in (date, id) order (back-dated entries not skipped) |
| `test/speed.test.js` | v15 index + planner statistics |
| others | money, auth units, alerts, discounts + bank reconciliation, M7 history, xlsx, proxy, backup mirror, PostgreSQL bridge, Artifact runtime |
| `test-e2e/ui.e2e.test.js` | every menu screen at 1366 px and 390 px without script errors; long statement / journal book / journal list in parts with «show all»; Excel export expands first; compressed app files + 304 on reload; a triple-submitted expense is saved once |

## Financial correctness — what a new accounting change must test
Balanced journal per operation · exact reversal on void · stock value = account 1200 · customers = 1100 · suppliers = 2010 ·
trial balance balances · `GET /api/accounting/integrity` all green. Copy the pattern from `test/erp.test.js`.
For a query rewrite: `scripts/compare-dump.js` before/after on the snapshot copy must print **all responses identical**.

## Not testable from the cloud
- **Print preview** and the Dubai font (Windows only): the owner's printouts are the acceptance test (KI-07).

## Known failures
None as of 2026-11-24.
