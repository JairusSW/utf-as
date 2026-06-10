import { validateUtf16Simd } from "./validate";
import { validateUtf16Swar } from "./validate_swar";

/** Encoding helpers for UTF-16. */
export namespace UTF16 {
  /** Smallest input (bytes) routed to the SIMD validator when SIMD is compiled
   *  in. Below this the SWAR validator wins: it skips the SIMD path's
   *  `memory.fill` + `memory.copy` of a 16-byte scratch block for the <8-unit
   *  tail and checks 4 surrogate-free units per u64. Tuned against
   *  `utf16-validate-swar.bench.ts`: below one 8-unit block (16 bytes) the SIMD
   *  path pays a 16-byte scratch fill and SWAR wins ~2-2.5×; at one block or
   *  more the cheap bitmask kernel pulls ahead. */
  // @ts-ignore: decorator
  @inline const SIMD_THRESHOLD: i32 = 16;

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
   *  The default path is the SWAR validator (`validate_swar.ts`): a BMP fast
   *  path skips 4 surrogate-free units per u64, with a per-unit pairing check
   *  for surrogates. When SIMD is compiled in (`ASC_FEATURE_SIMD`), inputs above
   *  the threshold route to the per-8-unit bitmask kernel (`validateUtf16Simd`).
   *  Both agree byte-for-byte. With `--enable simd` off the SIMD branch folds
   *  away and the v128 kernel is dead-code-eliminated. */
  // @ts-ignore: decorator
  @unsafe export function validateUnsafe(buf: usize, len: i32): bool {
    if (ASC_FEATURE_SIMD && len >= SIMD_THRESHOLD) return validateUtf16Simd(buf, len);
    return validateUtf16Swar(buf, len);
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
