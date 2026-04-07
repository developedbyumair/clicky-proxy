#!/bin/zsh
set -euo pipefail

BASE="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$BASE/backend"
APP_PLIST="$BASE/app/Clicky.app/Contents/Info.plist"
PID_FILE="$BACKEND_DIR/backend.pid"
LOG_FILE="$BACKEND_DIR/backend.log"
PORT="${CLICKY_BACKEND_PORT:-8787}"
SERVER_SCRIPT="$BACKEND_DIR/server.mjs"
HEALTH_URL="http://127.0.0.1:${PORT}/health"

mkdir -p "$BACKEND_DIR"

is_backend_healthy() {
  local RESPONSE
  RESPONSE="$(curl -fsS --max-time 2 "$HEALTH_URL" 2>/dev/null || true)"
  [[ "$RESPONSE" == *"\"ok\":true"* ]]
}

EXISTING="$(pgrep -f "$SERVER_SCRIPT" || true)"
if [ -n "$EXISTING" ]; then
  if is_backend_healthy; then
    KEEP_PID="$(echo "$EXISTING" | awk 'NR==1{print; exit}')"
    EXTRA_PIDS="$(echo "$EXISTING" | awk 'NR>1{print}')"

    if [ -n "$EXTRA_PIDS" ]; then
      echo "$EXTRA_PIDS" | while read -r PID; do
        [ -n "$PID" ] && kill "$PID" 2>/dev/null || true
      done
    fi

    echo "$KEEP_PID" > "$PID_FILE"
    echo "Backend already running (pid $KEEP_PID)"
    exit 0
  fi

  echo "Backend process exists but is unhealthy; restarting..."
  echo "$EXISTING" | while read -r PID; do
    [ -n "$PID" ] && kill "$PID" 2>/dev/null || true
  done
  sleep 1
fi

rm -f "$PID_FILE"

if [ -f "$BACKEND_DIR/.env" ]; then
  set -a
  . "$BACKEND_DIR/.env"
  set +a
fi

if [ -z "${OPENAI_API_KEY:-}" ]; then
  OPENAI_API_KEY=$(/usr/libexec/PlistBuddy -c "Print :OpenAIAPIKey" "$APP_PLIST" 2>/dev/null || true)
fi

if [ -z "${OPENAI_API_KEY:-}" ]; then
  echo "OPENAI_API_KEY is missing. Set it in backend/.env or Clicky Info.plist."
  exit 1
fi

: > "$LOG_FILE"

nohup env \
  NODE_OPTIONS="" \
  OPENAI_API_KEY="$OPENAI_API_KEY" \
  OPENAI_CHAT_MODEL="${OPENAI_CHAT_MODEL:-gpt-5}" \
  OPENAI_TTS_MODEL="${OPENAI_TTS_MODEL:-gpt-4o-mini-tts}" \
  OPENAI_TTS_VOICE="${OPENAI_TTS_VOICE:-shimmer}" \
  CLICKY_CALL_NAME="${CLICKY_CALL_NAME:-pintO}" \
  CLICKY_ENABLE_AUTO_CLICK="${CLICKY_ENABLE_AUTO_CLICK:-1}" \
  CLICKY_BACKEND_PORT="$PORT" \
  node "$SERVER_SCRIPT" >> "$LOG_FILE" 2>&1 &

PID=$!
echo "$PID" > "$PID_FILE"
sleep 1

if kill -0 "$PID" 2>/dev/null; then
  for _ in 1 2 3; do
    if is_backend_healthy; then
      echo "Backend started on 127.0.0.1:$PORT (pid $PID)"
      echo "Log: $LOG_FILE"
      exit 0
    fi
    sleep 1
  done

  echo "Backend started but health check failed. Check log: $LOG_FILE"
  exit 1
else
  echo "Backend failed to start. Check log: $LOG_FILE"
  exit 1
fi
