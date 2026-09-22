#!/usr/bin/env bash
# Disable the nginx site. Keeps the repo, generated data and nginx itself. Run with sudo.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DST=/etc/nginx/sites-enabled/ccusage-dashboard.conf

if [ -e "$DST" ] || [ -L "$DST" ]; then
  rm -f "$DST"
  nginx -t
  systemctl reload nginx
  echo "site disabled: $DST"
else
  echo "site was not enabled: $DST"
fi
rm -f "$ROOT/nginx/ccusage-dashboard.conf"
echo "rendered config removed. cron job (if any) is left untouched:"
echo "  crontab -l | grep -v ccusage-dashboard | crontab -"
