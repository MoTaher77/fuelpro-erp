# DEPLOYMENT — FuelPro
Two environments exist today. **Never mix their databases.**

| Environment | Where | DB | Status |
|---|---|---|---|
| **Production (real)** | owner's Windows laptop, `C:\Users\Moham\FuelPro`, http://localhost:3000 | `data\fuelpro.db` (محطة التميز, real data) | in daily use (VERIFIED files present) |
| Demo (laptop) | same folder, started with `start-fuelpro-demo.bat` | `data\demo.db` | available |
| **VPS (owner's own server)** | Ubuntu/Debian, `deploy/vps/` → **[VPS.md](VPS.md)** (systemd + Caddy HTTPS) | `/var/lib/fuelpro/fuelpro.db` | **live since 2026-11-24** on the owner's Contabo VPS, https://212-90-120-15.sslip.io, with محطة التميز's data from the 2026-11-23 snapshot (owner's explicit OK) |
| Cloud demo / production | Render (`render.yaml`) or Railway (Dockerfile) | separate persistent disks | **not used** (ADR-20) |

## Runtime requirements
Node.js ≥ 22.5 (22.5–22.12 need `--experimental-sqlite`, handled by `start-fuelpro.ps1`). No npm install. Disk for `data/`.
Env vars: see `.env.example` — `PORT`, `HOST`, `DB_PATH`, `APP_URL`, `APP_SECRET`, `COOKIE_SECURE`, `TRUST_PROXY`, `REGISTRATION` (open|first|closed, 0.27), `SMTP_*`, `MAIL_FROM*`, `BACKUP_DIR`, `BACKUP_COPY_DIR`, `BACKUP_AUTO`.

## Updating the laptop (current procedure)
1. Build `fuelpro.zip` containing a top folder `fuelpro/` with `src public scripts test` and top-level files (`package.json`, `CLAUDE.md`, `CHANGELOG.md`, …). **Never include `data/`.**
2. Put it at `C:\Users\Moham\Downloads\fuelpro.zip` (from a cloud session: `device_commit_files`, then compare sha256).
3. The owner runs `start-fuelpro.bat` → `start-fuelpro.ps1` replaces `src public scripts test`, copies top-level files, keeps `data\`, then starts the server and opens the browser.
4. If `data\fuelpro-new.db` exists, the script swaps it in and keeps the old one as `data\fuelpro-backup-<stamp>.db` (used only for planned data replacements — **not allowed now** that real work has started).
- `docs/` and `.claude/` are **not** copied by the script; copy them separately (they are never deleted by it).
- ⚠ The script re-installs from the zip on **every** start (KI-02).

## Backup and restore
- Automatic: one copy per day while the server runs (`src/backup.js`), newest 30 kept, in `data\backups\`. Manual: `npm run backup` or the backups screen (owner/admin).
- Restore: stop the server → put the copy at `DB_PATH` → start → «القوائم المالية ← فحص سلامة الدفاتر».
- Copy backups off the laptop (USB / cloud drive) regularly — today they share one disk.

## Rollback
Migrations only add. To roll back code: reinstall the previous zip **together with** a DB backup taken before the upgrade (an old version may not understand a newer schema). Take a backup before every update.

## Claude Artifact edition (ADR-20, current online demo)
See `docs/ARTIFACT-EDITION.md`. Render/Railway are not used (owner's instruction, 2026-11-23); the notes below are kept for reference only.

## Cloud (ADR-19, superseded by ADR-20)
Steps for the owner (needs his Render account; the agent cannot reach it): 1) render.com → New → Blueprint → connect `MoTaher77/fuelpro-erp`, branch `main`, file `render.yaml`; 2) in `fuelpro-demo` set `APP_URL` to its https address; 3) open the service Shell and run `DB_PATH=/app/data/demo.db node scripts/seed-demo.js --days 365` (prints a random password once); 4) verify: `node scripts/smoke-online.js https://<service>.onrender.com demo@fuelpro.demo <password> --write`. `fuelpro-production` stays empty until the owner approves moving real data. Render gives HTTPS automatically.

## Cloud (reference)
Render: Blueprint from `render.yaml` → set `APP_URL`, `APP_SECRET`, SMTP → demo seed from the demo service shell (`scripts/seed-demo.js` refuses non-DEMO DBs). Persistent disks need a paid plan — check current prices. Health check `/healthz`.

## Online through a Cloudflare Tunnel (0.11.0, owner's choice 2026-11-23)
- Phase 1 of two (ADR-17): the server stays on the laptop; `start-fuelpro-online.bat` (→ `start-fuelpro-online.ps1`, project root) opens a tunnel with `cloudflared` (installed by winget, `Cloudflare.cloudflared`) and starts the server with `HOST=127.0.0.1 COOKIE_SECURE=1 TRUST_PROXY=1 APP_SECRET=<data\app-secret.txt> APP_URL=<tunnel url>`.
- Quick tunnel (no account): a new `https://*.trycloudflare.com` address each start; the script prints it and copies it. Cloudflare does not promise uptime for quick tunnels.
- Fixed address: create a named tunnel on a Cloudflare account with a domain (`cloudflared tunnel login`, `cloudflared tunnel create fuelpro`, `cloudflared tunnel route dns fuelpro fuelpro.<domain>`), then write `fuelpro` to `data\tunnel-name.txt` and `https://fuelpro.<domain>` to `data\tunnel-url.txt`.
- Only the tunnel and the laptop itself reach the server (LAN devices use the public address). Client IP = `CF-Connecting-IP` (forged X-Forwarded-For cannot bypass the sign-in lockout — test/proxy.test.js).
- `data\app-secret.txt` encrypts two-factor secrets: back it up with the database; without it encrypted 2FA secrets cannot be read.
- Phase 2 (PLANNED): PostgreSQL data layer, then a hosted server.
