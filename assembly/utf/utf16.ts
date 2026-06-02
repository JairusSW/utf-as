import { surr_block, SCRATCH } from "./validate";

/** Encoding helpers for UTF-16. */
export namespace UTF16 {
  /** Calculates the byte length of the specified string when encoded as UTF-16. */
  export function byteLength(str: string): i32 {
    return <i32>(<usize>str.length << 1);
  }

  /** Whether the buffer is well-formed UTF-16LE: an even byte length with no
   *  lone surrogates. */
  export function validate(buf: ArrayBuffer): bool {
    return validateUnsafe(changetype<usize>(buf), buf.byteLength);
  }

  /** Whether `len` raw bytes at `buf` are well-formed UTF-16LE (an even byte
   *  length with no lone surrogates). Empty input is valid.
   *
   *  Per 8-unit (128-bit) block we build two bitmasks — `H` (high surrogates)
   *  and `L` (low surrogates), one bit per code unit. A high at unit i demands
   *  a low at i+1, so the required low positions are `H << 1`; the block is
   *  well-formed iff `L == ((H << 1) | carryIn)`, where `carryIn` is 1 when the
   *  previous block ended on a high surrogate. The top bit of `H` carries into
   *  the next block; a still-pending carry at end-of-input is an unpaired high.
   *  Surrogate-free blocks take a cheap fast path — see `surr_block`. */
  // @ts-ignore: decorator
  @unsafe export function validateUnsafe(buf: usize, len: i32): bool {
    if (len & 1) return false; // dangling half code unit
    const units = len >> 1;
    if (units <= 0) return units == 0;

    let pos: i32 = 0;
    let prevHigh: u32 = 0; // 1 if the previous block ended on a high surrogate
    let errors: u32 = 0;

    while (pos + 8 <= units) {
      const r = surr_block(v128.load(buf + (<usize>pos << 1)), prevHigh);
      errors |= r >> 1;
      prevHigh = r & 1;
      pos += 8;
    }

    if (pos < units) {
      // Tail: zero-pad the remaining <8 units into scratch. Zeros are
      // non-surrogates, so they create no spurious pairing — and a real high
      // surrogate as the last unit demands a low in the (zero) next slot,
      // correctly flagging an unpaired trailing high.
      const remaining = units - pos;
      memory.fill(SCRATCH, 0, 16);
      memory.copy(SCRATCH, buf + (<usize>pos << 1), <usize>remaining << 1);
      const r = surr_block(v128.load(SCRATCH), prevHigh);
      errors |= r >> 1;
      prevHigh = r & 1;
    }

    // A high surrogate at the final block's last unit has no successor.
    errors |= prevHigh;

    return errors == 0;
  }

  /** Encodes the specified string to UTF-16 bytes. */
  export function encode(str: string): ArrayBuffer {
    const size = <usize>str.length << 1;
    const buf = changetype<ArrayBuffer>(__new(size, idof<ArrayBuffer>()));
    memory.copy(changetype<usize>(buf), changetype<usize>(str), size);
    return buf;
  }

  /** Encodes the specified raw string to UTF-16 bytes. Returns the number of bytes written. */
  // @ts-ignore: decorator
  @unsafe export function encodeUnsafe(str: usize, len: i32, buf: usize): usize {
    const size = <usize>len << 1;
    memory.copy(buf, str, size);
    return size;
  }

  /** Decodes the specified buffer from UTF-16 bytes to a string. */
  export function decode(buf: ArrayBuffer): string {
    return decodeUnsafe(changetype<usize>(buf), <usize>buf.byteLength);
  }

  /** Decodes raw UTF-16 bytes to a string. */
  // @ts-ignore: decorator
  @unsafe export function decodeUnsafe(buf: usize, len: usize): string {
    const size = len & ~<usize>1;
    const str = changetype<string>(__new(size, idof<string>()));
    memory.copy(changetype<usize>(str), buf, size);
    return str;
  }
}
