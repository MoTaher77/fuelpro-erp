# SESSION-HISTORY — FuelPro
Short dated summaries. Newest last. 3–6 lines each.

## 2026-11-21 — v0.1 → 0.5.0 (REPORTED from CHANGELOG)
Core server, 3-language UI, password reset + 2FA, roles, stock ledger, shifts, suppliers, double entry, demo year,
Render/Docker/CI configs, emerald/gold visual identity. 47 tests at 0.4.0. Windows start scripts.

## 2026-11-22 — real data import and ERP books (REPORTED)
Imported محطة التميز's year from the Oracle M7 export (`scripts/import-m7.js`), reconciled balances (all match except
33807/411005). Added account tree, boxes, vouchers, currencies/FX, fixed assets, sales register, purchases, price history,
branding. Owner began real work → code-only delivery from now on.

## 2026-11-22 — 0.6.0 reports and year close (REPORTED)
Daily station report, box/bank report, collections, journal book, year close/reopen (`src/reports.js`, `public/more-ui.js`). Delivered as v16.

## 2026-11-22 — 0.6.1 formatting and printing (REPORTED)
Column auto-fit, unified print letterhead, landscape for wide tables, Dubai font, Arabic integrity names. 59 tests.
Checked in the owner's Chrome: 39 screens, no overflow. Delivered as v17 (`Downloads\fuelpro.zip`, sha256 verified). Waiting for print photos.

## 2026-11-23 — documentation system (VERIFIED)
Created `CLAUDE.md`, `docs/*` (17 files), `.claude/skills/fuelpro-*` (6 skills), `scripts/schema-doc.js`; added legacy notes
to the old root docs. No application code changed. `npm test` 59/59. Laptop code = cloud code except `scripts/reconcile-m7.js`.
Resume at `docs/NEXT-TASK.md` Task A.

## 2026-11-23 — work moves to Claude on Windows
`Downloads\fuelpro.zip` renamed to `fuelpro-v18.zip` (KI-02 mitigated). Development continues directly in `C:\Users\Moham\FuelPro`. Data untouched.

## 2026-11-23 — housekeeping (Task B1, B4) (VERIFIED)
Checked reality: no `Downloads\fuelpro.zip` (in-place edits are safe), `npm test` 59/59. Set `package.json` version 0.6.1 (KI-03 closed);
README now points to `docs/` and marks root docs as legacy. No application code or data touched.
Resume: Task A (owner's print photos) and Task B3 (`git init`, needs the owner's OK), then Task C (owner picks a feature).

## 2026-11-23 — Git repository (VERIFIED)
With the owner's OK: `git init -b main`, `.gitignore` extended (whole `data/`, `*.db*`, `.env*` except `.env.example`, `بيانات-الدخول.txt`,
`.claude/settings.local.json`, `*.zip`, `*.log`), `core.autocrlf=false`. Checked with `git check-ignore`: real DB, `.env` and the login file are excluded. KI-01 closed.
