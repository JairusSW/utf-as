#!/bin/bash
# Fetches simdutf's wikipedia_mars + emoji.txt benchmark payloads into
# assembly/__benches__/fixtures/simdutf/. Idempotent — skips files that
# already look valid (size sanity check rejects Wikipedia error pages).
#
# Run before: npm run bench:simdutf  or  npm run bench:vs-stdlib

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT_DIR/assembly/__benches__/fixtures/simdutf"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0"
MIN_BYTES=10000  # Wikipedia error pages are ~2KB; real articles are ≥250KB

mkdir -p "$DEST"

# file:lang:slug — wiki article URL is https://$lang.wikipedia.org/wiki/$slug
PAGES=(
  "english:en:Mars"
  "french:fr:Mars_(plan%C3%A8te)"
  "german:de:Mars_(Planet)"
  "arabic:ar:%D8%A7%D9%84%D9%85%D8%B1%D9%8A%D8%AE"
  "russian:ru:%D0%9C%D0%B0%D1%80%D1%81"
  "chinese:zh:%E7%81%AB%E6%98%9F"
  "japanese:ja:%E7%81%AB%E6%98%9F"
  "korean:ko:%ED%99%94%EC%84%B1"
  "hebrew:he:%D7%9E%D7%90%D7%93%D7%99%D7%9D"
  "hindi:hi:%E0%A4%AE%E0%A4%82%E0%A4%97%E0%A4%B2_%E0%A4%97%E0%A5%8D%E0%A4%B0%E0%A4%B9"
  "thai:th:%E0%B8%94%E0%B8%B2%E0%B8%A7%E0%B8%AD%E0%B8%B1%E0%B8%87%E0%B8%84%E0%B8%B2%E0%B8%A3"
  "vietnamese:vi:Sao_H%E1%BB%8Fa"
  "portuguese:pt:Marte_(planeta)"
  "esperanto:eo:Marso_(planedo)"
  "czech:cs:Mars_(planeta)"
  "greek:el:%CE%86%CF%81%CE%B7%CF%82_(%CF%80%CE%BB%CE%B1%CE%BD%CE%AE%CF%84%CE%B7%CF%82)"
  "persan:fa:%D9%85%D8%B1%DB%8C%D8%AE"
  "turkish:tr:Mars"
)

EMOJI_URL="https://raw.githubusercontent.com/simdutf/simdutf/master/benchmarks/dataset/emoji.txt"

fetch() {
  local out="$1" url="$2"
  if [[ -f "$out" ]]; then
    local size
    size=$(wc -c <"$out" | tr -d ' ')
    if (( size >= MIN_BYTES )); then
      echo "  ✓ $(basename "$out") ($size bytes, cached)"
      return
    fi
    echo "  ! $(basename "$out") cached but suspiciously small ($size bytes); refetching"
  fi
  curl -sSL -A "$UA" -o "$out" "$url"
  local size
  size=$(wc -c <"$out" | tr -d ' ')
  if (( size < MIN_BYTES )); then
    echo "  ✗ $(basename "$out") came back $size bytes (likely a Wikipedia error page)" >&2
    return 1
  fi
  echo "  ✓ $(basename "$out") ($size bytes)"
}

echo "Fetching simdutf benchmark payloads into $DEST"

# emoji.txt has a lower size floor.
emoji_out="$DEST/emoji.txt"
if [[ ! -f "$emoji_out" ]] || (( $(wc -c <"$emoji_out" | tr -d ' ') < 1000 )); then
  curl -sSL -o "$emoji_out" "$EMOJI_URL"
  echo "  ✓ emoji.txt ($(wc -c <"$emoji_out" | tr -d ' ') bytes)"
else
  echo "  ✓ emoji.txt (cached)"
fi

for entry in "${PAGES[@]}"; do
  IFS=':' read -r name lang slug <<<"$entry"
  fetch "$DEST/$name.html" "https://$lang.wikipedia.org/wiki/$slug"
done

echo "Done. ${#PAGES[@]} HTML files + emoji.txt in $DEST"
