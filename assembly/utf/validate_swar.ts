// SWAR (SIMD-Within-A-Register) UTF-8 and UTF-16 validation — the default paths
// (UTF-16 lives in the `--- UTF-16 ---` section at the bottom).
//
// Pure u64 word arithmetic: no v128, no `SCRATCH` padding, tiny fixed cost.
// Strategy is a hybrid that captures essentially all the throughput on real
// (ASCII-dominant) text while staying byte-exact with the SIMD validator:
//
//   • ASCII fast path — load 8 bytes as a u64 and skip the whole word when no
//     byte has its high bit set (`w & HI == 0`). On a dirty word, `ctz` jumps
//     straight to the first non-ASCII byte instead of re-scanning.
//   • Multibyte — `decodeOne` validates exactly one sequence with the RFC 3629
//     well-formed ranges (Unicode Table 3-7). Its range checks map 1:1 onto the
//     SIMD validator's error classes (see `validate.ts:12-20`), so the two paths
//     accept/reject identically.
//
// No 64-byte scratch fill on short input: empty/short strings cost one u64 load
// + mask + compare per 8 bytes plus a byte tail — versus the SIMD path's
// `memory.fill`/`memory.copy` of 64 bytes for anything under a full window.

// High bit of each byte lane.
const HI: u64 = 0x8080808080808080;

/** Validate one UTF-8 sequence starting at `buf + i`, bounded by `n` (= len).
 *  Returns the byte count consumed (1..4) on success, or 0 on any error,
 *  including truncation at end-of-input. Never called on an ASCII lead (the
 *  caller handles `b0 < 0x80` directly), but tolerates one anyway. */
// @ts-ignore: decorator
@inline function decodeOne(buf: usize, i: i32, n: i32, b0: u32): i32 {
  if (b0 < 0x80) return 1; // plain ASCII

  // 0x80..0xBF: stray continuation (no lead). 0xC0/0xC1: overlong 2-byte leads.
  // Both invalid — mirrors TWO_CONTS / TOO_LONG / OVERLONG_2.
  if (b0 < 0xC2) return 0;

  // 2-byte: C2..DF 80..BF  (U+0080..U+07FF). Overlong already excluded.
  if (b0 < 0xE0) {
    if (i + 2 > n) return 0;
    const b1 = <u32>load<u8>(buf + <usize>i + 1);
    if ((b1 & 0xC0) != 0x80) return 0;
    return 2;
  }

  // 3-byte: E0..EF, with a range-tightened second byte.
  //   E0   → b1 ∈ A0..BF  (reject overlong < U+0800)        [OVERLONG_3]
  //   ED   → b1 ∈ 80..9F  (reject surrogates D800..DFFF)     [SURROGATE]
  //   else → b1 ∈ 80..BF
  if (b0 < 0xF0) {
    if (i + 3 > n) return 0;
    const b1 = <u32>load<u8>(buf + <usize>i + 1);
    const b2 = <u32>load<u8>(buf + <usize>i + 2);
    if (b0 == 0xE0) { if (b1 < 0xA0 || b1 > 0xBF) return 0; }
    else if (b0 == 0xED) { if (b1 < 0x80 || b1 > 0x9F) return 0; }
    else { if ((b1 & 0xC0) != 0x80) return 0; }
    if ((b2 & 0xC0) != 0x80) return 0;
    return 3;
  }

  // 4-byte: F0..F4, with a range-tightened second byte.
  //   F0   → b1 ∈ 90..BF  (reject overlong < U+10000)        [OVERLONG_4]
  //   F4   → b1 ∈ 80..8F  (reject > U+10FFFF)                 [TOO_LARGE]
  //   else → b1 ∈ 80..BF  (F1..F3)
  if (b0 <= 0xF4) {
    if (i + 4 > n) return 0;
    const b1 = <u32>load<u8>(buf + <usize>i + 1);
    const b2 = <u32>load<u8>(buf + <usize>i + 2);
    const b3 = <u32>load<u8>(buf + <usize>i + 3);
    if (b0 == 0xF0) { if (b1 < 0x90 || b1 > 0xBF) return 0; }
    else if (b0 == 0xF4) { if (b1 < 0x80 || b1 > 0x8F) return 0; }
    else { if ((b1 & 0xC0) != 0x80) return 0; }
    if ((b2 & 0xC0) != 0x80) return 0;
    if ((b3 & 0xC0) != 0x80) return 0;
    return 4;
  }

  // b0 >= 0xF5: 5/6-byte leads and everything > U+10FFFF. [TOO_LARGE_1000]
  return 0;
}

/** Whether `len` raw bytes at `buf` are well-formed UTF-8. Byte-exact with
 *  `validateSimd`. Empty input is handled by the caller (`len <= 0`). */
// @ts-ignore: decorator
@unsafe export function validateSwar(buf: usize, len: i32): bool {
  let i: i32 = 0;
  const n = len;

  // ASCII skip. Wasm is little-endian, so memory byte 0 is the low 8 bits of a
  // loaded word: the first non-ASCII byte is the lowest set lane in `w & HI`,
  // located with ctz >> 3. A 32-byte (4-word) unrolled pre-skip races over pure
  // ASCII runs; on a dirty block it falls through to per-word handling and then
  // resumes the unrolled skip after the multibyte sequence.
  while (i + 8 <= n) {
    const w = load<u64>(buf + <usize>i);
    if ((w & HI) != 0) {
      // Dirty word — jump to the first non-ASCII byte, then validate the whole
      // multibyte cluster byte-directly (no per-codepoint word reload) until the
      // text returns to ASCII, where the unrolled skip below takes over again.
      i += <i32>(ctz(w & HI) >> 3);
      let b0 = <u32>load<u8>(buf + <usize>i);
      do {
        const consumed = decodeOne(buf, i, n, b0);
        if (consumed == 0) return false;
        i += consumed;
        if (i >= n) break;
        b0 = <u32>load<u8>(buf + <usize>i);
      } while (b0 >= 0x80);
      continue;
    }
    i += 8;
    // Word was clean — race over the following pure-ASCII run 32 bytes (4 words)
    // at a time. Bails to the per-word path the moment a high bit appears.
    while (i + 32 <= n) {
      const p = buf + <usize>i;
      const any = load<u64>(p) | load<u64>(p, 8) | load<u64>(p, 16) | load<u64>(p, 24);
      if ((any & HI) != 0) break;
      i += 32;
    }
  }

  // Tail: < 8 bytes remain — scan byte-wise, no scratch fill.
  while (i < n) {
    const b0 = <u32>load<u8>(buf + <usize>i);
    if (b0 < 0x80) { i += 1; continue; }
    const consumed = decodeOne(buf, i, n, b0);
    if (consumed == 0) return false;
    i += consumed;
  }

  return true;
}

// --- UTF-16 ----------------------------------------------------------------
// SWAR UTF-16LE validation: a BMP fast path skips runs of 4 surrogate-free code
// units per u64 word; surrogate regions fall to a per-unit pairing check. Like
// the UTF-8 SWAR path, short input pays no `memory.fill`/`memory.copy` scratch.

/** Whether any of the four u16 lanes of `w` is a surrogate (0xD800-0xDFFF).
 *  A lane is a surrogate iff (lane & 0xF800) == 0xD800. We map "non-surrogate"
 *  to bit 11 of each lane: after masking the top 5 bits and XOR-ing the
 *  surrogate pattern, OR the 5 top bits down to bit 11 (all shifts stay in-lane
 *  since a lane's lowest used bit, 11, is > 4 below the 16-bit boundary). */
// @ts-ignore: decorator
@inline function wordHasSurrogate(w: u64): bool {
  const d = (w & 0xF800F800F800F800) ^ 0xD800D800D800D800;
  const e = d | (d >> 1) | (d >> 2) | (d >> 3) | (d >> 4);
  // bit 0x0800 of a lane is set iff that lane is NON-surrogate.
  return (e & 0x0800080008000800) != 0x0800080008000800;
}

/** One step of the surrogate-pairing state machine. `needLow` is true when the
 *  previous unit was a high surrogate (so this one must be a low surrogate).
 *  Returns -1 on malformed, 0 if the next unit may be anything, 1 if the next
 *  unit must be a low surrogate. */
// @ts-ignore: decorator
@inline function stepUnit(u: u32, needLow: bool): i32 {
  const cls = u & 0xFC00;
  const isHigh = cls == 0xD800;
  const isLow = cls == 0xDC00;
  if (needLow) return isLow ? 0 : -1; // high must be followed by low
  if (isLow) return -1;               // lone low surrogate
  return isHigh ? 1 : 0;              // high → next unit must be low
}

/** Whether `len` raw bytes at `buf` are well-formed UTF-16LE (even byte length,
 *  no lone surrogates). Byte-exact with `validateUtf16Simd`. */
// @ts-ignore: decorator
@unsafe export function validateUtf16Swar(buf: usize, len: i32): bool {
  if (len & 1) return false; // dangling half code unit
  const units = len >> 1;
  let i: i32 = 0;
  let needLow = false;

  while (i + 4 <= units) {
    const w = load<u64>(buf + (<usize>i << 1));
    // BMP fast path: 4 surrogate-free units with no pending low → skip.
    if (!needLow && !wordHasSurrogate(w)) { i += 4; continue; }
    // Surrogate region (or pending low): check the 4 units one at a time.
    for (let k = 0; k < 4; k++) {
      const r = stepUnit(<u32>((w >> (k << 4)) & 0xFFFF), needLow);
      if (r < 0) return false;
      needLow = r == 1;
    }
    i += 4;
  }

  // Tail: < 4 units remain.
  while (i < units) {
    const r = stepUnit(<u32>load<u16>(buf + (<usize>i << 1)), needLow);
    if (r < 0) return false;
    needLow = r == 1;
    i += 1;
  }

  // A high surrogate at the very end has no low successor.
  return !needLow;
}
