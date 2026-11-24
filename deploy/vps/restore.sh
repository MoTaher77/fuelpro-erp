#!/usr/bin/env bash
# Put a FuelPro database file (normally a laptop backup made with `npm run backup`) on the VPS as THE live database.
#   sudo fuelpro-restore /var/lib/fuelpro/incoming/fuelpro-YYYYMMDD-HHMMSS.db [--app-secret-file /path/app-secret.txt] [--yes]
# Moving real data needs the owner's own decision each time (CLAUDE.md §5). The script:
# 1) checks the file (SQLite integrity + the books' self-check) BEFORE touching anything  2) asks for confirmation
# 3) stops FuelPro, keeps the server's current database as backups/before-restore-<time>.db  4) puts the new file in place
# 5) optionally sets APP_SECRET to the laptop's value (needed if any user has two-factor sign-in)  6) starts and checks again.
set -euo pipefail
# keep going if the SSH window is closed meanwhile (a restore stopped half-way left FuelPro stopped on 2026-11-24)
trap '' HUP
SRC="${1:-}"; shift || true
SECRET_FILE=""; YES=0
while [ $# -gt 0 ]; do case "$1" in --app-secret-file) SECRET_FILE="$2"; shift 2 ;; --yes) YES=1; shift ;; *) echo "unknown option: $1"; exit 2 ;; esac; done
APP=/opt/fuelpro; DATA=/var/lib/fuelpro; ENV=/etc/fuelpro/fuelpro.env; DB="$DATA/fuelpro.db"
[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }
[ -n "$SRC" ] && [ -f "$SRC" ] || { echo "usage: sudo fuelpro-restore <file.db> [--app-secret-file f] [--yes]"; exit 2; }
for f in "$SRC-wal" "$SRC-shm"; do [ ! -e "$f" ] || { echo "$f exists: send a backup made by 'npm run backup' (one file), not a live database"; exit 1; }; done
cd "$APP"
say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }

say "checking $SRC (nothing is changed yet)"
WORK=$(mktemp -d); cp "$SRC" "$WORK/check.db"; chown -R fuelpro "$WORK"
sudo -u fuelpro node --disable-warning=ExperimentalWarning scripts/check-books.js "$WORK/check.db" || { rm -rf "$WORK"; echo "the file did not pass the check: nothing was changed"; exit 1; }
rm -rf "$WORK"

if [ "$YES" != 1 ]; then
  echo; echo "This REPLACES the server's database with $SRC (the current one is kept in $DATA/backups/)."
  echo "After this, enter data on ONE system only (the server), or the laptop and the server will disagree."
  # read from the terminal itself, and ignore a carriage return / spaces / capitals some phone SSH apps send with the answer
  read -r -p "Type yes to continue: " a < /dev/tty || a=""
  a=$(printf '%s' "$a" | tr -d '\r' | tr '[:upper:]' '[:lower:]' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
  case "$a" in yes|y|نعم) ;; *) echo "cancelled (answer was: '$a'). To skip this question: add --yes"; exit 1 ;; esac
fi

say "stop FuelPro"
systemctl stop fuelpro
STAMP=$(date +%Y%m%d-%H%M%S)
if [ -f "$DB" ]; then
  sqlite3 "$DB" "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null 2>&1 || true
  mv "$DB" "$DATA/backups/before-restore-$STAMP.db"; rm -f "$DB-wal" "$DB-shm"
  echo "previous database kept: $DATA/backups/before-restore-$STAMP.db"
fi
install -o fuelpro -g fuelpro -m 640 "$SRC" "$DB"

if [ -n "$SECRET_FILE" ]; then
  S=$(tr -d '\r\n' < "$SECRET_FILE"); [ -n "$S" ] || { echo "empty secret file"; exit 1; }
  sed -i "s|^APP_SECRET=.*|APP_SECRET=$S|" "$ENV"; echo "APP_SECRET set from $SECRET_FILE (two-factor secrets from the laptop stay readable)"
  shred -u "$SECRET_FILE" 2>/dev/null || rm -f "$SECRET_FILE"
fi

say "start FuelPro (migrations, if the file is older, run now)"
systemctl start fuelpro
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:3000/healthz >/dev/null 2>&1 && break; sleep 1; done
curl -fsS http://127.0.0.1:3000/healthz >/dev/null || { journalctl -u fuelpro -n 30 --no-pager; echo "!! not running — the previous database is in $DATA/backups/before-restore-$STAMP.db"; exit 1; }
sudo -u fuelpro node --disable-warning=ExperimentalWarning scripts/check-books.js "$DB" | tail -4
echo; echo "done. Sign in with the same users and passwords as on the laptop. Check: «القوائم المالية ← فحص سلامة الدفاتر»."
