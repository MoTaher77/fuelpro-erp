# Backend stack benchmark — fuel-station ERP shape (measured 2026-11-27)

Same tiny service in 6 stacks × SQLite / PostgreSQL. All numbers below were measured on this machine; nothing is estimated.

**Machine:** Linux 6.18, 4 vCPU, 15 GB RAM, one VM. Load generator, app server and PostgreSQL all share the same 4 vCPU (so absolute numbers are a lower bound and the fastest stacks are partly client/CPU-bound — see notes).

**Data:** 2 orgs × 3 stations × 200,000 sales = 1.2 M sales, 1.2 M stock_moves, 1.2 M journals, 4.8 M journal_lines (4 per sale, balanced), 1.2 M audit rows. Integers only, money in minor units. Identical deterministic data in both engines (`seed/seed-sqlite.js`, `seed/pg-seed.sql`). SQLite file 345 MB; PG database 1.16 GB. Each config starts from a fresh copy (SQLite file copy / `CREATE DATABASE … TEMPLATE seed`). After every config a books check ran: Σdebit − Σcredit = 0 and sales = audit rows, in every run.

**Indexes:** sales(station_id,id), sales(station_id,created_at), stock_moves(station_id), journals(station_id,id), journal_lines(journal_id) covering debit,credit (SQLite: composite index; PG: `INCLUDE`).

**Endpoints:** (1) latest 50 sales of a station; (2) day totals + trial-balance totals Σdebit/Σcredit over the station's 800k journal lines (join, deliberately heavy); (3) POST = one transaction: org/station isolation check (`X-Org` header, foreign station → 404) + sale + stock_move + journal + 4 journal_lines + audit. All endpoints check isolation.

**Settings:** SQLite WAL, `synchronous=NORMAL`, `busy_timeout=5000`, `cache_size=-65536` (64 MB/conn), `temp_store=MEMORY`, `foreign_keys=ON` (Node/Bun also `mmap_size=256MB`; Go/Rust mmap off). Multi-threaded stacks (Go, Rust): read pool of 2×CPU = 8 connections + exactly one writer connection (writes queued in-process, `BEGIN IMMEDIATE`). Node/Bun: one connection, single event loop, one process (no cluster). PostgreSQL 16 default config (`shared_buffers=128MB`, `synchronous_commit=on`, `max_connections=100`), pool = CPUs = 4 in every stack.

**Load command** (per endpoint, a fresh server process each time):
```
node tools/load.js <url> 5 100 [body]   # warm-up 5 s, discarded
node tools/load.js <url> 15 100 [body]  # measured 15 s
```
`tools/load.js` = autocannon 8.0.0 programmatic API with 100 connections, headers `X-Org: 1`, `content-type: application/json`, 10 s request timeout, POST body `{"pump_id":3,"qty_ml":20000,"price_e4":3500000}`; it records every response time into an HDR histogram to get p95 (the autocannon CLI only prints p97.5). Equivalent CLI: `autocannon -c 100 -d 15 -H X-Org=1 -H content-type=application/json [-m POST -b '<body>'] <url>`.
Summary endpoint exception: warm-up at 1 connection and a 60 s timeout for the measured run (see note on abandoned backlogs). "2b" = the same summary at 1 connection = pure service time.
Orchestration: `run.sh <stack> <sqlite|pg>`, `run-all.sh`, `rerun.sh`; raw JSON per run in `results/`; `tools/tables.js` builds the tables.

### 1. GET /stations/:sid/sales?limit=50 (100 conn)

| Stack | DB | req/s | p50 ms | p95 ms | p99 ms | errors (timeouts) | non-2xx |
|---|---|--:|--:|--:|--:|--:|--:|
| Node node:http | SQLite | 5425 | 17.42 | 28.91 | 32.66 | 0 (0) | 0 |
| Node Fastify 5 | SQLite | 6525 | 13.87 | 22.09 | 26.8 | 0 (0) | 0 |
| Node Hono | SQLite | 5805 | 14.79 | 27.86 | 32.32 | 0 (0) | 0 |
| Bun Hono | SQLite | 11605 | 8.04 | 12.14 | 14.13 | 0 (0) | 0 |
| Go net/http | SQLite | 9707 | 8.75 | 24.56 | 34.05 | 0 (0) | 0 |
| Rust axum | SQLite | 21433 | 4.3 | 10.13 | 14.53 | 0 (0) | 0 |
| Node node:http | Postgres | 5091 | 17.68 | 28.77 | 34.37 | 0 (0) | 0 |
| Node Fastify 5 | Postgres | 5595 | 16.25 | 26.59 | 32.73 | 0 (0) | 0 |
| Node Hono | Postgres | 5339 | 17.54 | 26.09 | 31.79 | 0 (0) | 0 |
| Go net/http | Postgres | 9536 | 10.19 | 13.79 | 16.25 | 0 (0) | 0 |
| Rust axum | Postgres | 9576 | 10.08 | 14.07 | 16.59 | 0 (0) | 0 |

### 2. GET /stations/:sid/summary (100 conn)

| Stack | DB | req/s | p50 ms | p95 ms | p99 ms | errors (timeouts) | non-2xx |
|---|---|--:|--:|--:|--:|--:|--:|
| Node node:http | SQLite | 8 | 1482.75 | 5971.97 | 12394.5 | 0 (0) | 0 |
| Node Fastify 5 | SQLite | 8 | 7548.93 | 9781.25 | 9781.25 | 0 (0) | 0 |
| Node Hono | SQLite | 8 | 5865.47 | 8196.09 | 8683.52 | 21 (0) | 0 |
| Bun Hono | SQLite | 8 | 7421.95 | 13033.47 | 13041.66 | 0 (0) | 0 |
| Go net/http | SQLite | 31 | 2560 | 5738.49 | 7667.71 | 0 (0) | 0 |
| Rust axum | SQLite | 27 | 3452.93 | 3856.38 | 4179.97 | 0 (0) | 0 |
| Node node:http | Postgres | 3 | 7221.25 | 14139.39 | 14868.48 | 0 (0) | 0 |
| Node Fastify 5 | Postgres | 3 | 7110.65 | 14426.11 | 14647.3 | 0 (0) | 0 |
| Node Hono | Postgres | 3 | 7995.39 | 14417.92 | 14966.78 | 0 (0) | 0 |
| Go net/http | Postgres | 3 | 7671.81 | 14254.08 | 14835.71 | 0 (0) | 0 |
| Rust axum | Postgres | 3 | 8019.97 | 14123.01 | 14811.14 | 0 (0) | 0 |

### 2b. GET summary at 1 connection (service time, no queueing)

| Stack | DB | req/s | p50 ms | p95 ms | p99 ms | errors (timeouts) | non-2xx |
|---|---|--:|--:|--:|--:|--:|--:|
| Node node:http | SQLite | 7 | 134.53 | 192.25 | 201.47 | 0 (0) | 0 |
| Node Fastify 5 | SQLite | 7 | 146.43 | 201.98 | 205.69 | 0 (0) | 0 |
| Node Hono | SQLite | 8 | 126.78 | 152.32 | 164.74 | 0 (0) | 0 |
| Bun Hono | SQLite | 8 | 122.81 | 168.06 | 185.22 | 0 (0) | 0 |
| Go net/http | SQLite | 7 | 124.09 | 170.75 | 191.23 | 0 (0) | 0 |
| Rust axum | SQLite | 7 | 139.39 | 198.27 | 223.87 | 0 (0) | 0 |
| Node node:http | Postgres | 3 | 336.89 | 419.84 | 437.25 | 0 (0) | 0 |
| Node Fastify 5 | Postgres | 3 | 310.53 | 397.31 | 431.1 | 0 (0) | 0 |
| Node Hono | Postgres | 3 | 332.54 | 408.06 | 528.89 | 0 (0) | 0 |
| Go net/http | Postgres | 3 | 311.81 | 360.96 | 377.09 | 0 (0) | 0 |
| Rust axum | Postgres | 3 | 300.29 | 341.5 | 406.53 | 0 (0) | 0 |

### 3. POST /stations/:sid/sales (100 conn, pure writes)

| Stack | DB | req/s | p50 ms | p95 ms | p99 ms | errors (timeouts) | non-2xx |
|---|---|--:|--:|--:|--:|--:|--:|
| Node node:http | SQLite | 4666 | 20.27 | 31.05 | 38.78 | 0 (0) | 0 |
| Node Fastify 5 | SQLite | 4648 | 20.22 | 31.23 | 40.26 | 0 (0) | 0 |
| Node Hono | SQLite | 3827 | 24.11 | 37.12 | 50.72 | 0 (0) | 0 |
| Bun Hono | SQLite | 5014 | 19.04 | 28.61 | 34.11 | 0 (0) | 0 |
| Go net/http | SQLite | 2694 | 26.91 | 108.93 | 169.09 | 0 (0) | 0 |
| Rust axum | SQLite | 5129 | 18.64 | 48.86 | 71.94 | 0 (0) | 0 |
| Node node:http | Postgres | 2608 | 37.18 | 50.56 | 62.34 | 0 (0) | 0 |
| Node Fastify 5 | Postgres | 2839 | 33.22 | 51.65 | 68.35 | 0 (0) | 0 |
| Node Hono | Postgres | 2308 | 41.79 | 57.66 | 71.1 | 0 (0) | 0 |
| Go net/http | Postgres | 3073 | 31.74 | 38.94 | 46.37 | 0 (0) | 0 |
| Rust axum | Postgres | 3674 | 26.7 | 32.61 | 36.35 | 0 (0) | 0 |

### Peak server RSS (VmHWM, MB; max over the endpoint runs; DB server memory not included)

| Stack | SQLite list | SQLite summary | SQLite post | PG list | PG summary | PG post |
|---|--:|--:|--:|--:|--:|--:|
| Node node:http | 115 | 119 | 105 | 85 | 52 | 85 |
| Node Fastify 5 | 139 | 135 | 117 | 90 | 65 | 107 |
| Node Hono | 130 | 128 | 160 | 121 | 60 | 145 |
| Bun Hono | 40 | 115 | 79 | n/a | n/a | n/a |
| Go net/http | 25 | 553 | 38 | 23 | 18 | 22 |
| Rust axum | 25 | 543 | 54 | 11 | 7 | 10 |

### Deployable artefact size

| Stack | App artefact | Runtime needed on the server |
|---|--:|---|
| Node node:http | node_modules 0.9 MB (only `pg`; SQLite is built-in `node:sqlite`) | node 22 binary 118 MB |
| Node Fastify 5 | node_modules 15.9 MB (fastify + pg, 54 packages) | node 22, 118 MB |
| Node Hono | node_modules 5.0 MB (hono + @hono/node-server + pg) | node 22, 118 MB |
| Bun Hono | node_modules 3.7 MB (hono only; SQLite built-in) | bun binary 102 MB |
| Go net/http | single binary 11.5 MB (`-ldflags=-s -w`, includes SQLite via cgo + pgx; dynamic libc only) | none |
| Rust axum | single binary 4.1 MB (release, thin LTO, stripped; bundled SQLite + tokio-postgres) | none (libc, libgcc_s) |

### Extra: PostgreSQL write path sensitivity (Go, POST, 100 conn, 15 s)

| Pool | synchronous_commit | req/s | p50 | p95 | p99 |
|---|---|--:|--:|--:|--:|
| 4 | on (default) | 2929 | 33.1 | 41.3 | 66.1 |
| 16 | on | 4838 | 19.9 | 26.9 | 35.0 |
| 4 | off | 4756 | 20.6 | 26.4 | 30.9 |
| 16 | off | 6456 | 15.0 | 21.2 | 25.3 |

### Versions
Node 22.23.5 (`node:sqlite`, SQLite 3.54.1) · Fastify 5.12.8 · Hono 4.13.23 · @hono/node-server 1.19.19 · pg (node-postgres) 8.23.1 · Bun 1.4.4 (bun:sqlite, SQLite 3.53.4) · Go 1.24.7, net/http ServeMux, mattn/go-sqlite3 1.14.53 (SQLite 3.54.1, cgo), jackc/pgx v5.13.0 (pgxpool) · Rust 1.97.0, axum 0.8.9, tokio 1.54.1, rusqlite 0.37.0 bundled (libsqlite3-sys 0.35.0, SQLite 3.50.2) + r2d2_sqlite 0.31, tokio-postgres 0.7.18 + deadpool-postgres 0.14.2 · PostgreSQL 16.15 · autocannon 8.0.0.

### Observations
1. **Light reads and writes are fine everywhere.** At 100 connections every stack/DB keeps p95 < 60 ms on the list and POST endpoints (one exception: Go+SQLite POST p95 109 ms). Single-process Node does ~5–6.5k req/s on the list endpoint and ~4.6k fully-transactional POSTs/s on SQLite — orders of magnitude above what a few stations generate (a busy station is a few sales per minute). Framework choice inside Node changes little (±15 %): Fastify ≥ node:http ≥ Hono-on-Node.
2. **The heavy report is the real bottleneck, and no stack meets p95 < 100 ms on it at 100 connections.** The trial-balance query costs ~125–145 ms in SQLite and ~300–340 ms in PostgreSQL at one connection (2b). Throughput is then capped by cores: one event loop (Node, Bun) = 8 req/s; Go/Rust with 8 SQLite readers = 27–31 req/s; PostgreSQL = 3 req/s in every stack (each query already uses 3 cores via parallel workers). 100 concurrent report requests therefore wait 3–14 s. Note: latencies in table 2 only count requests that finished within the 15 s window, so they *understate* the queueing. Fix belongs in the data model (per-period balance snapshots / account-period totals / narrower index scans), not the language.
3. **Single event loop + slow query = whole server stalls.** In Node/Bun a 130 ms synchronous SQLite call blocks every other request; with the default 10 s client timeout, abandoned requests kept executing and the first run delivered 0 successful responses (goodput collapse, all 100 timed out). Go cancelled queries on client disconnect via `r.Context()` and kept serving. If Node stays, heavy reports need a worker thread / separate process or must be made cheap.
4. **SQLite write serialization is visible but not limiting.** All SQLite writes go through one writer: Node/Bun/Rust all land at 4.6–5.1k tx/s (≈ the single-writer ceiling with `synchronous=NORMAL`), so Rust's threads buy nothing for writes. Go's `database/sql` pool with `MaxOpenConns=1` added queueing jitter (2.7k tx/s, p95 109 ms). Multi-threaded stacks win big on *reads* only: Rust 21.4k and Bun 11.6k vs Node 5.4–6.5k on the list endpoint.
5. **SQLite vs PostgreSQL.** On this single box SQLite was faster or equal on every endpoint: list ≈ equal for Node (5.1–5.6k vs 5.4–6.5k), POST 1.3–1.8× faster on SQLite (PG 2.3–3.7k tx/s with pool 4 and fsync on every commit vs SQLite `synchronous=NORMAL`, which does not fsync each commit — not equal durability), report 2.5× faster on SQLite single-request. PG write throughput is sensitive to config: pool 16 or `synchronous_commit=off` lifted Go from 2.9k to 4.8k, both together 6.5k tx/s. PG's advantages (concurrent writers, network access, replication, roles) are operational, not raw speed, at this scale.
6. **Memory/artefact.** Go/Rust servers use 7–55 MB RSS on light loads vs 85–160 MB for Node; the ~550 MB on Go/Rust SQLite summary is 8 reader connections × 64 MB page cache filled by the 800k-row scan (tunable). Single binaries are 4–12 MB vs a 100–120 MB runtime + 1–16 MB node_modules.
7. **Pitfall found (measured):** rusqlite's bundled SQLite is compiled with `SQLITE_ENABLE_MEMORY_MANAGEMENT`, which makes all connections share one page-cache mutex. With it, Rust+SQLite did 15.5k req/s on list and only **3–4 req/s** on the report with 8 readers (futex-bound, 56 % sys CPU). Rebuilt with `LIBSQLITE3_FLAGS="-USQLITE_ENABLE_MEMORY_MANAGEMENT"`: 21.4k and 27 req/s. The Rust rows above use the fixed build (old raw results in `results-old/`).
8. **Measurement limits.** Client, server and PG share 4 vCPU; ~10k req/s already saturates the box (two parallel clients against Go gave 10.1k total vs 9.7k with one), so Go/Rust/Bun list numbers and the Go-vs-Rust PG list tie (~9.5k) are partly machine-bound. 15 s windows, one run each: treat differences < ~10 % as noise. PG server memory/CPU not included in RSS.

### Build notes / deviations
- All 6 stacks built and ran; none skipped.
- PG data directory lives in `/home/pgbench/pgdata` (symlinked as `pg/data`): the scratchpad's parent dir is root-only (mode 700, reset automatically), so the non-root `postgres` process could not use a directory inside it. Throwaway cluster on 127.0.0.1:5499, trust auth.
- Rust is built with `LIBSQLITE3_FLAGS="-USQLITE_ENABLE_MEMORY_MANAGEMENT" cargo build --release` (see observation 7).
- Node `pg` returns `numeric` sums as strings; a type parser turns int8/numeric into Number (values < 2^53).

### Layout
`seed/` (seed-sqlite.js, pg-seed.sql, seed.db) · `node-common/core.js` (shared data layer for the 3 Node stacks) · `node-http/ node-fastify/ node-hono/ bun-hono/ go-api/ rust-api/` · `tools/load.js` (autocannon + p95), `tools/tables.js` · `run.sh`, `run-all.sh`, `rerun.sh` · `results/*.json` (raw), `results/extra-go-pg-post.txt`, `results-old/` (Rust before the SQLite flag fix).
