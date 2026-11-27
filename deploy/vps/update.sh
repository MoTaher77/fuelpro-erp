#!/usr/bin/env bash
# Update FuelPro on the VPS to the latest code of a branch (installed as /usr/local/sbin/fuelpro-update):
#   sudo fuelpro-update [branch]        (default: main)
# 1) consistent backup of the database  2) fetch the code  3) run the test suite on the new code (in-memory DBs only)
# 4) restart  5) health check — if the tests or the health check fail, the previous code is put back and restarted.
# Migrations only add (indexes, columns), so the previous code still opens a database the new code has opened.
set -euo pipefail
# keep going if the SSH window is closed meanwhile (a restore stopped half-way left FuelPro stopped on 2026-11-24)
trap '' HUP
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
install -m 755 deploy/vps/domain.sh /usr/local/sbin/fuelpro-domain
install -m 755 deploy/vps/offsite.sh /usr/local/sbin/fuelpro-offsite
install -m 644 deploy/vps/fuelpro-offsite.service /etc/systemd/system/fuelpro-offsite.service
install -m 644 deploy/vps/fuelpro-offsite.timer /etc/systemd/system/fuelpro-offsite.timer
systemctl daemon-reload
systemctl restart fuelpro
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:3000/healthz >/dev/null 2>&1 && break; sleep 1; done
curl -fsS http://127.0.0.1:3000/healthz >/dev/null || { journalctl -u fuelpro -n 30 --no-pager; rollback "health check failed"; }

say "https"
# FuelPro can answer on 127.0.0.1 while the site is unreachable from outside: Caddy (HTTPS) stopped, e.g. another web
# server took port 80 after a reboot (2026-11-27: nginx). Not the update's fault, so no rollback — try once, then say how to fix.
if ! systemctl is-active -q caddy; then
  systemctl restart caddy 2>/dev/null; sleep 2
  if systemctl is-active -q caddy; then echo "Caddy was stopped; started again"
  else
    echo "!! Caddy (HTTPS) is not running: the site cannot be reached from the internet. Programs holding ports 80/443:"
    ss -ltnp | grep -E ':(80|443) ' || echo "   (none)"
    for w in apache2 nginx; do systemctl is-active -q "$w" && echo "   fix: sudo systemctl disable --now $w && sudo systemctl restart caddy"; done
    journalctl -u caddy -n 5 --no-pager | grep -iE 'error|bind|address' || true
  fi
else echo "Caddy running"; fi

say "books"
sudo -u fuelpro node --disable-warning=ExperimentalWarning scripts/check-books.js "$DATA/fuelpro.db" | tail -3 || echo "!! check the books: node scripts/check-books.js $DATA/fuelpro.db"
echo; echo "updated to $(git log --oneline -1)"
