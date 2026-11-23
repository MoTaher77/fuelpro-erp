---
name: fuelpro-accounting
description: Use before changing anything in FuelPro that touches money, journals, accounts, stock value, VAT, customer/supplier balances, shifts and cash, periods or year close, or the database schema.
---
# FuelPro accounting and data changes

## Read first
`docs/ACCOUNTING-RULES.md` (rules) and, if tables change, `docs/DATABASE-SCHEMA.md`. Code: `src/ledger.js`, `src/money.js`, `src/db.js`, then the module (`services.js`, `ops.js`, `books.js`, `reports.js`).

## Workflow
1. Name the invariant you touch (ACCOUNTING-RULES section). If you must change one, write an ADR in `docs/DECISIONS.md` first and tell the owner.
2. Write the test first in the matching `test/*.test.js` (copy a pattern from `test/erp.test.js`): balanced journal, exact reversal on void, stock value = 1200, customers = 1100, suppliers = 2010, `GET /api/accounting/integrity` green.
3. Implement inside `tx(db, ...)`; post with `L.post` / reverse with `L.reverseSource`; move stock only with `L.stockMove`; compute money only with `src/money.js` (integers, no floats).
4. Schema change = a **new** entry at the end of `MIGRATIONS` in `src/db.js` (never edit old ones), additive only; then `node scripts/schema-doc.js > docs/DATABASE-SCHEMA.generated.md`.
5. `npm test` must stay green (59+).

## Never
- Edit or delete posted journals/stock moves, or bypass triggers.
- Run anything that writes to the owner's real `data\fuelpro.db` (data fixes are done by the owner through vouchers/journals in the UI, or by a reviewed script on a **backup copy** first).
- Mix currencies in one total.
