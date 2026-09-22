#!/usr/bin/env bash
# Refresh usage data for the ccusage report. Safe to run any time; writes atomically.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/www/data"
TMP="$DATA/.tmp"
LOG="$ROOT/logs/refresh.log"
CC="$ROOT/node_modules/.bin/ccusage"
export PATH=/usr/local/bin:/usr/bin:/bin:$PATH
export TZ="${TZ:-Asia/Tokyo}"
mkdir -p "$TMP" "$ROOT/logs"
# keep log small
[ -f "$LOG" ] && [ "$(stat -c %s "$LOG")" -gt 1000000 ] && tail -n 500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"

start=$(date +%s)
ok=1
run_cc() { # $1=section
  local s="$1" out="$TMP/$s.json"
  if "$CC" "$s" --json > "$out" 2>>"$LOG" || "$CC" "$s" --json --offline > "$out" 2>>"$LOG"; then
    if node -e "JSON.parse(require('fs').readFileSync('$out','utf8'))" 2>>"$LOG"; then mv "$out" "$DATA/$s.json"; return 0; fi
  fi
  echo "$(date -Is) ccusage $s failed" >> "$LOG"; ok=0
}
for s in daily weekly monthly session blocks; do run_cc "$s"; done
node "$ROOT/bin/aggregate.mjs" "$DATA" 2>>"$LOG" || { echo "$(date -Is) aggregate failed" >> "$LOG"; ok=0; }

cat > "$TMP/meta.json" <<JSON
{"generatedAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","tz":"$TZ","host":"$(hostname)","ccusageVersion":"$("$CC" --version 2>/dev/null)","durationSec":$(( $(date +%s) - start )),"ok":$ok}
JSON
mv "$TMP/meta.json" "$DATA/meta.json"
echo "$(date -Is) refresh done ok=$ok in $(( $(date +%s) - start ))s" >> "$LOG"
