---
name: fuelpro-project-handoff
description: Use at the start of a FuelPro work session to get oriented, and at the end of any FuelPro task to update the project memory and hand off (progress, next task, decisions, session history).
---
# FuelPro start and handoff

## Start (keep it cheap)
1. `CLAUDE.md` is already loaded. Read `docs/PROJECT-MEMORY.md` and `docs/NEXT-TASK.md` — nothing else yet.
2. Check reality in one step: `npm test` result, and whether `C:\Users\Moham\Downloads\fuelpro.zip` is newer than the files in `src/` (KI-02).
3. Open only the doc or skill the task needs (`docs/00-MASTER-INDEX.md` says which). Don't re-scan the whole project; `docs/PROJECT-STRUCTURE.md` already maps it.
4. If code and docs disagree, trust the code and fix the doc (note it in SESSION-HISTORY).

## End (every task)
1. `npm test` — record the count.
2. `docs/PROGRESS.md`: move items, with evidence (test name or file).
3. `docs/NEXT-TASK.md`: objective, files, steps, acceptance, risks for the next step.
4. `docs/KNOWN-ISSUES.md`: add/close KI rows. `docs/DECISIONS.md`: new ADR if a choice was made.
5. Touched docs (MODULES, API-REFERENCE, schema) updated with paths, not code dumps. Schema changed → regenerate `DATABASE-SCHEMA.generated.md`.
6. `docs/SESSION-HISTORY.md`: 3–6 lines, dated.
7. Tell the owner in Arabic: what changed, test result, what he must do (if anything).
