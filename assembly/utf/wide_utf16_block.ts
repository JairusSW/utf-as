import { v256r, v512r } from "as-simd/assembly/wide/wide";

const BAD: usize = memory.data(64);

/** Check one UTF-16LE block; ptr includes two readable preceding bytes. */
@noInline
export function utf16_validate_block_256(ptr: usize): bool {
  v256r.load(0, ptr + 2);
  v256r.load(1, ptr);
  v256r.splat<u16>(2, 0xfc00);
  v256r.and(3, 0, 2);
  v256r.and(4, 1, 2);
  v256r.splat<u16>(5, 0xdc00);
  v256r.eq<u16>(3, 3, 5);
  v256r.splat<u16>(5, 0xd800);
  v256r.eq<u16>(4, 4, 5);
  v256r.xor(3, 3, 4);
  v256r.store(BAD, 3);
  return (
    (load<u64>(BAD) |
      load<u64>(BAD + 8) |
      load<u64>(BAD + 16) |
      load<u64>(BAD + 24)) !=
    0
  );
}

/** Check one UTF-16LE block; ptr includes two readable preceding bytes. */
@noInline
export function utf16_validate_block_512(ptr: usize): bool {
  v512r.load(0, ptr + 2);
  v512r.load(1, ptr);
  v512r.splat<u16>(2, 0xfc00);
  v512r.and(3, 0, 2);
  v512r.and(4, 1, 2);
  v512r.splat<u16>(5, 0xdc00);
  v512r.eq<u16>(3, 3, 5);
  v512r.splat<u16>(5, 0xd800);
  v512r.eq<u16>(4, 4, 5);
  v512r.xor(3, 3, 4);
  v512r.store(BAD, 3);
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
