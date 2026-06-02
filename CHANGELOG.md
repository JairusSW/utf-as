# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/JairusSW/utf-as/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/JairusSW/utf-as/releases/tag/v0.1.0
