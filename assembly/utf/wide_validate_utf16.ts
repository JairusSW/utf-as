/** UTF-16LE validation over native 256- and 512-bit Wide blocks. */
import { utf16_validate_block_256, utf16_validate_block_512 } from "as-simd/assembly/wide/utf16";

const SCRATCH: usize = memory.data(66);

export function validateUtf16Wide256(buf: usize, len: i32): bool {
  if (len < 0 || (len & 1) != 0) return false;
  memory.fill(SCRATCH, 0, 66);
  const first = len < 32 ? len : 32;
  memory.copy(SCRATCH + 2, buf, <usize>first);
  if (utf16_validate_block_256(SCRATCH)) return false;
  if (len < 32) return true;
  let pos = 32;
  while (pos + 32 <= len) {
    if (utf16_validate_block_256(buf + <usize>pos - 2)) return false;
    pos += 32;
  }
  memory.fill(SCRATCH, 0, 66);
  memory.copy(SCRATCH, buf + <usize>pos - 2, 2);
  memory.copy(SCRATCH + 2, buf + <usize>pos, <usize>(len - pos));
  return !utf16_validate_block_256(SCRATCH);
}

export function validateUtf16Wide512(buf: usize, len: i32): bool {
  if (len < 0 || (len & 1) != 0) return false;
  memory.fill(SCRATCH, 0, 66);
  const first = len < 64 ? len : 64;
  memory.copy(SCRATCH + 2, buf, <usize>first);
  if (utf16_validate_block_512(SCRATCH)) return false;
  if (len < 64) return true;
  let pos = 64;
  while (pos + 64 <= len) {
    if (utf16_validate_block_512(buf + <usize>pos - 2)) return false;
    pos += 64;
  }
  memory.fill(SCRATCH, 0, 66);
  memory.copy(SCRATCH, buf + <usize>pos - 2, 2);
  memory.copy(SCRATCH + 2, buf + <usize>pos, <usize>(len - pos));
  return !utf16_validate_block_512(SCRATCH);
}
