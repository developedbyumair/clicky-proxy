#!/bin/zsh
set -euo pipefail

BASE="$(cd "$(dirname "$0")/.." && pwd)"
APP="$BASE/app/Clicky.app"
PLIST="$APP/Contents/Info.plist"
BIN="$APP/Contents/MacOS/Clicky"

if [ ! -f "$PLIST" ] || [ ! -f "$BIN" ]; then
  echo "Clicky app files missing in: $APP"
  exit 1
fi

echo "App path: $APP"
echo
echo "Key status:"
for K in AssemblyAIAPIKey OpenAIAPIKey AssemblyAIStreamingToken; do
  V=$(/usr/libexec/PlistBuddy -c "Print :$K" "$PLIST" 2>/dev/null || true)
  if [ -n "$V" ]; then
    echo "- $K: set (len ${#V})"
  else
    echo "- $K: not set"
  fi
done

echo
VTP=$(/usr/libexec/PlistBuddy -c "Print :VoiceTranscriptionProvider" "$PLIST" 2>/dev/null || true)
OTM=$(/usr/libexec/PlistBuddy -c "Print :OpenAITranscriptionModel" "$PLIST" 2>/dev/null || true)
echo "Transcription provider: ${VTP:-not set}"
if [ -n "$OTM" ]; then
  echo "OpenAI transcription model: $OTM"
fi
if [ "${VTP:-}" = "openai" ]; then
  echo "Warning: openai transcription provider may crash this app build."
fi

TMP="$(mktemp)"
strings "$BIN" > "$TMP"

echo
if grep -qi "farza" "$TMP"; then
  echo "Farza check: FOUND references"
else
  echo "Farza check: no references found"
fi

echo
echo "Endpoint check:"
if grep -q "127.0.0.1:8787" "$TMP"; then
  grep -n "127.0.0.1:8787" "$TMP" | awk 'NR<=10 { print }'
  echo "Local endpoint mode: enabled"
elif grep -q "clicky-proxy" "$TMP"; then
  grep -n "clicky-proxy" "$TMP" | awk 'NR<=10 { print }'
  echo "Local endpoint mode: disabled"
else
  echo "No known chat/tts endpoint strings found"
fi

echo
if curl -sS "http://127.0.0.1:8787/health" >/dev/null 2>&1; then
  echo "Backend health: reachable at 127.0.0.1:8787"
  curl -sS "http://127.0.0.1:8787/health" | python3 -c "import json,sys; raw=sys.stdin.read().strip(); \
data=json.loads(raw) if raw else {}; \
print(f\"Backend chatModel: {data.get('chatModel','unknown')}\"); \
print(f\"Backend ttsVoice: {data.get('ttsVoice','unknown')}\"); \
print(f\"Backend autoClickEnabled: {data.get('autoClickEnabled','unknown')}\")"
else
  echo "Backend health: NOT reachable (start with ./scripts/start-backend.sh)"
fi

rm -f "$TMP"
