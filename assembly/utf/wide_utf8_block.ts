import { v256r, v512r } from "as-simd/assembly/wide/wide";

const BAD: usize = memory.data(64);

/** UTF-8 block validators. Input includes three readable preceding bytes. */
@noInline export function utf8_validate_block_256(ptr: usize): bool {
  v256r.load(0, ptr + 3);
  v256r.load(1, ptr + 2);
  v256r.load(2, ptr + 1);
  v256r.load(3, ptr);
  v256r.splat<u8>(4, 0xc2);
  v256r.ge<u8>(6, 1, 4);
  v256r.splat<u8>(4, 0xf4);
  v256r.le<u8>(5, 1, 4);
  v256r.and(6, 6, 5);
  v256r.splat<u8>(4, 0xe0);
  v256r.ge<u8>(5, 2, 4);
  v256r.splat<u8>(4, 0xf4);
  v256r.le<u8>(8, 2, 4);
  v256r.and(5, 5, 8);
  v256r.or(6, 6, 5);
  v256r.splat<u8>(4, 0xf0);
  v256r.ge<u8>(5, 3, 4);
  v256r.splat<u8>(4, 0xf4);
  v256r.le<u8>(8, 3, 4);
  v256r.and(5, 5, 8);
  v256r.or(6, 6, 5);
  v256r.splat<u8>(4, 0x80);
  v256r.ge<u8>(7, 0, 4);
  v256r.splat<u8>(4, 0xbf);
  v256r.le<u8>(5, 0, 4);
  v256r.and(7, 7, 5);
  v256r.xor(8, 6, 7);
  v256r.splat<u8>(4, 0xc0);
  v256r.ge<u8>(5, 0, 4);
  v256r.splat<u8>(4, 0xc2);
  v256r.lt<u8>(6, 0, 4);
  v256r.and(5, 5, 6);
  v256r.or(8, 8, 5);
  v256r.splat<u8>(4, 0xf5);
  v256r.ge<u8>(5, 0, 4);
  v256r.or(8, 8, 5);
  v256r.splat<u8>(4, 0xe0);
  v256r.eq<u8>(5, 1, 4);
  v256r.splat<u8>(4, 0xa0);
  v256r.lt<u8>(6, 0, 4);
  v256r.and(5, 5, 6);
  v256r.or(8, 8, 5);
  v256r.splat<u8>(4, 0xed);
  v256r.eq<u8>(5, 1, 4);
  v256r.splat<u8>(4, 0xa0);
  v256r.ge<u8>(6, 0, 4);
  v256r.and(5, 5, 6);
  v256r.or(8, 8, 5);
  v256r.splat<u8>(4, 0xf0);
  v256r.eq<u8>(5, 1, 4);
  v256r.splat<u8>(4, 0x90);
  v256r.lt<u8>(6, 0, 4);
  v256r.and(5, 5, 6);
  v256r.or(8, 8, 5);
  v256r.splat<u8>(4, 0xf4);
  v256r.eq<u8>(5, 1, 4);
  v256r.splat<u8>(4, 0x90);
  v256r.ge<u8>(6, 0, 4);
  v256r.and(5, 5, 6);
  v256r.or(8, 8, 5);
  v256r.store(BAD, 8);
  return (
    (load<u64>(BAD) |
      load<u64>(BAD + 8) |
      load<u64>(BAD + 16) |
      load<u64>(BAD + 24)) !=
    0
  );
}


@noInline export function utf8_validate_block_512(ptr: usize): bool {
  v512r.load(0, ptr + 3);
  v512r.load(1, ptr + 2);
  v512r.load(2, ptr + 1);
  v512r.load(3, ptr);
  v512r.splat<u8>(4, 0xc2);
  v512r.ge<u8>(6, 1, 4);
  v512r.splat<u8>(4, 0xf4);
  v512r.le<u8>(5, 1, 4);
  v512r.and(6, 6, 5);
  v512r.splat<u8>(4, 0xe0);
  v512r.ge<u8>(5, 2, 4);
  v512r.splat<u8>(4, 0xf4);
  v512r.le<u8>(8, 2, 4);
  v512r.and(5, 5, 8);
  v512r.or(6, 6, 5);
  v512r.splat<u8>(4, 0xf0);
  v512r.ge<u8>(5, 3, 4);
  v512r.splat<u8>(4, 0xf4);
  v512r.le<u8>(8, 3, 4);
  v512r.and(5, 5, 8);
  v512r.or(6, 6, 5);
  v512r.splat<u8>(4, 0x80);
  v512r.ge<u8>(7, 0, 4);
  v512r.splat<u8>(4, 0xbf);
  v512r.le<u8>(5, 0, 4);
  v512r.and(7, 7, 5);
  v512r.xor(8, 6, 7);
  v512r.splat<u8>(4, 0xc0);
  v512r.ge<u8>(5, 0, 4);
  v512r.splat<u8>(4, 0xc2);
  v512r.lt<u8>(6, 0, 4);
  v512r.and(5, 5, 6);
  v512r.or(8, 8, 5);
  v512r.splat<u8>(4, 0xf5);
  v512r.ge<u8>(5, 0, 4);
  v512r.or(8, 8, 5);
  v512r.splat<u8>(4, 0xe0);
  v512r.eq<u8>(5, 1, 4);
  v512r.splat<u8>(4, 0xa0);
  v512r.lt<u8>(6, 0, 4);
  v512r.and(5, 5, 6);
  v512r.or(8, 8, 5);
  v512r.splat<u8>(4, 0xed);
  v512r.eq<u8>(5, 1, 4);
  v512r.splat<u8>(4, 0xa0);
  v512r.ge<u8>(6, 0, 4);
  v512r.and(5, 5, 6);
  v512r.or(8, 8, 5);
  v512r.splat<u8>(4, 0xf0);
  v512r.eq<u8>(5, 1, 4);
  v512r.splat<u8>(4, 0x90);
  v512r.lt<u8>(6, 0, 4);
  v512r.and(5, 5, 6);
  v512r.or(8, 8, 5);
  v512r.splat<u8>(4, 0xf4);
  v512r.eq<u8>(5, 1, 4);
  v512r.splat<u8>(4, 0x90);
  v512r.ge<u8>(6, 0, 4);
  v512r.and(5, 5, 6);
  v512r.or(8, 8, 5);
  v512r.store(BAD, 8);
  return (
    (load<u64>(BAD) |
      load<u64>(BAD + 8) |
      load<u64>(BAD + 16) |
      load<u64>(BAD + 24) |
      load<u64>(BAD + 32) |
      load<u64>(BAD + 40) |
      load<u64>(BAD + 48) |
      load<u64>(BAD + 56)) !=
    0
  );
}
