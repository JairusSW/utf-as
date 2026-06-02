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

- `UTF8.decode`  →  2-7× faster than `String.UTF8.decode`
- `UTF8.encode`  →  8-13× faster than `String.UTF8.encode`
- `UTF8.validate`  →  up to 58 GB/s on ASCII-heavy HTML; 11-35 GB/s on mixed multibyte content
- `UTF16.validate`  →  ~24-25 GB/s on BMP-heavy text (surrogate-free fast path); ~13 GB/s on dense surrogate-pair content

If you often pass strings between a UTF-8-based host and wasm, consider using `UTF8.decode`/`UTF8.encode` for much faster conversion and less overhead.

## Installation

```bash
npm install utf-as
```

Then import from the package root:

```ts
import { UTF8, UTF16 } from "utf-as";
```

Builds need [SIMD](https://github.com/WebAssembly/spec/blob/main/proposals/simd/SIMD.md) and [Sign Extension](https://github.com/WebAssembly/spec/blob/main/proposals/sign-extension-ops/Overview.md) enabled:

```bash
--enable simd --enable sign-extension
```

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

Drop-in for `String.UTF8`. The SIMD kernels handle the stdlib-default path; the scalar fallback (a byte-for-byte stdlib clone) covers `nullTerminated`, `REPLACE`, and `ERROR` modes.

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

### Length pre-counters

Output-size pre-computation for sizing destination buffers without performing the full conversion.

```ts
utf16_length_from_utf8(src: usize, len: i32): i32   // → UTF-16 units from UTF-8 bytes
utf8_length_from_utf16(src: usize, len: i32): i32   // → UTF-8 bytes from UTF-16 units (0 on lone surrogate)
```

## Performance

### Benchmarks

V8 / Apple Silicon, GB/s of UTF-8 input. Payloads are simdutf's `wikipedia_mars/*.html` + `emoji.txt`.

| Payload | `UTF8.decode` | × stdlib | `UTF8.encode` | × stdlib | `UTF8.validate` |
|---|---:|---:|---:|---:|---:|
| english.html    | 16.4 GB/s | 6.97× | 14.2 GB/s | 13.0× | **59.6 GB/s** |
| german.html     | 10.8 GB/s | 4.71× | 12.0 GB/s | 11.3× | 35.3 GB/s |
| portuguese.html | 9.2 GB/s  | 4.29× | 11.2 GB/s | 11.0× | 30.4 GB/s |
| french.html     | 7.1 GB/s  | 3.19× | 10.5 GB/s | 10.4× | 24.6 GB/s |
| turkish.html    | 6.5 GB/s  | 3.05× | 9.4 GB/s  | 10.2× | 21.1 GB/s |
| vietnamese.html | 5.3 GB/s  | 2.67× | 8.2 GB/s  | 9.5×  | 21.1 GB/s |
| chinese.html    | 6.2 GB/s  | 2.88× | 10.2 GB/s | 10.2× | 17.5 GB/s |
| japanese.html   | 5.9 GB/s  | 2.66× | 9.6 GB/s  | 9.4×  | 15.4 GB/s |
| thai.html       | 6.2 GB/s  | 2.58× | 8.3 GB/s  | 8.4×  | 15.6 GB/s |
| hindi.html      | 5.8 GB/s  | 2.40× | 9.0 GB/s  | 9.4×  | 16.2 GB/s |
| arabic.html     | 4.7 GB/s  | 2.55× | 7.1 GB/s  | 8.4×  | 14.3 GB/s |
| korean.html     | 4.6 GB/s  | 2.15× | 9.1 GB/s  | 9.7×  | 14.1 GB/s |
| russian.html    | 4.4 GB/s  | 2.45× | 6.6 GB/s  | 8.1×  | 14.0 GB/s |
| hebrew.html     | 3.9 GB/s  | 2.19× | 6.8 GB/s  | 8.1×  | 11.6 GB/s |
| emoji.txt       | 1.5 GB/s  | 0.62× | 1.8 GB/s  | 1.7×  | 6.6 GB/s |

Emoji.txt is the outlier on both sides: 100% supplementary-plane 4-byte sequences force the SIMD path's surrogate-pair branch on every block, defeating the BMP fast lanes. For non-emoji content the wins are consistent across scripts.

### Charts

V8 / Apple Silicon, per simdutf payload. Regenerate with `npm run charts`.

<details>
<summary><b><code>UTF8.decode</code> vs <code>String.UTF8.decode</code></b> - 2-7× faster across scripts</summary>

![UTF8.decode vs stdlib](charts/utf-vs-stdlib-decode-v8.png)

</details>

<details>
<summary><b><code>UTF8.encode</code> vs <code>String.UTF8.encode</code></b> - 8-13× faster across scripts</summary>

![UTF8.encode vs stdlib](charts/utf-vs-stdlib-encode-v8.png)

</details>

<details>
<summary><b><code>UTF8.validate</code></b> - up to ~58 GB/s on ASCII-heavy markup, tapering with multibyte density</summary>

![UTF8.validate throughput](charts/utf-validate-simdutf-v8.png)

</details>

<details>
<summary><b><code>UTF16.validate</code></b> - a flat ~24-25 GB/s on BMP text (surrogate-free fast path); <code>emoji.txt</code> is the lone all-surrogate outlier</summary>

![UTF16.validate throughput](charts/utf16-validate-simdutf-v8.png)

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
