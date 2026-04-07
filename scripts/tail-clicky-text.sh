#!/bin/zsh
set -euo pipefail

BASE="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="$BASE/backend/backend.log"

mkdir -p "$BASE/backend"
touch "$LOG_FILE"

echo "Watching Clicky text log lines from: $LOG_FILE"
tail -n 60 -f "$LOG_FILE" | python3 -u -c "import re,sys; pat=re.compile(r'/chat user=|/chat assistant=|/chat assistant_fallback=|/tts text=|point-tag final|auto-click|/chat error|/tts fallback'); [print(line.rstrip()) for line in sys.stdin if pat.search(line)]"
