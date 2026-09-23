import { v256r, v512r } from "as-simd/assembly/wide/wide";

/** Scan inclusive runs of complete Wide blocks for a non-ASCII byte. */
export function ascii_scan_256(ptr: usize, last: usize): u32 {
  let found: u32 = 0;
  while (ptr <= last) {
    v256r.load(0, ptr);
    found |= <u32>v256r.bitmask<i8>(0);
    ptr += 32;
  }
  return found;
}

export function ascii_scan_512(ptr: usize, last: usize): u64 {
  let found: u64 = 0;
  while (ptr <= last) {
    v512r.load(0, ptr);
    found |= v512r.bitmask<i8>(0);
    ptr += 64;
  }
  return found;
}
