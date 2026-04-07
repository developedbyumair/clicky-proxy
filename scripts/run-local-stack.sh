#!/bin/zsh
set -euo pipefail

BASE="$(cd "$(dirname "$0")/.." && pwd)"

"$BASE/scripts/run-clicky.sh"

echo "Local stack started."
echo "Backend health: http://127.0.0.1:8787/health"
