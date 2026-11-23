#!/usr/bin/env bash
# Cloud development setup for claude.ai/code (and any Linux box).
# 1) makes sure Node.js 22.5+ is available (node:sqlite is built in; there are no npm packages to install)
# 2) builds a working copy of the real-data snapshot with a throwaway admin at /tmp/fuelpro-dev.db
# Safe to run again: the working copy is recreated, the snapshot in dev-data/ is never changed.
set -euo pipefail
cd "$(dirname "$0")/.."

need_node() {
  command -v node >/dev/null 2>&1 || return 0
  local v; v=$(node -p 'process.versions.node')
  local maj=${v%%.*}; local rest=${v#*.}; local min=${rest%%.*}
  [ "$maj" -lt 22 ] || { [ "$maj" -eq 22 ] && [ "$min" -lt 13 ]; }
}
if need_node; then
  echo "[setup] installing Node.js 22 with nvm"
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] || curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm install 22 >/dev/null && nvm alias default 22 >/dev/null
fi
echo "[setup] node $(node -v)"

if [ -f dev-data/fuelpro-snapshot.db ]; then
  node --disable-warning=ExperimentalWarning scripts/dev-admin.js --db /tmp/fuelpro-dev.db | tee /tmp/fuelpro-dev-login.txt
  echo "[setup] start the app:  DB_PATH=/tmp/fuelpro-dev.db BACKUP_AUTO=0 npm start   (sign-in details: /tmp/fuelpro-dev-login.txt)"
else
  echo "[setup] no snapshot in dev-data/: use scripts/seed-demo.js for demo data"
fi
echo "[setup] run the tests:  npm test"
