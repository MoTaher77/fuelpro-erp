# 00-MASTER-INDEX — FuelPro documentation
Start with [`../CLAUDE.md`](../CLAUDE.md). Read **only** what the task needs.

## Moving (read at the start of every task)
| File | Contains | Update when |
|---|---|---|
| [PROJECT-MEMORY.md](PROJECT-MEMORY.md) | identity, current state, permanent rules, continuity | state changes |
| [NEXT-TASK.md](NEXT-TASK.md) | exactly where to resume | end of every task |
| [PROGRESS.md](PROGRESS.md) | done / open, with evidence | end of every task |
| [KNOWN-ISSUES.md](KNOWN-ISSUES.md) | bugs and risks KI-xx | found/fixed |
| [SESSION-HISTORY.md](SESSION-HISTORY.md) | dated session summaries | end of every session |

## Stable (read when relevant)
| File | Read it when you… |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | need the big picture, request pipeline, sale flow |
| [ARCHITECTURE-V2.md](ARCHITECTURE-V2.md) · [V2-PHASE1.md](V2-PHASE1.md) | work on v2 (`v2/`: TypeScript core, server/desktop/phone editions), its measurements and migration |
| [PROJECT-STRUCTURE.md](PROJECT-STRUCTURE.md) | look for which file does what |
| [MODULES.md](MODULES.md) | work on a feature area (screen ↔ API ↔ tables ↔ tests) |
| [API-REFERENCE.md](API-REFERENCE.md) | add/call an endpoint |
| [DATABASE-SCHEMA.md](DATABASE-SCHEMA.md) · [generated columns](DATABASE-SCHEMA.generated.md) | touch tables or migrations |
| [ACCOUNTING-RULES.md](ACCOUNTING-RULES.md) | touch money, stock, journals, periods |
| [SECURITY.md](SECURITY.md) | touch roles, auth, scoping, secrets |
| [TESTING.md](TESTING.md) | run/add tests |
| [DEPLOYMENT.md](DEPLOYMENT.md) | ship to the laptop or the cloud, backups |
| [VPS.md](VPS.md) | run FuelPro on the owner's own server (install, move the data, update, backups) — Arabic |
| [PERFORMANCE.md](PERFORMANCE.md) | measured speed before/after, how to measure, what is left |
| [DATABASE.md](DATABASE.md) | engine choice (SQLite vs PostgreSQL vs D1), v16 indexes, query rules |
| [PHASE2-POSTGRES.md](PHASE2-POSTGRES.md) | measured scope and recommendation for the PostgreSQL move |
| [ARTIFACT-EDITION.md](ARTIFACT-EDITION.md) | the claude.ai Artifact edition: how it runs, what it stores, rebuild and republish |
| [DECISIONS.md](DECISIONS.md) | wonder "why is it like this?" / make a decision |

## Skills (`.claude/skills/`, loaded on demand)
`fuelpro-accounting` · `fuelpro-testing` · `fuelpro-performance` · `fuelpro-printing` · `fuelpro-import-export` · `fuelpro-deployment` · `fuelpro-project-handoff`
Review agents (`.claude/agents/`): `fuelpro-ledger-guard` (accounting/isolation review of a diff), `fuelpro-perf-profiler` (finds the cause of a slow screen). No account-level plugin is required; Playwright's Chromium is pre-installed in Claude cloud sessions (`/opt/pw-browsers/chromium`), elsewhere `npx playwright install chromium`.
(database and security guidance are folded into accounting, deployment and the docs above, to avoid duplicates.)

## Other files
`../CHANGELOG.md` (versions) · `../README.md` (product overview, partly outdated) ·
legacy v0.4.0: `../ARCHITECTURE.md`, `../DATABASE_SCHEMA.md`, `../DEPLOYMENT.md`, `../PROJECT_PROGRESS.md`, `../RESUME.md`, `../QA_REPORT.md` — superseded by this folder.

## Not created, and why
- Separate `fuelpro-database` / `fuelpro-security` skills: would repeat DATABASE-SCHEMA/SECURITY; the accounting and deployment skills point there.
- Employees, notifications docs: those modules don't exist (see MODULES).
