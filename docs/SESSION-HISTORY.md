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
Follow-up: re-rendered on a throwaway copy of the real-data snapshot (dev-admin.js). Sales register Pumps column aligned (`td.pumps`, `td.fuel`), sw v29. Daily report tank table splits after 1 row (not fixed). Tests 70 pass.

## 2026-11-23 — 0.11.2 cloud hosting authorised
Owner authorised cloud deployment (ADR-19). CLAUDE.md + fuelpro-deployment skill relaxed; `.dockerignore`; `scripts/smoke-online.js` (local demo run: all checks pass incl. post/list/void expense). NOT deployed: the agent has no Render/Railway account access; owner steps are in docs/DEPLOYMENT.md. Resume: after the PR merges, owner connects the Blueprint; then run the smoke test on the URL.

## 2026-11-23 — 0.12.0 Claude Artifact edition (ADR-20)
New `web/` (bundle of unchanged src + shims + sql.js engine + runtime with save/load to Artifact db). Published private page https://claude.ai/artifact/CgLf1pmqcani77JBGVL56N (demo data). Tests: npm test 72 (70 pass + 2 skip without sql.js); on sql.js 70/70 non-backup pass incl. 2 new artifact tests; Chromium e2e on the built page with a storage stand-in: sign-in, expense, save (41 blocks), reload, data + session back, integrity OK, no page errors. NOT verified: the live page's real claude storage (needs the owner to open it and do one operation). Resume: owner opens the page; then read `fpstate` with ArtifactData to confirm the save.
Follow-up: owner approved real data → private page «FuelPro المحطة» https://claude.ai/artifact/Dbe4L4cWnvRSbeswvYAENF from the snapshot + throwaway admin. Chromium e2e on that build: boot 0.8 s, first save 134 blocks, second save 16 blocks, reload keeps data, integrity OK. Fixed: «محفوظ ✓» showed while a second save was pending (e2e caught it).
Follow-up 2: station page sign-in confusion: the page's "create account" form had made an empty org 2 (no operations), so the owner saw no data. Blocked registration on the station page, renamed the admin to admin@fuelpro.local with an easy password, cleared fpstate/main, republished (v2). Local e2e on that build: sign-in, save, reload OK.

## 2026-11-23 — 0.13.0 speed
Profiled all 33 report routes on the station snapshot in the page engine. Fixes: migration v15 (m7_results_latest index + ANALYZE), PRAGMA optimize on open, page uses sql.js WebAssembly (JS fallback). Station data, WASM: analytics 0.34 s (was 3.3-3.9 s), alerts 0.16 s (2.7 s), statements ~0.06 s (0.65 s), every screen 0.17-0.54 s in Chromium. Tests 73. Resume: owner checks the chip menu shows «WebAssembly» on his devices.

## 2026-11-23 — 0.14.0 palettes + responsive
`public/app.css` (end block): data-palette royal/emerald/bordeaux/onyx with light+dark tokens; breakpoints >=1600, 901-1180, 601-900, <=600, <=380, landscape phones, hover:none. `app.js`: P.palette (default royal), swatch picker with live preview in Preferences (reverts if closed unsaved). Fixed «null» under customers/suppliers (ageingSection may return null). Screenshots 390/820/1280/1920 in four palettes: no horizontal overflow, no page errors. Tests 73. sw v31.

## 2026-11-23 — 0.15.0 WhatsApp
`public/books-ui.js`: waNumber (local → international by station currency), waDialog (wa.me link as a real <a target=_blank>, copy, Web Share), statement message builder; customer/supplier statements get a WhatsApp button (cfg.whatsapp). `public/more-ui.js`: payment reminder per customer on #col. Browser-checked on demo data (number 9677…, message text, no page errors). Tests 73. sw v32.

## 2026-11-23 — 0.15.1 page open speed
Owner: page very slow. Cause: every open downloaded seed.js (~5 MB) and read 137 blocks one by one. Fix in web/runtime.js: lazy seed, IndexedDB device copy, parallel block reads (12) and writes (8). Chromium with 150 ms storage latency: reopen same device 21.6 s → 0.4 s, other device 21.6 s → 2.4 s, first save → 4.5 s. Tests 73.

## 2026-11-23 — 0.16.0 statement PDF to WhatsApp
Owner wanted the PDF, not text. New `public/stmt-pdf.js`: canvas-drawn A4 pages (browser shapes Arabic RTL) → JPEG → minimal PDF writer. books-ui `sendPdf`: navigator.share({files}) when supported (Android/iOS/Windows share sheet → WhatsApp), else download (ASCII file name) + wa.me dialog to attach. Checked in Chromium: 3-page PDF of a 59-row demo statement in ~0.2 s, layout reviewed, no page errors. Tests 73. sw v33.

## 2026-11-23 — 0.17.0 station page refresh from a laptop backup
`web/runtime.js` importDb (station builds only, `window.__FP_STATION`): file picker → checks → confirm → save(true, bytes) → reload. Chromium e2e with the demo DB as the 'backup': confirm text correct, reload, sign-in with the file's account, integrity ok, old page admin gone. Tests 73.

## 2026-11-23 — 0.18.0 daily summary on WhatsApp
`public/more-ui.js` waDay on #day (uses F.waDialog with rememberKey `fp.waOwner`). Checked on a station-data copy for 2026-11-12 (message text, number remembered). sw v35. PR #5 merged earlier (0.16-0.17.2).

## 2026-11-23 — 0.19.0 payment reminders queue
`public/more-ui.js` queue() on #col: list of owing customers, wa.me anchors with waReminder text, sent ticks in localStorage `fp.remind.<date>`, inline phone save via PATCH customers/:cid. Finding: the station snapshot has 0 customers with a phone number. Checked in Chromium on a copy: 105 rows, save number → link 9677…, tick persists after reopen. sw v36.

## 2026-11-23 — 0.20.0 station setup wizard
`public/wizard-ui.js` (banner on #dash/#setup while the station has no fuels/tanks/pumps; modal steps VAT → fuels → tanks → pumps → next jobs). Chromium e2e on a fresh org: 5% tax, 2 fuels with price/cost, 2 tanks (25k/10k L), 2 pumps with meter readings, refused a level above capacity before creating anything, banner gone afterwards, no page errors. Bugs found and fixed during the test: parseDec returns scaled integers (VAT), a duplicate tank after a failed retry (now validate-all-then-create), stray 'null' on the last step. sw v37.

## 2026-11-23 — 0.21.0 second backup copy
`src/backup.js` syncMirror (BACKUP_COPY_DIR or data/backup-copy-dir.txt; temp file + rename; 30+30 retention; catch-up each hourly check; failure only reported), `GET /api/backups` returns `mirror`, status line on the backups screen. `test/backup-mirror.test.js` (3). KI-10 mitigated; owner must create the folder file. Tests 76.

## 2026-11-23 — Phase 2 assessment (docs only)
Owner said start Phase 2. Measured instead of rewriting: see docs/PHASE2-POSTGRES.md and ADR-21 (recommendation: postpone; needs an approved always-on host, a driver decision and several sessions). No code changed. Resume: owner decides.

## 2026-11-23 — libraries and tools installed (ADR-22)
Owner asked to install external libraries and dev tools instead of hand-writing them. Removed the half-written src/pg client. `npm i`: pg 8 (dependency), eslint 10 + @eslint/js + globals, sql.js 1.10.3 (exact), playwright (dev). `eslint.config.js` (0 errors, 28 warnings; real finds: duplicate i18n keys KI-12). CI: npm ci + lint + test; artifact job uses npm run test:artifact/build:artifact. Dockerfile runs npm ci --omit=dev. A local PostgreSQL 16 server is runnable in the sandbox (initdb + pg_ctl as user postgres, port 5433) for the next stage.

## 2026-11-23 — 0.23.0 Phase 2 stage A (PostgreSQL bridge)
src/pg/{worker,sync,dialect}.js + test/pg-sync.test.js (live tests need FUELPRO_TEST_PG; CI has a postgres:16 service). Local test server: initdb + pg_ctl as user postgres on port 5433, databases fp (SQL_ASCII, bridge tests) and fp8 (UTF8, schema probe). Schema probe: 127/129 statements port; v3 table rebuild + 9 triggers by hand. SQLite stays the default; nothing changes for the laptop. Resume: stage B in docs/PHASE2-POSTGRES.md.

## 2026-11-23 — 0.24.0 report PDFs on WhatsApp
public/stmt-pdf.js: optional party/summary/total, extra titled `sections`. books-ui: pdfShare + reportPdf (F.reportPdf); sales register button. more-ui: daily report (fuel + expenses + boxes + tanks) and collections PDFs. Checked on a station-data copy: day 2 pages, sales register 2, collections 4, each ~0.7 s, layouts reviewed, no page errors. sw v39.

## 2026-11-23 — 0.24.0 merged, demo page removed, handoff to laptop
- PR #10 merged: daily report / sales register / collections as PDF to WhatsApp (`F.reportPdf`, multi-section `stmt-pdf.js`). 77 tests, CI green.
- Demo Artifact deleted at the owner's request; station page republished (v15).
- Resume: `docs/NEXT-TASK.md` → "Handoff 2026-11-23".

## 2026-11-24 — 0.25.0
- Boxes report (#box) gets «واتساب PDF» (`boxPdf` in `public/more-ui.js`); sw v40. 77 tests. Checked in Chromium on the snapshot: the PDF dialog appears (262 KB).

## 2026-11-24 — 0.26.0 speed and quality (cloud, branch claude/wonderful-pascal-jfuqxu)
- Measured first (snapshot copy + demo DBs up to 100k journals): no compression/ETag (533 KB per reload), alerts after every screen (165 ms blocking), N+1 in ageing/integrity/party lists, 36k `Intl` constructions and up to 300 forced layouts on long screens.
- Fixed: compression + ETag, v16 covering indexes, grouped queries, faster balances/ledger/integrity, FPFMT, batched fitTables, long lists in parts, bell throttle; bugs KI-13..16 (boot race, CSP styles, date paging, double submit).
- Proved: `compare-dump.js` identical answers (snapshot, 100k and 480k journals); stress 20 users PASS (120-day and 20-year demo); 81 unit + 5 e2e tests; sql.js suite; Artifact bundle builds.
- Added: bench/stress scripts, CI jobs (typecheck, audit, e2e, perf), `fuelpro-performance` skill, review agents, ADR-23..25, docs PERFORMANCE.md + DATABASE.md.
- Resume: `docs/NEXT-TASK.md` → "Handoff 2026-11-24".

## 2026-11-24 — 0.27.0 VPS kit (cloud)
- Owner asked to run FuelPro on a real VPS. Built `deploy/vps/` (install/update/restore, systemd unit with hardening, Caddy HTTPS, laptop send/pull PowerShell) and `docs/VPS.md`; ADR-26.
- App: `REGISTRATION=open|first|closed` (+ /api/health `register`, sign-in page hides «create account»); Caddy strips client `CF-Connecting-IP`; `scripts/check-books.js`.
- Verified: 83 tests; smoke-online 14/14 with the VPS settings; scripts run in an Ubuntu 24.04 container with stubbed systemd/ufw/caddy. Not verified: real systemd, Let's Encrypt, firewall (KI-19).
- Resume: `docs/NEXT-TASK.md` → "Handoff 2026-11-24 (0.27.0)".
- 2026-11-24 later: owner ran the kit on his VPS. App + systemd + ufw OK; Caddy stopped on `/var/log/caddy/fuelpro.log: permission denied` (file created by root during `caddy validate`). 0.27.1: log to journald, fix ownership, verify HTTPS at the end. Owner given a one-line fix for his server.
- 2026-11-24 later still: Caddy fixed on the server (HTTPS 200); owner asked to put his real data on the VPS (explicit OK): snapshot copy + new owner password generated on the server, `fuelpro-restore --yes` → live, 13,857 journals, books OK. Kit fixes in PR #14: tolerant confirmation, scripts ignore SIGHUP.

## 2026-11-24 — 0.28.0 employees & payroll + screen audit (cloud)
- Owner: «no mistakes; find the missing screens and build them». Audit of all 30 screens × sub-tabs × ar/en × desktop/phone on the snapshot: no script errors, no failed API calls; 20 untranslated audit actions fixed + test/i18n.test.js.
- Built the only ⛔ module: employees & payroll (src/payroll.js, public/payroll-ui.js, migration v17, ADR-27, ACCOUNTING-RULES §15). 87 unit + 6 e2e; all snapshot API answers identical except 2 new accounts.
- Found: the real station keeps 37 employee accounts under 125 (KI-20) → owner decision. Resume: NEXT-TASK.
- Owner chose to carry the 125 accounts over: preview/carry/undo (src/payroll.js carry*, migration v18), rehearsed on the snapshot copy (27 employees, equity/profit unchanged, integrity OK) + browser check; test for undo → re-carry found and fixed a duplicate-employee bug.

## 2026-11-24 — 0.28.1 (cloud)
- Owner: trial user with no data → `scripts/new-org.js` (empty org + owner, random password printed once). «Failed to fetch» after idle → `api()` retries reads, clear message on saves, boot keeps the session screen; Caddy template h1/h2 only. 7 e2e. Domain: `domain.sh` merged (#16), waiting for the owner's domain.

## 2026-11-26 — 0.29.0 (cloud)
- Owner chose off-site backups on Google Drive + a download-to-device button. Added `deploy/vps/offsite.sh` (+ `.service`/`.timer`, installed by install.sh/update.sh), `BK.offsite()` reader, alert `offsite`, backup-screen status + button, i18n, sw v48; ADR-28, KI-10, VPS.md §4.
- Tests: 94 unit (+6 in test/offsite.test.js with a stub rclone), 7 e2e, 89 artifact, lint 0 errors, tsc clean. Real Google Drive not reachable from the cloud — the owner's first `fuelpro-offsite setup` is the real test.
- Resume: NEXT-TASK.

## 2026-11-27 — 0.30.0 UI polish (cloud, branch `claude/ui-polish`)
- Owner declined both new looks (calm mock-up; «ليل الياقوت», PR #20 closed): keep the original screens and colours, improve only (ADR-29).
- Done: folding menu groups (remembered, current group always open), calmer phone top bar (Excel/theme/sign-out moved into the menu), one-line bottom-bar names, sticky table headers on desktop, tabular figures, total rows, status dots, empty-state cards, «null» under customers fixed. Screen only; print untouched.
- Tests: 94 unit + 1 skipped, 7 e2e, 89 artifact, lint 0 errors; fold/phone-menu behaviour checked in Chromium. Before/after page (demo data) in the owner's private artifacts.
- Then (same PR): spinner + tick on save buttons (guard), errors under the field (`.fe`, `aria-invalid`) and a box beside the button (`.form-err`), toast countdown bar + red error toasts. New e2e test (8 total); the dropped-connection test now reads the box beside the button.

## 2026-11-27 — 0.31.0 every-screen review (cloud, branch `claude/ui-screens`)
- Automated audit of all 30 screens at 1366/768/390 px, light + dark (demo data) + contact sheets reviewed by eye. Fixed: «null» text in sales register and currencies (global guard on append/prepend/replaceChildren/before/after), labels tied to every field (`field()` gives an id), price inputs named, `a.btn` sized like buttons, phone dates ≤2 lines.
- e2e sweep now fails on null/undefined text, page sideways scroll or unlabelled fields. Tests: 94 unit, 8 e2e, 89 artifact, lint 0 errors.

## 2026-11-27 — 0.32.0 printing phase 1 (cloud, branch `claude/print-overhaul`)
- New print engine (`public/print-kit.js`, `public/print.css`, fonts in `public/fonts`): receipt 80/58 mm sized to its content, A4 account statement, journal book; «page X of Y» via @page margin boxes (CSSOM sheet, CSP-safe); waits for fonts.
- `scripts/print-check.js` (Chromium → PDF → pdftoppm/pdffonts/pdftotext): receipts 227×326 pt / 164×306 pt, statement 4 p, journal book 105 p, page numbers yes, 0 overflow, only Plex/Naskh embedded, 30–320 ms. Baseline: receipt printed on A4, no page numbers, Arabic fell back to DejaVu in the container.
- Samples in `docs/print-samples/`; owner to approve before the other documents (day report, boxes, collections, vouchers, payroll) are moved. Tests: 94 unit, 8 e2e, 89 artifact, lint 0 errors.
