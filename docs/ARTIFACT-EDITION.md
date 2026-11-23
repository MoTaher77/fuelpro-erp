# FuelPro Artifact edition (claude.ai page) — ADR-20

A second way to run FuelPro: a private claude.ai Artifact that opens on phone and laptop. It is **separate from the
laptop system**. It runs on demo data only, never on the station's data.

Live pages (both private to the owner):
- Demo: https://claude.ai/artifact/CgLf1pmqcani77JBGVL56N (`web/dist`, demo seed).
- Station copy «FuelPro المحطة»: https://claude.ai/artifact/Dbe4L4cWnvRSbeswvYAENF — the owner's OK (2026-11-23) to load the real-data snapshot. Built with `node scripts/dev-admin.js --db <tmp>` (throwaway admin; real users' passwords stay disabled) then `node web/build.js --seed-db <tmp> --out web/dist-station`. It is a copy of `dev-data/fuelpro-snapshot.db`: no sync with the laptop in either direction. Never share it; republishing keeps saved data (the seed is used only while storage is empty).

## How it works (no imitation)
| Layer | Laptop / server | Artifact page |
|---|---|---|
| Business rules, SQL, permissions, validation, journals, audit | `src/*.js` | **the same `src/*.js`, unchanged**, bundled by `web/bundle.js` |
| SQLite engine | `node:sqlite` | sql.js 1.10.3 (pure-JS build from cdn.jsdelivr.net), adapter `web/shims/sqlite-sqljs.js` |
| Node built-ins | Node | `web/shims/node-shims.js`: Buffer subset, SHA-1/256, HMAC, scrypt (byte-identical to Node, checked), path, no-file fs, http handler capture |
| HTTP | `node:http` server | the app's `fetch('/api/...')` is answered in the page by the same request handler (`web/runtime.js`) |
| Front end | `public/*` | `public/*` copied as is; only the service-worker line is removed and the one `confirm()` in `bank-ui.js` becomes an in-page dialog |
| Storage | `data/fuelpro.db` file | the database file saved in the Artifact's `db` storage: content-addressed 128 KB gzip blocks (`fpblk/<hash>`) + one state document (`fpstate/main`: generation, block list, size) |

Save cycle: after each successful change (and after sign-in, because sessions are rows too) the page waits 1.2 s,
exports the database, writes only the blocks that changed, then switches `fpstate/main` to the new generation and
deletes blocks nobody uses. A half-finished save never corrupts the data: the old state document still points at
complete old blocks. If another device saved a newer generation, the page refuses to overwrite it and asks for a reload.

## What works and is stored
Sign-in (scrypt hashes, sessions, lockout, roles and station scoping), sales by pump meter, voids with reason,
customers and payments, suppliers and purchases, tanks and stock moves, shifts and cash boxes, vouchers and manual
journals, expenses, bank reconciliation, daily report, sales register, statements, trial balance, financial
statements, analytics, alerts, audit log, Excel/CSV export (through the viewer's download prompt), a download of the
whole database file.

## What does not work in the page (needs the laptop/server)
- **Printing**: claude.ai pages cannot open the print dialog. Print from the laptop.
- **Server backups** (`VACUUM INTO`, the backups screen's download): no file system. Use the status chip → download the database.
- **Password-reset e-mail and SMTP**: no network sockets; mails are only logged.
- **2FA secret encryption with `APP_SECRET`**: not set in the page (2FA itself works, secrets are stored unencrypted, as on a server without `APP_SECRET`).
- **Several people at the same time on one copy**: one writer at a time; a second device gets "reload" instead of a merge.
- **Size**: built for demo size (about 5 MB, 40 blocks). The station's full data with M7 history would be slow to save; that is the laptop/server's job.
- **Real station data**: only in the private station page above (owner's OK). The demo page's seed is made by `scripts/seed-demo.js`, which refuses non-demo databases.
- **Size**: the station copy is 16.6 MB (134 blocks, 3.5 MB gzip); the first save writes all blocks (~30 s), later saves only changed blocks.

## Rebuild and republish after changing the project
1. `npm test` green, and the page engine checks:
   `npm i --no-save --no-package-lock sql.js@1.10.3`
   `node --test test/artifact-runtime.test.js`
   `node --import ./web/sqljs-hook.mjs --test --test-skip-pattern="[Bb]ackup" test/*.test.js`
2. `DEMO_PASSWORD=<pw> node web/build.js --days 90` → `web/dist/` (git-ignored). The password is only stored as a scrypt hash.
3. From a Claude Code session: publish `web/dist/index.html` with the Artifact tool, `url` = the live page above,
   `files` = every other file in `web/dist/`. Saved data in the page is kept across republishes (it lives in `db`).
   A new seed only matters after "reset demo data" in the chip menu.
4. CI (`.github/workflows/test.yml`, job `artifact`) runs step 1 and 2 on every PR and keeps the built `web/dist`
   as a downloadable workflow artifact for 14 days.

## Files
`web/bundle.js` (src → one script), `web/build.js` (bundle + seed + app → `web/dist`), `web/runtime.js` (boot, API bridge,
save/load), `web/index.html` (page shell), `web/shims/*`, `web/sqljs-hook.mjs` (run Node tests on sql.js),
`test/artifact-runtime.test.js`.
