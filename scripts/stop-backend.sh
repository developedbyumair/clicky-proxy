#!/bin/zsh
set -euo pipefail

BASE="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$BASE/backend/backend.pid"
SERVER_SCRIPT="$BASE/backend/server.mjs"

PIDS="$(pgrep -f "$SERVER_SCRIPT" || true)"

if [ -n "$PIDS" ]; then
  echo "$PIDS" | while read -r PID; do
    [ -n "$PID" ] || continue
    if kill -0 "$PID" 2>/dev/null; then
      kill "$PID" 2>/dev/null || true
      sleep 1
      if kill -0 "$PID" 2>/dev/null; then
        kill -9 "$PID" 2>/dev/null || true
      fi
      echo "Stopped backend (pid $PID)."
    fi
  done
else
  echo "Backend was not running."
fi

rm -f "$PID_FILE"
