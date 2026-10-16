#!/usr/bin/env bash
# Collects the static files nginx serves: the main page at / and the game at /play/.
# Usage: deploy/build-web.sh [target-dir]   (default: roadflow/web)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$ROOT/roadflow/web}"
rm -rf "$OUT"
mkdir -p "$OUT/play"
cp "$ROOT/site/index.html" "$OUT/index.html"
cp "$ROOT/games/traffic-architect/index.html" "$OUT/play/index.html"
echo "built $OUT"
