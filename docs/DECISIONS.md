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
