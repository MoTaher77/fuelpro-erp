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

## 2026-11-23 — 0.7.0 cash-flow statement (VERIFIED)
New `cashFlow` in `src/ops.js` + route `GET /api/accounting/cash-flow` + «التدفقات النقدية» tab in `public/erp.js` (i18n in `public/i18n-erp.js`), `sw.js` → v19.
Direct method, classification in ACCOUNTING-RULES §11 / ADR-13. Test added in `test/reports.test.js`; `npm test` 60/60.
Checked read-only on the real DB (no writes): reconciled, 56 ms. Browser check on a throwaway demo DB (port 8765; 3099 is reserved by Windows, 3000 is the owner's server).
Resume: owner reviews the cash-flow tab on real data; Task A print photos; next feature from NEXT-TASK Task C.

## 2026-11-23 — 0.8.0 old-system history in the normal screens (VERIFIED on a copy)
Owner uploaded `M7-SAT.DMP`; new `scripts/exp2sqlite.js` reads it (<1 s). All 2026 movements (to 2026-11-12) were already in FuelPro.
Owner rejected a separate archive screen; history now goes into audit/users/exchange_rates (+ m7_results, m7_stock_month, migration v13) via `scripts/import-m7-history.js`.
Screens: journal «سجل القيد», audit filters (dates/origin, paging), users «تفعيل», «الأرباح الشهرية» earlier years, «الجرد الشهري» old values. sw v20. Tests 63/63.
Finding: M7 has no detailed movements before 2026, so prior-year journals are impossible (ADR-14). Live DB NOT changed. Resume: NEXT-TASK Task 0, then dashboard → xlsx → bank rec + discounts.

## 2026-11-23 — 0.9.0 analytics, Excel, discounts, bank reconciliation (tests VERIFIED; browser checked for analytics + Excel only)
New: src/analytics.js + public/analytics-ui.js (#ana), public/xlsx.js (topbar Excel, opened in real Excel), sale discount (4050 sales_disc, perm sale.discount), src/bankrec.js + public/bank-ui.js (#bank, perm bank.reconcile), migration v14, sw v23. Tests 68/68.
NOT done: browser check of the discount field and bank screen; docs (MODULES/API/ACCOUNTING-RULES/ADR) not yet updated for 0.9.0; live DB still without M7 history (NEXT-TASK Task 0).

## 2026-11-23 — 0.11.1 print fix for the classic statement (tests VERIFIED 70; Playwright PDF on a demo DB)
Cloud env saved (Default: setup script + DB_PATH/BACKUP_AUTO). Rendered day report, sales register and customer statement to PDF from a throwaway demo DB. Statement: type column and long descriptions wrapped (14 rows/page); CSS-only fix in `public/app.css` (`.cl-tbl td.c/.k` nowrap, `td.d` bidi plaintext, header cells wrap) -> 22 rows/page, 3 pages instead of 4. sw v28.
Not done: sales register still has a wide centred Pumps column and tight Fuel/Date columns; Dubai font + real Chrome preview need the owner's printout (KI-07). Resume: NEXT-TASK Task A.
