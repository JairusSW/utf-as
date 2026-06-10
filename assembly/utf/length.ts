// Length pre-count helpers. Assume well-formed input; pair with `UTF8.validate`
// for untrusted sources. `utf8_length_from_utf16` returns 0 on lone surrogates
// — disambiguate from "empty input" by checking `len`.
//
// Both functions are exported (so they're compiled unconditionally) yet use
// v128. Each gates its SIMD loops behind `ASC_FEATURE_SIMD` and keeps a complete
// scalar tail, so with `--enable simd` off the SIMD blocks fold away, the v128
// bodies are dead-code-eliminated, and the scalar path counts the whole input.

// @ts-ignore: decorator
@lazy const SPLAT_NEG64: v128 = v128.splat<i8>(-64);
// 4-byte lead via `(b & 0xF8) == 0xF0`. Range tests would need both a positive
// lower bound and a signed-byte ceiling, costing an extra compare.
// @ts-ignore: decorator
@lazy const SPLAT_F8:    v128 = v128.splat<u8>(0xF8);
// @ts-ignore: decorator
@lazy const SPLAT_F0:    v128 = v128.splat<u8>(0xF0);
// @ts-ignore: decorator
@lazy const SPLAT_80_U16:  v128 = v128.splat<u16>(0x80);
// Any bit set under 0xFF80 ⇒ unit ≥ 0x80, i.e. not ASCII. Gates the wide skip.
// @ts-ignore: decorator
@lazy const SPLAT_FF80_U16:v128 = v128.splat<u16>(0xFF80);
// @ts-ignore: decorator
@lazy const SPLAT_800_U16: v128 = v128.splat<u16>(0x800);
// @ts-ignore: decorator
@lazy const SPLAT_F800_U16:v128 = v128.splat<u16>(0xF800);
// @ts-ignore: decorator
@lazy const SPLAT_D800_U16:v128 = v128.splat<u16>(0xD800);
// @ts-ignore: decorator
@lazy const SPLAT_DC00_U16:v128 = v128.splat<u16>(0xDC00);
// @ts-ignore: decorator
@lazy const SPLAT_FC00_U16:v128 = v128.splat<u16>(0xFC00);

/** UTF-16 units = input_bytes - continuation_bytes + four_byte_leads. */
export function utf16_length_from_utf8(src: usize, len: i32): i32 {
  if (len <= 0) return 0;

  let pos: i32 = 0;
  let contCount: i32 = 0;
  let fourByteCount: i32 = 0;

  // SIMD fast path, gated on compile-time SIMD availability so this exported
  // function builds with `--enable simd` off: the block folds away and its v128
  // body is dead-code-eliminated, leaving only the scalar tail below (which on
  // its own counts the whole input correctly).
  if (ASC_FEATURE_SIMD) {
    while (pos + 16 <= len) {
      const v = v128.load(src + <usize>pos);
      const isCont = i8x16.lt_s(v, SPLAT_NEG64);
      contCount += popcnt<i32>(i8x16.bitmask(isCont));
      const is4 = i8x16.eq(v128.and(v, SPLAT_F8), SPLAT_F0);
      fourByteCount += popcnt<i32>(i8x16.bitmask(is4));
      pos += 16;
    }
  }

  while (pos < len) {
    const b = load<u8>(src + <usize>pos);
    if ((b & 0xC0) == 0x80) contCount += 1;
    if ((b & 0xF8) == 0xF0) fourByteCount += 1;
    pos += 1;
  }

  return len - contCount + fourByteCount;
}

/** UTF-8 byte count for 8 UTF-16 units, or -1 to bail to scalar.
 *  Baseline = 1 byte/unit, +1 per unit ≥ 0x80, +1 per unit ≥ 0x800 — which
 *  scores each surrogate as 3. The surrogate fix-up (high 3→4, low 3→0) only
 *  runs when the cheap `any_true` gate finds one, so non-surrogate text (the
 *  common case) skips two bitmask/popcnt pairs and the pairing arithmetic. */
// @ts-ignore: decorator
@inline function utf8_bytes_of_8(v: v128): i32 {
  const ge80 = i16x8.ge_u(v, SPLAT_80_U16);
  const ge800 = i16x8.ge_u(v, SPLAT_800_U16);
  // Each i16 lane occupies 2 bitmask bits; popcnt >> 1 = true-lane count.
  let bytes = 8
    + (popcnt<i32>(<u32>i8x16.bitmask(ge80)) >> 1)
    + (popcnt<i32>(<u32>i8x16.bitmask(ge800)) >> 1);

  const isSurr = i16x8.eq(v128.and(v, SPLAT_F800_U16), SPLAT_D800_U16);
  if (v128.any_true(isSurr)) {
    const isLowSurr = i16x8.eq(v128.and(v, SPLAT_FC00_U16), SPLAT_DC00_U16);
    const isHighSurr = v128.andnot(isSurr, isLowSurr);
    const lanes_low = popcnt<i32>(<u32>i8x16.bitmask(isLowSurr)) >> 1;
    const lanes_high = popcnt<i32>(<u32>i8x16.bitmask(isHighSurr)) >> 1;
    // Mismatched counts ⇒ lone surrogate or pair straddling the block
    // boundary — bail to scalar so the lookback can run.
    if (lanes_low != lanes_high) return -1;
    bytes += lanes_high - 3 * lanes_low;
  }
  return bytes;
}

/** UTF-8 bytes from a UTF-16LE source. Returns 0 on lone surrogate. */
export function utf8_length_from_utf16(src: usize, len: i32): i32 {
  if (len <= 0) return 0;

  let i: i32 = 0;
  let total: i32 = 0;

  // SIMD fast paths, gated on compile-time SIMD availability so this exported
  // function builds with `--enable simd` off: both loops (and the `@inline`
  // `utf8_bytes_of_8` they call) fold away and are dead-code-eliminated, leaving
  // the scalar tail below to count the whole input on its own.
  if (ASC_FEATURE_SIMD) {
    // Wide fast path: 32 units (64 bytes) at a time. Pure-ASCII text — the
    // dominant byteLength input — needs only one OR-reduction + `any_true`,
    // since each unit is exactly one UTF-8 byte. The check re-arms every chunk,
    // so a run of accents drops to per-8 classification then resumes skipping.
    while (i + 32 <= len) {
      const base = src + (<usize>i << 1);
      const v0 = v128.load(base);
      const v1 = v128.load(base, 16);
      const v2 = v128.load(base, 32);
      const v3 = v128.load(base, 48);

      const any = v128.or(v128.or(v0, v1), v128.or(v2, v3));
      if (!v128.any_true(v128.and(any, SPLAT_FF80_U16))) {
        total += 32;
        i += 32;
        continue;
      }

      // Non-ASCII somewhere in the chunk: reuse the loaded vectors. Any bail
      // hands the whole chunk to the scalar tail, which validates pairing.
      const c0 = utf8_bytes_of_8(v0); if (c0 < 0) break;
      const c1 = utf8_bytes_of_8(v1); if (c1 < 0) break;
      const c2 = utf8_bytes_of_8(v2); if (c2 < 0) break;
      const c3 = utf8_bytes_of_8(v3); if (c3 < 0) break;
      total += c0 + c1 + c2 + c3;
      i += 32;
    }

    // Trailing 8–31 units.
    while (i + 8 <= len) {
      const c = utf8_bytes_of_8(v128.load(src + (<usize>i << 1)));
      if (c < 0) break;
      total += c;
      i += 8;
    }
  }

  while (i < len) {
    const w: u32 = load<u16>(src + (<usize>i << 1));
    if (w < 0x80) { total += 1; i += 1; }
    else if (w < 0x800) { total += 2; i += 1; }
    else if (w < 0xD800 || w >= 0xE000) { total += 3; i += 1; }
    else if (w < 0xDC00) {
      if (i + 1 >= len) return 0;
      const w2: u32 = load<u16>(src + (<usize>(i + 1) << 1));
      if (w2 < 0xDC00 || w2 >= 0xE000) return 0;
      total += 4;
      i += 2;
    } else {
      return 0;
    }
  }

  return total;
}
