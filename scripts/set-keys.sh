#!/bin/zsh
set -euo pipefail

BASE="$(cd "$(dirname "$0")/.." && pwd)"
APP="$BASE/app/Clicky.app"
PLIST="$APP/Contents/Info.plist"
BACKUP_DIR="$BASE/backup"

if [ ! -f "$PLIST" ]; then
  echo "Info.plist not found: $PLIST"
  exit 1
fi

mkdir -p "$BACKUP_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
cp "$PLIST" "$BACKUP_DIR/Info.plist.$TS.backup"
echo "Backed up plist: $BACKUP_DIR/Info.plist.$TS.backup"

read -s "AKEY?AssemblyAI API key (leave blank to keep current): "
echo
read -s "OKEY?OpenAI API key (leave blank to keep current): "
echo
read -s "ASTREAM?AssemblyAI streaming token (optional, blank to remove): "
echo

if [ -n "$AKEY" ]; then
  /usr/libexec/PlistBuddy -c "Delete :AssemblyAIAPIKey" "$PLIST" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Add :AssemblyAIAPIKey string $AKEY" "$PLIST"
  echo "Updated AssemblyAIAPIKey"
fi

if [ -n "$OKEY" ]; then
  /usr/libexec/PlistBuddy -c "Delete :OpenAIAPIKey" "$PLIST" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Add :OpenAIAPIKey string $OKEY" "$PLIST"
  echo "Updated OpenAIAPIKey"
fi

/usr/libexec/PlistBuddy -c "Delete :AssemblyAIStreamingToken" "$PLIST" 2>/dev/null || true
if [ -n "$ASTREAM" ]; then
  /usr/libexec/PlistBuddy -c "Add :AssemblyAIStreamingToken string $ASTREAM" "$PLIST"
  echo "Set AssemblyAIStreamingToken"
else
  echo "Removed AssemblyAIStreamingToken"
fi

codesign --force --deep --sign - "$APP" || codesign --force --sign - "$APP"
xattr -r -d com.apple.quarantine "$APP" 2>/dev/null || true

echo "Re-signed app: $APP"
echo "Note: macOS may ask permissions again after re-sign."
