// Shared v128 helpers for the UTF-8/16 kernels.

/** v128(...) takes signed i8 lanes; this wrapper accepts 0..255 for LUTs. */
// @ts-ignore: decorator
@inline export function u8x16(
  a: u32, b: u32, c: u32, d: u32, e: u32, f: u32, g: u32, h: u32,
  i: u32, j: u32, k: u32, l: u32, m: u32, n: u32, o: u32, p: u32
): v128 {
  return v128(
    <i8>a, <i8>b, <i8>c, <i8>d, <i8>e, <i8>f, <i8>g, <i8>h,
    <i8>i, <i8>j, <i8>k, <i8>l, <i8>m, <i8>n, <i8>o, <i8>p
  );
}

// @ts-ignore: decorator
@inline export function MASK_0x0F(): v128 { return v128.splat<u8>(0x0F); }
// @ts-ignore: decorator
@inline export function MASK_0x80(): v128 { return v128.splat<u8>(0x80); }

/** Per-byte u8 >> 4. WASM SIMD only exposes 16-bit-lane shifts. */
// @ts-ignore: decorator
@inline export function shr4_u8(v: v128): v128 {
  return v128.and(v128.shr<u16>(v, 4), MASK_0x0F());
}

/** `prevN`: take lanes (16-N..31-N) from concat(prev, curr) — cross-block lookback. */
// @ts-ignore: decorator
@inline export function prev1(curr: v128, prev: v128): v128 {
  return i8x16.shuffle(prev, curr,
    15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30);
}

// @ts-ignore: decorator
@inline export function prev2(curr: v128, prev: v128): v128 {
  return i8x16.shuffle(prev, curr,
    14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29);
}

// @ts-ignore: decorator
@inline export function prev3(curr: v128, prev: v128): v128 {
  return i8x16.shuffle(prev, curr,
    13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28);
}

/** All four chunks pure ASCII? (no high bit anywhere) */
// @ts-ignore: decorator
@inline export function block_is_ascii(b0: v128, b1: v128, b2: v128, b3: v128): bool {
  const any = v128.or(v128.or(b0, b1), v128.or(b2, b3));
  return !v128.any_true(v128.and(any, MASK_0x80()));
}
