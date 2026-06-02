// SIMD UTF-8 validation. Ported from simdutf's `utf8_lookup4_algorithm.h`
// (Keiser–Lemire, "Validating UTF-8 in less than one instruction per byte",
// SPE 2021). 64-byte windows of 4 × 16-byte chunks.

import {
  u8x16, MASK_0x0F, MASK_0x80, shr4_u8, prev1, prev2, prev3
} from "./common";

// Error bit flags. Layout matches simdutf so the LUT constants below can be
// diffed against the C++. The trailing comment is the byte-pattern that
// triggers each flag.
const TOO_SHORT: u8     = 1 << 0; // 11______ 0_______ / 11______
const TOO_LONG: u8      = 1 << 1; // 0_______ 10______
const OVERLONG_3: u8    = 1 << 2; // 11100000 100_____
const TOO_LARGE: u8     = 1 << 3; // 11110100+ 1001____ / 101_____
const SURROGATE: u8     = 1 << 4; // 11101101 101_____
const OVERLONG_2: u8    = 1 << 5; // 1100000_ 10______
const TOO_LARGE_1000: u8 = 1 << 6; // 11110101+ 1000____  (shares bit with OVERLONG_4)
const OVERLONG_4: u8    = 1 << 6; // 11110000 1000____
const TWO_CONTS: u8     = 1 << 7; // 10______ 10______
const CARRY: u8         = TOO_SHORT | TOO_LONG | TWO_CONTS;

// Nibble-indexed LUTs; conjunction of all three is the actual error mask.
// Lane comments are the high or low nibble pattern that selects that lane.
// @ts-ignore: decorator
@inline function BYTE_1_HIGH(): v128 {
  return u8x16(
    TOO_LONG, TOO_LONG, TOO_LONG, TOO_LONG,           // 0xxx ASCII
    TOO_LONG, TOO_LONG, TOO_LONG, TOO_LONG,
    TWO_CONTS, TWO_CONTS, TWO_CONTS, TWO_CONTS,       // 10xx continuation
    TOO_SHORT | OVERLONG_2,                           // 1100 2-byte lead
    TOO_SHORT,                                        // 1101 2-byte lead
    TOO_SHORT | OVERLONG_3 | SURROGATE,               // 1110 3-byte lead
    TOO_SHORT | TOO_LARGE | TOO_LARGE_1000 | OVERLONG_4 // 1111 4-byte lead
  );
}

// @ts-ignore: decorator
@inline function BYTE_1_LOW(): v128 {
  return u8x16(
    CARRY | OVERLONG_3 | OVERLONG_2 | OVERLONG_4,     // ___0
    CARRY | OVERLONG_2,                               // ___1
    CARRY, CARRY,                                     // ___2, ___3
    CARRY | TOO_LARGE,                                // ___4
    CARRY | TOO_LARGE | TOO_LARGE_1000,               // ___5
    CARRY | TOO_LARGE | TOO_LARGE_1000,               // ___6
    CARRY | TOO_LARGE | TOO_LARGE_1000,               // ___7
    CARRY | TOO_LARGE | TOO_LARGE_1000,               // ___8
    CARRY | TOO_LARGE | TOO_LARGE_1000,               // ___9
    CARRY | TOO_LARGE | TOO_LARGE_1000,               // ___a
    CARRY | TOO_LARGE | TOO_LARGE_1000,               // ___b
    CARRY | TOO_LARGE | TOO_LARGE_1000,               // ___c
    CARRY | TOO_LARGE | TOO_LARGE_1000 | SURROGATE,   // ___d
    CARRY | TOO_LARGE | TOO_LARGE_1000,               // ___e
    CARRY | TOO_LARGE | TOO_LARGE_1000                // ___f
  );
}

// @ts-ignore: decorator
@inline function BYTE_2_HIGH(): v128 {
  return u8x16(
    TOO_SHORT, TOO_SHORT, TOO_SHORT, TOO_SHORT,
    TOO_SHORT, TOO_SHORT, TOO_SHORT, TOO_SHORT,
    TOO_LONG | OVERLONG_2 | TWO_CONTS | OVERLONG_3 | TOO_LARGE_1000 | OVERLONG_4, // 1000
    TOO_LONG | OVERLONG_2 | TWO_CONTS | OVERLONG_3 | TOO_LARGE,                   // 1001
    TOO_LONG | OVERLONG_2 | TWO_CONTS | SURROGATE | TOO_LARGE,                    // 1010
    TOO_LONG | OVERLONG_2 | TWO_CONTS | SURROGATE | TOO_LARGE,                    // 1011
    TOO_SHORT, TOO_SHORT, TOO_SHORT, TOO_SHORT
  );
}

// @ts-ignore: decorator
@inline function check_special_cases(input: v128, p1: v128): v128 {
  const b1h = i8x16.swizzle(BYTE_1_HIGH(), shr4_u8(p1));
  const b1l = i8x16.swizzle(BYTE_1_LOW(), v128.and(p1, MASK_0x0F()));
  const b2h = i8x16.swizzle(BYTE_2_HIGH(), shr4_u8(input));
  return v128.and(v128.and(b1h, b1l), b2h);
}

// @ts-ignore: decorator
@lazy const SPLAT_E0_MINUS_80: v128 = v128.splat<u8>(0xe0 - 0x80);
// @ts-ignore: decorator
@lazy const SPLAT_F0_MINUS_80: v128 = v128.splat<u8>(0xf0 - 0x80);

// simdutf trick: `prev2 sat- 0x60` is non-zero iff prev2 was a 3-byte lead;
// `prev3 sat- 0x70` mirrors that for 4-byte leads. Either implies current
// MUST be a continuation; XOR vs the special-cases mask catches the gap.
// @ts-ignore: decorator
@inline function check_multibyte_lengths(input: v128, prevBlock: v128, sc: v128): v128 {
  const p2 = prev2(input, prevBlock);
  const p3 = prev3(input, prevBlock);
  const is3 = i8x16.sub_sat_u(p2, SPLAT_E0_MINUS_80);
  const is4 = i8x16.sub_sat_u(p3, SPLAT_F0_MINUS_80);
  const must23_80 = v128.and(v128.or(is3, is4), MASK_0x80());
  return v128.xor(must23_80, sc);
}

// Nonzero if the block's last 1-3 bytes are the *start* of a multibyte
// sequence and so need bytes from the next block. Thresholds: byte-13 > 0xef
// (4-byte lead), byte-14 > 0xdf (3-byte), byte-15 > 0xbf (any lead).
// @ts-ignore: decorator
@inline export function is_incomplete(input: v128): v128 {
  const max_value = u8x16(
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff,
    0xf0 - 1, 0xe0 - 1, 0xc0 - 1
  );
  return i8x16.sub_sat_u(input, max_value);
}

// @ts-ignore: decorator
@inline export function check_chunk(input: v128, prevBlock: v128, error: v128): v128 {
  const p1 = prev1(input, prevBlock);
  const sc = check_special_cases(input, p1);
  return v128.or(error, check_multibyte_lengths(input, prevBlock, sc));
}

// Subdivided dirty-path: run check_chunk only on chunks that have any
// high-bit-set byte. At every dirty→clean transition inside the block
// (including the cross-block carry into a clean b0), OR `is_incomplete` of
// the dirty side into `error` so an unfinished sequence at the chunk's tail
// (or a stale `prevIncomplete` from the previous block) can't slip past an
// ASCII chunk that wouldn't otherwise be validated.
//
// Cost vs. the unconditional 4× check_chunk path: +8 ops for the 4 chunk-
// dirty probes, ~30 ops saved per skipped check_chunk. Net positive whenever
// ≥1 chunk in a 64-byte block is pure ASCII; small overhead on dense
// multibyte content where all four chunks are dirty.
// @ts-ignore: decorator
@inline export function check_block_subdivided(
  b0: v128, b1: v128, b2: v128, b3: v128,
  prevInput: v128, prevIncomplete: v128,
  error: v128
): v128 {
  // `i8x16.bitmask` extracts the sign bit (= UTF-8 high bit) of each byte
  // into a 16-bit scalar — one SIMD-to-GP move per chunk, then ordinary
  // integer comparison. Cheaper on Apple Silicon than `any_true(and(b,
  // 0x80))` which lowers to a horizontal max-reduce + zero compare.
  const m0 = i8x16.bitmask(b0);
  const m1 = i8x16.bitmask(b1);
  const m2 = i8x16.bitmask(b2);
  const m3 = i8x16.bitmask(b3);
  const d0 = m0 != 0;
  const d1 = m1 != 0;
  const d2 = m2 != 0;
  const d3 = m3 != 0;

  // All-dirty fast path: dense multibyte content (Cyrillic, CJK, emoji)
  // would otherwise pay subdivision overhead for no benefit. Skip straight
  // to the unconditional 4× check_chunk path when every chunk has at least
  // one high-bit byte.
  if (d0 & d1 & d2 & d3) {
    error = check_chunk(b0, prevInput, error);
    error = check_chunk(b1, b0, error);
    error = check_chunk(b2, b1, error);
    error = check_chunk(b3, b2, error);
    return error;
  }

  // Cross-block: if b0 is ASCII, no check_chunk lookback consumes the carry.
  if (!d0) error = v128.or(error, prevIncomplete);

  if (d0) error = check_chunk(b0, prevInput, error);
  if (d0 && !d1) error = v128.or(error, is_incomplete(b0));

  if (d1) error = check_chunk(b1, b0, error);
  if (d1 && !d2) error = v128.or(error, is_incomplete(b1));

  if (d2) error = check_chunk(b2, b1, error);
  if (d2 && !d3) error = v128.or(error, is_incomplete(b2));

  if (d3) error = check_chunk(b3, b2, error);

  return error;
}

// --- UTF-16 ---------------------------------------------------------------
// Well-formed UTF-16LE has no lone surrogates: every high surrogate
// (0xD800-0xDBFF) is immediately followed by a low surrogate (0xDC00-0xDFFF),
// and every low surrogate is immediately preceded by a high one.
//
// Per 8-unit (128-bit) block we build two bitmasks — `H` (high surrogates) and
// `L` (low surrogates) — one bit per code unit, bit i = unit i. The set of
// required low positions is `H << 1`: a high at unit i demands a low at i+1.
// The block is well-formed iff `L == ((H << 1) | carryIn)`, where `carryIn` is
// 1 when the previous block ended on a high surrogate. The high bit of `H`
// (a high surrogate at the block's last unit) carries into the next block.
// At end-of-input a still-pending carry is an unpaired trailing high → error.
//
// Fast path: a block with no surrogates at all (`surr` bitmask == 0) provably
// has H == 0 and L == 0 (highs and lows are both subsets of the surrogate
// range), so its only possible error is an unfulfilled `carryIn` and its
// carry-out is 0 — handled without the extra classification ops. The common
// case (text with zero surrogates) thus pays one compare + one bitmask.

// @ts-ignore: decorator
@lazy const SPLAT_F800_U16: v128 = v128.splat<u16>(0xf800);
// @ts-ignore: decorator
@lazy const SPLAT_D800_SURR: v128 = v128.splat<u16>(0xd800);
// @ts-ignore: decorator
@lazy const SPLAT_FC00_U16: v128 = v128.splat<u16>(0xfc00);
// @ts-ignore: decorator
@lazy const SPLAT_DC00_LOW: v128 = v128.splat<u16>(0xdc00);

/** Validate one 8-unit UTF-16 block against the running high-surrogate carry.
 *  Returns packed: bits [8..1] = error contribution (`L ^ expectedLow`), bit 0
 *  = carry-out (a high surrogate at the block's last unit). */
// @ts-ignore: decorator
@inline export function surr_block(v: v128, prevHigh: u32): u32 {
  // surrogate iff (v & 0xf800) == 0xd800.
  const surr = i16x8.eq(v128.and(v, SPLAT_F800_U16), SPLAT_D800_SURR);
  if (i16x8.bitmask(surr) == 0) {
    // No surrogates → H = L = 0. Error contribution is the unfulfilled carry
    // (expectedLow == prevHigh, L == 0); carry-out is 0.
    return prevHigh << 1;
  }
  // low iff (v & 0xfc00) == 0xdc00; high is a surrogate that isn't low.
  const low = i16x8.eq(v128.and(v, SPLAT_FC00_U16), SPLAT_DC00_LOW);
  const high = v128.and(surr, v128.not(low));
  const H = <u32>i16x8.bitmask(high);
  const L = <u32>i16x8.bitmask(low);
  const err = L ^ (((H << 1) | prevHigh) & 0xff);
  return (err << 1) | ((H >> 7) & 1);
}

/** Shared zero-padding scratch for tail blocks (64 B covers both the UTF-8
 *  64-byte window and the UTF-16 16-byte block). */
export const SCRATCH: usize = memory.data(64);
