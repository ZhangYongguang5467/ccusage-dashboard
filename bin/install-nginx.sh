#!/usr/bin/env bash
# Render the nginx site from the template and enable it. Run with sudo.
#   sudo PORT=8090 bin/install-nginx.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8090}"
SRC="$ROOT/nginx/ccusage-dashboard.conf"
DST=/etc/nginx/sites-enabled/ccusage-dashboard.conf

sed -e "s|__ROOT__|$ROOT|g" -e "s|__PORT__|$PORT|g" \
    "$ROOT/nginx/ccusage-dashboard.conf.template" > "$SRC"
ln -sf "$SRC" "$DST"
nginx -t
systemctl enable --now nginx
systemctl reload nginx
sleep 1
echo -n "healthz: "; curl -s "http://127.0.0.1:$PORT/healthz"
echo "site enabled: $(readlink -f "$DST") (root $ROOT/www, port $PORT)"
