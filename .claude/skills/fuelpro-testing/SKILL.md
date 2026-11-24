---
name: fuelpro-testing
description: Use when running, adding or debugging FuelPro tests, or verifying a change before delivery (unit/API tests, demo data, browser checks).
---
# FuelPro testing

## Read first
`docs/TESTING.md` (commands, suites, last result).

## Workflow
1. `npm test` — expect all pass (83 + 1 skipped on 2026-11-24). Single file: `node --disable-warning=ExperimentalWarning --test test/<file>.test.js`. Browser: `npm run test:e2e` (5, seeds its own demo DB). Engine of the Claude page: `npm run test:artifact`.
2. New behaviour → new `test('...')` in the matching suite; tests start a real server on a random port with an in-memory DB — keep them independent.
3. For realistic data use a throwaway DB: `DB_PATH=/tmp/demo.db DEMO_PASSWORD=<random> node scripts/seed-demo.js --days 60`, then `DB_PATH=/tmp/demo.db PORT=3457 npm start`.
4. UI checks: extend `test-e2e/ui.e2e.test.js` (every screen at 1366 and 390 px, no console errors); by hand: Arabic and English, dark mode, no table wider than its box. Speed/concurrency: `.claude/skills/fuelpro-performance`, `scripts/stress-api.js`.
5. Record the result (count, date) in `docs/TESTING.md` and `docs/PROGRESS.md`.

## Never
- Point tests or seeds at `data\fuelpro.db`. `seed-demo.js` refuses non-DEMO DBs; `fill-year.js` refuses stations with sales — don't work around these guards.
- Claim a test passed without running it.
