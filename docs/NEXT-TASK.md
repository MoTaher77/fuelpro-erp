# NEXT-TASK — where to resume
Updated 2026-11-23 (after 0.7.0).

## Task A (first) — act on the owner's print feedback
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
`CLAUDE.md` → this file → `docs/KNOWN-ISSUES.md` → `npm test` (expect 60 pass) → check whether `Downloads\fuelpro.zip` is newer than the folder files.
