// SWAR vs SIMD UTF-16 validation throughput across input sizes.
//
// The SWAR validator is the default; the SIMD kernel is dispatched only when
// compiled in and above the threshold (32 bytes), since below its 8-unit window
// it just zero-pads a scratch block. This sweeps both over BMP-only text (the
// surrogate-free fast path) and surrogate-pair-dense text so the crossover and
// the small-input SWAR advantage are measurable.
//
// Results dump as `utf16-validate-{swar,simd}-{bmp,surr}-<bytes>` for the
// companion chart (scripts/charts/utf16-validate-swar-vs-simd.mjs).

import { bench, dumpToFile, blackbox } from "./lib/bench";
import { validateUtf16Swar } from "../utf/validate_swar";
import { validateUtf16Simd } from "../utf/validate";

const OPS: u64 = 50_000;
const MIN_MS: f64 = 400;

let P: usize = 0;
let N: i32 = 0;

function benchSwar(): void { blackbox(validateUtf16Swar(P, N)); }
function benchSimd(): void { blackbox(validateUtf16Simd(P, N)); }

const keep: ArrayBuffer[] = [];

function sweep(label: string, buf: ArrayBuffer): void {
  P = changetype<usize>(buf);
  N = buf.byteLength;
  const swar = "utf16-validate-swar-" + label;
  bench(swar, benchSwar, OPS, <u64>N, MIN_MS); dumpToFile(swar);
  const simd = "utf16-validate-simd-" + label;
  bench(simd, benchSimd, OPS, <u64>N, MIN_MS); dumpToFile(simd);
}

// Build a UTF-16 buffer of `byteLen` bytes (`byteLen/2` units). When `surr` is
// true a surrogate pair is placed every ~4 units; otherwise pure BMP.
function makeUtf16(byteLen: i32, surr: bool): ArrayBuffer {
  const units = byteLen >> 1;
  const buf = new ArrayBuffer(byteLen);
  const p = changetype<usize>(buf);
  let k = 0;
  let since = 0;
  while (k < units) {
    if (surr && k + 1 < units && since >= 3) {
      store<u16>(p + (<usize>k << 1), 0xD83C);
      store<u16>(p + (<usize>(k + 1) << 1), 0xDF0D);
      k += 2; since = 0;
    } else {
      store<u16>(p + (<usize>k << 1), <u16>(0x41 + (k & 0x3F)));
      k += 1; since += 1;
    }
  }
  return buf;
}

const sizes: i32[] = [2, 4, 8, 12, 14, 16, 32, 48, 64, 96, 128, 256, 1024, 8192, 65536];

for (let i = 0; i < sizes.length; i++) {
  const n = sizes[i];
  const bmp = makeUtf16(n, false); keep.push(bmp);
  sweep("bmp-" + n.toString(), bmp);
}
for (let i = 0; i < sizes.length; i++) {
  const n = sizes[i];
  const surr = makeUtf16(n, true); keep.push(surr); // dense surrogate pairs
  sweep("surr-" + n.toString(), surr);
}
