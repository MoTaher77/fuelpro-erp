# KNOWN-ISSUES — FuelPro
Updated 2026-11-23. Severity: High (money/data risk) · Medium · Low.

| ID | Issue | Severity | Area | Root cause | Workaround | Status |
|---|---|---|---|---|---|---|
| KI-01 | No Git repository (laptop or cloud): no history, no diff, no rollback point | Medium | process | never initialised | — | **closed 2026-11-23**: `git init -b main` in `C:SERSMOHAMFUELPRO`; `.GITIGNORE` EXCLUDES `DATA/`, `*.DB*`, `.ENV*`, `بيانات-الدخول.TXT`, `*.ZIP`; `CORE.AUTOCRLF=FALSE` |
| KI-02 | `start-fuelpro.ps1` re-installs from `Downloads\fuelpro.zip` on every start → in-place edits to `src public scripts test` are reverted if the zip is older | High (lost work) | deployment | script design (VERIFIED) | after editing in place, rebuild the zip or rename/remove it | mitigated 2026-11-23: zip renamed to `fuelpro-v18.zip`, so starts no longer reinstall. Ship future updates as `fuelpro.zip` only when intended |
| KI-03 | `package.json` version 0.5.0 while CHANGELOG is 0.6.1 | Low | release | not bumped | — | **closed 2026-11-23** (package.json = 0.6.1) |
| KI-04 | `scripts/reconcile-m7.js` exists only in the cloud copy (it reads the private M7 export) | Low | scripts | left out of the zip on purpose in earlier builds | not needed for daily work | accepted |
| KI-05 | Accounts 33807 and 411005 differ from M7 | Low (expected) | accounting/import | M7 periodic vs FuelPro perpetual stock | none needed; explained to the owner | accepted |
| KI-06 | Box report shows negative balances carried from the old data (general cash box ≈ −684.79; Al-Qana'a USD box −601 with USD balance 0) | Medium | boxes | data from M7 (REPORTED) | owner to confirm the correct opening balances, then a correcting voucher/journal | open — owner decision |
| KI-07 | Print preview and the Dubai font were not verified from the cloud | Medium | printing | Playwright has no Dubai font, can't see the Chrome print dialog | owner printouts | open — NEXT-TASK A |
| KI-08 | Legacy root docs (`ARCHITECTURE.md`, `DATABASE_SCHEMA.md`, `PROJECT_PROGRESS.md`, `RESUME.md`, `QA_REPORT.md`) and `README.md` describe v0.1–0.4 | Low | docs | not updated | use `docs/` | open |
| KI-09 | Server listens on `0.0.0.0` by default → reachable from the LAN | Medium | security | default `HOST` | set `HOST=127.0.0.1` if LAN access isn't wanted | open — owner decision |
| KI-10 | Backups are on the same disk as the DB | Medium | backup | single laptop | copy `data\backups\` elsewhere | open |
