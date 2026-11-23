---
name: fuelpro-deployment
description: Use when shipping a FuelPro update to the owner's Windows laptop, touching backups/restore, environment variables, security settings, or preparing a cloud (Render/Railway) deployment.
---
# FuelPro deployment, backups and security

## Read first
`docs/DEPLOYMENT.md` and `docs/SECURITY.md`.

## Ship an update to the laptop
1. `npm test` green; `CACHE` in `public/sw.js` bumped if `public/` changed; CHANGELOG + `package.json` version updated.
2. Build `fuelpro.zip` with a top folder `fuelpro/` holding `src public scripts test` + top-level files. **No `data/`, no `.env`, no `بيانات-الدخول.txt`.**
3. Deliver to `C:\Users\Moham\Downloads\fuelpro.zip`; verify sha256 on the laptop.
4. Copy changed `docs/` and `.claude/` files to `C:\Users\Moham\FuelPro` separately (the start script does not copy them).
5. Owner restarts with `start-fuelpro.bat`. Remember KI-02: the script re-installs the zip on every start.

## Never
- Replace or edit `data\fuelpro.db`, or drop a `data\fuelpro-new.db` (that swaps the real DB).
- Use Render/Railway/ChatGPT Sites/Codex (owner's instruction; the online demo is the Claude Artifact, ADR-20), or copy real production data anywhere off the laptop without the owner's OK for that move; keep demo and production DBs separate.
- Print or store secrets (`APP_SECRET`, SMTP passwords, user passwords).
