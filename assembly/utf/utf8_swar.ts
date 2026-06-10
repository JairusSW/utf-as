// SWAR (SIMD-Within-A-Register) UTF-8 transcoders — the default encode/decode
// paths. Pure u64 word arithmetic: no v128, so they compile and run with
// `--enable simd` off, and they beat the SIMD kernels on small/medium input
// (which the SIMD kernels can't accelerate below their 64-byte window anyway).
//
// Each kernel is a hybrid: an ASCII fast path that processes 8 code units /
// bytes per u64 word, falling back to the existing strict scalar coders
// (`scalar_decode_one` / `scalar_encode`) for the multibyte parts. On valid
// input the output is byte-identical to the SIMD kernels; the decode path
// keeps the same "strict here, permissive scalar fallback in the caller"
// contract (returns -1 on malformed, the caller retries via `scalarDecode`).

import { scalar_decode_one, scalar_encode } from "./utf8";

// High bit of each byte lane (UTF-8 non-ASCII / continuation detector).
const HI: u64 = 0x8080808080808080;
// Bits outside 0x00-0x7F of each u16 lane (UTF-16 non-ASCII detector).
const HI16: u64 = 0xFF80FF80FF80FF80;

/** Widen the low 4 bytes of `x` into 4 little-endian u16 lanes (zero-extend each
 *  byte). `b3 b2 b1 b0` → `00 b3 00 b2 00 b1 00 b0`. Mask to 4 bytes, then two
 *  spread-and-mask steps settle each byte into its own 16-bit lane (7 ops vs the
 *  four-masked-shift form's 10), with a shorter dependency tail. */
// @ts-ignore: decorator
@inline function widenLo(x: u64): u64 {
  let w = x & 0xFFFFFFFF;
  w = (w | (w << 16)) & 0x0000FFFF0000FFFF; // b3 b2 → high 32, b1 b0 → low 32
  w = (w | (w << 8)) & 0x00FF00FF00FF00FF;  // each byte into its own u16 lane
  return w;
}

/** Narrow 4 u16 lanes (low byte of each) into 4 packed bytes. Inverse of
 *  `widenLo` for ASCII. `00 u3 00 u2 00 u1 00 u0` → `u3 u2 u1 u0`. */
// @ts-ignore: decorator
@inline function packLo(x: u64): u32 {
  return <u32>((x & 0xFF)
    | ((x >> 8) & 0xFF00)
    | ((x >> 16) & 0xFF0000)
    | ((x >> 24) & 0xFF000000));
}

/** UTF-8 → UTF-16LE, SWAR. Returns code units written, or -1 on malformed
 *  input (strict; the caller falls back to the permissive `scalarDecode`).
 *  Byte-identical to `utf8_to_utf16le` on valid input. */
// @ts-ignore: decorator
@unsafe export function utf8_to_utf16le_swar(src: usize, len: i32, dst: usize): i32 {
  if (len < 0) return -1;
  let pos: i32 = 0;
  let out: usize = dst;

  // 16-byte (2-word) unrolled ASCII widen for the dominant all-ASCII case;
  // 8-byte for the tail of a window. A dirty word doesn't dump the *whole* word
  // to the scalar coder — `ctz` locates the first non-ASCII byte, the ASCII
  // prefix is widened in bulk, and only the multibyte cluster runs through
  // `scalar_decode_one` (and stays there until ASCII resumes). This keeps mixed
  // text from paying a per-byte scalar call for ASCII that merely shares a word
  // with a multibyte sequence.
  while (pos + 16 <= len) {
    const w0 = load<u64>(src + <usize>pos);
    const w1 = load<u64>(src + <usize>pos, 8);
    if (((w0 | w1) & HI) == 0) {
      store<u64>(out, widenLo(w0));
      store<u64>(out, widenLo(w0 >> 32), 8);
      store<u64>(out, widenLo(w1), 16);
      store<u64>(out, widenLo(w1 >> 32), 24);
      out += 32;
      pos += 16;
      continue;
    }
    if ((w0 & HI) == 0) { // first word ASCII, second dirty — widen first, step
      store<u64>(out, widenLo(w0));
      store<u64>(out, widenLo(w0 >> 32), 8);
      out += 16;
      pos += 8;
      continue;
    }
    // w0 dirty: widen its ASCII prefix in bulk, then decode the multibyte run.
    let k = <i32>(ctz(w0 & HI) >> 3);
    pos += k;
    for (let j: i32 = 0; j < k; j++) {
      store<u16>(out, <u16>((w0 >> (<u64>(j << 3))) & 0xFF));
      out += 2;
    }
    let b0 = <u32>load<u8>(src + <usize>pos);
    do {
      const ret = scalar_decode_one(src + <usize>pos, len - pos, out);
      if (ret == 0) return -1;
      pos += <i32>(ret & 0xffffffff);
      out += <usize>((ret >> 32) << 1);
      if (pos >= len) break;
      b0 = <u32>load<u8>(src + <usize>pos);
    } while (b0 >= 0x80);
  }
  while (pos + 8 <= len) {
    const w = load<u64>(src + <usize>pos);
    if ((w & HI) == 0) {
      store<u64>(out, widenLo(w));
      store<u64>(out, widenLo(w >> 32), 8);
      out += 16;
      pos += 8;
      continue;
    }
    let k = <i32>(ctz(w & HI) >> 3);
    pos += k;
    for (let j: i32 = 0; j < k; j++) {
      store<u16>(out, <u16>((w >> (<u64>(j << 3))) & 0xFF));
      out += 2;
    }
    let b0 = <u32>load<u8>(src + <usize>pos);
    do {
      const ret = scalar_decode_one(src + <usize>pos, len - pos, out);
      if (ret == 0) return -1;
      pos += <i32>(ret & 0xffffffff);
      out += <usize>((ret >> 32) << 1);
      if (pos >= len) break;
      b0 = <u32>load<u8>(src + <usize>pos);
    } while (b0 >= 0x80);
  }

  // Tail: < 8 bytes remain.
  while (pos < len) {
    const ret = scalar_decode_one(src + <usize>pos, len - pos, out);
    if (ret == 0) return -1;
    pos += <i32>(ret & 0xffffffff);
    out += <usize>((ret >> 32) << 1);
  }

  return <i32>((out - dst) >> 1);
}

/** UTF-16LE → UTF-8, SWAR. Returns bytes written, or -1 on a lone surrogate
 *  (the caller falls back to `scalarEncode`, which handles WTF-8 / REPLACE /
 *  ERROR). Byte-identical to `utf16le_to_utf8` on surrogate-free input. */
// @ts-ignore: decorator
@unsafe export function utf16le_to_utf8_swar(src: usize, len: i32, dst: usize): i32 {
  if (len < 0) return -1;
  if (len == 0) return 0;
  let i: i32 = 0;
  let out: usize = dst;

  while (i + 8 <= len) {
    const base = src + (<usize>i << 1);
    const w0 = load<u64>(base);
    const w1 = load<u64>(base, 8);
    if (((w0 | w1) & HI16) == 0) {
      // 8 ASCII units → 8 bytes.
      store<u32>(out, packLo(w0));
      store<u32>(out, packLo(w1), 4);
      out += 8;
      i += 8;
      continue;
    }
    // Dirty word — emit one unit (or surrogate pair), then retry the fast path.
    const w: u32 = load<u16>(src + (<usize>i << 1));
    if (w < 0x80) {
      store<u8>(out, <u8>w);
      out += 1; i += 1;
    } else if (w < 0x800) {
      store<u8>(out, <u8>(0xC0 | (w >> 6)));
      store<u8>(out, <u8>(0x80 | (w & 0x3F)), 1);
      out += 2; i += 1;
    } else if (w < 0xD800 || w >= 0xE000) {
      store<u8>(out, <u8>(0xE0 | (w >> 12)));
      store<u8>(out, <u8>(0x80 | ((w >> 6) & 0x3F)), 1);
      store<u8>(out, <u8>(0x80 | (w & 0x3F)), 2);
      out += 3; i += 1;
    } else if (w < 0xDC00) {
      if (i + 1 >= len) return -1;
      const w2: u32 = load<u16>(src + (<usize>(i + 1) << 1));
      if (w2 < 0xDC00 || w2 >= 0xE000) return -1;
      const cp = (((w - 0xD800) << 10) | (w2 - 0xDC00)) + 0x10000;
      store<u8>(out, <u8>(0xF0 | (cp >> 18)));
      store<u8>(out, <u8>(0x80 | ((cp >> 12) & 0x3F)), 1);
      store<u8>(out, <u8>(0x80 | ((cp >> 6) & 0x3F)), 2);
      store<u8>(out, <u8>(0x80 | (cp & 0x3F)), 3);
      out += 4; i += 2;
    } else {
      return -1; // lone low surrogate
    }
  }

  // Tail: < 8 units remain — reuse the strict scalar coder.
  const written = scalar_encode(src + (<usize>i << 1), len - i, out);
  if (written < 0) return -1;
  out += <usize>written;
  return <i32>(out - dst);
}
