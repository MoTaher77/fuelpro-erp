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
