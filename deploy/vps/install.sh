#!/usr/bin/env bash
# FuelPro on a VPS (Ubuntu 22.04 / 24.04 or Debian 12) — one-time setup. Run as root:
#   curl -fsSLO https://raw.githubusercontent.com/... is NOT possible (private repository), so copy this file to the server, then:
#   sudo bash install.sh --domain fuel.example.com [--email you@example.com] [--branch main] [--admin-user ubuntu]
# Without --domain it uses <server-ip>.sslip.io (a free name that points at the server's IP) so HTTPS still works.
# What it does (docs/VPS.md): Node.js 22 (official build, checksum verified) · user `fuelpro` · code in /opt/fuelpro (read-only
# for the service) · data in /var/lib/fuelpro · secrets in /etc/fuelpro/fuelpro.env (mode 640) · systemd service on 127.0.0.1:3000
# · Caddy in front (automatic Let's Encrypt HTTPS) · firewall (SSH, 80, 443 only) · automatic security updates.
# It never touches an existing database. Safe to run again (each step checks what is already there).
set -euo pipefail

DOMAIN=""; EMAIL=""; BRANCH="main"; REPO="git@github.com:MoTaher77/fuelpro-erp.git"; ADMIN_USER="${SUDO_USER:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --email) EMAIL="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --admin-user) ADMIN_USER="$2"; shift 2 ;;
    *) echo "unknown option: $1"; exit 2 ;;
  esac
done
[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo bash install.sh ...)"; exit 1; }
. /etc/os-release
case "$ID" in ubuntu|debian) ;; *) echo "this script supports Ubuntu and Debian (found $ID)"; exit 1 ;; esac
say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }

APP=/opt/fuelpro; DATA=/var/lib/fuelpro; ETC=/etc/fuelpro; KEY=/root/.ssh/fuelpro_deploy
export DEBIAN_FRONTEND=noninteractive

say "packages"
apt-get update -qq
apt-get install -y -qq curl ca-certificates git ufw xz-utils gnupg debian-keyring debian-archive-keyring apt-transport-https unattended-upgrades sqlite3 >/dev/null

say "Node.js 22 (official build from nodejs.org, SHA-256 checked)"
need_node=1
if command -v node >/dev/null; then v=$(node -p 'process.versions.node'); [ "${v%%.*}" -ge 22 ] && need_node=0; fi
if [ "$need_node" = 1 ]; then
  case "$(dpkg --print-architecture)" in amd64) NA=x64 ;; arm64) NA=arm64 ;; *) echo "unsupported CPU"; exit 1 ;; esac
  BASE=https://nodejs.org/dist/latest-v22.x; TMP=$(mktemp -d)
  curl -fsSL "$BASE/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
  FILE=$(awk -v a="linux-$NA.tar.xz" '$2 ~ a"$" {print $2}' "$TMP/SHASUMS256.txt")
  curl -fsSL "$BASE/$FILE" -o "$TMP/$FILE"
  (cd "$TMP" && grep " $FILE\$" SHASUMS256.txt | sha256sum -c -)
  rm -rf /usr/local/lib/nodejs && mkdir -p /usr/local/lib/nodejs && tar -xJf "$TMP/$FILE" -C /usr/local/lib/nodejs --strip-components=1
  ln -sf /usr/local/lib/nodejs/bin/node /usr/local/bin/node; ln -sf /usr/local/lib/nodejs/bin/npm /usr/local/bin/npm
  rm -rf "$TMP"
fi
echo "node $(node -v)"

say "service user and folders"
id fuelpro >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin fuelpro
install -d -o fuelpro -g fuelpro -m 750 "$DATA" "$DATA/backups"
install -d -o fuelpro -g fuelpro -m 770 "$DATA/incoming"   # the admin user drops laptop backups here (scp)
install -d -o root -g fuelpro -m 750 "$ETC"
if [ -n "$ADMIN_USER" ] && id "$ADMIN_USER" >/dev/null 2>&1; then usermod -aG fuelpro "$ADMIN_USER"; echo "$ADMIN_USER can read backups (group fuelpro; sign in again to take effect)"; fi

say "code from GitHub (read-only deploy key)"
if [[ "$REPO" == git@* ]]; then
  if [ ! -f "$KEY" ]; then
    install -d -m 700 /root/.ssh
    ssh-keygen -q -t ed25519 -N "" -C "fuelpro-vps-$(hostname)" -f "$KEY"
    echo; echo "Add this key on GitHub: repository MoTaher77/fuelpro-erp → Settings → Deploy keys → Add deploy key"
    echo "(title: VPS, leave «Allow write access» UNTICKED):"; echo; cat "$KEY.pub"; echo
    read -r -p "Press Enter once the key is added... " _
  fi
  export GIT_SSH_COMMAND="ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
fi
if [ -d "$APP/.git" ]; then git -C "$APP" fetch -q origin "$BRANCH"; else git clone -q --branch "$BRANCH" "$REPO" "$APP"; fi
git -C "$APP" checkout -q --detach "origin/$BRANCH" 2>/dev/null || git -C "$APP" checkout -q --detach "$BRANCH"
git -C "$APP" config core.sshCommand "${GIT_SSH_COMMAND:-ssh}"
chown -R root:root "$APP"; chmod -R go-w "$APP"
echo "code at $(git -C "$APP" log --oneline -1)"

say "address"
if [ -z "$DOMAIN" ]; then
  IP=$(curl -fsS4 https://api.ipify.org || hostname -I | awk '{print $1}')
  DOMAIN="${IP//./-}.sslip.io"
  echo "no --domain given: using $DOMAIN (points at $IP). A real domain is better for customers; re-run with --domain later."
fi

say "settings ($ETC/fuelpro.env)"
if [ ! -f "$ETC/fuelpro.env" ]; then
  SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")
  cat > "$ETC/fuelpro.env" <<ENV
# FuelPro server settings. After a change: sudo systemctl restart fuelpro
PORT=3000
HOST=127.0.0.1
DB_PATH=$DATA/fuelpro.db
APP_URL=https://$DOMAIN
COOKIE_SECURE=1
TRUST_PROXY=1
# first = only the first organisation may register (then closed); closed = nobody; open = anyone
REGISTRATION=first
# Encrypts two-factor secrets. Moving the laptop's data here? Put the laptop's data\\app-secret.txt value here instead (docs/VPS.md).
APP_SECRET=$SECRET
# Password-reset e-mail (optional). Without SMTP_HOST the reset link is written to: journalctl -u fuelpro
#SMTP_HOST=smtp.example.com
#SMTP_PORT=587
#SMTP_USER=
#SMTP_PASS=
#MAIL_FROM=no-reply@$DOMAIN
#MAIL_FROM_NAME=FuelPro
ENV
else
  sed -i "s|^APP_URL=.*|APP_URL=https://$DOMAIN|" "$ETC/fuelpro.env"
  echo "kept the existing settings (APP_URL set to https://$DOMAIN)"
fi
chown root:fuelpro "$ETC/fuelpro.env"; chmod 640 "$ETC/fuelpro.env"

say "service (systemd)"
install -m 644 "$APP/deploy/vps/fuelpro.service" /etc/systemd/system/fuelpro.service
install -m 755 "$APP/deploy/vps/update.sh" /usr/local/sbin/fuelpro-update
install -m 755 "$APP/deploy/vps/restore.sh" /usr/local/sbin/fuelpro-restore
install -m 755 "$APP/deploy/vps/domain.sh" /usr/local/sbin/fuelpro-domain
install -m 755 "$APP/deploy/vps/offsite.sh" /usr/local/sbin/fuelpro-offsite
install -m 644 "$APP/deploy/vps/fuelpro-offsite.service" /etc/systemd/system/fuelpro-offsite.service
install -m 644 "$APP/deploy/vps/fuelpro-offsite.timer" /etc/systemd/system/fuelpro-offsite.timer
systemctl daemon-reload
systemctl enable -q --now fuelpro
systemctl restart fuelpro
for i in $(seq 1 20); do curl -fsS http://127.0.0.1:3000/healthz >/dev/null 2>&1 && break; sleep 1; done
curl -fsS http://127.0.0.1:3000/healthz >/dev/null && echo "FuelPro is running" || { journalctl -u fuelpro -n 30 --no-pager; exit 1; }

say "HTTPS (Caddy)"
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi
sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__EMAIL__|${EMAIL:-}|g" "$APP/deploy/vps/Caddyfile" > /etc/caddy/Caddyfile
[ -n "$EMAIL" ] || sed -i '/^[[:space:]]*email[[:space:]]*$/d' /etc/caddy/Caddyfile   # no e-mail: drop that line only
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || { caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; exit 1; }
# validate runs as root and may create files Caddy (user caddy) must own; 0.27.0 left a root-owned log file that stopped Caddy
install -d -o caddy -g caddy /var/log/caddy; rm -f /var/log/caddy/fuelpro.log; chown -R caddy:caddy /var/log/caddy /var/lib/caddy 2>/dev/null || true
systemctl enable -q caddy
if ! systemctl restart caddy; then
  echo; echo "!! Caddy (HTTPS) did not start. Programs holding ports 80/443:"
  ss -ltnp | grep -E ':(80|443) ' || echo "   (none)"
  journalctl -u caddy -n 15 --no-pager | grep -iE 'error|bind|address|listen' || journalctl -u caddy -n 15 --no-pager
  # one command per web server that is really installed (naming a missing unit makes systemctl stop with an error)
  for w in apache2 nginx; do systemctl cat "$w" >/dev/null 2>&1 && echo "If $w holds the ports and hosts nothing you need:  systemctl disable --now $w"; done
  echo "then run this script again."
  exit 1
fi
echo "waiting for the HTTPS certificate of $DOMAIN (Let's Encrypt needs ports 80/443 open to the internet)..."
ok=0
for i in $(seq 1 45); do
  if curl -fsS -m 5 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/healthz" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
if [ "$ok" = 1 ]; then echo "HTTPS works: https://$DOMAIN"
else
  echo "!! no certificate yet. Last Caddy messages:"
  journalctl -u caddy -n 20 --no-pager | grep -iE 'error|obtain|challenge|certificate' | tail -8
  echo "   Check that the provider's own firewall (control panel) allows ports 80 and 443, then: systemctl restart caddy"
fi

say "firewall"
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null; ufw status | sed -n '1,8p'

say "automatic security updates"
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

say "done"
cat <<DONE
FuelPro:  https://$DOMAIN      (HTTPS may take a minute the first time)
Next (docs/VPS.md):
  • empty server: open the address and create the organisation (only the first one is allowed), or
  • move the laptop's data: copy a laptop backup to $DATA/incoming/ and run  sudo fuelpro-restore $DATA/incoming/<file>.db
Update later:   sudo fuelpro-update        Logs: journalctl -u fuelpro -f        Settings: $ETC/fuelpro.env
DONE
