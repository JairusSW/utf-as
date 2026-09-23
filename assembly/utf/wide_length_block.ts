import { v256r, v512r } from "as-simd/assembly/wide/wide";

/** Count UTF-16 code units in a valid UTF-8 block. */
export function utf16_length_utf8_block_256(ptr: usize): i32 {
  v256r.load(0, ptr);
  v256r.splat<u8>(1, 0x80);
  v256r.ge<u8>(2, 0, 1);
  v256r.splat<u8>(1, 0xc0);
  v256r.lt<u8>(3, 0, 1);
  v256r.and(2, 2, 3);
  v256r.splat<u8>(1, 0xf0);
  v256r.ge<u8>(3, 0, 1);
  v256r.splat<u8>(1, 0xf8);
  v256r.lt<u8>(4, 0, 1);
  v256r.and(3, 3, 4);
  return 32 - popcnt(<u32>v256r.bitmask<i8>(2)) + popcnt(<u32>v256r.bitmask<i8>(3));
}

export function utf16_length_utf8_block_512(ptr: usize): i32 {
  v512r.load(0, ptr);
  v512r.splat<u8>(1, 0x80);
  v512r.ge<u8>(2, 0, 1);
  v512r.splat<u8>(1, 0xc0);
  v512r.lt<u8>(3, 0, 1);
  v512r.and(2, 2, 3);
  v512r.splat<u8>(1, 0xf0);
  v512r.ge<u8>(3, 0, 1);
  v512r.splat<u8>(1, 0xf8);
  v512r.lt<u8>(4, 0, 1);
  v512r.and(3, 3, 4);
  return 64 - <i32>popcnt(v512r.bitmask<i8>(2)) + <i32>popcnt(v512r.bitmask<i8>(3));
}

/** Count UTF-8 bytes from a valid UTF-16 block. */
export function utf8_length_utf16_block_256(ptr: usize): i32 {
  v256r.load(0, ptr);
  v256r.splat<u16>(1, 0x80);
  v256r.ge<u16>(2, 0, 1);
  v256r.splat<u16>(1, 0x800);
  v256r.ge<u16>(3, 0, 1);
  v256r.splat<u16>(1, 0xdc00);
  v256r.ge<u16>(4, 0, 1);
  v256r.splat<u16>(1, 0xe000);
  v256r.lt<u16>(5, 0, 1);
  v256r.and(4, 4, 5);
  return 16 + popcnt(<u32>v256r.bitmask<i16>(2)) + popcnt(<u32>v256r.bitmask<i16>(3)) - 2 * popcnt(<u32>v256r.bitmask<i16>(4));
}

export function utf8_length_utf16_block_512(ptr: usize): i32 {
  v512r.load(0, ptr);
  v512r.splat<u16>(1, 0x80);
  v512r.ge<u16>(2, 0, 1);
  v512r.splat<u16>(1, 0x800);
  v512r.ge<u16>(3, 0, 1);
  v512r.splat<u16>(1, 0xdc00);
  v512r.ge<u16>(4, 0, 1);
  v512r.splat<u16>(1, 0xe000);
  v512r.lt<u16>(5, 0, 1);
  v512r.and(4, 4, 5);
  return 32 + <i32>popcnt(v512r.bitmask<i16>(2)) + <i32>popcnt(v512r.bitmask<i16>(3)) - 2 * <i32>popcnt(v512r.bitmask<i16>(4));
}
