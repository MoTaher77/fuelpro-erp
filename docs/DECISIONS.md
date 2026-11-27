# DECISIONS — Architecture Decision Records
Dates are when the decision is first visible in the CHANGELOG or sessions (REPORTED unless noted). Add new ADRs at the end.

### ADR-01 Zero dependencies, Node built-ins only (0.1, 2026-11)
- **Decision:** `node:http`, `node:sqlite`, `node:crypto`; own SMTP, TOTP, QR. **Why:** installable on any laptop with just Node; nothing to break or audit. **Alternatives:** Express/Prisma/React. **Consequences:** more hand-written code; Node ≥22.5 required. **Evidence:** `package.json` has no dependencies.

### ADR-02 SQLite (WAL) on one file (0.1)
- **Why:** zero admin, atomic transactions, easy backup (`VACUUM INTO`). **Alternative:** PostgreSQL (planned for multi-server). **Consequence:** one server process per DB. **Evidence:** `src/db.js`.

### ADR-03 Integer money, BigInt arithmetic (0.1)
- **Why:** no rounding drift. **Evidence:** `src/money.js`, `test/money.test.js`.

### ADR-04 Balances derived from documents; immutability enforced by DB triggers (0.4)
- **Why:** trustworthy books; a bug or manual SQL can't silently change history. **Consequence:** corrections only by void/reversal. **Evidence:** triggers in `src/db.js`.

### ADR-05 Perpetual stock at weighted-average cost (0.4)
- **Alternative:** periodic stock (what M7 used). **Consequence:** accounts 33807/411005 differ from M7 after import (accepted). **Evidence:** `L.stockMove`.

### ADR-06 Seven roles, server-side checks, station assignment (0.4)
- **Evidence:** `PERMS` in `src/auth.js`, `erp.test.js`.

### ADR-07 Vanilla JS SPA without a build step (0.1–0.6)
- **Why:** ships as static files in the zip; works offline as a PWA shell. **Consequence:** large hand-written UI files.

### ADR-08 Import the real M7 year into a NEW database (2026-11-22)
- **Decision:** `scripts/import-m7.js` builds a fresh DB from the SQLite copy of the Oracle export; nothing is written to the source; verified with `reconcile-m7.js`. **Consequence:** the imported DB became the real `fuelpro.db`.

### ADR-09 Code-only delivery once real work starts (2026-11-22)
- **Decision:** never replace `data\fuelpro.db`; ship only the program zip; check `audit` for user activity before any data operation. **Why:** the owner now enters real transactions.

### ADR-10 Year close as a reversible journal (0.6.0, 2026-11-22)
- **Decision:** one `year_close` journal per station into 3900, optional period lock; income statement ignores it. **Alternative:** closing by zeroing accounts. **Evidence:** `src/reports.js`, `test/reports.test.js`.

### ADR-11 Automatic column fit + unified print letterhead, Dubai font (0.6.1, 2026-11-22)
- **Why:** owner asked for formal, error-free statements. **Consequence:** Dubai only on Windows; fallbacks Segoe UI/Tahoma. **Evidence:** `fitTable` and `printNode` in `public/app.js`, print block in `public/app.css`.

### ADR-12 Project knowledge lives in the repo (`CLAUDE.md` + `docs/` + `.claude/skills/`) (2026-11-23)
- **Why:** sessions should resume without re-explaining; cloud containers are temporary. **Consequence:** every task ends by updating PROGRESS/NEXT-TASK/SESSION-HISTORY. **Alternative:** relying on chat history (lost and expensive to re-read).

### ADR-13 Cash-flow statement by the direct method, classified by account (0.7.0, 2026-11-23)
- **Decision:** derive flows from journals that touch a box, attributing each box movement to the other accounts of its journal; classify by system account, fixed-asset register, imported group code (11/214 investing; 216/217/224/227 financing), then account type. No schema change.
- **Why:** exact integer reconciliation with the boxes, works for both the FuelPro chart and the imported M7 tree. **Alternative:** indirect method from net profit and balance-sheet changes (needs a reliable current/non-current split the imported tree does not give). **Evidence:** `src/ops.js` `cashFlow`, `test/reports.test.js`; checked read-only on the real books: reconciled, 56 ms for 11 months.

### ADR-14 Old-system history goes into the normal tables and screens; earlier years only as results (0.8.0, 2026-11-23)
- **Decision:** edit copies, approvals, closing runs and the sign-in log become `audit` rows (actions `m7.*`, old local time converted to UTC, linked to the journal by document number); old users become inactive `users` (placeholder e-mail `@old-system.invalid`, activation needs a real e-mail); old rates go into `exchange_rates`. Only data with no FuelPro table is kept apart: `m7_results` (shown in «الأرباح الشهرية») and `m7_stock_month` (shown in «الجرد الشهري»). Every row has a source key, so a second run adds nothing.
- **Why:** the owner rejected a separate archive screen ("same screens and tables"). He chose monthly summary journals for 2020–2025, but analysis showed BAL_ACC is not a full balance sheet (17–58 accounts per date, 0 of 30 balances match the 2026 opening entry): such journals would give wrong books, so earlier years are shown as the old system's results instead. **Evidence:** `src/m7archive.js`, `test/m7-history.test.js`, trial on a copy (books unchanged, second run adds 0).

### ADR-15 Sale discount as a contra-revenue line; bank reconciliation as marks beside the books (0.9.0, 2026-11-23)
Discounts post to a separate account 4050 so list sales and discounts stay visible; VAT follows the amount paid. Bank reconciliation stores only cleared flags (`bank_cleared`), so immutable journals stay untouched and reopening is possible without reversals.

### ADR-16 Alerts are computed on request, never stored (0.10.0, 2026-11-23)
A stored alert can disagree with the books; computing from the live data keeps one source of truth. The bell refreshes every 5 minutes and after each screen; the list links to the screen that fixes it.

### ADR-17 Go online in two phases: laptop + Cloudflare Tunnel now, PostgreSQL later (0.11.0, 2026-11-23)
Owner chose the laptop + tunnel (free, data stays local) and a two-phase database move. Phase 2 replaces the synchronous node:sqlite layer with PostgreSQL behind the same tests, then the data is moved after reconciliation.

### ADR-18 A sign-in-free snapshot of the real data lives in the private repository (2026-11-23)
The owner develops from the cloud and asked for his real data there. `scripts/dev-snapshot.js` makes `dev-data/fuelpro-snapshot.db` (VACUUM INTO) and removes every password hash, session, reset token, recovery code and two-factor secret; business data (customers, suppliers, journals) stays. The repository is private (`MoTaher77/fuelpro-erp`). Refreshing it is a manual step on the laptop (`node scripts/dev-snapshot.js`, then commit). Git keeps old snapshots in history: if a snapshot must ever disappear, the repository history has to be rewritten.

### ADR-19 Cloud hosting is authorised; moving real data stays a separate decision (2026-11-23)
The owner explicitly allowed deploying the full app (Node + SQLite on a persistent disk) to a cloud host, reachable over HTTPS from any device. Rule in `CLAUDE.md` §5 changed from "never without request" to "allowed; real-data copy needs a separate OK". Safeguards kept: separate demo/production disks (`render.yaml`), `.dockerignore` keeps `data/`, `dev-data/`, `*.db`, `.env*` out of the image, secrets only in the host dashboard, backup before any migration, `scripts/smoke-online.js` to verify a deployment. SQLite on one disk fits a single instance; PostgreSQL (Phase 2) is needed for several instances.

### ADR-20 Online demo as a Claude Artifact running the real server code (2026-11-23)
The owner wants FuelPro usable from phone and laptop entirely inside Claude, without Render/Railway/ChatGPT/Codex (supersedes ADR-19's hosting plan). Chosen: bundle the unchanged `src/` into the page with small shims (Buffer, hashes, scrypt, path, fs, http) and sql.js as the SQLite engine; the app's own front end talks to it through `fetch`. The database file is stored in the Artifact's `db` capability as content-addressed gzip blocks plus one state document, so a save is atomic from the reader's view. Rejected: rewriting features for the page (would fork the accounting rules), a fake API (forbidden: no imitation of financial results). Proof: all non-backup tests pass on sql.js (`web/sqljs-hook.mjs`), plus `test/artifact-runtime.test.js` (save → reopen → identical books). Limits: no printing, no file backups or SMTP in the page, one writer at a time, demo data only.
Addendum 2026-11-23: the owner explicitly approved loading the real-data snapshot into a second private Artifact («FuelPro المحطة»). Safeguards: snapshot has no password hashes/sessions/2FA secrets, a throwaway admin is the only working sign-in, the page is private, demo and station pages have separate storage.

### ADR-21 Phase 2 (PostgreSQL) is postponed until a server exists (2026-11-23, proposed — owner to confirm)
Measured scope in `docs/PHASE2-POSTGRES.md`: 361 synchronous prepare calls, no async anywhere, 9 triggers, no driver (zero dependencies), no PostgreSQL server in the sandbox; and no always-on host is allowed by CLAUDE.md §5. The laptop + tunnel + SQLite WAL covers the current need. Revisit on a second paying station, an approved host, or real concurrent branches.

### ADR-22 External libraries and dev tools are allowed (2026-11-23, owner's instruction)
The owner interrupted the hand-written PostgreSQL client and asked for the standard libraries and tools. Installed with a committed `package-lock.json`: runtime `pg` 8 (PostgreSQL driver for Phase 2); dev `eslint` + `@eslint/js` + `globals` (lint, errors fail CI), `sql.js` 1.10.3 exact (the Claude page's SQLite engine, used by tests and the Artifact build), `playwright` (browser checks). Rule kept: the SQLite mode runs with no installed package (`pg` is loaded lazily only when a PostgreSQL URL is set), so the laptop does not have to run `npm install` after `git pull` until it switches to PostgreSQL. CI runs `npm ci`, `npm run lint`, `npm test` and the Artifact job. `npm audit`: 0 vulnerabilities at install time. Supersedes the zero-dependency statement of earlier docs.

### ADR-23 Speed comes from measurement, never from cached balances (0.26.0, 2026-11-24)
Every optimisation in 0.26.0 was measured first (`scripts/bench-api.js`, `scripts/bench-pages.js`, Chrome CPU profiles) and proved harmless with `scripts/compare-dump.js` (every API answer byte-identical before/after, on the real-data snapshot copy and on a 100k-journal demo). Chosen: HTTP compression + ETag, covering indexes (schema v16), grouped queries instead of one per party (N+1), shorter SQL plans, fewer DOM rows and layouts. **Rejected: caching balances, reports or summary tables** — a cached figure can be shown as final while the books have moved (owner's rule); balances stay Σ journal_lines / Σ stock_moves in the same request. The bell's alert badge (a reminder, not a figure) is re-checked at most every 2 minutes; opening the bell always re-reads the books. If a later size needs more (see `docs/PERFORMANCE.md` §Next), the next step is a trigger-maintained daily total table written in the same transaction as the journal, never a time-based cache.

### ADR-24 Front end stays vanilla JS without a build step; React/TypeScript not adopted now (0.26.0, 2026-11-24)
Assessed React + TypeScript + Vite + Tailwind/shadcn + TanStack (owner's candidate list). Measured: the slow screens were slow because of 533 KB uncompressed downloads, 36k `Intl` formatter constructions, up to 300 forced layouts per screen and 2,000-row tables — none of which a framework fixes, and all of which were fixed in place (phone, median of 3 on the snapshot copy: journal book 9.5 s → 2.7 s, accounts 4.8 s → 1.2 s, first open 4.0 s → 2.2 s, reload 3.7 s → 1.1 s). A rewrite would touch ~9,000 lines of UI, every printed document (owner's printouts are the acceptance test, KI-07), the Artifact edition (serves `public/` unchanged, no bundler) and the "runs with nothing installed" rule — high risk to a system in daily use for no measured gain. Kept: plain JS + `FPFMT` cached formatters + "show more / show all" for long lists (printing/PDF/Excel keep every row). TypeScript is adopted as **type checking only** (`npm run typecheck`, `// @ts-check` per file, CI) so files can be typed one by one without a build. Revisit if a second front end (mobile app) or a team of developers appears.

### ADR-25 SQLite stays the production engine; PostgreSQL remains Phase 2 (0.26.0, 2026-11-24)
Compared for the actual operation (one laptop, offline-first, Windows, Artifact edition on sql.js, no always-on host allowed): SQLite (WAL, covering indexes) answers every simple read under 15 ms and the heaviest year reports under 70 ms on one year of real data; at 100k journals (≈ 7 years of the station) simple reads stay under 30 ms and only the analytics dashboard and the alert check exceed 250 ms; at 480k journals (demo, 20 years) lists stay under 65 ms while year-wide reports take 0.3–1.4 s (next step: trigger-maintained totals, PERFORMANCE §9). PostgreSQL would add a server to install, run and back up on the laptop and a round trip per query through the Phase 2 bridge (`src/pg/`), and cannot run inside the Artifact page. D1 is excluded (external host). Decision: keep SQLite; PostgreSQL stays the Phase 2 path of ADR-21 (bridge built, stages B–E open) for the day several stations write to one central server. No migration of the live data was attempted (CLAUDE.md §5).

### ADR-26 FuelPro on the owner's own VPS (0.27.0, 2026-11-24, owner's instruction)
The owner asked to run FuelPro on a real VPS. This is the owner's own server (no platform-as-a-service; Render/Railway/ChatGPT/Codex stay excluded, ADR-20). Chosen: plain Ubuntu/Debian + systemd + Caddy (automatic Let's Encrypt HTTPS), Node 22 from nodejs.org (checksum verified), app on 127.0.0.1 behind Caddy, code read-only from GitHub with a read-only deploy key, data in `/var/lib/fuelpro`, secrets in `/etc/fuelpro/fuelpro.env`. Kit: `deploy/vps/` (install, update with tests + automatic rollback, restore with a books check before replacing anything, laptop send/pull scripts), guide `docs/VPS.md`. Rejected: Docker on the VPS (one more layer for one Node process and one SQLite file; the Dockerfile stays for others), PM2 (systemd already restarts and logs), nginx + certbot (two tools where Caddy does both). Public-server hardening added to the app: `REGISTRATION=open|first|closed` (default open keeps the laptop's first run; the VPS uses `first`), and Caddy drops a client-supplied `CF-Connecting-IP` (the app trusts it first under `TRUST_PROXY=1`). Data rule unchanged: moving the real data from the laptop to the VPS is the owner's own step each time (`laptop-send-data.ps1` → `fuelpro-restore`), and afterwards only one system takes entries (no sync).

### ADR-27 Employees & payroll as a station module with party lines (0.28.0, 2026-11-24)
The owner asked for the missing screens; employees/payroll was the only module marked ⛔. Chosen: employees per station; balances only from journal lines with `party_type='employee'` on two system accounts (1160 advances, 2200 salaries payable), the same pattern as customers (1100) and suppliers (2010), so the integrity rules stay simple and no balance is stored. One payroll journal per station and month; cash moves enter the shift. Rejected: one ledger account per employee (the imported M7 practice under group 125) — it grows the chart for every hire and cannot be checked as one total. KI-20: the owner chose to carry the real station's accounts under 125 over (one journal per station, owner/admin, preview + backup + undo; ACCOUNTING-RULES §15).

### ADR-29 Keep the original look; improve it in place (0.30.0, 2026-11-27, owner)
Two redesigns were shown (a calm «emerald» mock-up, then «ليل الياقوت»: sapphire + gold, new fonts, PR #20). The owner declined both: keep the first screens' layout, colours and fonts, and only improve them. So UI work is incremental: small, screen-only rules appended to `app.css` (inside `@media screen`, printing untouched) and small helpers in `app.js`; no new palette, no new fonts, no new stylesheet. Mock-ups for bigger screen changes are shown before code.

### ADR-28 Off-site backup = Google Drive through rclone, plus a one-tap download (0.29.0, 2026-11-26, owner's choice)
Backups on the VPS lived on the same disk as the database (KI-10). Owner chose «Google Drive، ومحلياً تنزيل نسخة إلى الجهاز». Chosen: a root-run `fuelpro-offsite` (systemd timer, 02:40 UTC) that takes its OWN fresh `VACUUM INTO` copy (independent of the app's 30+30 retention), checks it, gzips, uploads with rclone (`drive.file` scope: only files the program created are visible; token from the owner's own `rclone authorize`, stored 0600 in `/etc/fuelpro/rclone.conf`), verifies the size on Drive and keeps 45 days + every 1st-of-month copy. The result goes to `offsite-status.json`; the app only READS it (backup screen + alert) so the web process never holds the Google token. Rejected: a Google service-account/OAuth flow inside the Node app (a secret in the web process, needs a Google Cloud project); `laptop-pull-backups.ps1` as the only off-site copy (depends on the laptop being on). Not encrypted on Drive: it is the owner's private account; add `rclone crypt` later if the Drive is ever shared. Restore: download the `.db.gz`, `gunzip`, `sudo fuelpro-restore <file>`.

### ADR-30 FuelPro v2: one product, three independent run modes, one TypeScript core (2026-11-27, proposed, phase 0)
Owner asked for server / desktop-offline / phone-offline editions with no sync, sharing as much code as possible, and lifted the earlier tech limits (ADR-24/25). Options: (a) Go or Rust server + separate JS logic in the offline apps; (b) Rust core compiled to WASM for every mode; (c) one TypeScript core with async storage ports. Measured (`bench/arch-v2/backend`): Rust/Go are 1.5–4× faster on reads and use 3–10× less memory, but every stack meets p95 < 60 ms on common reads/writes at 100 connections, and the heavy report is equally slow in all (125–340 ms per request). (a) duplicates the accounting core, so «same numbers to the mil» could only be tested, never guaranteed; (b) rewrites 4,300 tested lines plus the UI bridge. Chosen (c): the accounting core is the same code in all three modes by construction. Details: `docs/ARCHITECTURE-V2.md`.

### ADR-31 Server database PostgreSQL 16; local database SQLite (2026-11-27, proposed)
Measured on one box: SQLite was as fast or faster than PostgreSQL (list ≈ equal, writes 1.3–1.8× faster, heavy report 2.5× faster). PostgreSQL is chosen for the multi-user server for operations, not speed: many concurrent writers, network access, continuous archiving (point-in-time restore), row-level security as a second tenant wall, replicas. SQLite stays for desktop and phone (and for tests / a single-station server).

### ADR-32 Data access: Kysely + async ports + one migration set, tested on both engines (2026-11-27, proposed)
The core calls an async port (`query`, `exec`, `transaction(fn)`) with an explicit transaction handle (the current core is synchronous, 361 calls; PostgreSQL and the Capacitor SQLite plugin are asynchronous). Kysely gives one type-checked query builder for PostgreSQL and SQLite and a migrator; dialect-specific DDL (triggers, identity columns) lives in per-dialect migration files. CI runs every test on both engines plus a parity scenario whose answers must match byte for byte.

### ADR-33 Heavy reports run off the request thread (2026-11-27, proposed)
Measured: one slow report blocks a Node process; under 100 users common operations reach p95 250–290 ms behind the ledger (3.1 s). Reports run in worker threads on read connections with a time limit and cancellation; covering indexes as needed. ADR-23 (no stored balances/totals) is kept; a stored daily-totals table would need the owner's explicit decision.

### ADR-34 Front end stays framework-free, gains TypeScript + a build step + virtualized tables (2026-11-27, proposed; amends ADR-24)
Measured (`bench/arch-v2/frontend`, throttled phone): no framework beat vanilla for the user; frameworks cost +0–66 KB gzip and 4–6× JS memory; React heaviest and worst scrolling. Big tables are slow in every framework (3.2–3.8 s for 5,000 rows) and fast only when virtualized (10,000 rows < 1.1 s). Chosen: keep vanilla, add TypeScript + esbuild (code splitting per screen, to bring the cold first screen from 2.4 s under 2 s), virtualize long lists, keep the separate print path (`print-kit.js`).

### ADR-35 Desktop shell Tauri 2; phone shell Capacitor with native SQLite (2026-11-27, proposed)
Desktop: Tauri uses the system web view (installer in MB, signed updater) — Electron would run today's Node server unchanged but ships 80–250 MB (published comparisons, not yet measured here). Phone: Capacitor keeps the same UI and core; native SQLite instead of browser storage (can be evicted). React Native rejected (UI rewrite). Phase 1 measures installer size, memory and start time of both on real builds.

### ADR-36 Server operations: Docker Compose + Caddy, one-command install, backups with point-in-time restore (2026-11-27, proposed)
App + PostgreSQL + Caddy (automatic HTTPS) in Compose, installed by one script building on `deploy/vps`; daily `pg_dump` + WAL archiving + the existing off-site copy; health and metrics endpoints; rolling update with expand/contract migrations, backup before every update and automatic rollback. Target: full restore under 10 minutes (to be measured).

### ADR-37 Security per mode (2026-11-27, proposed)
Server: passkeys (WebAuthn) + the existing TOTP, tenant checks in the core plus PostgreSQL RLS, audit log unchanged. Local: optional database encryption with a password (SQLCipher), local users with passwords, same permission table in the core.

### ADR-38 Migration path: strangler, module by module, the current system stays live (2026-11-27, proposed)
v2 is built beside v1; each module (sales & shifts → stock → parties → finance → reports & printing → payroll & admin) passes the acceptance criteria before the next. A migration tool moves a v1 SQLite file into v2 and stops on any difference in ledger totals, every account/box/tank balance, journal and sale counts or the trial balance. Real data moves only at the end and only with the owner's explicit OK each time.

### ADR-39 v2 phase 1: how the core is built and run (2026-11-27, accepted — owner approved ADR-30..38 by merging PR #25)
- **Place:** `v2/` beside v1 with its own npm workspaces, lock file and CI (`.github/workflows/v2.yml`); v1's code, tests and CI are untouched (strangler, ADR-38).
- **TypeScript without a server build:** Node ≥ 22.18 runs `.ts` by type stripping (`erasableSyntaxOnly`); `tsc` only checks. The browser editions are bundled with esbuild (`tools/build.ts`).
- **Same schema names as v1** in the v2 migrations, so parity tests and the migration tool compare rows one-to-one. Timestamps come from the core's clock (text, UTC) instead of `datetime('now')`, so both engines write the same thing.
- **Local SQLite through our own small bridge, not `tauri-plugin-sql`:** the plugin uses a connection pool, which can run BEGIN and COMMIT on different connections; our Rust command (rusqlite, one connection, a mutex) and the Kysely `BridgeDialect` (one statement at a time, `BEGIN IMMEDIATE`) keep "one operation = one transaction" on the desktop. The phone uses the same dialect over `@capacitor-community/sqlite`.
- **PostgreSQL concurrency:** pump, tank, shift and customer rows are locked (`FOR UPDATE`) for the write; duplicates of the same `client_id` are stopped by a unique index and answered as "already recorded".
- **Reversal line order** follows v1's covering index (account, debit, credit) so a void writes identical journal lines on every engine.
- **Migration tool** copies and proves inside ONE target transaction; any difference rolls back (exit 2). Measured on a demo year: SQLite 3 s, PostgreSQL 13 s.

### ADR-40 v2 phase 2: check before the first write; split the UI by screen; compress (2026-11-27, accepted)
- **Every command runs all its checks before its first write**, raising errors in v1's order. Reason: PostgreSQL identities are never reused after a rollback (SQLite reuses rowids), so a command that writes and then fails leaves a gap in document and journal numbers. The parity test on PostgreSQL found it (a delivery void that reversed its journal and then hit «already sold»). Helpers: `ledger.countReversible` (how many journals a void would reverse) and `ledger.planMove` (the arithmetic of a stock move without writing). Gaps from two *concurrent* failing commands remain possible on PostgreSQL and are acceptable (numbers are references, not a sequence the law requires here).
- **Screens load on demand** (esbuild code splitting + `modulepreload` for what the first screen needs): the stock screen is fetched when its tab opens. First screen 1.48 s on a mid phone.
- **The v2 server compresses** JS, CSS, HTML (once, kept in memory) and JSON answers above 1 KB (gzip, per request).
- **Covering indexes for the tank reconciliation**: `stock_moves(tank_id, business_date, kind, qty_ml, value)` and `sales(tank_id, business_date, voided_at, quantity_ml)` — 20.7 → 3.8 ms per request on a demo year; the same totals (parity tests).

