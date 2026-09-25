<h1 align="center"><pre>╔═╗ ╔═╗    ╦ ╦ ╔╦╗ ╔═╗
╠═╣ ╚═╗ ══ ║ ║  ║  ╠═ 
╩ ╩ ╚═╝    ╚═╝  ╩  ╩  </pre></h1>

<details>
<summary>Table of Contents</summary>

- [What](#what)
- [Installation](#installation)
- [Usage](#usage)
- [API](#api)
  - [`UTF8`](#utf8)
  - [`UTF16`](#utf16)
  - [Validation](#validation)
  - [Length pre-counters](#length-pre-counters)
  - [Wide kernels](#wide-kernels)
- [Performance](#performance)
  - [Benchmarks](#benchmarks)
  - [Running benchmarks locally](#running-benchmarks-locally)
- [Contributing](#contributing)
- [License](#license)
- [Contact](#contact)

</details>

## What

This library bases itself off of simdutf's westmere SSE4 UTF-8 kernels, ports them to 128-bit Wasm SIMD, and exposes them through the same namespace shape. It also includes fast validators for both UTF-8 and UTF-16.

- `UTF8.decode` → 2.1–6.7× faster than `String.UTF8.decode` on the HTML payloads
- `UTF8.encode` → 4.3–9.4× faster than `String.UTF8.encode` on the HTML payloads
- `UTF8.validate` → up to 55.4 GB/s on ASCII-heavy HTML; 11.9–34.4 GB/s on other HTML payloads
- `UTF16.validate` → up to 87 GB/s on surrogate-free HTML; about 13–14 GB/s on dense surrogate pairs

Every operation has a portable **SWAR** (SIMD-within-a-register) path that runs by default and is dispatched to the SIMD kernel only above a size threshold, so small inputs avoid SIMD setup overhead and the library works **with or without `--enable simd`** (the throughput figures above were measured with SIMD enabled).

If you often pass strings between a UTF-8-based host and wasm, consider using `UTF8.decode`/`UTF8.encode` for much faster conversion and less overhead.

## Installation

```bash
npm install utf-as
```

Then import from the package root:

```ts
import { UTF8, UTF16 } from "utf-as";
```

For full throughput, enable [SIMD](https://github.com/WebAssembly/spec/blob/main/proposals/simd/SIMD.md) (it is on by default in the bundled `asconfig.json`):

```bash
--enable simd
```

SIMD is no longer required — with `--disable simd` (or a toolchain without it) the library falls back to its scalar/SWAR paths and still works, just slower on large input.

Enabling [Bulk Memory](https://github.com/WebAssembly/spec/blob/main/proposals/bulk-memory-operations/Overview.md) helps with memory allocation overhead and is not required, but strongly recommended.

```bash
--enable bulk-memory 
```

## Usage

```ts
import { UTF8, UTF16 } from "utf-as";

const bytes = UTF8.encode("Hello, 世界 🌍");      // ArrayBuffer
const back  = UTF8.decode(bytes);                 // string
const valid = UTF8.validate(bytes);               // bool - strict UTF-8 check

// UTF-16 is memcpy under the hood (kept for API parity with String.UTF16)
const wide  = UTF16.encode("Hello");              // ArrayBuffer
const wback = UTF16.decode(wide);                 // string
```

All namespace functions match their Standard Library `String.UTF8` / `String.UTF16` counterparts' signatures - same `ErrorMode` enum (`WTF8` / `REPLACE` / `ERROR`), same `nullTerminated` flag, byte-for-byte stdlib parity on valid input. They are 100% interchangeable.

## API

### `UTF8`

Drop-in for `String.UTF8`. `encode` / `decode` use a **SWAR** transcoder by default. With SIMD enabled, encoding switches to v128 at 16 UTF-16 units; decoding switches at 512 bytes, or at 256 bytes for pure ASCII. A short leading sample routes dense mixed CJK text to the scalar encoder; runs of surrogate pairs use a dedicated SIMD encoder. ASCII input also uses the fast encoder in `REPLACE` and `ERROR` modes; mixed text, lone surrogates, and `nullTerminated` use the scalar fallback in those modes. Both functions compile and run without SIMD.

```ts
UTF8.byteLength(str: string, nullTerminated?: bool): i32
UTF8.encode(str: string, nullTerminated?: bool, errorMode?: UTF8.ErrorMode): ArrayBuffer
UTF8.decode(buf: ArrayBuffer, nullTerminated?: bool): string

// Pointer-based variants - no allocation, caller-owned buffers:
UTF8.encodeUnsafe(str: usize, len: i32, buf: usize, ...): usize
UTF8.decodeUnsafe(buf: usize, len: usize, nullTerminated?: bool): string

// Extensions (not in stdlib):
UTF8.utf16Length(buf: ArrayBuffer): i32
UTF8.utf16LengthUnsafe(buf: usize, len: i32): i32
UTF8.validate(buf: ArrayBuffer): bool
UTF8.validateUnsafe(buf: usize, len: i32): bool
```

Decode is *permissive* - see the [Architecture](#architecture) notes for what that means in practice.

### `UTF16`

Drop-in for `String.UTF16`. UTF-16LE in, UTF-16LE out - all four entry points are memcpy-shaped, kept for API parity so callers can swap our package in without touching call sites.

```ts
UTF16.byteLength(str: string): i32
UTF16.encode(str: string): ArrayBuffer
UTF16.decode(buf: ArrayBuffer): string
UTF16.encodeUnsafe(str: usize, len: i32, buf: usize): usize
UTF16.decodeUnsafe(buf: usize, len: usize): string

// Extensions (not in stdlib):
UTF16.validate(buf: ArrayBuffer): bool
UTF16.validateUnsafe(buf: usize, len: i32): bool
```

### Validation

Strict validators with no stdlib equivalent, exposed on both namespaces. The `*Unsafe` variants take a raw pointer and a **byte** length (`UTF16.validateUnsafe` returns `false` on an odd byte length); the `ArrayBuffer` forms wrap them. Empty input is valid.

```ts
UTF8.validate(buf: ArrayBuffer): bool
UTF8.validateUnsafe(buf: usize, len: i32): bool       // len in bytes

UTF16.validate(buf: ArrayBuffer): bool
UTF16.validateUnsafe(buf: usize, len: i32): bool      // len in bytes
```

- **`UTF8`** (Keiser–Lemire, "Validating UTF-8 in less than one instruction per byte"): rejects lone continuation bytes, overlong sequences, UTF-8-encoded surrogates (`ED A0–BF X`), out-of-range codepoints (>U+10FFFF), and truncated multibyte at EOF.
- **`UTF16`**: rejects lone surrogates - every high surrogate (`D800–DBFF`) must be immediately followed by a low surrogate (`DC00–DFFF`), and vice versa - plus odd byte lengths.

`UTF8.validate` runs a **SWAR** (SIMD-within-a-register, 8 bytes per `u64`) validator by default and dispatches to the SIMD kernel only when SIMD is compiled in (`ASC_FEATURE_SIMD`) **and** the input is ≥ 64 bytes. The two paths agree byte-for-byte. Two consequences:

- **Small inputs are faster.** Below 64 bytes the SWAR path skips the SIMD kernel's 64-byte scratch fill and validates 8 bytes at a time — up to ~3× the throughput of the SIMD path on short ASCII.
- **SIMD is now optional for validation.** With `--enable simd` off, `UTF8.validate` compiles and runs through the SWAR path alone (it reaches zero v128 ops).

`UTF16.validate` works the same way (SWAR default, SIMD ≥ 16 bytes / one 8-unit block) and is ~2-2.5× faster than the SIMD path on sub-block input. `UTF8.encode` / `decode` likewise default to SWAR (see [`UTF8`](#utf8)); `UTF16.encode` / `decode` are a plain `memory.copy`. The whole library now compiles and runs with `--enable simd` off.

### Length pre-counters

Output-size pre-computation for sizing destination buffers without performing the full conversion.

```ts
utf16_length_from_utf8(src: usize, len: i32): i32   // → UTF-16 units from UTF-8 bytes
utf8_length_from_utf16(src: usize, len: i32): i32   // → UTF-8 bytes from UTF-16 units (0 on lone surrogate)
```

### Wide kernels

The optional `utf-as/wide` entrypoint exposes 256-bit and 512-bit validators
and length counters. Its block algorithms live in this package and use the
published `as-simd@0.0.2` generic Wide API:

```ts
import {
  validateWide256, validateWide512,
  validateUtf16Wide256, validateUtf16Wide512,
  utf16LengthWide256, utf16LengthWide512,
  utf8LengthWide256, utf8LengthWide512,
} from "utf-as/wide";
```

Validation lengths are in bytes; `utf8LengthWide*` takes UTF-16 code units and
returns zero on malformed input. UTF-8 length counting assumes well-formed
input. Validation and length counting use general vector operations, with
portable fallbacks. `WAGO_PLUGINS=wide` and `--transform as-simd` let the
published transform lower supported operations to Wide imports. Current
compiler output keeps most of these algorithms in portable Wasm, including
the 512-bit validation path. The public `UTF8` and `UTF16` namespaces retain
their SWAR/v128 dispatch.

## Performance

### Benchmarks

![String.UTF8.decode versus utf-as SIMD and SWAR decode throughput on 15 payloads](./charts/utf-vs-stdlib-decode-v8.png)

![String.UTF8.encode versus utf-as SIMD and SWAR encode throughput on 15 payloads](./charts/utf-vs-stdlib-encode-v8.png)

![utf-as UTF8.validate SIMD and SWAR throughput on 15 payloads](./charts/utf8-validate-simdutf-v8.png)

![utf-as UTF16.validate SIMD and SWAR throughput on 15 payloads](./charts/utf16-validate-simdutf-v8.png)

### Running benchmarks locally

```bash
npm install
npm run bench:fetch              # one-time: pulls simdutf payloads into fixtures/simdutf/
npm run bench:simdutf            # validator over the 18 payloads
npm run bench:vs-stdlib          # head-to-head stdlib UTF8 vs ours (encode + decode)
npm run bench:summary            # markdown summary of results from build/logs/as/<runtime>/
npm run charts                   # build + serve ./charts on :3000
```

Multi-runtime - pass `--wavm` or `--wazero` to any bench command (binaries need to be in PATH):

```bash
npm run bench -- --wavm utf-vs-stdlib
npm run charts:build -- --wavm
```

Optional memory tracking via [`as-heap-analyzer`](https://www.npmjs.com/package/as-heap-analyzer):

```bash
npm run bench -- --memory utf-vs-stdlib
```

## Contributing

PRs are welcome - open an issue first if it's a non-trivial change so we can sync on the approach. Run `npm test` and `npm run bench:simdutf` before submitting; the bench delta versus baseline is a useful thing to include in the PR description.

## License

This project is distributed under an open source license. Work on this project is done by passion, but if you want to support it financially, you can do so by making a donation to the project's [GitHub Sponsors](https://github.com/sponsors/JairusSW) page.

You can view the full license using the following link: [License](./LICENSE)

## Contact

Please send all issues to [GitHub Issues](https://github.com/JairusSW/json-as/issues) and to converse, please send me an email at [me@jairus.dev](mailto:me@jairus.dev)

- **Email:** Send me inquiries, questions, or requests at [me@jairus.dev](mailto:me@jairus.dev)
- **GitHub:** Visit the official GitHub repository [Here](https://github.com/JairusSW/json-as)
- **Website:** Visit my official website at [jairus.dev](https://jairus.dev/)
- **Discord:** Contact me at [My Discord](https://discord.com/users/600700584038760448) or on the [AssemblyScript Discord Server](https://discord.gg/assemblyscript/)
