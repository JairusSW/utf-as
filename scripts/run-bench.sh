#!/bin/bash
# Build and run AssemblyScript benchmarks.
#
# Usage:
#   ./scripts/run-bench.sh [flags] [bench-name]
#
# Flags:
#   --v8        Run under V8 / d8 (default if no runtime selected)
#   --wavm      Run under WAVM (requires `wavm` in PATH)
#   --wazero    Run under wazero (requires `wazero` in PATH)
#   --memory    Enable as-heap-analyzer; bench output includes per-class
#               retained/in-flight bytes
#   --list      List discoverable bench files and exit
#   --help, -h  Show this help and exit
#
# Outputs JSON to build/logs/as/<runtime>/<bench-stem>.as.json
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

D8_BIN="${D8_BIN:-}"
WAVM_BIN="${WAVM_BIN:-wavm}"
WAZERO_BIN="${WAZERO_BIN:-wazero}"
WAVM_RUN_FLAGS="${WAVM_RUN_FLAGS:-"--abi=wasi --enable simd --enable bulk-memory"}"
WAZERO_RUN_FLAGS="${WAZERO_RUN_FLAGS:-}"
BENCH_NAME=""
ARGS=()
RUN_V8=0
RUN_WAVM=0
RUN_WAZERO=0
BENCH_MEMORY=0

read -r -a WAVM_RUN_FLAGS_ARR <<< "$WAVM_RUN_FLAGS"
read -r -a WAZERO_RUN_FLAGS_ARR <<< "$WAZERO_RUN_FLAGS"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --v8)
      RUN_V8=1
      shift
      ;;
    --wavm|--llvm)
      RUN_WAVM=1
      shift
      ;;
    --wazero)
      RUN_WAZERO=1
      shift
      ;;
    --memory)
      BENCH_MEMORY=1
      shift
      ;;
    --list)
      echo "Available benches:"
      for f in ./assembly/__benches__/*.bench.ts; do
        [[ -f "$f" ]] || continue
        b="$(basename "$f" .bench.ts)"
        echo "  - $b"
      done
      exit 0
      ;;
    --help|-h)
      sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      ARGS+=("$1")
      shift
      ;;
  esac
done

# Compile flags that enable the heap-analyzer transform + the BENCH_TRACK_MEMORY
# compile-time guard inside bench.ts. Without --memory the bench loop skips all
# memory-tracking work entirely.
MEMORY_ASC_ARGS=()
if [[ $BENCH_MEMORY -eq 1 ]]; then
  MEMORY_ASC_ARGS=(
    --transform ./node_modules/as-heap-analyzer/transform/addHeapAnalyzerInfo.mjs
    --use "BENCH_TRACK_MEMORY=1"
  )
fi

if [[ $RUN_V8 -eq 0 && $RUN_WAVM -eq 0 && $RUN_WAZERO -eq 0 ]]; then
  RUN_V8=1
fi

if [[ $RUN_V8 -eq 1 ]]; then
  if [[ -z "$D8_BIN" ]]; then
    if command -v v8 >/dev/null 2>&1; then
      D8_BIN="v8"
    elif command -v d8 >/dev/null 2>&1; then
      D8_BIN="d8"
    else
      echo "❌ Neither v8 nor d8 was found in PATH"
      exit 1
    fi
  fi
fi

if [[ $RUN_WAVM -eq 1 ]] && ! command -v "$WAVM_BIN" >/dev/null 2>&1; then
  echo "❌ wavm not found in PATH (or WAVM_BIN is invalid)"
  exit 1
fi

if [[ $RUN_WAZERO -eq 1 ]] && ! command -v "$WAZERO_BIN" >/dev/null 2>&1; then
  echo "❌ wazero not found in PATH (or WAZERO_BIN is invalid)"
  exit 1
fi

if [[ ${#ARGS[@]} -gt 0 ]]; then
  BENCH_NAME="${ARGS[0]}"
fi

mkdir -p ./build/logs/as/{v8,wavm,wazero}

FILES=()

if [[ -n "$BENCH_NAME" ]]; then
  [[ "$BENCH_NAME" != *.bench.ts ]] && BENCH_NAME="$BENCH_NAME.bench.ts"
  FILES=( "./assembly/__benches__/$BENCH_NAME" )
  if [[ ! -f "${FILES[0]}" ]]; then
    echo "❌ No benchmark found for '${ARGS[0]}'"
    exit 1
  fi
else
  FILES=( ./assembly/__benches__/*.bench.ts )
fi

consume_bench_output() {
  local tmp="$1"

  while IFS= read -r line; do
    if [[ "$line" == __AS_BENCH_JSON__* ]]; then
      local payload file_name json
      payload="${line#__AS_BENCH_JSON__}"
      file_name="${payload%%$'\t'*}"
      json="${payload#*$'\t'}"
      mkdir -p "$(dirname "$file_name")"
      printf "%s" "$json" >"$file_name"
    else
      echo "$line"
    fi
  done <"$tmp"
}

run_v8_module() {
  local wasm_arg="$1"
  "$D8_BIN" --no-liftoff --module ./bench/runners/assemblyscript.js -- "$wasm_arg"
}

# WASI runtimes have no `readFile` hostcall, so payload benches receive their
# fixtures as a framed blob on stdin (see scripts/pack-simdutf-fixtures.mjs and
# assembly/__benches__/fixtures/simdutf_loader.ts). $2 is that blob's path;
# benches that don't read stdin get /dev/null and ignore it.
run_wavm_module() {
  local wasm_arg="$1"
  local infile="${2:-/dev/null}"
  local tmp
  tmp="$(mktemp)"

  if [[ ${#WAVM_RUN_FLAGS_ARR[@]} -gt 0 ]]; then
    if ! "$WAVM_BIN" run "${WAVM_RUN_FLAGS_ARR[@]}" "./build/$wasm_arg" <"$infile" >"$tmp" 2>&1; then
      cat "$tmp"
      rm -f "$tmp"
      return 1
    fi
  elif ! "$WAVM_BIN" run "./build/$wasm_arg" <"$infile" >"$tmp" 2>&1; then
    cat "$tmp"
    rm -f "$tmp"
    return 1
  fi

  consume_bench_output "$tmp"
  rm -f "$tmp"
}

run_wazero_module() {
  local wasm_arg="$1"
  local infile="${2:-/dev/null}"
  local tmp
  tmp="$(mktemp)"

  if [[ ${#WAZERO_RUN_FLAGS_ARR[@]} -gt 0 ]]; then
    if ! "$WAZERO_BIN" run "${WAZERO_RUN_FLAGS_ARR[@]}" "./build/$wasm_arg" <"$infile" >"$tmp" 2>&1; then
      cat "$tmp"
      rm -f "$tmp"
      return 1
    fi
  elif ! "$WAZERO_BIN" run "./build/$wasm_arg" <"$infile" >"$tmp" 2>&1; then
    cat "$tmp"
    rm -f "$tmp"
    return 1
  fi

  consume_bench_output "$tmp"
  rm -f "$tmp"
}

# Pack the simdutf fixtures into a temp file for benches that read them from
# stdin under WASI. Echoes the temp path; empty if this bench needs no
# fixtures. Caller is responsible for `rm -f`.
pack_fixtures_if_needed() {
  local bench_file="$1"
  if ! grep -q "simdutf_loader" "$bench_file"; then
    return 0
  fi
  local out
  out="$(mktemp)"
  if ! node "$ROOT_DIR/scripts/pack-simdutf-fixtures.mjs" >"$out"; then
    rm -f "$out"
    echo "❌ failed to pack simdutf fixtures — run \`npm run bench:fetch\` first" >&2
    exit 1
  fi
  echo "$out"
}

optimize_or_fallback() {
  local in_wasm="$1"
  local out_wasm="$2"
  if command -v wasm-opt >/dev/null 2>&1; then
    shift 2
    wasm-opt "$@" "$in_wasm" -o "$out_wasm"
    rm -f "$in_wasm"
  else
    mv "$in_wasm" "$out_wasm"
  fi
}

build_v8() {
  local file="$1"
  local output="$2"

  npx asc "$file" -o "${output}.tmp" -O3 --converge --noAssert --uncheckedBehavior always --runtime incremental --enable bulk-memory --enable simd --exportStart start --exportRuntime "${MEMORY_ASC_ARGS[@]}"
  optimize_or_fallback "${output}.tmp" "$output" --enable-bulk-memory --enable-simd --enable-nontrapping-float-to-int --enable-tail-call -tnh -iit -ifwl -s 0 -O4
}

build_wasi() {
  local file="$1"
  local output="$2"
  local runtime_flag="$3"

  npx asc "$file" -o "$output" -O3 --converge --noAssert --uncheckedBehavior always --runtime incremental --config ./node_modules/@assemblyscript/wasi-shim/asconfig.json --use "$runtime_flag=1" --enable bulk-memory --enable simd --exportRuntime "${MEMORY_ASC_ARGS[@]}"
}

for file in "${FILES[@]}"; do
  filename="${file##*/}"
  output="./build/${filename%.ts}"

  if [[ $RUN_V8 -eq 1 ]]; then
    wasm_arg="${filename%.ts}.v8.wasm"
    build_v8 "$file" "${output}.v8.wasm"
    echo -e "$filename (asc/v8)\n"
    run_v8_module "$wasm_arg"
  fi

  stdin_file=""
  if [[ $RUN_WAVM -eq 1 || $RUN_WAZERO -eq 1 ]]; then
    stdin_file="$(pack_fixtures_if_needed "$file")"
  fi

  if [[ $RUN_WAVM -eq 1 ]]; then
    wasm_arg="${filename%.ts}.wavm.wasm"
    build_wasi "$file" "${output}.wavm.wasm" "AS_BENCH_RUNTIME_WAVM"
    echo -e "$filename (asc/wavm)\n"
    run_wavm_module "$wasm_arg" "$stdin_file"
  fi

  if [[ $RUN_WAZERO -eq 1 ]]; then
    wasm_arg="${filename%.ts}.wazero.wasm"
    build_wasi "$file" "${output}.wazero.wasm" "AS_BENCH_RUNTIME_WAZERO"
    echo -e "$filename (asc/wazero)\n"
    run_wazero_module "$wasm_arg" "$stdin_file"
  fi

  [[ -n "$stdin_file" ]] && rm -f "$stdin_file"
done

echo "Finished benchmarks"
