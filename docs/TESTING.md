# TESTING — FuelPro

## Commands (VERIFIED 2026-11-23)
| Command | What | Result |
|---|---|---|
| `npm test` | `node --test test/*.test.js` — real HTTP server on a random port, in-memory SQLite per test | **68 pass / 0 fail, ~9 s** (2026-11-23) |
| `node --test test/reports.test.js` | one file | |
| `DB_PATH=/tmp/demo.db DEMO_PASSWORD=ci-only-password-123 node scripts/seed-demo.js --days 60` | demo smoke test: generates 60 days through real logic; books must balance | used in CI |
| CI | `.github/workflows/ci.yml`: npm test + demo seed + docker build | never run on GitHub (no repo) |

## Suites
| File | Tests | Covers |
|---|---|---|
| `test/api.test.js` | 23 | register/login, meter sales, stock limits, idempotent `client_id`, VAT, void, cashier limits, org isolation, credit/overpayment, deliveries, stock count, summary, throttling, CSRF, validation, statements, password change/reset, 2FA |
| `test/erp.test.js` | 11 | balanced journals + weighted average, void reversal + append-only, stock count, transfers, shifts, suppliers/ageing/credit limit, manual journals + period lock, roles, parallel duplicates, v2→v3 upgrade, backup restore |
| `test/books.test.js` | 10 | account tree/boxes, vouchers, manual journal rules, meter sheet, price history, sales register/purchases/profit by month, FX boxes + revaluation, fixed assets, monthly stock, backups API |
| `test/money.test.js` | 9 | rounding, `amountMinor` exactness, `vatSplit` |
| `test/auth-units.test.js` | 4 | TOTP vectors, SMTP client |
| `test/reports.test.js` | 2 | daily/box/collections agree with the day's operations; year close + reopen + statements + integrity |

## Financial correctness — what a new accounting change must test
Balanced journal per operation · exact reversal on void · stock value = account 1200 · customers = 1100 · suppliers = 2010 ·
trial balance balances · `GET /api/accounting/integrity` all green. Copy the pattern from `test/erp.test.js`.

## Browser / UI / print tests (manual or ad-hoc, not in the repo)
- Playwright sweeps were run from the cloud container in earlier sessions (scripts in a temp folder, not kept) against an import of the real data: every screen and sub-tab in Arabic/English, phone and desktop, no console errors, no table overflow (REPORTED 2026-11-22).
- Real-Chrome check through Claude in Chrome on `http://localhost:3000`: 39 screens, no overflow, no clipped tiles (REPORTED 2026-11-22).
- **Print preview cannot be checked from the cloud**; the Dubai font only exists on Windows. Owner's printouts are the acceptance test (open — NEXT-TASK A).
- Recommendation (not done): add a small Playwright smoke script in a new `test/ui` folder.

## Known failures
None as of 2026-11-23.
