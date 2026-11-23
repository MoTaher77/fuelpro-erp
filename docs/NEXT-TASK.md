# NEXT-TASK — where to resume

## Next candidates (owner chose the setup wizard first; 0.20.0 done)
1. Off-site automatic backups (KI-10) — needs the owner's choice of destination.
2. Customer phone numbers: 0 of 148 in the real data (add from #col reminders queue).
3. KI-06 negative boxes: owner to confirm the right opening balances.

## Task AF — owner refreshes the station page from his laptop (0.17)
`npm run backup` on the laptop → station page → chip → «تحديث البيانات من نسخة اللابتوب…». Then decide: keep entering data on the laptop only (recommended; the page is for viewing and WhatsApp), or plan a real two-way sync (needs a server both can reach).

## Task AE — confirm the Artifact edition on the owner's devices (0.12.0)
Owner opens https://claude.ai/artifact/CgLf1pmqcani77JBGVL56N on phone and laptop, signs in (demo@fuelpro.demo, password given in chat), posts a sale/expense, reopens. Then a session checks `fpstate/main` with ArtifactData. Rebuild/republish steps: `docs/ARTIFACT-EDITION.md`.
Updated 2026-11-23 (after 0.8.0).

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
