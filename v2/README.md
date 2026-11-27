# FuelPro v2 (phase 1: sales & shifts)

One TypeScript core, three run modes. See `docs/ARCHITECTURE-V2.md` (design, ADR-30..39) and `docs/V2-PHASE1.md` (what phase 1 delivers, measurements).

```
packages/core     the business rules (money, permissions, ledger, set-up, sales, shifts, stock & deliveries, customers & suppliers & collections, reports, operation table)
packages/db       Kysely migrations + drivers: node:sqlite, PostgreSQL (pg), async bridge (Tauri / Capacitor)
packages/ui       the shared screen (vanilla TypeScript, no framework)
packages/local    the in-process backend of the desktop and phone editions
apps/server       HTTP server edition (PostgreSQL or SQLite)
apps/desktop      Tauri 2 desktop edition (Rust + rusqlite bridge, one local file)
apps/mobile       Capacitor phone edition (@capacitor-community/sqlite)
tools/            build.ts (esbuild), migrate-v1.ts (copy + prove the books)
tests/            parity with v1, invariants, browser checks
bench/            before/after measurements
```

Commands (Node ≥ 22.18 runs `.ts` directly; `tsc` only checks types):
```
npm ci
npm run typecheck
npm test                                   # SQLite + bridge; add V2_PG_URL=postgres://… for PostgreSQL
node tools/build.ts                        # apps/*/dist
V2_DB=./v2-data/demo.db npm start          # server edition on 127.0.0.1:3100 (prints a one-time token link)
node tools/migrate-v1.ts --from <copy of v1 db> --to <v2.db | postgres://…>
node bench/compare.ts --v1 <demo-v1.db> --v2 <demo-v2.db> --pg postgres://…/<migrated db>
```
Demo data only. Never point any tool at `data/fuelpro.db`; moving real data needs the owner's OK each time.
