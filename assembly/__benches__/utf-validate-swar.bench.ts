// SWAR vs SIMD UTF-8 validation throughput across input sizes.
//
// The SWAR validator is the default path; the SIMD validator wins only once the
// input is large enough to amortize its 64-byte window + scratch fill. This
// bench sweeps both validators over a range of sizes (ASCII and mixed-script)
// so the crossover — and the small-input SWAR advantage — is measurable, and so
// `SIMD_THRESHOLD` in utf8.ts can be tuned against real numbers.
//
// Results dump as `utf-validate-{swar,simd}-{ascii,mixed}-<bytes>` for the
// companion chart (scripts/charts/utf-validate-swar-vs-simd.mjs).

import { bench, dumpToFile, blackbox } from "./lib/bench";
import { validateSwar } from "../utf/validate_swar";
import { validateSimd } from "../utf/validate";
import { asciiCorpus, mixedCorpus } from "./fixtures/corpora";

// Per-bench batch size and floor time. Small inputs need many iterations to
// register; minMs keeps each measurement stable without dragging the suite.
const OPS: u64 = 50_000;
const MIN_MS: f64 = 400;

// Active input for the routines below — set before each `bench` call (AS has no
// closures, so the routines read module-level state, like utf-validate-simdutf).
let P: usize = 0;
let N: i32 = 0;

function benchSwar(): void { blackbox(validateSwar(P, N)); }
function benchSimd(): void { blackbox(validateSimd(P, N)); }

// Keep every fixture buffer alive for the whole run so the incremental GC can't
// reclaim one mid-measurement.
const keep: ArrayBuffer[] = [];

function run(desc: string, buf: ArrayBuffer, swar: bool): void {
  P = changetype<usize>(buf);
  N = buf.byteLength;
  bench(desc, swar ? benchSwar : benchSimd, OPS, <u64>N, MIN_MS);
  dumpToFile(desc);
}

function sweep(label: string, buf: ArrayBuffer): void {
  run("utf-validate-swar-" + label, buf, true);
  run("utf-validate-simd-" + label, buf, false);
}

// ASCII: exact sizes (UTF-8 is 1:1 for ASCII), spanning below and above the
// 64-byte SIMD threshold up to 64 KiB.
const asciiSizes: i32[] = [8, 16, 32, 48, 64, 96, 128, 256, 1024, 8192, 65536];
for (let i = 0; i < asciiSizes.length; i++) {
  const n = asciiSizes[i];
  const buf = String.UTF8.encode(asciiCorpus(n));
  keep.push(buf);
  sweep("ascii-" + n.toString(), buf);
}

// Mixed-script (2/3/4-byte) at larger sizes, where the SIMD kernel's dense-
// multibyte path is expected to pull ahead.
const mixedSizes: i32[] = [64, 128, 256, 1024, 8192, 65536];
for (let i = 0; i < mixedSizes.length; i++) {
  const n = mixedSizes[i];
  const buf = String.UTF8.encode(mixedCorpus(n));
  keep.push(buf);
  sweep("mixed-" + n.toString(), buf);
}
