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
  - [Charts](#charts)
- [Contributing](#contributing)
- [License](#license)
- [Contact](#contact)

</details>

## What

This library ports simdutf's westmere SSE4 UTF-8 kernels to 128-bit Wasm SIMD and exposes them through the same namespace shape, so you can swap them in by changing the import. It also includes fast validators for both UTF-8 and UTF-16.

- `UTF8.decode` → 2.1–6.7× faster than `String.UTF8.decode` on the HTML payloads
- `UTF8.encode` → 4.3–9.4× faster than `String.UTF8.encode` on the HTML payloads
- `UTF8.validate` → up to 55.4 GB/s on ASCII-heavy HTML; 11.9–34.4 GB/s on other HTML payloads
- `UTF16.validate` → 26.2–26.5 GB/s on the HTML payloads; 13.9 GB/s on dense surrogate pairs

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

- **Small inputs are faster.** Below 64 bytes the SWAR path skips the SIMD kernel's 64-byte scratch fill and validates 8 bytes at a time — up to ~3× the throughput of the SIMD path on short ASCII (see the [chart](#charts)).
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

Apple M4 Max / V8 15.2.20, captured 2026-09-23 from merged main (`b3c5fab`).
The HTML payloads were downloaded that day, so their contents can differ from
older captures. Each value is the median of three one-second runs. Throughput
uses UTF-8 input bytes, except `UTF16.validate`, which uses UTF-16 bytes.

| Payload | `UTF8.decode` | × stdlib | `UTF8.encode` | × stdlib | `UTF8.validate` | `UTF16.validate` |
|---|---:|---:|---:|---:|---:|---:|
| english.html    | 17.8 | 6.74× | 11.5 | 9.43× | **55.4** | 26.4 |
| german.html     | 11.4 | 4.65× | 9.0 | 7.86× | 34.4 | 26.5 |
| portuguese.html | 9.8 | 4.07× | 7.7 | 7.02× | 30.0 | 26.4 |
| french.html     | 6.6 | 2.80× | 5.7 | 5.13× | 23.4 | 26.5 |
| turkish.html    | 6.8 | 2.94× | 6.4 | 6.26× | 21.9 | 26.4 |
| vietnamese.html | 5.1 | 2.37× | 5.5 | 5.61× | 19.6 | 26.3 |
| chinese.html    | 6.6 | 2.88× | 6.8 | 6.46× | 17.5 | 26.4 |
| japanese.html   | 5.8 | 2.62× | 6.2 | 5.65× | 14.7 | 26.5 |
| thai.html       | 5.9 | 2.52× | 5.7 | 4.86× | 15.7 | 26.4 |
| hindi.html      | 5.4 | 2.48× | 6.3 | 5.85× | 15.9 | 26.4 |
| arabic.html     | 4.6 | 2.32× | 4.4 | 4.48× | 13.9 | 26.5 |
| korean.html     | 4.8 | 2.32× | 5.7 | 5.75× | 14.0 | 26.5 |
| russian.html    | 4.6 | 2.30× | 4.2 | 4.29× | 14.0 | 26.2 |
| hebrew.html     | 4.1 | 2.11× | 4.3 | 4.47× | 11.9 | 26.4 |
| emoji.txt       | 1.6 | 0.64× | 1.0 | 0.92× | 6.7 | 13.9 |

All throughput cells are GB/s. `emoji.txt` is the outlier: its dense
supplementary-plane sequences make both public conversions slower than the
stdlib, while validation also falls below the HTML rates.

The optional Wide validators were measured separately on a Ryzen 7 7800X3D
with Wago and its Wide plugin, using the premerge `13f46c7` tree that was
merged into `b3c5fab`. Each call validates 4 KiB; times below are per call
from repeated batches of 100 validations.

| UTF-8 input | SWAR | v128 | Wide 256 | Wide 512 |
|---|---:|---:|---:|---:|
| ASCII | 95 ns | 94 ns | 192 ns | 192 ns |
| Latin | 620 ns | 676 ns | 18.0 µs | 10.6 µs |
| CJK | 3.34 µs | 673 ns | 18.0 µs | 10.6 µs |
| Emoji | 2.74 µs | 668 ns | 18.1 µs | 10.7 µs |

The published as-simd transform currently lowers only three v256 operations
and no v512 operations in this module. Most Wide validation work therefore
runs in portable Wasm, and v128 is the faster choice for these inputs.

### Charts

Historical v0.2.0 charts. The table above is the current main-branch capture.

<details>
<summary><b><code>UTF8.decode</code> vs <code>String.UTF8.decode</code></b> (v0.2.0)</summary>

![UTF8.decode vs stdlib](https://raw.githubusercontent.com/JairusSW/utf-as/refs/heads/docs/charts/v0.2.0/utf-vs-stdlib-decode-v8.png)

</details>

<details>
<summary><b><code>UTF8.encode</code> vs <code>String.UTF8.encode</code></b> (v0.2.0)</summary>

![UTF8.encode vs stdlib](https://raw.githubusercontent.com/JairusSW/utf-as/refs/heads/docs/charts/v0.2.0/utf-vs-stdlib-encode-v8.png)

</details>

<details>
<summary><b><code>UTF8.validate</code></b> (v0.2.0)</summary>

![UTF8.validate throughput](https://raw.githubusercontent.com/JairusSW/utf-as/refs/heads/docs/charts/v0.2.0/utf-validate-simdutf-v8.png)

</details>

<details>
<summary><b><code>UTF16.validate</code></b> (v0.2.0)</summary>

![UTF16.validate throughput](https://raw.githubusercontent.com/JairusSW/utf-as/refs/heads/docs/charts/v0.2.0/utf16-validate-simdutf-v8.png)

</details>

<details>
<summary><b>SWAR vs SIMD <code>UTF8.validate</code></b> (v0.2.0)</summary>

![SWAR vs SIMD validate, ASCII](https://raw.githubusercontent.com/JairusSW/utf-as/refs/heads/docs/charts/v0.2.0/utf-validate-swar-vs-simd-ascii-v8.png)
![SWAR vs SIMD validate, mixed](https://raw.githubusercontent.com/JairusSW/utf-as/refs/heads/docs/charts/v0.2.0/utf-validate-swar-vs-simd-mixed-v8.png)

Regenerate with `npm run bench -- utf-validate-swar && npm run charts:build -- utf-validate-swar-vs-simd`.

</details>

<details>
<summary><b>SWAR vs SIMD <code>UTF8.decode</code> / <code>UTF8.encode</code></b> (v0.2.0)</summary>

![SWAR vs SIMD decode, ASCII](https://raw.githubusercontent.com/JairusSW/utf-as/refs/heads/docs/charts/v0.2.0/utf-decode-swar-vs-simd-ascii-v8.png)
![SWAR vs SIMD encode, ASCII](https://raw.githubusercontent.com/JairusSW/utf-as/refs/heads/docs/charts/v0.2.0/utf-encode-swar-vs-simd-ascii-v8.png)

Regenerate with `npm run bench -- utf-transcode-swar && npm run charts:build -- utf-transcode-swar-vs-simd`.

</details>

<details>
<summary><b>SWAR vs SIMD <code>UTF16.validate</code></b> (v0.2.0)</summary>

![SWAR vs SIMD UTF-16 validate, BMP](https://raw.githubusercontent.com/JairusSW/utf-as/refs/heads/docs/charts/v0.2.0/utf16-validate-swar-vs-simd-bmp-v8.png)

Regenerate with `npm run bench -- utf16-validate-swar && npm run charts:build -- utf16-validate-swar-vs-simd`.

</details>

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

The V8 runner loads payload fixtures via a `readFile` hostcall; WASI runtimes have none, so the harness packs the fetched fixtures and pipes them in on stdin (`scripts/pack-simdutf-fixtures.mjs`). Run `npm run bench:fetch` first for any payload bench under `--wavm`/`--wazero`.

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
