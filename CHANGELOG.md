# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-06-24

### Fixed

- Ship the root `index.ts` in the published package. The 0.3.0 release added it
  so consumers could `import { UTF8, UTF16 } from "utf-as"`, but it was missing
  from the `files` allowlist, so the tarball never included it - `asc` resolves
  the bare `"utf-as"` specifier to `node_modules/utf-as/index.ts`, so the import
  failed for anyone installing from the registry (it only worked through a local
  workspace symlink). `index.ts` is now in `files`.

## [0.3.0] - 2026-06-23

### Added

- `UTF8.byteLengthUnsafe(str, len, nullTerminated?)` - the pointer-based core of
  `UTF8.byteLength`, so a caller can pre-count a UTF-16 sub-range without owning
  a `string`. `byteLength` now delegates to it (no behaviour change).

### Fixed

- Root `index.ts` re-exported `"./assembly/index.ts"` with an explicit `.ts`
  extension, which `asc` could not resolve (it appended a second `.ts`).
  Consumers can now `import { UTF8, UTF16 } from "utf-as"` directly.

## [0.2.0] - 2026-06-10

SWAR (SIMD-within-a-register) default paths for every operation. Each of
`UTF8.validate` / `encode` / `decode` and `UTF16.validate` now runs a portable
`u64`-word kernel by default and dispatches to the SIMD kernel only when it is
compiled in (`ASC_FEATURE_SIMD`) and the input clears a per-operation size
threshold. Two user-visible wins: small/medium input is up to ~3× faster (the
SIMD kernels do no vector work below their window), and **the whole library now
compiles and runs with `--enable simd` off**. The public API is unchanged and
output is byte-identical to the SIMD path on valid input.

### Added

- **SWAR UTF-8 validation path**, now the default for `UTF8.validate` /
  `validateUnsafe`. A SIMD-within-a-register validator (8 bytes per `u64`, with a
  32-byte unrolled ASCII fast-skip and a direct multibyte-cluster loop) handles
  inputs below a 64-byte threshold; the SIMD kernel is dispatched only when
  compiled in (`ASC_FEATURE_SIMD`) and the input is ≥ 64 bytes. Both paths are
  byte-for-byte identical (verified by a three-way differential — SWAR vs SIMD vs
  an independent value-based reference — plus fuzz parity).
  - **Up to ~3× faster on small ASCII** (< 64 bytes): the SWAR path skips the
    SIMD kernel's 64-byte scratch fill and per-window setup.
  - **SIMD is now optional for validation.** `UTF8.validate` compiles and runs
    with `--enable simd` off (SWAR reaches zero v128 ops); decode/encode still
    require SIMD. A no-SIMD test suite (`npm run test:nosimd`) guards this.
  - Dedicated bench (`utf-validate-swar`) and charts
    (`utf-validate-swar-vs-simd`) cover the size sweep and crossover.

- **SWAR UTF-8 encode/decode paths**, now the default for `UTF8.encode` /
  `decode` (and the `*Unsafe` variants). A SIMD-within-a-register transcoder
  (8 code units / bytes per `u64` ASCII fast path + the existing strict scalar
  coders for multibyte) handles small/medium input; the SIMD kernels are
  dispatched only when compiled in and above a size threshold (encode 32 units,
  decode 256 bytes), since they do no vector work below their window. Output is
  byte-identical on valid input (verified by a four-way differential — SWAR vs
  SIMD vs public API vs stdlib `String.UTF8` — plus fuzz round-trips).
  - **Up to ~3× faster on small ASCII** decode/encode (< ~128 bytes).
  - **`encode` / `decode` now compile and run with `--enable simd` off** (the
    v128 kernels, including the length pre-counter used by `byteLength`, are
    dead-code-eliminated). Covered by the no-SIMD test suite.
  - Dedicated bench (`utf-transcode-swar`) and charts
    (`utf-transcode-swar-vs-simd`) cover the size sweep and crossover.

- **SWAR UTF-16 validation path**, now the default for `UTF16.validate` /
  `validateUnsafe`. A BMP fast path skips 4 surrogate-free code units per `u64`,
  with a per-unit surrogate-pairing check; the SIMD bitmask kernel is dispatched
  only when compiled in and at/above one 8-unit block (16 bytes). Byte-exact
  with the SIMD path (three-way differential + fuzz).
  - **~2-2.5× faster on sub-block input** (< 16 bytes): no 16-byte scratch fill.
  - **`UTF16.validate` compiles and runs with `--enable simd` off.** Combined
    with the UTF-8 work, the entire library now builds without SIMD (`UTF16`
    encode/decode were already a plain `memory.copy`). Bench
    (`utf16-validate-swar`) and chart (`utf16-validate-swar-vs-simd`) added.

### Changed

- The default code path for validate / encode / decode is now SWAR; the SIMD
  kernels are reached only above their dispatch thresholds (UTF-8 validate ≥ 64
  bytes, encode ≥ 32 units, decode ≥ 256 bytes, UTF-16 validate ≥ 16 bytes).
  Behavior and output are unchanged on valid input. SIMD remains enabled by
  default via `asconfig.json`; building with `--disable simd` (or omitting
  `--enable simd`) now yields a working scalar/SWAR build instead of a compile
  error.
- Tests run in two as-test modes (`simd` / `nosimd`) so both builds are covered
  by CI; `npm test` runs both. The no-SIMD build is exercised via a dedicated
  mode rather than a second config file.

## [0.1.1] - 2026-06-04

### Changed

- Dropped the Wasm **sign-extension** feature requirement. The SIMD kernels only
  use vector lane ops, never scalar `i32.extend8_s` / `i32.extend16_s`, so the
  feature was never actually needed. Builds now require only `--enable simd`
  (`--enable bulk-memory` still recommended), widening runtime compatibility with
  no behavior change.

## [0.1.0] - 2026-06-01

Initial release — SIMD UTF-8/UTF-16 for AssemblyScript, a drop-in for stdlib
`String.UTF8` / `String.UTF16` with simdutf-derived 128-bit Wasm SIMD kernels.

### Added

- **`UTF8`** namespace, drop-in for `String.UTF8`: `byteLength`, `encode` /
  `encodeUnsafe`, `decode` / `decodeUnsafe`, plus the `utf16Length` /
  `utf16LengthUnsafe` extensions. SIMD kernels (ported from simdutf's westmere
  SSE4 `utf16le_to_utf8` / `utf8_to_utf16le`) cover the stdlib-default path; a
  byte-for-byte scalar clone handles `nullTerminated`, `REPLACE`, and `ERROR`
  modes. Decode is permissive — pair with `UTF8.validate` for strict input.
- **`UTF16`** namespace, drop-in for `String.UTF16`: `byteLength`, `encode` /
  `encodeUnsafe`, `decode` / `decodeUnsafe`.
- **Validators** on both namespaces: `UTF8.validate` / `UTF8.validateUnsafe`
  (Keiser–Lemire, with per-chunk ASCII subdivision) and `UTF16.validate` /
  `UTF16.validateUnsafe` (surrogate-pair checking with a surrogate-free fast
  path). The `*Unsafe` variants take a pointer and a byte length; empty input
  is valid.
- **Length pre-counters**: `utf16_length_from_utf8` and `utf8_length_from_utf16`
  for sizing destination buffers without a full conversion.

### Performance

On simdutf's `wikipedia_mars/*.html` + `emoji.txt` fixtures (V8 / Apple Silicon):

- `UTF8.decode` — 2–7× faster than `String.UTF8.decode`.
- `UTF8.encode` — 8–13× faster than `String.UTF8.encode`.
- `UTF8.validate` — up to ~58 GB/s on ASCII-heavy markup; 11–35 GB/s on mixed
  multibyte content.
- `UTF16.validate` — ~24–25 GB/s on BMP-heavy text via the surrogate-free fast
  path; ~13 GB/s on dense surrogate-pair content.

[Unreleased]: https://github.com/JairusSW/utf-as/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/JairusSW/utf-as/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/JairusSW/utf-as/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/JairusSW/utf-as/releases/tag/v0.1.0
