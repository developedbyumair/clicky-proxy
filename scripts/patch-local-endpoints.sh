#!/bin/zsh
set -euo pipefail

BASE="$(cd "$(dirname "$0")/.." && pwd)"
APP="$BASE/app/Clicky.app"
BIN="$APP/Contents/MacOS/Clicky"
BACKUP_DIR="$BASE/backup"

if [ ! -f "$BIN" ]; then
  echo "Binary not found: $BIN"
  exit 1
fi

mkdir -p "$BACKUP_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
cp "$BIN" "$BACKUP_DIR/Clicky.bin.local-endpoint.$TS.backup"
echo "Backup created: $BACKUP_DIR/Clicky.bin.local-endpoint.$TS.backup"

python3 - <<'PY' "$BIN"
from pathlib import Path
import sys

bin_path = Path(sys.argv[1])
data = bytearray(bin_path.read_bytes())

replacements = [
    (b"https://clicky-proxy.owner-0cb.workers.dev/chat", b"http://127.0.0.1:8787/chat"),
    (b"https://clicky-proxy.owner-0cb.workers.dev/tts", b"http://127.0.0.1:8787/tts"),
    (b"https://clicky-proxy.farza-0cb.workers.dev/chat", b"http://127.0.0.1:8787/chat"),
    (b"https://clicky-proxy.farza-0cb.workers.dev/tts", b"http://127.0.0.1:8787/tts"),
]

def patch_all(payload: bytearray, old: bytes, new: bytes) -> int:
    if len(new) > len(old):
        raise ValueError(f"replacement too long ({len(new)} > {len(old)}): {new!r}")
    count = 0
    start = 0
    while True:
        idx = payload.find(old, start)
        if idx == -1:
            break
        patched = new + (b"\x00" * (len(old) - len(new)))
        payload[idx : idx + len(old)] = patched
        count += 1
        start = idx + len(old)
    return count

total = 0
for old, new in replacements:
    c = patch_all(data, old, new)
    if c:
        print(f"patched {c} occurrence(s): {old.decode()} -> {new.decode()}")
        total += c

if total == 0:
    print("no endpoint strings found to patch")

bin_path.write_bytes(bytes(data))
print(f"total_patched={total}")
PY

/usr/libexec/PlistBuddy -c "Delete :NSAppTransportSecurity" "$APP/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity dict" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :NSAppTransportSecurity:NSAllowsArbitraryLoads bool true" "$APP/Contents/Info.plist"

codesign --force --deep --sign - "$APP" || codesign --force --sign - "$APP"
echo "Patched to local endpoints and re-signed app."
