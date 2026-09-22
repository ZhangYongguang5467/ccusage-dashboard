#!/usr/bin/env bash
# Refresh usage data for the dashboard. Safe to run any time; writes atomically.
# ccusage is optional: without it the billing-window panels are disabled, everything else works.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/www/data"
TMP="$DATA/.tmp"
LOG="$ROOT/logs/refresh.log"
CC="$ROOT/node_modules/.bin/ccusage"
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH
mkdir -p "$TMP" "$ROOT/logs"
now() { date +%Y-%m-%dT%H:%M:%S%z; }
# keep log small (portable: no GNU stat)
[ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 1000000 ] && tail -n 500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"

start=$(date +%s)
ok=1
have_cc=true
run_cc() { # $1=section
  local s="$1" out="$TMP/$s.json"
  if "$CC" "$s" --json > "$out" 2>>"$LOG" || "$CC" "$s" --json --offline > "$out" 2>>"$LOG"; then
    if node -e "JSON.parse(require('fs').readFileSync('$out','utf8'))" 2>>"$LOG"; then mv "$out" "$DATA/$s.json"; return 0; fi
  fi
  echo "$(now) ccusage $s failed" >> "$LOG"; ok=0
}
if [ -x "$CC" ]; then
  for s in daily weekly monthly session blocks; do run_cc "$s"; done
else
  have_cc=false
  rm -f "$DATA"/{daily,weekly,monthly,session,blocks}.json   # never serve stale windows
  echo "$(now) ccusage not installed; billing-window data skipped" >> "$LOG"
fi
node "$ROOT/bin/aggregate.mjs" "$DATA" 2>>"$LOG" || { echo "$(now) aggregate failed" >> "$LOG"; ok=0; }

cat > "$TMP/meta.json" <<JSON
{"generatedAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","tz":"${TZ:-$(node -e 'console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)')}","host":"$(hostname)","ccusage":$have_cc,"ccusageVersion":"$([ -x "$CC" ] && "$CC" --version 2>/dev/null)","durationSec":$(( $(date +%s) - start )),"ok":$ok}
JSON
mv "$TMP/meta.json" "$DATA/meta.json"
echo "$(now) refresh done ok=$ok ccusage=$have_cc in $(( $(date +%s) - start ))s" >> "$LOG"
