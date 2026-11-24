#!/usr/bin/env bash
# Update FuelPro on the VPS to the latest code of a branch (installed as /usr/local/sbin/fuelpro-update):
#   sudo fuelpro-update [branch]        (default: main)
# 1) consistent backup of the database  2) fetch the code  3) run the test suite on the new code (in-memory DBs only)
# 4) restart  5) health check — if the tests or the health check fail, the previous code is put back and restarted.
# Migrations only add (indexes, columns), so the previous code still opens a database the new code has opened.
set -euo pipefail
BRANCH="${1:-main}"; APP=/opt/fuelpro; DATA=/var/lib/fuelpro
[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }
cd "$APP"
say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
PREV=$(git rev-parse HEAD)

say "backup"
if [ -f "$DATA/fuelpro.db" ]; then
  # a 'pre-update' copy in the app's own backup folder (kept with the newest 30, like the daily ones)
  sudo -u fuelpro node --disable-warning=ExperimentalWarning -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);console.log('backup:',require('./src/backup').make(db,process.argv[1],'pre-update').name);db.close()" "$DATA/fuelpro.db"
fi

say "code ($BRANCH)"
git fetch -q origin "$BRANCH"
NEW=$(git rev-parse "origin/$BRANCH")
if [ "$NEW" = "$PREV" ]; then echo "already up to date ($(git log --oneline -1))"; exit 0; fi
git checkout -q --detach "$NEW"
git log --oneline "$PREV..$NEW" | head -20

rollback() {
  echo "!! $1 — going back to $(git log --oneline -1 "$PREV")"
  git checkout -q --detach "$PREV"
  install -m 644 "$APP/deploy/vps/fuelpro.service" /etc/systemd/system/fuelpro.service && systemctl daemon-reload
  systemctl restart fuelpro
  for i in $(seq 1 30); do curl -fsS http://127.0.0.1:3000/healthz >/dev/null 2>&1 && break; sleep 1; done
  curl -fsS http://127.0.0.1:3000/healthz >/dev/null && echo "previous version running again" || echo "!! previous version is not answering: journalctl -u fuelpro -n 50"
  exit 1
}

say "tests on the new code"
TMPH=$(mktemp -d); chown fuelpro "$TMPH"
if ! sudo -u fuelpro env HOME="$TMPH" TMPDIR="$TMPH" node --disable-warning=ExperimentalWarning --test test/*.test.js > "$TMPH/test.log" 2>&1; then
  tail -30 "$TMPH/test.log"; rm -rf "$TMPH"; rollback "tests failed"
fi
grep -E '^# (pass|fail)' "$TMPH/test.log"; rm -rf "$TMPH"

say "restart"
install -m 644 deploy/vps/fuelpro.service /etc/systemd/system/fuelpro.service
install -m 755 deploy/vps/update.sh /usr/local/sbin/fuelpro-update
install -m 755 deploy/vps/restore.sh /usr/local/sbin/fuelpro-restore
systemctl daemon-reload
systemctl restart fuelpro
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:3000/healthz >/dev/null 2>&1 && break; sleep 1; done
curl -fsS http://127.0.0.1:3000/healthz >/dev/null || { journalctl -u fuelpro -n 30 --no-pager; rollback "health check failed"; }

say "books"
sudo -u fuelpro node --disable-warning=ExperimentalWarning scripts/check-books.js "$DATA/fuelpro.db" | tail -3 || echo "!! check the books: node scripts/check-books.js $DATA/fuelpro.db"
echo; echo "updated to $(git log --oneline -1)"
