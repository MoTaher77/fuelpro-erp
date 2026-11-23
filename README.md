# FuelPro

> **الإصدار الحالي 0.6.1.** التوثيق المعتمد في مجلد `docs/` — ابدأ من `docs/00-MASTER-INDEX.md` (الحالة في `docs/PROGRESS.md`).
> ملفات الجذر `ARCHITECTURE.md` و`DATABASE_SCHEMA.md` و`PROJECT_PROGRESS.md` و`RESUME.md` و`QA_REPORT.md` قديمة (v0.4.0).
> الجدول أدناه «What is built (v0.1)» تاريخي؛ القائمة الكاملة لما بُني في `CHANGELOG.md` و`docs/PROGRESS.md`.

Multi-tenant fuel-station management server. Zero npm dependencies (Node 22.5+, built-in `node:sqlite`).

```bash
npm test          # 59 tests (node:test, in-memory DBs)
npm start         # http://localhost:3000  (create an account on the first screen)
npm run backup    # consistent online SQLite backup -> data/backups/
node scripts/reset-2fa.js user@example.com   # support: turn off 2FA for someone who lost phone AND recovery codes
```

## What is built (v0.1)

| Area | Status |
|---|---|
| Organisations, stations, users with roles (owner / manager / cashier) | done |
| Auth: scrypt passwords, hashed server-side sessions, HttpOnly SameSite=Strict cookie, login lockout, CSRF origin check | done |
| Money as integers (minor units), volume as integer millilitres, BigInt arithmetic, ISO currency decimals | done |
| Sales by meter reading or quantity; meter continuity; stock enforcement; idempotent retries (`client_id`) | done |
| VAT per sale (included / added), snapshotted rate; input VAT on deliveries & expenses; VAT-payable report | done |
| Voids with reason (never hard-deletes), stock and meter reversal, audit trail on every change | done |
| Deliveries (capacity enforced), stock counts, expenses, customers, credit balances, payments (overpayment blocked) | done |
| Dashboard and period summary (margin, VAT, by fuel / pump / day) | done |
| Web client: Arabic/English/French (RTL), litres/US gal/UK gal, Gregorian/Hijri, Arabic numerals, expenses, customer statements, CSV export, change password, readable audit log, margin warning when cost is missing | done |
| Password reset by email: single-use 30-min link, only the newest link works, signs out every device, no account enumeration, rate limited, links built from `APP_URL` only | done |
| Two-step verification (TOTP, RFC 6238): QR + manual key, replay-safe, 10 one-time recovery codes, per-account lockout, owner can reset staff, secrets encrypted with `APP_SECRET` | done |
| SMTP client (STARTTLS / implicit TLS, AUTH PLAIN, UTF-8), no dependencies | done |
| Online backup script, Dockerfile | done |

## Design rules that keep the numbers right

* No floats anywhere in storage or calculation. `price_e4` = minor units per litre x 10,000.
* Every write is one `BEGIN IMMEDIATE` transaction; SQLite CHECK constraints are the last line of defence
  (tank level between 0 and capacity, meter never negative, VAT <= gross, credit sale requires a customer).
* Server decides prices, VAT and totals. Clients only send meter readings / quantities.
* Every query is scoped by the caller's organisation; foreign ids return 404.

## Not built yet (read before selling)

1. ~~Port the full prototype UI~~ done in v0.2.
2. **Postgres** (or managed SQLite/Litestream) for multi-instance hosting; move login throttling and sessions to Redis if you scale out.
3. ~~Password reset, 2FA~~ done in v0.3. Still to do: **per-user station restrictions**, optional "require 2FA for all staff" policy.
4. **Billing / subscriptions** (Stripe or local gateways), tenant limits, trial logic, terms & privacy pages.
5. **Offline-tolerant sales entry** on poor connections (the API is already idempotent for this).
6. **Accountant sign-off**: VAT/tax rules differ per country; have a local accountant verify the reports before charging for them.
7. **Security review / penetration test**, load test, monitoring and alerting, scheduled off-site backups.
8. **Unit conversion** and currency conversion in the API layer (storage is already canonical: litres and minor units).

## Configuration for production

Copy `.env.example`. The three settings that matter for accounts:

* `APP_URL` – the public https address. Reset links are built from it.
* `APP_SECRET` – encrypts 2FA secrets. If you lose it, every user with 2FA must be reset with `scripts/reset-2fa.js`.
* `SMTP_*`, `MAIL_FROM` – any provider (Amazon SES, Mailgun, Brevo, Gmail Workspace, your host). Set SPF and DKIM for the sending domain or reset emails will land in spam.
