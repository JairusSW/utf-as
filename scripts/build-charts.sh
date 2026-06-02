#!/bin/bash
# Renders every scripts/charts/*.mjs file with the selected runtime.
#
#   ./scripts/build-charts.sh                # v8 (default)
#   ./scripts/build-charts.sh --wavm
#   ./scripts/build-charts.sh --wazero
#   ./scripts/build-charts.sh --v8 chart1    # only chart1.mjs
#
# Files starting with `_` (e.g. `_template.mjs`) are skipped. Charts read
# bench JSON from build/logs/as/<runtime>/; run the matching benchmark first:
#   npm run bench -- --v8     (or --wavm / --wazero)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUNTIME="v8"
TARGETS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --v8)     RUNTIME="v8";     shift ;;
    --wavm)   RUNTIME="wavm";   shift ;;
    --wazero) RUNTIME="wazero"; shift ;;
    --list)
      echo "Available charts:"
      for f in ./scripts/charts/*.mjs; do
        [[ -f "$f" ]] || continue
        b="$(basename "$f" .mjs)"
        [[ "$b" == _* ]] && continue
        echo "  - $b"
      done
      exit 0
      ;;
    --help|-h)
      sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) TARGETS+=("$1"); shift ;;
  esac
done

FILES=()
if [[ ${#TARGETS[@]} -gt 0 ]]; then
  for t in "${TARGETS[@]}"; do
    [[ "$t" != *.mjs ]] && t="$t.mjs"
    if [[ -f "./scripts/charts/$t" ]]; then
      FILES+=("./scripts/charts/$t")
    else
      echo "❌ chart script not found: scripts/charts/$t" >&2
      exit 1
    fi
  done
else
  for f in ./scripts/charts/*.mjs; do
    [[ -f "$f" ]] || continue
    base="$(basename "$f")"
    [[ "$base" == _* ]] && continue # skip _template.mjs etc.
    FILES+=("$f")
  done
fi

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "No chart scripts to run. Add one to scripts/charts/ (start from _template.mjs)."
  exit 0
fi

mkdir -p ./charts

echo "Building ${#FILES[@]} chart(s) for runtime: $RUNTIME"
for f in "${FILES[@]}"; do
  BENCH_CHART_RUNTIME="$RUNTIME" node "$f"
done
