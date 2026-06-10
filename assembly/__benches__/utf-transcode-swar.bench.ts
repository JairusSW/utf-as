// SWAR vs SIMD UTF-8 encode/decode throughput across input sizes.
//
// The SWAR transcoders are the default; the SIMD kernels are dispatched only
// above a size threshold (encode 32 units, decode 80 bytes) since they do no
// vector work below their window. This bench sweeps both across ASCII and
// mixed-script input so the crossover is measurable and the thresholds tunable.
//
// Results dump as `utf-{decode,encode}-{swar,simd}-{ascii,mixed}-<bytes>` for
// the companion chart (scripts/charts/utf-transcode-swar-vs-simd.mjs).

import { bench, dumpToFile, blackbox } from "./lib/bench";
import { utf8_to_utf16le_swar, utf16le_to_utf8_swar } from "../utf/utf8_swar";
import { utf8_to_utf16le, utf16le_to_utf8 } from "../utf/utf8";
import { asciiCorpus, mixedCorpus } from "./fixtures/corpora";

const OPS: u64 = 50_000;
const MIN_MS: f64 = 400;

// Active operands — set before each `bench` (AS has no closures).
let SRC: usize = 0;   // decode: UTF-8 bytes / encode: UTF-16 units
let N: i32 = 0;       // decode: byte length / encode: unit length
let DST: usize = 0;

function decodeSwar(): void { blackbox(utf8_to_utf16le_swar(SRC, N, DST)); }
function decodeSimd(): void { blackbox(utf8_to_utf16le(SRC, N, DST)); }
function encodeSwar(): void { blackbox(utf16le_to_utf8_swar(SRC, N, DST)); }
function encodeSimd(): void { blackbox(utf16le_to_utf8(SRC, N, DST)); }

const keep: ArrayBuffer[] = [];

function runDecode(label: string, utf8: ArrayBuffer): void {
  SRC = changetype<usize>(utf8);
  N = utf8.byteLength;
  const dst = new ArrayBuffer(N * 2 + 64); keep.push(dst);
  DST = changetype<usize>(dst);
  const swar = "utf-decode-swar-" + label;
  bench(swar, decodeSwar, OPS, <u64>N, MIN_MS); dumpToFile(swar);
  const simd = "utf-decode-simd-" + label;
  bench(simd, decodeSimd, OPS, <u64>N, MIN_MS); dumpToFile(simd);
}

function runEncode(label: string, s: string): void {
  SRC = changetype<usize>(s);
  N = s.length;
  const refBytes = String.UTF8.byteLength(s);
  const dst = new ArrayBuffer(refBytes + 64); keep.push(dst);
  DST = changetype<usize>(dst);
  // Report UTF-8 bytes produced as the throughput denominator (matches decode).
  const swar = "utf-encode-swar-" + label;
  bench(swar, encodeSwar, OPS, <u64>refBytes, MIN_MS); dumpToFile(swar);
  const simd = "utf-encode-simd-" + label;
  bench(simd, encodeSimd, OPS, <u64>refBytes, MIN_MS); dumpToFile(simd);
}

// ASCII: exact byte sizes (UTF-8 == UTF-16-unit count for ASCII).
const asciiSizes: i32[] = [8, 16, 32, 48, 64, 96, 128, 256, 1024, 8192, 65536];
for (let i = 0; i < asciiSizes.length; i++) {
  const n = asciiSizes[i];
  const s = asciiCorpus(n);
  const label = "ascii-" + n.toString();
  runDecode(label, String.UTF8.encode(s));
  runEncode(label, s);
}

// Mixed-script (2/3/4-byte) at larger sizes.
const mixedSizes: i32[] = [64, 128, 256, 1024, 8192, 65536];
for (let i = 0; i < mixedSizes.length; i++) {
  const n = mixedSizes[i];
  const s = mixedCorpus(n);
  const label = "mixed-" + n.toString();
  runDecode(label, String.UTF8.encode(s));
  runEncode(label, s);
}
