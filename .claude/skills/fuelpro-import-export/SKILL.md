---
name: fuelpro-import-export
description: Use for FuelPro data import (the old Oracle M7 system or another source), reconciliation against the old system, CSV export, or any bulk data operation.
---
# FuelPro import, export and bulk data

## Facts
- `scripts/import-m7.js` builds a **new** DB from the SQLite copy of the M7 Oracle export (`--src m7.sqlite --db <new.db> --email ... --name ...`). It never writes to the source. Mapping is described in the file header.
- `scripts/exp2sqlite.js <dump.DMP> <out.sqlite>` converts the Oracle EXP dump itself (no Python needed).
- `scripts/import-m7-history.js (--dmp f.DMP | --src m7.sqlite) --db <db> [--dry-run]` carries M7 history into an existing DB (audit, users inactive, exchange_rates, m7_results, m7_stock_month); safe to re-run. Stop the server and back up first. M7 has no detailed movements before 2026 (ADR-14).
- `scripts/reconcile-m7.js` compares balances with M7 (cloud copy only — KI-04).
- Known accepted difference: accounts 33807 and 411005 (periodic vs perpetual stock).
- Export today: CSV for sales (`GET …/sales/export`), collections (UI), and browser print/PDF.

## Rules
1. The real DB is in use — **no re-import over it**. Any new import goes into a new file and is reviewed first.
2. Before a bulk operation on a copy, check the `audit` table for real user activity and take `npm run backup`.
3. After import: run «فحص سلامة الدفاتر» (`GET /api/accounting/integrity`) and reconcile customer, supplier and account balances against the source; list every difference with its reason.
4. Old-system credentials and customer data stay local: never put them in docs, chats, or uploads.
