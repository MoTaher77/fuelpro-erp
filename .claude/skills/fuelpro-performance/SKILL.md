---
name: fuelpro-performance
description: Use before and after any FuelPro change meant to make it faster (slow screen, slow report, big table, SQL query, index, payload size, startup), and when checking that a change did not slow something down.
---
# FuelPro performance

## Read first
`docs/PERFORMANCE.md` (baseline numbers, what was done, what is left).

## Workflow (measure → change → prove → measure)
1. Working copy of the real-data snapshot: `node scripts/dev-admin.js --db <scratch>/bench.db` (prints a throwaway password). Large demo data: `DB_PATH=<scratch>/big.db DEMO_PASSWORD=<pw> node scripts/seed-demo.js --days 1500`.
2. Baseline: `node scripts/bench-api.js --db <copy> --password <pw> --runs 20 --json before.json --dump golden-before.json` and `node scripts/bench-pages.js --db <copy> --password <pw>` (phone profile = 4x CPU + slow network).
3. Find the cost before changing anything: `EXPLAIN QUERY PLAN`, a per-query timer around `db.prepare`, or a Chrome CPU profile (positionTicks give the hot line).
4. Change one thing. Schema changes = a new entry at the end of `MIGRATIONS` in `src/db.js` (indexes only; never edit an old migration).
5. Prove nothing visible changed: re-run with `--dump golden-after.json`, then `node scripts/compare-dump.js golden-before.json golden-after.json` must say **all responses identical**. Then `npm test`, `npm run test:e2e`, `npm run test:artifact` (sql.js engine).
6. Re-measure and write the numbers in `docs/PERFORMANCE.md`.

## Rules
- Balances stay derived from `journal_lines` / `stock_moves` in the same request: **no cache of balances or reports** (ADR-23).
- New indexes can change other plans: re-run the whole API bench, not only the endpoint you fixed (v16 slowed the cash flow until `+l.account_id`).
- One query per party/tank/row is the usual culprit (N+1): group in one query (`partyBalances`, `partyExtrasMany`).
- Long screen lists: show a first part + «show more / show all» with a `data-expand` button; printing, PDF and Excel must keep every row.
- Format numbers/dates with `FPFMT.nf / FPFMT.dt` (cached), never `new Intl.*` in a loop. Layout reads (`scrollWidth`, `offsetWidth`) after DOM writes force a layout: batch them.
- Front-end change → bump `CACHE` in `public/sw.js`.
