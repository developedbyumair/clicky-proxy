#!/bin/zsh
set -euo pipefail

BASE="$(cd "$(dirname "$0")/.." && pwd)"

# Kill all Clicky processes first.
pkill -f "Clicky.app/Contents/MacOS/Clicky" 2>/dev/null || true

# Restart backend cleanly.
"$BASE/scripts/stop-backend.sh"
"$BASE/scripts/start-backend.sh"

# Relaunch app.
"$BASE/scripts/run-clicky.sh"

echo "Clean restart complete."
