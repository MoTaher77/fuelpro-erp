# CLAUDE.md — FuelPro (entry point for every Claude session)

Reply to the owner (Mohammed, Yemen, UTC+3) in **Arabic**. Keep code identifiers, paths and commands as they are.

## 1. What this is
FuelPro: a multi-tenant fuel-station ERP (sales by pump meter, tanks and stock, shifts and cash boxes,
customers/suppliers, double-entry accounting, reports, printing). Intended to be sold commercially.
In real use at **محطة التميز** with one year of data imported from the old Oracle "M7" system.

## 2. Where the code lives (read first)
- **Canonical code: GitHub `MoTaher77/fuelpro-erp` (private), branch `main`.** The owner develops from his phone via claude.ai/code: work on a branch, run `npm test`, open a PR; CI (`.github/workflows/test.yml`) must be green before merge.
- **Cloud sessions work on a snapshot of the real data** (owner's request, ADR-18): `dev-data/fuelpro-snapshot.db`, made on the laptop by `node scripts/dev-snapshot.js` with every password hash, session, reset token, recovery code and 2FA secret removed. To try the app: `node scripts/dev-admin.js` (copies it to a temp file and prints a throwaway admin), then `DB_PATH=<that file> npm start`. Never write to the snapshot itself, never commit `data/`. The snapshot is a copy, not the live data: changes made in the cloud never reach the station.
- The laptop copy `C:\Users\Moham\FuelPro` holds the real data (`data\`, never in Git); after a merge it updates with `git pull`.
- Real data: `data\fuelpro.db` (+ `-wal`, `-shm`). Demo data: `data\demo.db`. Backups: `data\fuelpro-backup-*.db`, `data\backups\`.
- Local Git repo (branch `main`, no remote). `.gitignore` keeps `data/` and secrets out — never force-add them.
- ⚠ `start-fuelpro.ps1` re-installs `src public scripts test` + top-level files from `Downloads\fuelpro.zip`
  **on every start**. If you edit files in place, rebuild or remove that zip, or your edits are reverted (KI-02).

## 3. Stack (verified)
Node.js ≥ 22.5, built-in `node:sqlite` (WAL). **Libraries are allowed (owner, 2026-11-23, ADR-22)** but the SQLite mode must keep running with nothing installed: the runtime dependency `pg` (PostgreSQL, Phase 2) is `require`d lazily, only when a PostgreSQL URL is configured. Dev tools (`npm ci`): `eslint`, `sql.js` (pinned 1.10.3 = the page engine), `playwright`, `typescript` (type check only, no build). Plain HTTP server `src/server.js`
(133 routes). Front end: vanilla JS SPA in `public/` (no framework, no build step), PWA service worker.
Schema migrations in `src/db.js` (`PRAGMA user_version`, currently 18 = payroll tables + employees.legacy_account_id; `openDb` also runs `PRAGMA optimize`).
Front end stays vanilla JS, no framework/build (ADR-24); SQLite stays the engine, PostgreSQL = Phase 2 (ADR-25). Speed work: `docs/PERFORMANCE.md`.

## 4. Non-negotiable invariants
1. Money = integers in minor units (`stations.cur_dec`; YER uses 3 stored / `disp_dec` 2 shown). Quantities in ml, prices `*_e4`, rates `*_e6`. Never floats — use `src/money.js`.
2. One business operation = one transaction (`tx()` in `src/db.js`, nested = SAVEPOINT): document + stock move + journal + audit together.
3. Balances are derived: tank = Σ`stock_moves`; account = Σ`journal_lines`. Never edit a balance directly.
4. No deletes of posted data. Void = written reason + reversing journal + reversing stock move. DB triggers enforce this.
5. Perpetual stock, weighted-average cost (`L.stockMove` in `src/ledger.js`).
6. Isolation: every query scoped by org, then by station via `user_stations` (owner/admin = org-wide). Foreign id → 404.
7. Permissions checked on the server (`need(user, perm)`, table `PERMS` in `src/auth.js`). UI hiding is cosmetic.
8. Year close = one `source='year_close'` journal per station dated 31 Dec into `3900`; reopen = `reverseSource`.

## 5. Safety rules for any session
- **Never replace, reset, migrate-by-hand or write to `data\fuelpro.db`.** The owner does real daily work in it. Check the `audit` table before any data operation; deliver **code only**.
- Before any risky change: copy the DB with `npm run backup` (VACUUM INTO) — never copy a live WAL file by hand.
- Never print/store passwords. `بيانات-الدخول.txt` and `.env` hold secrets: do not read or copy them.
- Customer/supplier names and balances are private: never publish, upload, or paste them into docs.
- **Demo Artifact page deleted 2026-11-23 (owner); only the station page below remains.**
- **Own VPS allowed (owner, 2026-11-24, ADR-26):** `deploy/vps/` + `docs/VPS.md` (Ubuntu/Debian, systemd, Caddy HTTPS, `REGISTRATION=first`). The agent has no SSH access: it ships code and scripts; the owner runs them. Real data reaches the VPS only through the owner's own `laptop-send-data.ps1` → `sudo fuelpro-restore` (books checked first, old DB kept); afterwards data is entered on one system only.
- **Online demo = Claude Artifact only (owner, 2026-11-23, ADR-20):** the Artifact edition (`web/`, `docs/ARTIFACT-EDITION.md`) runs the unchanged `src/` in a claude.ai page on **demo data only**, saved in the Artifact's own storage. Do **not** use Render, Railway, ChatGPT Sites or Codex (owner's instruction; supersedes the Render plan in ADR-19). Real station data is allowed **only** in the owner's separate private page «FuelPro المحطة» (https://claude.ai/artifact/Dbe4L4cWnvRSbeswvYAENF, owner's explicit OK 2026-11-23), built from the password-free snapshot with `web/build.js --seed-db` and a throwaway admin from `scripts/dev-admin.js`, and refreshed by the owner himself from a laptop backup (chip menu → «تحديث البيانات من نسخة اللابتوب», 0.17; the file then carries the users' password hashes, which stay in the owner's private page storage); never in the demo page, never shared or made public, never re-seeded over saved data without the owner. It is a copy: it does not sync with the laptop. **Moving real data anywhere off the laptop needs the owner's separate OK each time** (backup first, then `--dry-run`). Never commit or print passwords, keys, `APP_SECRET`, SMTP credentials or real customer/financial data; verify a deployment with `node scripts/smoke-online.js <url> <email> <password>`.
- Any front-end change: bump `CACHE` in `public/sw.js` (now `fuelpro-shell-v52`) or users keep the old UI.
- **Never cache balances or report totals** (ADR-23). A query rewrite must be proved with `scripts/compare-dump.js` (all responses identical).

## 6. Commands (verified 2026-11-24)
```
npm ci                   # installs pg + dev tools (lock file committed); not needed just to run the SQLite app
npm run lint             # eslint (errors fail CI)
npm test                 # node:test, 94 pass + 1 skipped (PostgreSQL), ~6 s, in-memory DBs — must stay green
npm run test:e2e         # Playwright on a seeded demo DB, 8 tests, ~40 s
npm run typecheck        # tsc on files marked // @ts-check
npm start                # PORT=3000, DB_PATH=./data/fuelpro.db by default
DB_PATH=/tmp/demo.db DEMO_PASSWORD=... node scripts/seed-demo.js --days 365   # throwaway demo DB
npm run backup           # consistent copy into data/backups/ (server also makes 1 auto copy/day, keeps 30)
node scripts/schema-doc.js > docs/DATABASE-SCHEMA.generated.md   # refresh the table list
node scripts/bench-api.js --db <copy> --password <pw> [--dump f.json]   # API p50/p95 (+ answers for compare-dump.js)
node scripts/bench-pages.js --db <copy> --password <pw>                # screens in Chromium, desktop + phone profile
node scripts/stress-api.js --db <demo copy> --password <pw>            # 20 concurrent users, then checks the books (writes!)
node scripts/print-check.js [--docs receipt,stmt,jbook] [--out dir]           # printed documents on demo data → PDF + PNG + checks (docs/PRINT-CHECKLIST.md)
node scripts/check-books.js <db file>                                   # read-only: SQLite integrity + the books' self-check
node scripts/new-org.js --db <db> --email <e>                           # a new EMPTY organisation + owner (trial user); prints a random password once
sudo bash deploy/vps/install.sh --domain <d> | sudo fuelpro-update | sudo fuelpro-restore <file> | sudo fuelpro-offsite setup   # on the VPS (docs/VPS.md; offsite = daily Google Drive copy)
```
Windows: `start-fuelpro-online.bat` (project root, online via Cloudflare tunnel), `start-fuelpro.bat` / `start-fuelpro.ps1` in `Downloads` (real data), `start-fuelpro-demo.bat` (demo).

## 7. Conventions
- CommonJS, `'use strict'`, small pure helpers; SQL is always parameterised (`db.prepare(...).run(?)`).
- Errors: `src/errors.js` (`HttpError`); validation: `src/validate.js`.
- UI strings: dictionary `D` in `public/app.js` + `window.FP_I18N` in `public/i18n-erp.js`; each key = `[ar, en, fr]`.
- New screen = `F.VIEWS.<key>` + an entry in `NAV` (`public/app.js`) + i18n keys + icon.
- Tables get auto-fit column classes (`fitTables`); print through `printNode` / `F.printDoc`.
- Add a test in `test/*.test.js` for every accounting rule you touch; record a CHANGELOG entry.

## 7b. Artifact edition
Build: `DEMO_PASSWORD=<pw> node web/build.js` → `web/dist/` (git-ignored), then republish `web/dist/index.html` to the live page (`docs/ARTIFACT-EDITION.md`). Page-engine checks need `npm ci` (sql.js 1.10.3 is a pinned devDependency): `npm run test:artifact`; build with `npm run build:artifact`. `src/` stays engine-neutral: no new Node built-ins without a shim in `web/shims/`.

## 8. Documentation map → `docs/00-MASTER-INDEX.md`
Stable: ARCHITECTURE, PROJECT-STRUCTURE, DATABASE-SCHEMA, MODULES, API-REFERENCE, ACCOUNTING-RULES, SECURITY,
TESTING, DEPLOYMENT, DECISIONS. Moving: PROJECT-MEMORY, PROGRESS, NEXT-TASK, KNOWN-ISSUES, SESSION-HISTORY.
On-demand skills: `.claude/skills/fuelpro-*` (incl. `fuelpro-performance`). Review agents: `.claude/agents/fuelpro-ledger-guard`, `fuelpro-perf-profiler`.
Old-system (M7) history is carried into the normal tables by `scripts/import-m7-history.js` → `src/m7archive.js` (ADR-14). Hash routes are letters only (`#[a-z]+`).
Root files `ARCHITECTURE.md DATABASE_SCHEMA.md PROJECT_PROGRESS.md RESUME.md QA_REPORT.md` are **legacy (v0.4.0)**; `docs/` wins.

## 9. Start-of-task workflow (do not skip, do not over-read)
1. Read this file (auto-loaded), then `docs/PROJECT-MEMORY.md` and `docs/NEXT-TASK.md`.
2. Open only the docs/skill relevant to the task (index tells you which).
3. Check reality: file dates/hashes in `src public test`, `npm test`, and whether the Downloads zip is newer than the folder.
4. Never redo work marked VERIFIED in `docs/PROGRESS.md` unless the code disagrees — then record the discrepancy.

## 10. End-of-task workflow
1. `npm test` green; note the count.
2. Update `docs/PROGRESS.md` + `docs/NEXT-TASK.md`; add a decision to `docs/DECISIONS.md` if one was made.
3. Update the module/architecture doc you changed (paths, not code dumps). Add/close items in `docs/KNOWN-ISSUES.md`.
4. Append 3–6 lines to `docs/SESSION-HISTORY.md` (date, what changed, tests, where to resume).
5. Update `CHANGELOG.md` and `package.json` version together.

## 11. Evidence labels used in docs
VERIFIED (code or executed test) · REPORTED (said in a past session, not re-checked) · PLANNED · UNKNOWN.
