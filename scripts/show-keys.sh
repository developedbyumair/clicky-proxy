#!/bin/zsh
set -euo pipefail

BASE="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$BASE/app/Clicky.app/Contents/Info.plist"
MODE="${1:-masked}"

if [ ! -f "$PLIST" ]; then
  echo "Info.plist not found: $PLIST"
  exit 1
fi

print_key() {
  local key="$1"
  local value
  value=$(/usr/libexec/PlistBuddy -c "Print :$key" "$PLIST" 2>/dev/null || true)

  if [ -z "$value" ]; then
    echo "$key: not set"
    return
  fi

  if [ "$MODE" = "--full" ]; then
    echo "$key: $value"
    return
  fi

  local len=${#value}
  if [ "$len" -le 8 ]; then
    echo "$key: $value"
  else
    local prefix="${value[1,4]}"
    local suffix="${value[$((len-3)),$len]}"
    echo "$key: ${prefix}...${suffix} (len=$len)"
  fi
}

print_key "AssemblyAIAPIKey"
print_key "OpenAIAPIKey"
print_key "AssemblyAIStreamingToken"
