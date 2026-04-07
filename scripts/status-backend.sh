#!/bin/zsh
set -euo pipefail

BASE="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$BASE/backend/backend.pid"
LOG_FILE="$BASE/backend/backend.log"
SERVER_SCRIPT="$BASE/backend/server.mjs"
PORT="${CLICKY_BACKEND_PORT:-8787}"
HEALTH_URL="http://127.0.0.1:${PORT}/health"

ALL_PIDS="$(pgrep -f "$SERVER_SCRIPT" || true)"

if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    echo "Backend running (pid $PID)"
  else
    echo "Backend not running (stale pid file)"
  fi
else
  echo "Backend not running"
fi

if [ -n "$ALL_PIDS" ]; then
  COUNT="$(echo "$ALL_PIDS" | awk 'NF{c++} END{print c+0}')"
  if [ "$COUNT" -gt 1 ]; then
    echo "Warning: multiple backend processes detected: $(echo "$ALL_PIDS" | tr '\n' ' ')"
  fi
fi

if curl -fsS --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
  echo "Health: ok ($HEALTH_URL)"
else
  echo "Health: failing ($HEALTH_URL)"
fi

if [ -f "$LOG_FILE" ]; then
  echo "Log file: $LOG_FILE"
else
  echo "Log file not created yet"
fi
