#!/bin/zsh
set -euo pipefail

BASE="$(cd "$(dirname "$0")/.." && pwd)"
APP="$BASE/app/Clicky.app"
BINARY_PATTERN="Clicky.app/Contents/MacOS/Clicky"
START_BACKEND="$BASE/scripts/start-backend.sh"
HEALTH_URL="http://127.0.0.1:8787/health"

if [ ! -e "$APP" ]; then
  echo "App not found: $APP"
  exit 1
fi

# Always ensure backend is up before launching app to avoid "credits exhausted" UI.
"$START_BACKEND"
if ! curl -fsS --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
  echo "Backend is not healthy at $HEALTH_URL"
  exit 1
fi

# Enforce single instance to avoid intermittent hotkey/input conflicts.
EXISTING="$(pgrep -f "$BINARY_PATTERN" || true)"
if [ -n "$EXISTING" ]; then
  echo "$EXISTING" | while read -r PID; do
    [ -n "$PID" ] && kill "$PID" 2>/dev/null || true
  done
  sleep 1
fi

open "$APP"
echo "Launched: $APP"
