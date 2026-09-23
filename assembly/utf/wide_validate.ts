/** Wide UTF-8 validators. Each multibyte check covers a 256- or 512-bit block. */
import { utf8_validate_block_256, utf8_validate_block_512 } from "./wide_utf8_block";
import { ascii_scan_256, ascii_scan_512 } from "./wide_ascii";

const SCRATCH: usize = memory.data(67);



/** Validate UTF-8 over 256-bit blocks. */
export function validateWide256(buf: usize, len: i32): bool {
  if (len < 0) return false;
  if (len >= 32 && (len & 31) == 0 && ascii_scan_256(buf, buf + <usize>len - 32) == 0) return true;
  memory.fill(SCRATCH, 0, 67);
  const first = len < 32 ? len : 32;
  memory.copy(SCRATCH + 3, buf, <usize>first);
  if (utf8_validate_block_256(SCRATCH)) return false;
  if (len < 32) return true;
  let pos = 32;
  while (pos + 32 <= len) {
    if (utf8_validate_block_256(buf + <usize>pos - 3)) return false;
    pos += 32;
  }
  memory.fill(SCRATCH, 0, 67);
  memory.copy(SCRATCH, buf + <usize>pos - 3, 3);
  memory.copy(SCRATCH + 3, buf + <usize>pos, <usize>(len - pos));
  return !utf8_validate_block_256(SCRATCH);
}



/** Validate UTF-8 over 512-bit blocks. */
export function validateWide512(buf: usize, len: i32): bool {
  if (len < 0) return false;
  if (len >= 64 && (len & 63) == 0 && ascii_scan_512(buf, buf + <usize>len - 64) == 0) return true;
  memory.fill(SCRATCH, 0, 67);
  const first = len < 64 ? len : 64;
  memory.copy(SCRATCH + 3, buf, <usize>first);
  if (utf8_validate_block_512(SCRATCH)) return false;
  if (len < 64) return true;
  let pos = 64;
  while (pos + 64 <= len) {
    if (utf8_validate_block_512(buf + <usize>pos - 3)) return false;
    pos += 64;
  }
  memory.fill(SCRATCH, 0, 67);
  memory.copy(SCRATCH, buf + <usize>pos - 3, 3);
  memory.copy(SCRATCH + 3, buf + <usize>pos, <usize>(len - pos));
  return !utf8_validate_block_512(SCRATCH);
}
