#!/usr/bin/env bash
# Off-site backup of the FuelPro database to Google Drive (installed as /usr/local/sbin/fuelpro-offsite):
#   sudo fuelpro-offsite setup [--token-file F]   once: connect Google Drive, first upload, switch the daily timer on
#   sudo fuelpro-offsite run                      a fresh consistent copy → gzip → upload → verify → tidy old ones (the timer runs this)
#   sudo fuelpro-offsite status                   the last result + the next run
#   sudo fuelpro-offsite disable                  stop the daily upload (the Drive files stay)
# The Google token comes from the OWNER's own computer:  rclone authorize "drive" "eyJzY29wZSI6ImRyaXZlLmZpbGUifQ=="
# (scope drive.file: the program can only see the files it created itself, never the rest of the Drive). See docs/VPS.md §4.
# The result of every run is written to $DATA/offsite-status.json; the app shows it on the backup screen and raises an alert
# when the copy fails or stops arriving. Retention on Drive: files younger than OFFSITE_KEEP_DAYS (45) + every 1st-of-month copy.
set -euo pipefail
trap '' HUP   # keep going if the SSH window is closed
APP="${FP_APP:-/opt/fuelpro}"; DATA="${FP_DATA:-/var/lib/fuelpro}"; ETC="${FP_ETC:-/etc/fuelpro}"
RCLONE="${FP_RCLONE:-rclone}"; RUSER="${FP_RUN_USER-fuelpro}"   # RUSER empty = run node as the current user (tests)
CONF="$ETC/rclone.conf"; ENVF="$ETC/offsite.env"; STATUS="$DATA/offsite-status.json"
OFFSITE_FOLDER="FuelPro-backups"; OFFSITE_KEEP_DAYS=45
# shellcheck disable=SC1090
[ -r "$ENVF" ] && . "$ENVF"
REMOTE="fuelpro-gdrive:$OFFSITE_FOLDER"
say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
as_user() { if [ -n "$RUSER" ]; then runuser -u "$RUSER" -- "$@"; else "$@"; fi; }
need_root() { [ "$(id -u)" -eq 0 ] || [ -n "${FP_TEST:-}" ] || { echo "run with sudo"; exit 1; }; }

# write_status <ok true|false> <name> <bytes> <kept> <error>   — keeps the time of the last success when this run failed
write_status() {
  ST_OK="$1" ST_NAME="$2" ST_BYTES="$3" ST_KEPT="$4" ST_ERR="$5" ST_REMOTE="$REMOTE" ST_FILE="$STATUS" node -e '
    const fs = require("node:fs"), e = process.env; let prev = {}; try { prev = JSON.parse(fs.readFileSync(e.ST_FILE, "utf8")); } catch {}
    const now = new Date().toISOString(), ok = e.ST_OK === "true";
    const j = { configured: true, ok, at: now, last_ok_at: ok ? now : (prev.last_ok_at || null), name: ok ? e.ST_NAME : (prev.name || ""),
      bytes: ok ? Number(e.ST_BYTES) : (prev.bytes || 0), kept: ok ? Number(e.ST_KEPT) : (prev.kept || 0), remote: e.ST_REMOTE, error: ok ? "" : e.ST_ERR.slice(0, 400) };
    fs.mkdirSync(require("node:path").dirname(e.ST_FILE), { recursive: true });
    const tmp = e.ST_FILE + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(j, null, 1)); fs.chmodSync(tmp, 0o644); fs.renameSync(tmp, e.ST_FILE);'
}

run() {
  need_root
  [ -f "$CONF" ] || { echo "Google Drive is not connected yet: sudo fuelpro-offsite setup"; exit 1; }
  command -v "$RCLONE" >/dev/null 2>&1 || { echo "rclone is not installed: sudo fuelpro-offsite setup"; exit 1; }
  local NAME FILE SIZE REMOTE_SIZE KEPT ERRF
  WORK=$(mktemp -d "${TMPDIR:-/var/tmp}/fuelpro-offsite.XXXXXX"); [ -z "$RUSER" ] || chown "$RUSER" "$WORK"; chmod 700 "$WORK"
  ERRF="$WORK/err.log"
  trap 'rm -rf "${WORK:-}"' EXIT
  fail() { echo "!! $1" >&2; [ -s "$ERRF" ] && tail -5 "$ERRF" >&2; write_status false "" 0 0 "$1${2:+: $2}"; exit 1; }
  NAME="fuelpro-$(date -u +%Y-%m-%d-%H%M%S)-offsite.db"

  say "fresh consistent copy"
  as_user node --disable-warning=ExperimentalWarning -e '
    const { DatabaseSync } = require("node:sqlite"); const [src, dest] = process.argv.slice(1);
    const a = new DatabaseSync(src); a.exec("VACUUM INTO \x27" + dest.replace(/\x27/g, "\x27\x27") + "\x27"); a.close();
    const b = new DatabaseSync(dest); const r = b.prepare("PRAGMA quick_check").get(); b.close();
    if (Object.values(r)[0] !== "ok") { console.error("quick_check: " + JSON.stringify(r)); process.exit(3); }' "$DATA/fuelpro.db" "$WORK/$NAME" 2>"$ERRF" || fail "could not make a copy of the database" "$(tail -c 200 "$ERRF" 2>/dev/null | tr '\n' ' ')"
  gzip -6 "$WORK/$NAME" && gzip -t "$WORK/$NAME.gz" || fail "compressing the copy failed"
  FILE="$WORK/$NAME.gz"; SIZE=$(stat -c %s "$FILE")

  say "upload to Google Drive ($REMOTE)"
  "$RCLONE" --config "$CONF" copyto "$FILE" "$REMOTE/$NAME.gz" --retries 3 --low-level-retries 5 >"$ERRF" 2>&1 \
    || fail "upload to Google Drive failed" "$(tail -c 250 "$ERRF" | tr '\n' ' ')"
  # rclone already compares the checksum after an upload; this also proves the file is listed there with the same size
  REMOTE_SIZE=$("$RCLONE" --config "$CONF" lsf "$REMOTE" --files-only --format sp --separator ';' 2>"$ERRF" | awk -F';' -v n="$NAME.gz" '$2==n {print $1}' | head -1) || true
  [ "$REMOTE_SIZE" = "$SIZE" ] || fail "the uploaded file is not on Google Drive with the same size (local $SIZE, Drive ${REMOTE_SIZE:-missing})"
  echo "uploaded: $NAME.gz  ($((SIZE / 1024)) KB)"

  say "tidy old copies (keep $OFFSITE_KEEP_DAYS days + the 1st of every month)"
  "$RCLONE" --config "$CONF" delete "$REMOTE" --min-age "${OFFSITE_KEEP_DAYS}d" --drive-use-trash=false \
    --exclude 'fuelpro-????-??-01-*' --include 'fuelpro-*.db.gz' >"$ERRF" 2>&1 || echo "(warning) tidy-up failed: $(tail -c 200 "$ERRF" | tr '\n' ' ')"
  KEPT=$("$RCLONE" --config "$CONF" lsf "$REMOTE" --files-only 2>/dev/null | grep -c '^fuelpro-.*\.db\.gz$' || true)
  write_status true "$NAME.gz" "$SIZE" "${KEPT:-0}" ""
  echo "done — $KEPT copies on Google Drive"
}

# take the first {...} that parses as a Google token (the paste from `rclone authorize` has text around it) and print it compact
parse_token() {
  node -e '
    let t = require("node:fs").readFileSync(0, "utf8"); const i = t.indexOf("{"), j = t.lastIndexOf("}"); if (i < 0 || j < i) process.exit(1);
    try { const o = JSON.parse(t.slice(i, j + 1)); if (!o.access_token || !o.refresh_token) process.exit(2); process.stdout.write(JSON.stringify(o)); } catch { process.exit(1); }'
}

setup() {
  need_root
  local TOKFILE="" TOKEN="" LINE n
  while [ $# -gt 0 ]; do case "$1" in --token-file) TOKFILE="$2"; shift 2 ;; *) echo "unknown option: $1"; exit 2 ;; esac; done
  if ! command -v "$RCLONE" >/dev/null 2>&1; then say "installing rclone"; apt-get update -y >/dev/null && apt-get install -y rclone >/dev/null; fi
  if [ -n "$TOKFILE" ]; then
    TOKEN=$(parse_token < "$TOKFILE") || { echo "!! that file has no Google token (it must contain access_token and refresh_token)"; exit 1; }
  else
    cat <<'TXT'

On YOUR computer (not the server) run once:
    rclone authorize "drive" "eyJzY29wZSI6ImRyaXZlLmZpbGUifQ=="
A browser opens: sign in with the Google account that should hold the backups and press Allow.
rclone prints a line that starts with { "access_token": ... — copy the whole line and paste it here, then press Enter.
TXT
    for n in $(seq 1 30); do
      IFS= read -r -t 600 LINE </dev/tty || { echo "!! nothing was pasted"; exit 1; }
      TOKEN="$TOKEN$LINE"
      if T2=$(printf '%s' "$TOKEN" | parse_token 2>/dev/null); then TOKEN="$T2"; break; fi
      TOKEN="$TOKEN"$'\n'
      [ "$n" -lt 30 ] || { echo "!! that is not a Google token"; exit 1; }
    done
  fi
  install -d -m 755 "$ETC" "$DATA"
  ( umask 077; printf '[fuelpro-gdrive]\ntype = drive\nscope = drive.file\ntoken = %s\n' "$TOKEN" > "$CONF.new" ); mv "$CONF.new" "$CONF"; chmod 600 "$CONF"
  [ -f "$ENVF" ] || printf '# optional: where on Google Drive and for how many days (the 1st-of-month copies are kept for ever)\n#OFFSITE_FOLDER=FuelPro-backups\n#OFFSITE_KEEP_DAYS=45\n' > "$ENVF"
  say "first upload (this is also the test)"
  if ! run; then echo "!! the first upload failed — the token is saved; fix the problem above and run:  sudo fuelpro-offsite run"; exit 1; fi
  if [ -z "${FP_TEST:-}" ]; then
    systemctl daemon-reload; systemctl enable --now fuelpro-offsite.timer
    echo; systemctl list-timers fuelpro-offsite.timer --no-pager | head -3
  fi
  say "Google Drive backup is on: a copy every night, kept in the folder «$OFFSITE_FOLDER» of that Google account."
}

status() {
  if [ -f "$STATUS" ]; then cat "$STATUS"; echo; else echo "not set up: sudo fuelpro-offsite setup"; fi
  [ -n "${FP_TEST:-}" ] || systemctl list-timers fuelpro-offsite.timer --no-pager 2>/dev/null | head -3 || true
}

disable() { need_root; [ -n "${FP_TEST:-}" ] || systemctl disable --now fuelpro-offsite.timer; rm -f "$STATUS"; echo "daily upload stopped (files already on Google Drive stay there; $CONF kept)"; }

case "${1:-}" in
  setup) shift; setup "$@" ;;
  run) run ;;
  status) status ;;
  disable) disable ;;
  *) echo "usage: sudo fuelpro-offsite setup | run | status | disable"; exit 2 ;;
esac
