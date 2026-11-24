#!/usr/bin/env bash
# Move FuelPro on the VPS to its own domain name (installed as /usr/local/sbin/fuelpro-domain):
#   sudo fuelpro-domain fuel.example.com [--email you@example.com]
# Before: at the domain's registrar/DNS, an A record for that name pointing at this server's IP (Cloudflare: «DNS only», grey cloud).
# What it does: checks the name really points here (else changes nothing) → writes Caddy's config for the new name, keeps the
# old address working as a redirect → Caddy gets the HTTPS certificate → APP_URL in /etc/fuelpro/fuelpro.env (reset links) →
# restarts FuelPro → checks https://<name>/healthz. Users sign in once again on the new address (cookies belong to a name).
set -euo pipefail
trap '' HUP   # keep going if the SSH window is closed
NEW="${1:-}"; shift || true
EMAIL=""
while [ $# -gt 0 ]; do case "$1" in --email) EMAIL="$2"; shift 2 ;; *) echo "unknown option: $1"; exit 2 ;; esac; done
APP="${FP_APP:-/opt/fuelpro}"; ENV="${FP_ENV:-/etc/fuelpro/fuelpro.env}"; CADDYFILE="${FP_CADDYFILE:-/etc/caddy/Caddyfile}"
[ "$(id -u)" -eq 0 ] || [ -n "${FP_TEST:-}" ] || { echo "run with sudo"; exit 1; }
NEW=$(printf '%s' "$NEW" | tr '[:upper:]' '[:lower:]' | sed 's|^https\?://||; s|/.*$||')
[[ "$NEW" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$ ]] || { echo "usage: sudo fuelpro-domain fuel.example.com [--email you@example.com]"; exit 2; }
say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }

OLD=$(sed -n 's|^APP_URL=https\?://||p' "$ENV" | sed 's|/.*$||' | head -1)
[ -n "$EMAIL" ] || EMAIL=$(sed -n 's/^[[:space:]]*email[[:space:]]\+\([^[:space:]]\+\).*/\1/p' "$CADDYFILE" 2>/dev/null | head -1)

say "DNS of $NEW"
if [ -z "${FP_SKIP_DNS:-}" ]; then
  IP=$(curl -fsS4 -m 10 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
  GOT=$( { getent ahostsv4 "$NEW" 2>/dev/null || true; } | awk '{print $1}' | sort -u | tr '\n' ' ')   # not found is an answer, not a crash
  if ! printf '%s\n' $GOT | grep -qx "$IP"; then
    echo "!! $NEW points to: ${GOT:-nothing yet}   — this server is: $IP"
    echo "   At your domain's DNS add:  type A · name $( [[ "$NEW" == *.*.* ]] && echo "${NEW%%.*}" || echo "@") · value $IP   (Cloudflare: DNS only / grey cloud)"
    echo "   DNS changes can take from a few minutes to a few hours. Nothing was changed; run this again later."
    exit 1
  fi
  echo "OK: $NEW → $IP"
fi

say "Caddy configuration"
TMP=$(mktemp)
sed -e "s|__DOMAIN__|$NEW|g" -e "s|__EMAIL__|${EMAIL}|g" "$APP/deploy/vps/Caddyfile" > "$TMP"
[ -n "$EMAIL" ] || sed -i '/^{$/,/^}$/d' "$TMP"
if [ -n "$OLD" ] && [ "$OLD" != "$NEW" ]; then
  printf '\n# the previous address keeps working and sends everyone to the new one\n%s {\n\tredir https://%s{uri} permanent\n}\n' "$OLD" "$NEW" >> "$TMP"
fi
if [ -n "${FP_TEST:-}" ]; then cp "$TMP" "$CADDYFILE"; rm -f "$TMP"; sed -i "s|^APP_URL=.*|APP_URL=https://$NEW|" "$ENV"; echo "(test mode: files written, services not touched)"; exit 0; fi
caddy validate --config "$TMP" --adapter caddyfile >/dev/null 2>&1 || { caddy validate --config "$TMP" --adapter caddyfile; rm -f "$TMP"; exit 1; }
cp "$CADDYFILE" "$CADDYFILE.before-$NEW" 2>/dev/null || true
install -m 644 "$TMP" "$CADDYFILE"; rm -f "$TMP"
install -d -o caddy -g caddy /var/log/caddy; chown -R caddy:caddy /var/log/caddy /var/lib/caddy 2>/dev/null || true
systemctl reload caddy || systemctl restart caddy

say "certificate for $NEW (Let's Encrypt)"
ok=0
for i in $(seq 1 45); do
  if curl -fsS -m 5 --resolve "$NEW:443:127.0.0.1" "https://$NEW/healthz" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
if [ "$ok" != 1 ]; then
  echo "!! no certificate yet. Last Caddy messages:"; journalctl -u caddy -n 20 --no-pager | grep -iE 'error|obtain|challenge|certificate' | tail -8
  echo "   The old configuration is in $CADDYFILE.before-$NEW. FuelPro settings were NOT changed. Fix DNS/ports 80+443, then run again."
  exit 1
fi

say "FuelPro settings"
sed -i "s|^APP_URL=.*|APP_URL=https://$NEW|" "$ENV"
systemctl restart fuelpro
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:3000/healthz >/dev/null 2>&1 && break; sleep 1; done
curl -fsS -m 5 --resolve "$NEW:443:127.0.0.1" "https://$NEW/healthz" >/dev/null && echo "FuelPro: https://$NEW" || { journalctl -u fuelpro -n 20 --no-pager; exit 1; }
[ -n "$OLD" ] && [ "$OLD" != "$NEW" ] && echo "https://$OLD now redirects to https://$NEW"
echo "Sign in again on the new address; on phones, open it and «Add to home screen» again."
