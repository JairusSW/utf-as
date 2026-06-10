// Drop-in for stdlib `String.UTF8`. SIMD kernels ported from simdutf's
// westmere targets:
//   `utf16le_to_utf8` ← src/westmere/sse_convert_utf16_to_utf8.cpp
//   `utf8_to_utf16le` ← src/westmere/sse_convert_utf8_to_utf16.cpp
//                       + src/generic/utf8_to_utf16/utf8_to_utf16.h
// Algorithm: Lemire & Muła, "Transcoding Billions of Unicode Characters per
// Second with SIMD".
//
// `utf8_to_utf16le` is *permissive*: per-block Keiser–Lemire validation is
// dropped (~14% on mixed-script input). Malformed bytes that survive the
// cheap F5+ pre-gate and the table's idx==209 sentinel decode to whatever
// the bit pattern says — output is always well-formed UTF-16, but `-1` is
// best-effort. Pair with `UTF8.validateUnsafe` for strict input.

import { PACK_123_PTR, UTF8_BIG_INDEX_PTR, SHUF_UTF8_PTR } from "./tables";
import { u8x16, block_is_ascii } from "./common";
import { utf16_length_from_utf8, utf8_length_from_utf16 } from "./length";
import { validateSimd } from "./validate";
import { validateSwar } from "./validate_swar";
import { utf8_to_utf16le_swar, utf16le_to_utf8_swar } from "./utf8_swar";

const E_UNPAIRED_SURROGATE: string = "String contains an unpaired surrogate";

// @ts-ignore: decorator
@lazy const SPLAT_FF80:     v128 = v128.splat<u16>(0xff80);
// @ts-ignore: decorator
@lazy const SPLAT_F800:     v128 = v128.splat<u16>(0xf800);
// @ts-ignore: decorator
@lazy const SPLAT_D800_U16: v128 = v128.splat<u16>(0xd800);
// @ts-ignore: decorator
@lazy const SPLAT_ZERO:     v128 = v128.splat<u16>(0);
// @ts-ignore: decorator
@lazy const SPLAT_3F7F:     v128 = v128.splat<u16>(0x3F7F);
// @ts-ignore: decorator
@lazy const SPLAT_8000:     v128 = v128.splat<u16>(0x8000);
// @ts-ignore: decorator
@lazy const SPLAT_0FFC:     v128 = v128.splat<u16>(0x0FFC);
// @ts-ignore: decorator
@lazy const SPLAT_00FF:     v128 = v128.splat<u16>(0x00FF);
// @ts-ignore: decorator
@lazy const SPLAT_C0E0:     v128 = v128.splat<u16>(0xC0E0);
// @ts-ignore: decorator
@lazy const SPLAT_4000:     v128 = v128.splat<u16>(0x4000);
// @ts-ignore: decorator
@lazy const SPLAT_7F_U16:   v128 = v128.splat<u16>(0x7f);
// @ts-ignore: decorator
@lazy const SPLAT_1F00_U16: v128 = v128.splat<u16>(0x1f00);
// @ts-ignore: decorator
@lazy const SPLAT_7F_U32:   v128 = v128.splat<u32>(0x7f);
// @ts-ignore: decorator
@lazy const SPLAT_3F00_U32: v128 = v128.splat<u32>(0x3f00);
// @ts-ignore: decorator
@lazy const SPLAT_0F0000:   v128 = v128.splat<u32>(0x0f0000);
// @ts-ignore: decorator
@lazy const SPLAT_3F0000:   v128 = v128.splat<u32>(0x3f0000);
// @ts-ignore: decorator
@lazy const SPLAT_400000:   v128 = v128.splat<u32>(0x400000);
// @ts-ignore: decorator
@lazy const SPLAT_FF000000: v128 = v128.splat<u32>(0xff000000);
// @ts-ignore: decorator
@lazy const SPLAT_10000:    v128 = v128.splat<u32>(0x10000);
// @ts-ignore: decorator
@lazy const SPLAT_3FF:      v128 = v128.splat<u32>(0x3ff);
// @ts-ignore: decorator
@lazy const SPLAT_DC00:     v128 = v128.splat<u32>(0xDC00);
// @ts-ignore: decorator
@lazy const SPLAT_D800_U32: v128 = v128.splat<u32>(0xD800);
// @ts-ignore: decorator
@lazy const SPLAT_NEG64:    v128 = v128.splat<i8>(-64);
// @ts-ignore: decorator
@lazy const SPLAT_3C00000:  v128 = v128.splat<i32>(0x3c00000);
// @ts-ignore: decorator
@lazy const SPLAT_F4:       v128 = v128.splat<u8>(0xF4);

// @ts-ignore: decorator
@lazy const DUP_EVEN: v128 = v128(
  0, 0, 2, 2, 4, 4, 6, 6, 8, 8, 10, 10, 12, 12, 14, 14
);

// @ts-ignore: decorator
@lazy const SHUF_3BYTE: v128 = v128(
  2, 3, 1, 6, 7, 5, 10, 11, 9, 14, 15, 13, <i8>0x80, <i8>0x80, <i8>0x80, <i8>0x80
);

// 0x80 lanes act as zero in i8x16.swizzle.
// @ts-ignore: decorator
@lazy const SHUF_3BYTE_FAST: v128 = v128(
  2, 1, 0, <i8>0x80,
  5, 4, 3, <i8>0x80,
  8, 7, 6, <i8>0x80,
  11, 10, 9, <i8>0x80
);

/** Strict UTF-16LE → UTF-8 scalar. Returns bytes written, or -1 on lone/invalid surrogate. */
// @ts-ignore: decorator
@inline export function scalar_encode(src: usize, len: i32, dst: usize): i32 {
  let i: i32 = 0;
  let out: usize = dst;
  while (i < len) {
    const w: u32 = load<u16>(src + (<usize>i << 1));
    if (w < 0x80) {
      store<u8>(out, <u8>w);
      out += 1;
      i += 1;
    } else if (w < 0x800) {
      store<u8>(out, <u8>(0xC0 | (w >> 6)));
      store<u8>(out, <u8>(0x80 | (w & 0x3F)), 1);
      out += 2;
      i += 1;
    } else if (w < 0xD800 || w >= 0xE000) {
      store<u8>(out, <u8>(0xE0 | (w >> 12)));
      store<u8>(out, <u8>(0x80 | ((w >> 6) & 0x3F)), 1);
      store<u8>(out, <u8>(0x80 | (w & 0x3F)), 2);
      out += 3;
      i += 1;
    } else if (w < 0xDC00) {
      if (i + 1 >= len) return -1;
      const w2: u32 = load<u16>(src + (<usize>(i + 1) << 1));
      if (w2 < 0xDC00 || w2 >= 0xE000) return -1;
      const cp = (((w - 0xD800) << 10) | (w2 - 0xDC00)) + 0x10000;
      store<u8>(out, <u8>(0xF0 | (cp >> 18)));
      store<u8>(out, <u8>(0x80 | ((cp >> 12) & 0x3F)), 1);
      store<u8>(out, <u8>(0x80 | ((cp >> 6) & 0x3F)), 2);
      store<u8>(out, <u8>(0x80 | (cp & 0x3F)), 3);
      out += 4;
      i += 2;
    } else {
      return -1;
    }
  }
  return <i32>(out - dst);
}

/** Widen 16 ASCII bytes to two v128 of UTF-16LE. Caller must guarantee 32 bytes writable. */
// @ts-ignore: decorator
@inline function store_ascii_as_utf16le(input: v128, dst: usize): void {
  const lo = i16x8.extend_low_i8x16_u(input);
  const hi = i16x8.extend_high_i8x16_u(input);
  v128.store(dst, lo);
  v128.store(dst, hi, 16);
}

/** Strict UTF-8 → UTF-16LE scalar for one code point. Returns
 *  `(units << 32) | bytes_consumed`, or `0` on malformed/truncated input. */
// @ts-ignore: decorator
@inline export function scalar_decode_one(src: usize, remaining: i32, dst: usize): u64 {
  if (remaining <= 0) return 0;
  const b0 = <u32>load<u8>(src);
  if (b0 < 0x80) {
    store<u16>(dst, <u16>b0);
    return (<u64>1 << 32) | 1;
  }
  if (b0 < 0xC2) return 0;
  if (b0 < 0xE0) {
    if (remaining < 2) return 0;
    const b1 = <u32>load<u8>(src, 1);
    if ((b1 & 0xC0) != 0x80) return 0;
    const cp = ((b0 & 0x1F) << 6) | (b1 & 0x3F);
    store<u16>(dst, <u16>cp);
    return (<u64>1 << 32) | 2;
  }
  if (b0 < 0xF0) {
    if (remaining < 3) return 0;
    const b1 = <u32>load<u8>(src, 1);
    const b2 = <u32>load<u8>(src, 2);
    if ((b1 & 0xC0) != 0x80 || (b2 & 0xC0) != 0x80) return 0;
    const cp = ((b0 & 0x0F) << 12) | ((b1 & 0x3F) << 6) | (b2 & 0x3F);
    if (cp < 0x800 || (cp >= 0xD800 && cp <= 0xDFFF)) return 0;
    store<u16>(dst, <u16>cp);
    return (<u64>1 << 32) | 3;
  }
  if (b0 < 0xF5) {
    if (remaining < 4) return 0;
    const b1 = <u32>load<u8>(src, 1);
    const b2 = <u32>load<u8>(src, 2);
    const b3 = <u32>load<u8>(src, 3);
    if ((b1 & 0xC0) != 0x80 || (b2 & 0xC0) != 0x80 || (b3 & 0xC0) != 0x80) return 0;
    const cp = ((b0 & 0x07) << 18) | ((b1 & 0x3F) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F);
    if (cp < 0x10000 || cp > 0x10FFFF) return 0;
    const v = cp - 0x10000;
    const hi: u32 = 0xD800 | (v >> 10);
    const lo: u32 = 0xDC00 | (v & 0x3FF);
    store<u16>(dst, <u16>hi);
    store<u16>(dst, <u16>lo, 2);
    return (<u64>2 << 32) | 4;
  }
  return 0;
}

/** Per-12-byte UTF-8 → UTF-16LE convert. Reads 16 input bytes (caller must
 *  guarantee readable), consumes ≤12, writes 2..24 bytes. `mask` is the
 *  12-bit end-of-code-point bitmask. Returns `(units << 16) | bytes_consumed`,
 *  or `0` if the table sentinel (idx==209) rejects the pattern. */
// @ts-ignore: decorator
@inline function convert_masked_utf8_to_utf16le(in_ptr: usize, mask: u32, out: usize): u32 {
  const input = v128.load(in_ptr);
  const mask12 = mask & 0xfff;

  // 12 ASCII → 12 cps. We widen and store 24 bytes; the high 8 are scratch
  // that the next iteration overwrites — caller advances `out` by only 24.
  if (mask12 == 0xfff) {
    store_ascii_as_utf16le(input, out);
    return (12 << 16) | 12;
  }

  // 8 two-byte sequences (16 bytes → 8 cps).
  if ((mask & 0xffff) == 0xaaaa) {
    const sh = u8x16(
       1, 0,  3, 2,  5, 4,  7, 6,
       9, 8, 11,10, 13,12, 15,14
    );
    const perm = i8x16.swizzle(input, sh);
    const ascii = v128.and(perm, SPLAT_7F_U16);
    const high = v128.and(perm, SPLAT_1F00_U16);
    const composed = v128.or(ascii, v128.shr<u16>(high, 2));
    v128.store(out, composed);
    return (8 << 16) | 16;
  }

  // 4 three-byte sequences (12 bytes → 4 cps).
  if (mask12 == 0x924) {
    const perm = i8x16.swizzle(input, SHUF_3BYTE_FAST);
    const ascii = v128.and(perm, SPLAT_7F_U32);
    const middle = v128.and(perm, SPLAT_3F00_U32);
    const middleShifted = v128.shr<u32>(middle, 2);
    const high = v128.and(perm, SPLAT_0F0000);
    const highShifted = v128.shr<u32>(high, 4);
    const composed = v128.or(v128.or(ascii, middleShifted), highShifted);
    const packed = i16x8.narrow_i32x4_u(composed, composed);
    v128.store64_lane(out, packed, 0);
    return (4 << 16) | 12;
  }

  const tableEntry: u32 = load<u16>(UTF8_BIG_INDEX_PTR + (<usize>mask12 << 1));
  const idx: u32 = tableEntry & 0xff;
  const consumed: u32 = (tableEntry >> 8) & 0xff;

  if (idx < 64) {
    const sh = v128.load(SHUF_UTF8_PTR + (<usize>idx << 4));
    const perm = i8x16.swizzle(input, sh);
    const ascii = v128.and(perm, SPLAT_7F_U16);
    const high = v128.and(perm, SPLAT_1F00_U16);
    const composed = v128.or(ascii, v128.shr<u16>(high, 2));
    v128.store(out, composed);
    return (6 << 16) | consumed;
  }

  if (idx < 145) {
    const sh = v128.load(SHUF_UTF8_PTR + (<usize>idx << 4));
    const perm = i8x16.swizzle(input, sh);
    const ascii = v128.and(perm, SPLAT_7F_U32);
    const middle = v128.and(perm, SPLAT_3F00_U32);
    const middleShifted = v128.shr<u32>(middle, 2);
    const high = v128.and(perm, SPLAT_0F0000);
    const highShifted = v128.shr<u32>(high, 4);
    const composed = v128.or(v128.or(ascii, middleShifted), highShifted);
    const packed = i16x8.narrow_i32x4_u(composed, composed);
    v128.store64_lane(out, packed, 0);
    return (4 << 16) | consumed;
  }

  if (idx < 209) {
    // Up to 3 cps including 4-byte → surrogate pair.
    const sh = v128.load(SHUF_UTF8_PTR + (<usize>idx << 4));
    const perm = i8x16.swizzle(input, sh);
    const ascii = v128.and(perm, SPLAT_7F_U32);
    const middle = v128.and(perm, SPLAT_3F00_U32);
    const middleShifted = v128.shr<u32>(middle, 2);
    let midHi = v128.and(perm, SPLAT_3F0000);
    // simdutf trick: cancel the 0x40 spill from the 3rd byte when the lead
    // is 0xF0..0xF4. Equivalent to subtracting 0x400000.
    const correct = v128.shr<u32>(v128.and(perm, SPLAT_400000), 1);
    midHi = v128.xor(correct, midHi);
    const midHiShifted = v128.shr<u32>(midHi, 4);
    // Whole top byte carries the lead; later `composed > 0x3c00000` flags
    // the lanes that need surrogate-pair encoding.
    const high = v128.and(perm, SPLAT_FF000000);
    const highShifted = v128.shr<u32>(high, 6);
    const composed = v128.or(v128.or(ascii, middleShifted),
                             v128.or(highShifted, midHiShifted));

    const composedMinus = i32x4.sub(composed, SPLAT_10000);
    const lowTen = v128.and(composedMinus, SPLAT_3FF);
    const highTen = v128.and(v128.shr<u32>(composedMinus, 10), SPLAT_3FF);
    const lowAdd = i32x4.add(lowTen, SPLAT_DC00);
    const highAdd = i32x4.add(highTen, SPLAT_D800_U32);
    const lowAddShifted = v128.shl<u32>(lowAdd, 16);
    const surrogates = v128.or(highAdd, lowAddShifted);

    const basic0 = <u32>i32x4.extract_lane(composed, 0);
    const basic1 = <u32>i32x4.extract_lane(composed, 1);
    const basic2 = <u32>i32x4.extract_lane(composed, 2);
    const surMask =
       <i32>(basic0 > 0x3c00000)       |
      (<i32>(basic1 > 0x3c00000) << 1) |
      (<i32>(basic2 > 0x3c00000) << 2);

    // One dispatch on the 3-bit surrogate mask instead of three per-lane
    // branches: ~30% faster on mixed-script input.
    if (surMask == 0) {
      store<u32>(out, basic0 | (basic1 << 16));
      store<u16>(out, <u16>basic2, 4);
      return (3 << 16) | consumed;
    }

    const surr0 = <u32>i32x4.extract_lane(surrogates, 0);
    const surr1 = <u32>i32x4.extract_lane(surrogates, 1);
    const surr2 = <u32>i32x4.extract_lane(surrogates, 2);

    switch (surMask) {
      case 1:
        store<u32>(out, surr0);
        store<u16>(out, <u16>basic1, 4);
        store<u16>(out, <u16>basic2, 6);
        return (4 << 16) | consumed;
      case 2:
        store<u16>(out, <u16>basic0);
        store<u32>(out, surr1, 2);
        store<u16>(out, <u16>basic2, 6);
        return (4 << 16) | consumed;
      case 3:
        store<u32>(out, surr0);
        store<u32>(out, surr1, 4);
        store<u16>(out, <u16>basic2, 8);
        return (5 << 16) | consumed;
      case 4:
        store<u16>(out, <u16>basic0);
        store<u16>(out, <u16>basic1, 2);
        store<u32>(out, surr2, 4);
        return (4 << 16) | consumed;
      case 5:
        store<u32>(out, surr0);
        store<u16>(out, <u16>basic1, 4);
        store<u32>(out, surr2, 6);
        return (5 << 16) | consumed;
      case 6:
        store<u16>(out, <u16>basic0);
        store<u32>(out, surr1, 2);
        store<u32>(out, surr2, 6);
        return (5 << 16) | consumed;
      default:
        store<u32>(out, surr0);
        store<u32>(out, surr1, 4);
        store<u32>(out, surr2, 8);
        return (6 << 16) | consumed;
    }
  }

  return 0;
}

/** UTF-16LE → UTF-8 (SIMD). Returns bytes written, or -1 on malformed.
 *  Reached only when SIMD is compiled in (see `UTF8.encodeUnsafe`'s dispatch);
 *  kept non-`@inline` so its v128 body is never spliced into the dispatcher and
 *  is dead-code-eliminated when `--enable simd` is off. Exported for tests. */
export function utf16le_to_utf8(src: usize, len: i32, dst: usize): i32 {
  if (len < 0) return -1;
  if (len == 0) return 0;

  let i: i32 = 0;
  let out: usize = dst;
  const SAFE_MARGIN: i32 = 12;

  while (i + 16 + SAFE_MARGIN <= len) {
    const inBase = src + (<usize>i << 1);
    let inv = v128.load(inBase);

    if (!v128.any_true(v128.and(inv, SPLAT_FF80))) {
      const nextIn = v128.load(inBase, 16);
      if (v128.any_true(v128.and(nextIn, SPLAT_FF80))) {
        const packed = i8x16.narrow_i16x8_u(inv, inv);
        v128.store64_lane(out, packed, 0);
        i += 8;
        out += 8;
        inv = nextIn;
      } else {
        const packed = i8x16.narrow_i16x8_u(inv, nextIn);
        v128.store(out, packed);
        i += 16;
        out += 16;
        continue;
      }
    }

    const oneByteMask = i16x8.eq(v128.and(inv, SPLAT_FF80), SPLAT_ZERO);
    const oneByteBits = i8x16.bitmask(oneByteMask);
    const oneOrTwoMask = i16x8.eq(v128.and(inv, SPLAT_F800), SPLAT_ZERO);
    const oneOrTwoBits = i8x16.bitmask(oneOrTwoMask);
    const surrMask = i16x8.eq(v128.and(inv, SPLAT_F800), SPLAT_D800_U16);
    const surrBits = i8x16.bitmask(surrMask);

    if (surrBits != 0) {
      // Scalar-encode just the BMP prefix + surrogate pair, then resume SIMD.
      // Keeps scalar cost proportional to actual surrogates, not "any in block".
      // `>> 1` because bitmask has 2 bits per i16 lane.
      const firstSurr: i32 = ctz<i32>(<u32>surrBits) >> 1;
      if (firstSurr > 0) {
        const w1 = scalar_encode(src + (<usize>i << 1), firstSurr, out);
        if (w1 < 0) return -1;
        out += <usize>w1;
        i += firstSurr;
      }
      if (i + 2 > len) return -1;
      const w2 = scalar_encode(src + (<usize>i << 1), 2, out);
      if (w2 < 0) return -1;
      out += <usize>w2;
      i += 2;
      continue;
    }

    // No surrogates: 8 lanes → 1/2/3 UTF-8 bytes each, packed via pack_1_2_3
    // table. See simdutf's sse_convert_utf16_to_utf8.cpp for the bit-layout.
    const t0 = i8x16.swizzle(inv, DUP_EVEN);
    const t1 = v128.and(t0, SPLAT_3F7F);
    const t2 = v128.or(t1, SPLAT_8000);

    const s0 = v128.shr<u16>(inv, 4);
    const s1 = v128.and(s0, SPLAT_0FFC);
    const s1Lo = v128.shl<u16>(v128.and(s1, SPLAT_00FF), 6);
    const s1Hi = v128.shr<u16>(s1, 8);
    const s2 = v128.or(s1Lo, s1Hi);
    const s3 = v128.or(s2, SPLAT_C0E0);
    // Only set 0x4000 in 3-byte lanes (== 1 where one_or_two_byte is false).
    const m0 = v128.andnot(SPLAT_4000, oneOrTwoMask);
    const s4 = v128.xor(s3, m0);

    const out0 = i8x16.shuffle(t2, s4,
       0,  1, 16, 17,
       2,  3, 18, 19,
       4,  5, 20, 21,
       6,  7, 22, 23
    );
    const out1 = i8x16.shuffle(t2, s4,
       8,  9, 24, 25,
      10, 11, 26, 27,
      12, 13, 28, 29,
      14, 15, 30, 31
    );

    // Two-bit-per-lane mask: 00=3B, 10=2B, 11=1B. Even bits from oneByte,
    // odd from oneOrTwo — the two bitmasks already interleave that way.
    const mask: u32 = (<u32>oneByteBits & 0x5555) | (<u32>oneOrTwoBits & 0xaaaa);

    if (mask == 0) {
      const u8a = i8x16.swizzle(out0, SHUF_3BYTE);
      const u8b = i8x16.swizzle(out1, SHUF_3BYTE);
      v128.store(out, u8a);
      v128.store(out, u8b, 12);
      out += 24;
      i += 8;
      continue;
    }

    const mask0: u32 = mask & 0xff;
    const mask1: u32 = (mask >> 8) & 0xff;
    const row0Ptr: usize = PACK_123_PTR + (<usize>mask0 << 5);
    const row1Ptr: usize = PACK_123_PTR + (<usize>mask1 << 5);
    const totalBytes0: i32 = load<u8>(row0Ptr);
    const totalBytes1: i32 = load<u8>(row1Ptr);
    const shuf0 = v128.load(row0Ptr, 1);
    const shuf1 = v128.load(row1Ptr, 1);
    const u8a = i8x16.swizzle(out0, shuf0);
    const u8b = i8x16.swizzle(out1, shuf1);
    v128.store(out, u8a);
    out += <usize>totalBytes0;
    v128.store(out, u8b);
    out += <usize>totalBytes1;

    i += 8;
  }

  const written = scalar_encode(src + (<usize>i << 1), len - i, out);
  if (written < 0) return -1;
  out += <usize>written;
  return <i32>(out - dst);
}

/** UTF-8 → UTF-16LE (SIMD). Returns code units written, or -1 on malformed
 *  input (best-effort — see file header for the permissive contract).
 *  Reached only when SIMD is compiled in (see `UTF8.decodeUnsafe`'s dispatch);
 *  kept non-`@inline` so its v128 body is never spliced into the dispatcher and
 *  is dead-code-eliminated when `--enable simd` is off. Exported for tests. */
export function utf8_to_utf16le(src: usize, len: i32, dst: usize): i32 {
  if (len < 0) return -1;
  if (len == 0) return 0;

  let pos: i32 = 0;
  let out: usize = dst;

  // 16-byte margin lets the per-12-byte inner kernel v128.load past `pos`.
  const SAFE_MARGIN: i32 = 16;

  while (pos + 64 + SAFE_MARGIN <= len) {
    const basePtr = src + <usize>pos;
    const b0 = v128.load(basePtr);
    const b1 = v128.load(basePtr, 16);
    const b2 = v128.load(basePtr, 32);
    const b3 = v128.load(basePtr, 48);

    if (block_is_ascii(b0, b1, b2, b3)) {
      store_ascii_as_utf16le(b0, out);
      store_ascii_as_utf16le(b1, out + 32);
      store_ascii_as_utf16le(b2, out + 64);
      store_ascii_as_utf16le(b3, out + 96);
      out += 128;
      pos += 64;
      continue;
    }

    // Cheap F5+ gate (saturating-sub vs 0xF4): cheaper than full
    // Keiser–Lemire (~52 SIMD ops). Other malformed patterns are caught by
    // the table sentinel (idx==209) and the scalar tail.
    const inv0 = i8x16.sub_sat_u(b0, SPLAT_F4);
    const inv1 = i8x16.sub_sat_u(b1, SPLAT_F4);
    const inv2 = i8x16.sub_sat_u(b2, SPLAT_F4);
    const inv3 = i8x16.sub_sat_u(b3, SPLAT_F4);
    if (v128.any_true(v128.or(v128.or(inv0, inv1), v128.or(inv2, inv3)))) return -1;

    // Continuation byte ⇔ (byte & 0xC0) == 0x80 ⇔ signed-byte < -64.
    const cont0 = i8x16.lt_s(b0, SPLAT_NEG64);
    const cont1 = i8x16.lt_s(b1, SPLAT_NEG64);
    const cont2 = i8x16.lt_s(b2, SPLAT_NEG64);
    const cont3 = i8x16.lt_s(b3, SPLAT_NEG64);
    const m0: u64 = <u64>(<u32>i8x16.bitmask(cont0)) & 0xffff;
    const m1: u64 = <u64>(<u32>i8x16.bitmask(cont1)) & 0xffff;
    const m2: u64 = <u64>(<u32>i8x16.bitmask(cont2)) & 0xffff;
    const m3: u64 = <u64>(<u32>i8x16.bitmask(cont3)) & 0xffff;
    const continuationMask: u64 = m0 | (m1 << 16) | (m2 << 32) | (m3 << 48);

    if ((continuationMask & 1) != 0) return -1; // block starts mid-codepoint

    const leadingMask: u64 = ~continuationMask;
    let endOfCpMask: u64 = leadingMask >> 1;

    const maxStart: i32 = pos + 64 - 12;
    while (pos < maxStart) {
      const ret = convert_masked_utf8_to_utf16le(src + <usize>pos, <u32>endOfCpMask, out);
      if (ret == 0) return -1;
      const consumed: u32 = ret & 0xffff;
      const written: u32 = ret >> 16;
      out += <usize>(written << 1);
      pos += <i32>consumed;
      endOfCpMask >>= consumed;
    }
  }

  while (pos < len) {
    const ret = scalar_decode_one(src + <usize>pos, len - pos, out);
    if (ret == 0) return -1;
    const consumed = <i32>(ret & 0xffffffff);
    const written = <i32>(ret >> 32);
    pos += consumed;
    out += <usize>(written << 1);
  }

  return <i32>((out - dst) >> 1);
}

/** Encoding helpers for UTF-8. */
export namespace UTF8 {
  /** UTF-8 encoding error modes. */
  export const enum ErrorMode {
    /** Keeps unpaired surrogates as of WTF-8. This is the default. */
    WTF8,
    /** Replaces unpaired surrogates with the replacement character (U+FFFD). */
    REPLACE,
    /** Throws an error on unpaired surrogates. */
    ERROR
  }

  /** Calculates the byte length of the specified string when encoded as UTF-8, optionally null terminated. */
  export function byteLength(str: string, nullTerminated: bool = false): i32 {
    const len = str.length;
    if (len == 0) return i32(nullTerminated);
    if (ASC_FEATURE_SIMD && !nullTerminated) {
      // SIMD precount returns 0 on lone surrogates; let the WTF8 scalar handle that.
      // Gated on SIMD so this module still compiles with `--enable simd` off
      // (the v128 length kernel is then dead-code-eliminated).
      const fast = utf8_length_from_utf16(changetype<usize>(str), len);
      if (fast != 0) return fast;
    }
    return scalarByteLength(changetype<usize>(str), len, nullTerminated);
  }

  /** Encodes the specified string to UTF-8 bytes, optionally null terminated. ErrorMode defaults to WTF-8. */
  export function encode(
    str: string,
    nullTerminated: bool = false,
    errorMode: ErrorMode = ErrorMode.WTF8
  ): ArrayBuffer {
    const buf = changetype<ArrayBuffer>(
      __new(<usize>byteLength(str, nullTerminated), idof<ArrayBuffer>())
    );
    encodeUnsafe(
      changetype<usize>(str), str.length, changetype<usize>(buf),
      nullTerminated, errorMode
    );
    return buf;
  }

  /** Encodes the specified raw string to UTF-8 bytes, opionally null terminated. ErrorMode defaults to WTF-8. Returns the number of bytes written. */
  // @ts-ignore: decorator
  @unsafe export function encodeUnsafe(
    str: usize,
    len: i32,
    buf: usize,
    nullTerminated: bool = false,
    errorMode: ErrorMode = ErrorMode.WTF8
  ): usize {
    // SWAR by default; SIMD only when compiled in and the input is large enough
    // to amortize its 16-unit window (small input has no SIMD work to do). Both
    // cover the stdlib-default path; other modes / lone surrogates fall to the
    // scalar emitter, which rewrites `buf` from the start.
    if (!nullTerminated && errorMode == ErrorMode.WTF8) {
      const written = (ASC_FEATURE_SIMD && len >= ENCODE_SIMD_THRESHOLD)
        ? utf16le_to_utf8(str, len, buf)
        : utf16le_to_utf8_swar(str, len, buf);
      if (written >= 0) return <usize>written;
    }
    return scalarEncode(str, len, buf, nullTerminated, errorMode);
  }

  /** Decodes the specified buffer from UTF-8 bytes to a string, optionally null terminated. */
  export function decode(buf: ArrayBuffer, nullTerminated: bool = false): string {
    return decodeUnsafe(changetype<usize>(buf), <usize>buf.byteLength, nullTerminated);
  }

  /** Decodes raw UTF-8 bytes to a string, optionally null terminated. */
  // @ts-ignore: decorator
  @unsafe export function decodeUnsafe(buf: usize, len: usize, nullTerminated: bool = false): string {
    if (len == 0) return "";
    if (!nullTerminated) {
      const maxStr = changetype<string>(__new(len << 1, idof<string>()));
      // SWAR by default; SIMD only when compiled in and the input clears its
      // 64-byte window. Both are byte-identical on valid input; on malformed
      // input either may return -1 and fall through to permissive `scalarDecode`.
      const units = (ASC_FEATURE_SIMD && len >= <usize>DECODE_SIMD_THRESHOLD)
        ? utf8_to_utf16le(buf, <i32>len, changetype<usize>(maxStr))
        : utf8_to_utf16le_swar(buf, <i32>len, changetype<usize>(maxStr));
      if (units >= 0) {
        return changetype<string>(
          __renew(changetype<usize>(maxStr), <usize>units << 1)
        );
      }
    }
    // SIMD rejected, or null-scan requested → permissive scalar.
    return scalarDecode(buf, len, nullTerminated);
  }

  export function utf16Length(buf: ArrayBuffer): i32 {
    return utf16_length_from_utf8(changetype<usize>(buf), buf.byteLength);
  }

  // @ts-ignore: decorator
  @unsafe
  export function utf16LengthUnsafe(buf: usize, len: i32): i32 {
    return utf16_length_from_utf8(buf, len);
  }

  /** Whether the buffer is well-formed UTF-8. */
  export function validate(buf: ArrayBuffer): bool {
    return validateUnsafe(changetype<usize>(buf), buf.byteLength);
  }

  /** Smallest input (bytes) routed to the SIMD validator when SIMD is compiled
   *  in. Below this the SWAR path wins: it skips the SIMD path's `memory.fill` +
   *  `memory.copy` of a 64-byte scratch window and validates 8 bytes per u64.
   *  Tuned empirically against `utf-validate-swar.bench.ts`. */
  // @ts-ignore: decorator
  @inline const SIMD_THRESHOLD: i32 = 64;

  /** Smallest input routed to the SIMD encode/decode kernels when SIMD is
   *  compiled in. Below these the SWAR transcoders win: the SIMD kernels do no
   *  vector work until their window fills (encode: 16 units + 12-unit margin;
   *  decode: 64 bytes + 16-byte margin) and otherwise run the same scalar tail.
   *  Tuned against `utf-transcode-swar.bench.ts`. Thresholds are in code units
   *  (encode: UTF-16 units) / bytes (decode: UTF-8 bytes).
   *
   *  The decode threshold favors ASCII: after the SWAR decoder's bulk-widen
   *  rework it beats the SIMD kernel on ASCII up to ~512 B (e.g. at 256 B: ~5.9
   *  vs ~3.5 GB/s), so 256-511 B ASCII text stays on SWAR. Mixed-script input in
   *  that band is modestly faster on SIMD — a deliberate trade, since real decode
   *  input skews ASCII-dominant. */
  // @ts-ignore: decorator
  @inline const ENCODE_SIMD_THRESHOLD: i32 = 32;
  // @ts-ignore: decorator
  @inline const DECODE_SIMD_THRESHOLD: i32 = 512;

  /** Whether `len` raw bytes at `buf` are well-formed UTF-8. Empty input is
   *  valid. The default path is the SWAR validator (`validate_swar.ts`); when
   *  SIMD is compiled in (`ASC_FEATURE_SIMD`) large inputs route to the simdutf
   *  Keiser–Lemire kernel (`validateSimd`). Both paths agree byte-for-byte.
   *
   *  The `ASC_FEATURE_SIMD` guard is a compile-time constant: with `--enable
   *  simd` off it folds false, `validateSimd` is never called, and an uncalled
   *  function is never compiled — so this module builds and runs without SIMD. */
  // @ts-ignore: decorator
  @unsafe
  export function validateUnsafe(buf: usize, len: i32): bool {
    if (len <= 0) return len == 0;
    if (ASC_FEATURE_SIMD && len >= SIMD_THRESHOLD) return validateSimd(buf, len);
    return validateSwar(buf, len);
  }
}

// Stdlib-clone scalars — byte-for-byte parity with `String.UTF8` for the
// WTF8 / REPLACE / ERROR encode modes and the permissive decode path.

function scalarByteLength(strPtr: usize, strLen: i32, nullTerminated: bool): i32 {
  let strOff = strPtr;
  const strEnd = strOff + (<usize>strLen << 1);
  let bufLen: i32 = i32(nullTerminated);
  while (strOff < strEnd) {
    const c1 = <u32>load<u16>(strOff);
    if (c1 < 128) {
      // @ts-ignore: cast
      if (nullTerminated & !c1) break;
      bufLen += 1;
    } else if (c1 < 2048) {
      bufLen += 2;
    } else {
      if ((c1 & 0xFC00) == 0xD800 && strOff + 2 < strEnd) {
        if ((<u32>load<u16>(strOff, 2) & 0xFC00) == 0xDC00) {
          bufLen += 4; strOff += 4;
          continue;
        }
      }
      bufLen += 3;
    }
    strOff += 2;
  }
  return bufLen;
}

function scalarEncode(
  strIn: usize,
  lenIn: i32,
  bufIn: usize,
  nullTerminated: bool,
  errorMode: UTF8.ErrorMode
): usize {
  let str = strIn;
  const strEnd = str + (<usize>lenIn << 1);
  let bufOff = bufIn;
  while (str < strEnd) {
    let c1 = <u32>load<u16>(str);
    if (c1 < 128) {
      store<u8>(bufOff, c1);
      bufOff++;
      // @ts-ignore: cast
      if (nullTerminated & !c1) return bufOff - bufIn;
    } else if (c1 < 2048) {
      const b0 = c1 >> 6 | 192;
      const b1 = c1 & 63 | 128;
      store<u16>(bufOff, b1 << 8 | b0);
      bufOff += 2;
    } else {
      if ((c1 & 0xF800) == 0xD800) {
        if (c1 < 0xDC00 && str + 2 < strEnd) {
          const c2 = <u32>load<u16>(str, 2);
          if ((c2 & 0xFC00) == 0xDC00) {
            c1 = 0x10000 + ((c1 & 0x03FF) << 10) | (c2 & 0x03FF);
            const b0 = c1 >> 18 | 240;
            const b1 = c1 >> 12 & 63 | 128;
            const b2 = c1 >> 6  & 63 | 128;
            const b3 = c1       & 63 | 128;
            store<u32>(bufOff, b3 << 24 | b2 << 16 | b1 << 8 | b0);
            bufOff += 4; str += 4;
            continue;
          }
        }
        if (errorMode != UTF8.ErrorMode.WTF8) {
          if (errorMode == UTF8.ErrorMode.ERROR) throw new Error(E_UNPAIRED_SURROGATE);
          c1 = 0xFFFD;
        }
      }
      const b0 = c1 >> 12 | 224;
      const b1 = c1 >> 6  & 63 | 128;
      const b2 = c1       & 63 | 128;
      store<u16>(bufOff, b1 << 8 | b0);
      store<u8>(bufOff, b2, 2);
      bufOff += 3;
    }
    str += 2;
  }
  if (nullTerminated) {
    store<u8>(bufOff++, 0);
  }
  return bufOff - bufIn;
}

function scalarDecode(bufIn: usize, lenIn: usize, nullTerminated: bool): string {
  let bufOff = bufIn;
  const bufEnd = bufIn + lenIn;
  assert(bufEnd >= bufOff);
  const str = changetype<string>(__new(lenIn << 1, idof<string>()));
  let strOff = changetype<usize>(str);
  while (bufOff < bufEnd) {
    const u0 = <u32>load<u8>(bufOff); ++bufOff;
    if (!(u0 & 128)) {
      // @ts-ignore: cast
      if (nullTerminated & !u0) break;
      store<u16>(strOff, u0);
    } else {
      if (bufEnd == bufOff) break;
      const u1 = <u32>load<u8>(bufOff) & 63; ++bufOff;
      if ((u0 & 224) == 192) {
        store<u16>(strOff, (u0 & 31) << 6 | u1);
      } else {
        if (bufEnd == bufOff) break;
        const u2 = <u32>load<u8>(bufOff) & 63; ++bufOff;
        if ((u0 & 240) == 224) {
          store<u16>(strOff, (u0 & 15) << 12 | u1 << 6 | u2);
        } else {
          if (bufEnd == bufOff) break;
          let cp = (u0 & 7) << 18 | u1 << 12 | u2 << 6 | <u32>load<u8>(bufOff) & 63;
          ++bufOff;
          if (cp < 0x10000) {
            store<u16>(strOff, cp);
          } else {
            cp -= 0x10000;
            const lo = cp >> 10 | 0xD800;
            const hi = (cp & 0x03FF) | 0xDC00;
            store<u32>(strOff, lo | (hi << 16));
            strOff += 2;
          }
        }
      }
    }
    strOff += 2;
  }
  return changetype<string>(
    __renew(changetype<usize>(str), strOff - changetype<usize>(str))
  );
}
