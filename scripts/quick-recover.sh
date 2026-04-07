#!/bin/zsh
set -euo pipefail

BASE="$(cd "$(dirname "$0")/.." && pwd)"
HEALTH_URL="http://127.0.0.1:8787/health"

"$BASE/scripts/start-backend.sh"
if ! curl -fsS --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
  echo "Backend unhealthy, doing clean restart..."
  "$BASE/scripts/stop-backend.sh"
  "$BASE/scripts/start-backend.sh"
fi

"$BASE/scripts/run-clicky.sh"
echo "Recovery complete."
