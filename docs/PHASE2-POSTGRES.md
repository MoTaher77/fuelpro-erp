# Phase 2 — PostgreSQL: assessment (2026-11-23, VERIFIED by measurement)

## What the code looks like today
- `src/*.js` is 3,787 lines. **361** `db.prepare(...)` and 17 `db.exec(...)` calls, all **synchronous** (`node:sqlite`): `services.js` 104, `ops.js` 73, `books.js` 66, `bankrec.js` 27, `ledger.js` 24, `m7archive.js` 21, `reports.js` 19.
- Not a single `await` inside `services.js`, `ops.js` or `books.js`: every business function is a plain synchronous function and `tx()` (`src/db.js`) relies on that (`BEGIN IMMEDIATE` + a shared `db.__inTx` flag; nested calls become SAVEPOINTs).
- SQLite-specific SQL to rewrite: `datetime('now')` ×32, `lastInsertRowid` ×27, `PRAGMA` ×10, `INSERT OR …` ×5, `substr(` ×4, `GROUP_CONCAT` ×3, `VACUUM INTO` ×2, `strftime` ×1, **9 `CREATE TRIGGER`** (the "no deletes of posted data" rule, invariant 4) and the migration runner.
- No driver: the project has **zero npm dependencies**. PostgreSQL needs either the `pg` package or our own wire-protocol client (startup, SCRAM-SHA-256, extended query protocol, TLS) — several hundred lines to write and test.
- This sandbox has `psql` (client) only, no PostgreSQL server, so nothing here could be run against PostgreSQL today.

## What a real move requires
1. Make every service function `async` and thread a **per-request connection/transaction** through it (a shared global connection would interleave two users' transactions). That touches essentially every function: ~360 call sites plus every route handler and every test.
2. Rewrite the dialect differences above, port the 9 triggers to PL/pgSQL, port 15 migrations.
3. A driver (new dependency or our own).
4. Run all 76 tests on both engines, then reconcile the real books to the cent before any real data moves (owner's separate OK, CLAUDE.md §5).
Estimate: several full sessions, with real risk to the accounting core, and the whole test suite as the only safety net.

## What it buys, and what it does not
- Buys: many users writing at once from many places, one central server, no single-file database.
- Does **not** buy anything unless a server exists: PostgreSQL needs a host that is always on. The owner ruled out Render/Railway/other hosts (CLAUDE.md §5); the laptop + Cloudflare tunnel already serves several devices at once, and SQLite in WAL mode handles one station with a handful of users comfortably (the live data is 17 MB, 61,725 journal lines).
- The Claude page already gives phone/laptop viewing, WhatsApp sending and a second backup copy without a database server.

## Update (owner decided to go ahead; stage A built and measured)
The owner confirmed Phase 2 and asked for standard libraries (ADR-22). Instead of rewriting 361 call sites to `async`, stage A keeps them **synchronous** with a bridge: `src/pg/sync.js` (`PgSync`: `exec`, `prepare().run/get/all`, same shape as `node:sqlite`) sends each statement to a worker thread (`src/pg/worker.js`, the `pg` driver) and sleeps on `Atomics.wait` until the answer comes back. This is what FuelPro already does (one request = one uninterrupted synchronous transaction), so `tx()` with `BEGIN IMMEDIATE`/SAVEPOINT keeps working unchanged. `src/pg/dialect.js` translates `?` → `$n`, `datetime('now')`, `INSERT OR IGNORE`, `GROUP_CONCAT`, `BEGIN IMMEDIATE`, and ignores PRAGMAs. 64-bit integers return as numbers, booleans as 1/0, and `lastInsertRowid` comes from `RETURNING id`.
Measured on PostgreSQL 16 here: 300 round trips well under the 3 s test bound; transactions, savepoints and unique-violation errors (message contains "constraint", so `server.js` still answers 409) behave like SQLite.
**Schema probe (VERIFIED):** the 15 migrations contain 129 statements besides the 9 triggers; **127 run unchanged** after a mechanical translation (`INTEGER PRIMARY KEY` → identity, `INTEGER` → `BIGINT`, `REAL` → `DOUBLE PRECISION`, `datetime('now')` defaults), on a **UTF-8 database with an ICU `nocase` collation** (`CREATE COLLATION nocase (provider = icu, locale = 'und-u-ks-level2', deterministic = false)`). The two failures are the SQLite table-rebuild idiom in migration v3 (`DROP TABLE users` with dependants). The 9 triggers must be ported to PL/pgSQL by hand.
Stages left: B schema + triggers port with a `FUELPRO_DB=postgres` switch in `openDb`; C run the 76 tests on both engines (CI matrix); D reconcile real books to the cent; E migrate with the owner's separate OK. Trade-off of the bridge: the event loop blocks during a query (fine for a LAN/same-machine server; for a remote PostgreSQL each query costs one network round trip).

## Recommendation
Do **not** start the rewrite now. Revisit when one of these is true: (a) a second paying station needs its own always-on server, (b) the owner approves a host, or (c) concurrent writers from several branches become a real need. Until then the cheap wins are: off-site backup (done 0.21), customer phone numbers, correcting KI-06, and the Windows print check (KI-07).

If the owner still wants Phase 2, the safest staged path is: (1) a thin async `Db` interface with `get/all/run/tx` and a SQLite implementation, converting `src/` module by module with all tests green after each module; (2) a PostgreSQL implementation and our own driver behind the same interface; (3) dual-engine test run; (4) reconciliation; (5) migration with the owner's OK.
