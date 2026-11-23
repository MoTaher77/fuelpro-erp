# PROJECT-MEMORY — FuelPro

Long-term memory. Facts that stay true between sessions. Short and factual: details are in the linked docs.
Last verified: **2026-11-23** (`npm test` 60/60).
Labels: VERIFIED · REPORTED · PLANNED · UNKNOWN.

## 1. Identity
| | |
|---|---|
| Name | FuelPro (fuel-station management ERP) |
| Owner | Mohammed, Yemen (UTC+3). Works in Arabic |
| Purpose | Run fuel stations end to end (pumps, tanks, shifts, boxes, customers, suppliers, accounting), and sell it as a product (REPORTED) |
| First live user | **محطة التميز** — one year of real data imported from the old Oracle "M7" system (VERIFIED: `scripts/import-m7.js`) |
| Tenancy | Many organisations (`orgs`) → many stations (`stations`); each station has its own currency, VAT, timezone (VERIFIED) |
| Platforms | Any browser (desktop + phone, PWA). Runs on Windows laptop today; cloud configs exist for Render/Railway (VERIFIED files, not deployed) |
| Stack | Node ≥22.5, `node:sqlite`, zero dependencies, vanilla JS front end → [ARCHITECTURE](ARCHITECTURE.md) |

## 2. Current state (2026-11-23)
- Version: **0.7.0** in both `CHANGELOG.md` and `package.json`.
- Tests: **60/60 pass** (VERIFIED 2026-11-23, ~9 s).
- In production use on the owner's laptop with the real DB `C:\Users\Moham\FuelPro\data\fuelpro.db`. The owner has **started real daily work** in it (REPORTED 2026-11-22) → never replace it.
- Import result: all customer, supplier and account balances match the old system, except the stock-method accounts **33807** and **411005** (old system = periodic stock, FuelPro = perpetual). Accepted, documented (REPORTED/VERIFIED during import sessions; KI-05).
- Not deployed to the cloud. Local Git repo since 2026-11-23 (no remote). → [PROGRESS](PROGRESS.md), [KNOWN-ISSUES](KNOWN-ISSUES.md)

## 3. Milestones (summary — full list in `CHANGELOG.md`)
0.1 core server · 0.2 3-language UI, Hijri calendar, CSV · 0.3 password reset + TOTP 2FA · 0.4 roles, stock ledger,
shifts, suppliers, double-entry accounting, demo year · 0.5 visual identity · (unversioned, 2026-11-22) M7 import,
vouchers, multi-currency boxes, fixed assets, sales register, purchases, price history, branding/letterhead ·
0.6.0 daily report, box report, collections, journal book, year close · 0.6.1 column auto-fit, Dubai font, unified print · 0.7.0 cash-flow statement.

## 4. Permanent business rules (details → [ACCOUNTING-RULES](ACCOUNTING-RULES.md), [SECURITY](SECURITY.md))
- Integer money (minor units), ml quantities, `price_e4`, `rate_e6`. No floats.
- Every operation is one DB transaction: document + stock move + journal + audit.
- Posted journals and stock moves are immutable (DB triggers). Correction = void/reversal with a reason.
- Perpetual inventory, weighted-average cost; COGS posted at each sale.
- Period lock (`orgs.locked_through`); year close journal into 3900 per station.
- Org isolation + station assignment; 7 roles; server-side permission checks; full audit table.

## 5. Development context
- Canonical source on the laptop `C:\Users\Moham\FuelPro`. Cloud sessions are temporary; anything built there must be shipped back as `Downloads\fuelpro.zip` (installed by `start-fuelpro.ps1`) **and** the docs folder copied.
- Delivery rule: ship **code only**; `start-fuelpro.ps1` never touches `data\`.
- Front-end change → bump `public/sw.js` `CACHE`.
- Testing strategy → [TESTING](TESTING.md). Coding conventions → `CLAUDE.md` §7.
- Constraints: single SQLite file (one server process); no npm packages; Arabic RTL first; print via browser.

## 6. Session continuity
- Stopped at: v0.7.0 cash-flow statement (2026-11-23). Local Git repo, branch `main`.
- Waiting on the owner: photos of the **printed** customer statement, daily report and sales register (print preview is not verifiable from the cloud).
- Next task → [NEXT-TASK](NEXT-TASK.md). History → [SESSION-HISTORY](SESSION-HISTORY.md).
