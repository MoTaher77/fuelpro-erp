# NEXT-TASK — where to resume

## 2026-11-26 — own domain live
- **https://fuelpro-ye.com** (GoDaddy DNS: A @ → 212.90.120.15, TTL 600; forwarding removed). Verified from outside: HTTPS 200, HTTP/2, no Alt-Svc, registration closed. Server code at 0.28.1 (PR #17); this PR (0.28.2) only fixes `domain.sh`.
- Owner to do: tell staff the new address (no `www`; each user signs in once again, phones «Add to home screen» again); create the trial org (`new-org.js`); try «نقل حسابات الموظفين القديمة»; change the root password; SSH keys instead of password.

## 2026-11-24 — 0.28.0 employees & payroll (branch, PR pending)
- Built and tested (87 unit + 6 e2e). On the server after merge: `sudo fuelpro-update` (migration v17 adds tables only).
- **Owner chose (a) carry-over (KI-20).** After merge + `sudo fuelpro-update` on the server: الموظفون والرواتب ← «نقل حسابات الموظفين القديمة» ← check the preview (27 accounts, 1,667,517.995 / 26,891) ← تنفيذ. Then enter salaries on each employee card, and stop using vouchers on the old 125xx accounts (they are closed).
- New system accounts 1160/2200 sit at the root of the imported tree; the owner may move them under groups 12/22 from the chart screen.

## State 2026-11-24 — FuelPro LIVE on the owner's VPS
- https://212-90-120-15.sslip.io (Contabo, Ubuntu; installed by the owner with `deploy/vps/install.sh`; HTTPS 200; schema v16).
- Data: محطة التميز from `dev-data/fuelpro-snapshot.db` (to 2026-11-23 ~08:00 Yemen time; 13,857 journals, 11,881 sales; books check all OK), loaded with `fuelpro-restore` at the owner's explicit request. The owner account got a new password generated on the server.
- **Open with the owner:** (1) change the owner password and the root password (both appeared in chat); (2) decide the ONE live system (VPS or laptop) — no sync; (3) if the laptop has entries after 2026-11-23 08:00, send them with `deploy\vps\laptop-send-data.ps1` (replaces the server DB after the books check); (4) a real domain instead of sslip.io (`install.sh --domain`); (5) SSH key login, `PasswordAuthentication no`; (6) daily `laptop-pull-backups.ps1` for an off-server copy; (7) merge PR #14 (0.27.1 kit fixes), then `sudo fuelpro-update` on the server.

## Handoff 2026-11-24 (0.27.0) — VPS kit ready, waiting for the owner's server
- Code: `deploy/vps/` + `docs/VPS.md` (Arabic). 83 tests green. Tried in a container with stubs (install, restore, update incl. rollback); not yet on a real server (KI-19).
- **Owner:** get an Ubuntu 22.04/24.04 or Debian 12 VPS (1–2 GB RAM) and, if possible, a domain (A record → server IP). Then follow `docs/VPS.md` §1. Decide: fresh server (§2أ) or move محطة التميز's data (§2ب: your own step; afterwards enter data on the server only).
- After the first install, tell the next session the address so it can run `scripts/smoke-online.js` against it.

## Handoff 2026-11-24 (0.26.0 on branch `claude/wonderful-pascal-jfuqxu`, PR open) — speed and quality
- State: 81 unit tests + 5 browser tests green, lint 0 errors, typecheck 0 errors, audit 0 vulnerabilities, sql.js suite green. Schema v16, sw `fuelpro-shell-v44`.
- **Owner after merge (laptop):** `git pull` → `npm run backup` → restart FuelPro (migration v16 adds indexes only, a few seconds on the real file; no data change). Then open the journal book, an account statement of the cash box and the analytics screen once on the phone and say if they feel faster.
- Owner to check by eye (cloud cannot): the long lists now show «عرض المزيد / عرض الكل»; printing the journal book or a statement still prints every row (code path unchanged, `classicStatement` / `tbl(true)`).
- Next speed steps (measured, `docs/PERFORMANCE.md` §9): trigger-maintained daily account totals for 7+ years of data (KI-17); heavy reports off the main thread; server-side idempotency key for vouchers/payments/expenses (KI-16 rest); smaller first part of the journal book on phones (2.7 s).
- Earlier open choices still stand (below): more report PDFs, Phase 2 stage B, customer phones, KI-06.

## Handoff 2026-11-23 (after 0.24.0, PR #10 merged) — continue on the owner's laptop
- State: `main` = 0.24.0, 77 tests green, CI green. Demo Artifact page **deleted** (owner's request); only the private station page remains: https://claude.ai/artifact/Dbe4L4cWnvRSbeswvYAENF (build: `node web/build.js --seed-db <snapshot> --out web/dist-station`).
- Laptop: `git pull`, then `npm run backup`, restart FuelPro (sw `fuelpro-shell-v39`).
- 0.25.0: boxes report «واتساب PDF» done. Owner's open choices: (a) more report PDFs (per-box days, stock) via `F.reportPdf` in `public/books-ui.js`; (b) Phase 2 stage B: port the 9 triggers + migration v3 to PostgreSQL, add `FUELPRO_DB=postgres` (`docs/PHASE2-POSTGRES.md`).
- Waiting on owner: customer phones, KI-06, backup-copy folder, WhatsApp Business API decision.

## Next candidates (owner chose the setup wizard first; 0.20.0 done)
1. Off-site automatic backups (KI-10) — needs the owner's choice of destination.
2. Customer phone numbers: 0 of 148 in the real data (add from #col reminders queue).
3. KI-06 negative boxes: owner to confirm the right opening balances.

## Task AF — owner refreshes the station page from his laptop (0.17)
`npm run backup` on the laptop → station page → chip → «تحديث البيانات من نسخة اللابتوب…». Then decide: keep entering data on the laptop only (recommended; the page is for viewing and WhatsApp), or plan a real two-way sync (needs a server both can reach).


## Task 0 (first) — carry the M7 history into the live DB (needs the owner's OK)
0.8.0 adds the code; the live `data\fuelpro.db` does not have it yet. With the owner's OK: stop FuelPro, `npm run backup`,
`node scripts/import-m7-history.js --dmp <M7-SAT.DMP> --db data/fuelpro.db --dry-run`, then without `--dry-run`, start FuelPro.
Tried on a VACUUM copy 2026-11-23: users 6 · edit copies 2,078 (2,057 linked) · approvals 1,263 (990 linked) · runs 54 · log 2,312 · results 8,847 · stock months 27 · rates 19; second run adds 0; books unchanged.
Done in 0.9.0: analytics dashboard, real .xlsx export, bank reconciliation, sale discounts. The owner must restart FuelPro (after `npm run backup`) to get migrations v13/v14 and the new screens.

## Task A — act on the owner's print feedback
**Progress 2026-11-23 (0.11.1):** customer statement print tightened in the cloud (rows no longer wrap). Sales register alignment fixed too (checked on the real-data snapshot copy). Daily report short tables now stay on one page (v30). Still open: owner's real printout on Windows (Dubai font).
**Objective:** the owner prints a customer statement, the daily report and the sales register and sends photos.
Fix whatever looks wrong; if he reports nothing, close this item.
- Files: `public/app.js` (`printNode`, `fitTable`), `public/books-ui.js` (`F.printDoc`, statements, sales register), `public/more-ui.js` (`VIEWS.day`), `public/app.css` (print block at the end, `@page land`).
- Steps: reproduce with the demo DB (`start-fuelpro-demo.bat`, or `seed-demo.js` in a temp DB) → fix CSS/markup → bump `CACHE` in `public/sw.js` → `npm test`.
- Acceptance: A4 portrait for narrow docs, landscape for wide tables, no clipped column, header/letterhead on each page, amounts aligned, Dubai font used.
- Risks: Dubai exists only on Windows; Playwright in the cloud renders a fallback font, so the owner's print preview is the real test.
- Delivery: build `fuelpro.zip` with `src public scripts test` + top-level files → `C:\Users\Moham\Downloads\fuelpro.zip`; **never ship `data\`**.

## Task B — housekeeping (small, safe)
1. ~~Set `package.json` version to 0.6.1 (KI-03)~~ — done 2026-11-23.
2. (KI-04 accepted — `reconcile-m7.js` stays out of the zip.)
3. ~~`git init` (KI-01)~~ — done 2026-11-23 with the owner's OK (branch `main`). No remote yet.
4. ~~Point `README.md` to `docs/`~~ — done 2026-11-23.

## Task C — next feature (owner to choose)
Done 2026-11-23: **cash-flow statement** (0.7.0, ADR-13). Ask the owner to open it on the real data (Financial statements → Cash flow) and say whether the investing/financing split looks right for his accounts.
Remaining candidates: bank reconciliation, sale discounts, native Excel export, cloud deployment. For any accounting feature follow `.claude/skills/fuelpro-accounting/SKILL.md` and add tests first.

## Resume checklist
`CLAUDE.md` → this file → `docs/KNOWN-ISSUES.md` → `npm test` (expect 70 pass) → check whether `Downloads\fuelpro.zip` is newer than the folder files.

## Phase 2 — PostgreSQL (owner chose two phases, 2026-11-23)
Introduce a data-access layer that runs the existing SQL on PostgreSQL (async), keep node:sqlite for tests/offline, port migrations, run all tests on both, then copy the live data after a full reconciliation. Optional: a fixed address via a named tunnel (needs a Cloudflare account and a domain).
