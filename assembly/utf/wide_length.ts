/** Length counters using fused native Wide classification blocks. */
import {
  utf16_length_utf8_block_256, utf16_length_utf8_block_512,
  utf8_length_utf16_block_256, utf8_length_utf16_block_512,
} from "as-simd/assembly/wide/utf_length";
import { validateUtf16Wide256, validateUtf16Wide512 } from "./wide_validate_utf16";

/** UTF-16 units needed for well-formed UTF-8 input. */
export function utf16LengthWide256(src: usize, len: i32): i32 {
  if (len <= 0) return 0;
  let pos = 0, total = 0;
  while (pos + 32 <= len) { total += utf16_length_utf8_block_256(src + <usize>pos); pos += 32; }
  while (pos < len) {
    const b = load<u8>(src + <usize>pos);
    total += 1 - i32((b & 0xc0) == 0x80) + i32((b & 0xf8) == 0xf0);
    pos++;
  }
  return total;
}

/** UTF-16 units needed for well-formed UTF-8 input. */
export function utf16LengthWide512(src: usize, len: i32): i32 {
  if (len <= 0) return 0;
  let pos = 0, total = 0;
  while (pos + 64 <= len) { total += utf16_length_utf8_block_512(src + <usize>pos); pos += 64; }
  while (pos < len) {
    const b = load<u8>(src + <usize>pos);
    total += 1 - i32((b & 0xc0) == 0x80) + i32((b & 0xf8) == 0xf0);
    pos++;
  }
  return total;
}

/** UTF-8 bytes needed for UTF-16LE input; returns zero on malformed input. */
export function utf8LengthWide256(src: usize, units: i32): i32 {
  if (units <= 0) return 0;
  if (units > 0x3fffffff || !validateUtf16Wide256(src, units << 1)) return 0;
  let pos = 0, total = 0;
  while (pos + 16 <= units) { total += utf8_length_utf16_block_256(src + (<usize>pos << 1)); pos += 16; }
  while (pos < units) {
    const u = load<u16>(src + (<usize>pos << 1));
    total += 1 + i32(u >= 0x80) + i32(u >= 0x800) - 2 * i32(u >= 0xdc00 && u <= 0xdfff);
    pos++;
  }
  return total;
}

/** UTF-8 bytes needed for UTF-16LE input; returns zero on malformed input. */
export function utf8LengthWide512(src: usize, units: i32): i32 {
  if (units <= 0) return 0;
  if (units > 0x3fffffff || !validateUtf16Wide512(src, units << 1)) return 0;
  let pos = 0, total = 0;
  while (pos + 32 <= units) { total += utf8_length_utf16_block_512(src + (<usize>pos << 1)); pos += 32; }
  while (pos < units) {
    const u = load<u16>(src + (<usize>pos << 1));
    total += 1 + i32(u >= 0x80) + i32(u >= 0x800) - 2 * i32(u >= 0xdc00 && u <= 0xdfff);
    pos++;
  }
  return total;
}
