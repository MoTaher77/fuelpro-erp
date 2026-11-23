# PROJECT-STRUCTURE — FuelPro
Verified 2026-11-23 (file list + line counts). 40 files under `src public test scripts` (the laptop has 39: `scripts/reconcile-m7.js` is missing there).

```
FuelPro/
├── CLAUDE.md               entry point for Claude sessions
├── CHANGELOG.md            version history (current 0.6.1)
├── README.md               product overview (partly outdated: "What is built (v0.1)")
├── package.json            scripts: start, dev, test, backup, seed:demo, reset-2fa (version 0.6.1)
├── .env.example            documented environment variables (no real secrets)
├── Dockerfile, render.yaml, .github/workflows/ci.yml    cloud build/deploy/CI (container copy only for .github)
├── ARCHITECTURE.md DATABASE_SCHEMA.md DEPLOYMENT.md PROJECT_PROGRESS.md QA_REPORT.md RESUME.md   legacy v0.4.0 docs
├── docs/                   this documentation system (start at 00-MASTER-INDEX.md)
├── .claude/skills/         on-demand Claude skills (fuelpro-*)
├── src/                    server (Node, CommonJS)
├── public/                 browser app (static, no build)
├── test/                   node:test suites
├── scripts/                CLI tools (seed, import, backup, 2FA reset, schema doc)
└── data/                   databases — NOT in the zip, never overwritten (git-ignored)
```

## src/ — server (3,137 lines)
| File | Lines | Role | Depends on |
|---|---|---|---|
| `server.js` | 271 | HTTP server, router, CSRF, static files, all routes | all modules below |
| `db.js` | 396 | open DB, migrations 1–12, `tx()` | node:sqlite |
| `services.js` | 674 | core operations, scoping, audit, auth flows | ledger, auth, money, validate |
| `ops.js` | 571 | shifts, suppliers, transfers, journals, financial statements, integrity | ledger, services |
| `books.js` | 490 | vouchers, boxes, currencies, assets, registers, brand, meter sheet | ledger, services |
| `reports.js` | 181 | daily/box/collections reports, year close | books, ledger, ops |
| `ledger.js` | 149 | chart, posting, reversal, stock ledger | db |
| `auth.js` | 113 | passwords, sessions, roles, throttling | node:crypto |
| `mailer.js` 94 · `totp.js` 64 · `backup.js` 44 · `money.js` 44 · `validate.js` 36 · `errors.js` 10 | | helpers | |

## public/ — browser app
| File | Lines | Role |
|---|---|---|
| `index.html` | — | loads the scripts below |
| `app.js` | 600 | shell, i18n `D`, prefs, `api()`, `NAV`, `render()`, `fitTables`, `printNode`; screens dash, sales, stock, exp, rep, audit, setup, users |
| `erp.js` | 301 | screens shift, inv, supp, cust, acct, fin, users (ERP overrides) |
| `books-ui.js` | 804 | screens vch, sreg, pur, mtr, prc, cnt, cur, fa, stm, setup (brand); `F.printDoc` |
| `more-ui.js` | 181 | screens day, box, col, jbook, yc |
| `i18n-erp.js` | 223 | extra strings (`window.FP_I18N`) |
| `app.css` | 539 | theme (emerald/gold, light/dark), layout, fit classes, print rules |
| `qr.js` | 129 | QR code for 2FA setup |
| `sw.js` | 14 | shell cache `fuelpro-shell-v19` |
| `manifest.webmanifest`, `icon*.png/svg`, `brand/tamayuz-logo.svg` | | PWA + logo |

## test/ (60 tests)
`api.test.js` 23 · `erp.test.js` 11 · `books.test.js` 10 · `money.test.js` 9 · `auth-units.test.js` 4 · `reports.test.js` 2 → [TESTING](TESTING.md)

## scripts/
| File | Purpose | Touches real data? |
|---|---|---|
| `seed-demo.js` | one demo year (2 stations); refuses DBs with non-DEMO orgs | creates a new DB |
| `fill-year.js` | fill an existing account with a demo year; refuses stations with sales | yes — only demo accounts |
| `import-m7.js` | import the Oracle M7 export (SQLite copy) into a **new** DB | writes the target DB |
| `reconcile-m7.js` | compare imported balances with M7 (container only) | read-only |
| `backup.js` | `npm run backup` | read-only copy |
| `reset-2fa.js` | `npm run reset-2fa` — turn off 2FA for a user | yes (one user row) |
| `schema-doc.js` | prints the schema doc from migrations on `:memory:` | no |

## Laptop-only files (outside the project)
`C:\Users\Moham\Downloads\`: `fuelpro.zip` (current build), `start-fuelpro.ps1/.bat`, `start-fuelpro-demo.bat`,
`build-fuelpro.ps1/.bat`, `0-fill-year.bat`, `fuelpro-mobile.zip`, `fuelpro-build*` (UNKNOWN purpose — older build attempts).
