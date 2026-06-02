// Kernel-only UTF benches: call the SIMD kernel directly with a preallocated
// destination buffer, so each iteration measures pure conversion cost (no
// per-op allocation / __renew). Useful for isolating kernel perf vs. the
// namespace's allocation overhead.

import { bench, dumpToFile, blackbox } from "./lib/bench";
import { utf8_to_utf16le } from "../utf/utf8";
import { mixedCorpus, asciiCorpus } from "./fixtures/corpora";

const TARGET_BYTES: i32 = 64 * 1024;
const OPS: u64 = 5_000;

const mixedStr = mixedCorpus(TARGET_BYTES);
const mixedUtf8 = String.UTF8.encode(mixedStr);
const asciiStr = asciiCorpus(TARGET_BYTES);
const asciiUtf8 = String.UTF8.encode(asciiStr);

// Worst-case sized output buffers — 1 u16 per UTF-8 byte covers any input.
const mixedDst = new ArrayBuffer(mixedUtf8.byteLength * 2 + 32);
const asciiDst = new ArrayBuffer(asciiUtf8.byteLength * 2 + 32);

bench("utf-kernel-mixed-decode", () => {
  blackbox(utf8_to_utf16le(
    changetype<usize>(mixedUtf8),
    mixedUtf8.byteLength,
    changetype<usize>(mixedDst),
  ));
}, OPS, <u64>mixedUtf8.byteLength);
dumpToFile("utf-kernel-mixed-decode");

bench("utf-kernel-ascii-decode", () => {
  blackbox(utf8_to_utf16le(
    changetype<usize>(asciiUtf8),
    asciiUtf8.byteLength,
    changetype<usize>(asciiDst),
  ));
}, OPS, <u64>asciiUtf8.byteLength);
dumpToFile("utf-kernel-ascii-decode");
