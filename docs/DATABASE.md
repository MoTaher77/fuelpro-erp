# DATABASE — engine choice, indexes, query rules
Short on purpose. Tables and columns: [DATABASE-SCHEMA](DATABASE-SCHEMA.md) · [generated list](DATABASE-SCHEMA.generated.md). Numbers: [PERFORMANCE](PERFORMANCE.md). Decision: ADR-25.

## Engine: SQLite now, PostgreSQL later (VERIFIED 2026-11-24)
| | SQLite (`node:sqlite`, WAL) — **chosen** | PostgreSQL 16 (Phase 2 bridge `src/pg/`) | Cloudflare D1 |
|---|---|---|---|
| Runs on the owner's laptop with nothing installed | yes | needs a server service + its own backups | no (remote) |
| Runs inside the Claude Artifact page | yes (sql.js, same SQL) | no | no |
| Measured, 1 year real data (61k lines) | simple reads < 15 ms, year reports 30–60 ms | not measured on the app (stages B–E open) | — |
| Measured, 100k journals / 366k lines (demo) | simple reads < 30 ms; trial balance 69 ms; analytics 260 ms | — | — |
| Many writers on many machines | one process writes (WAL readers in parallel); enough for a station | yes | yes |
| Allowed by the owner | yes | yes, when a server exists (ADR-21) | no (external host, CLAUDE.md §5) |
Revisit when several stations must write to one central server (then: ADR-21 stages B–E, all tests on both engines, reconciliation to the cent, owner's OK).

## Indexes (v16)
Every report sums `journal_lines` by account, by journal or by party. The v16 covering indexes hold the amounts, so a total is
an index walk with no table reads: `jl_journal_cover`, `jl_account_cover`, `jl_party_cover`, `journals_post_day`, plus
`sales_tank_day`. `ANALYZE` runs in the migration and `PRAGMA optimize` at every start keeps statistics fresh.
Cost: +4 MB on the 17 MB real file; three more index writes per journal line (negligible next to a sale's transaction).

## Query rules (learned in 0.26)
1. **No query per row** (N+1). Group: `S.partyBalances(db, type, sid)` (all customer/supplier balances at once), `B.partyExtrasMany`, one grouped query per kind in `ageing`.
2. **Aggregate before you join names**: `SELECT … FROM (SELECT account_id, SUM(…) … GROUP BY account_id) t JOIN accounts` (2× faster than grouping joined rows).
3. **One join per source table**, not a correlated sub-select per line and column (ledger: 5 look-ups per line → 4 `LEFT JOIN`s on primary keys).
4. **Check plans after adding an index**: the planner may switch to a worse plan elsewhere. `+column` disables an index for one term (`+l.account_id` in the cash flow).
5. **Page lists in their own order**: lists ordered by (date, id) page with `(date < d OR (date = d AND id < x))` (`S.beforeDate`), never `id < x` alone.
6. **No cached balances or report totals** (ADR-23). Prove a rewrite with `scripts/compare-dump.js` (identical answers).
