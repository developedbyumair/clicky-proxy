#!/bin/zsh
set -euo pipefail

BASE="$(cd "$(dirname "$0")/.." && pwd)"
APP="$BASE/app/Clicky.app"
BIN="$APP/Contents/MacOS/Clicky"
BACKUP_DIR="$BASE/backup"

usage() {
  echo "Usage:"
  echo "  ./scripts/replace-message.sh \"OLD_TEXT\" \"NEW_TEXT\""
  echo
  echo "Notes:"
  echo "  - NEW_TEXT must be same length or shorter than OLD_TEXT"
  echo "  - The script pads remaining bytes with spaces"
  echo "  - App is re-signed automatically after patching"
}

if [ $# -ne 2 ]; then
  usage
  exit 1
fi

if [ ! -f "$BIN" ]; then
  echo "Binary not found: $BIN"
  exit 1
fi

OLD="$1"
NEW="$2"

mkdir -p "$BACKUP_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
cp "$BIN" "$BACKUP_DIR/Clicky.bin.$TS.backup"
echo "Backup created: $BACKUP_DIR/Clicky.bin.$TS.backup"

python3 - <<'PY' "$BIN" "$OLD" "$NEW"
from pathlib import Path
import sys

bin_path = Path(sys.argv[1])
old = sys.argv[2].encode("utf-8")
new = sys.argv[3].encode("utf-8")

if len(new) > len(old):
    raise SystemExit(
        f"NEW_TEXT is longer than OLD_TEXT ({len(new)} > {len(old)}). "
        "Use equal or shorter text."
    )

data = bin_path.read_bytes()
count = data.count(old)
if count == 0:
    raise SystemExit("OLD_TEXT not found in binary.")

new_padded = new + b" " * (len(old) - len(new))
patched = data.replace(old, new_padded)
bin_path.write_bytes(patched)

print(f"patched_occurrences={count}")
print(f"old_len={len(old)} new_len={len(new)} padded_len={len(new_padded)}")
PY

codesign --force --deep --sign - "$APP" || codesign --force --sign - "$APP"
echo "Re-signed app: $APP"
echo "Done. Relaunch Clicky to verify message updates."
