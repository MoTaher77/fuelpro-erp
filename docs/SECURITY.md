# SECURITY — FuelPro
Verified 2026-11-23 against `src/auth.js`, `src/server.js`, `src/services.js`, `src/backup.js`.

## Roles and permissions (`PERMS` in `src/auth.js`)
| Role | Scope | Can do |
|---|---|---|
| `owner`, `admin` | whole org (`ORG_WIDE`) | everything (`*`), incl. users, backups, year close |
| `manager` | assigned stations | operations + void, back-date, deliveries, expenses, transfers, prices, config, suppliers, cash moves, shift approval, vouchers, journal read, reports, audit |
| `accountant` | assigned stations | customers, payments, expenses, suppliers, shift approval, journals (create/post/reverse), period lock, account edit, vouchers, reports, audit |
| `supervisor` | assigned stations | operations + void sale, deliveries, expenses, stock count, cash moves, reports |
| `cashier` | assigned stations | read, sell, add customer, take payment, open/close shift |
| `viewer` | assigned stations | read + reports |
Base operations `OPS` = read, sale.create, customer.create, payment.create, shift.open, shift.close.
Every route checks `need(user, perm)` on the server; the menu (`NAV` in `public/app.js`) only hides what the user can't use.

## Isolation
- Every query is scoped by `org_id`; station routes go through `scoped()` (`src/services.js`) using `user_stations`. A station or record from another org/station answers **404** (existence is not revealed). Tested in `api.test.js` and `erp.test.js`.
- Mixed-currency stations are never summed together.

## Authentication
- Passwords: scrypt (`hashPassword`/`verifyPassword`), policy ≥10 chars (`checkPasswordPolicy`); dummy hash for unknown users (timing).
- Sessions: random token in cookie `sid` (HttpOnly, SameSite=Strict, `Secure` when `COOKIE_SECURE=1`), stored **hashed** in `sessions`, 7 days. Password change/reset signs out other devices.
- Login throttling (`assertNotLocked`/`recordFail`), separate throttling for 2FA codes and reset requests.
- 2FA: TOTP RFC 6238 with replay guard (`totp_last_step`), recovery codes stored hashed, secrets sealed with AES-256-GCM using `APP_SECRET`. `scripts/reset-2fa.js` for lock-outs.
- Password reset: single-use, expiring token; link built from `APP_URL`, never the Host header; same answer for unknown e-mails.

## Request protection (`src/server.js`)
CSRF: writes must be same-origin and JSON. Static files: path-traversal check. Security headers via `secHeaders()`: CSP `default-src 'self'; script-src 'self'; style-src 'self'` (no inline scripts or styles), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: same-origin`, HSTS when `COOKIE_SECURE=1`. Parameterised SQL only.

## Audit
`audit` table: org, station, user, action, entity, id, detail, time. Written in the same transaction as the operation. Screen «سجل التدقيق» (`audit.read`).

## Secrets and private data
- Secrets come from the environment (`.env`, never committed; `.env.example` has placeholders only). Keep `APP_SECRET` stable — changing it breaks existing 2FA secrets.
- `بيانات-الدخول.txt` in the laptop project folder holds login details: never read, copy or publish it.
- `data/*.db` contains real customer and financial data: never upload, publish or paste into chats/docs.
- Backups can only be listed/downloaded by owner/admin (`backup.can`).

## Known risks / gaps
- Running on `http://localhost` on the laptop: fine locally; anyone reaching port 3000 on the LAN could reach the login page (VERIFIED: `server.listen(port, process.env.HOST || '0.0.0.0')`). Prefer `HOST=127.0.0.1` unless LAN access is wanted.
- No independent penetration test; no error monitoring.
- Backups live on the same disk as the DB — copy them off the laptop regularly.

## Behind a tunnel (0.11.0)
HOST=127.0.0.1, Secure cookies, HSTS, TRUST_PROXY with CF-Connecting-IP, APP_SECRET from data\app-secret.txt. Recommend two-factor sign-in for every account before sharing the public address.
