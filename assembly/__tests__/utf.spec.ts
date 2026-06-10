import { describe, expect, test } from "as-test";
import { UTF8, UTF16 } from "../utf";
// The length pre-counters and SIMD kernels aren't part of the package's public
// API (it exports only the UTF8/UTF16 namespaces), so tests import them from
// their modules directly to exercise pointer-level contracts and error returns.
// Every describe that calls a SIMD kernel is gated on `ASC_FEATURE_SIMD` so it —
// and all the v128 code it reaches — dead-code-eliminates in the `--disable
// simd` test build. The length helpers keep a scalar path and run in both modes.
import { utf16_length_from_utf8, utf8_length_from_utf16 } from "../utf/length";
import { utf8_to_utf16le, utf16le_to_utf8 } from "../utf/utf8";

function validStr(s: string): bool {
  const buf = String.UTF8.encode(s);
  return UTF8.validateUnsafe(changetype<usize>(buf), buf.byteLength);
}

function validBytes(bytes: u8[]): bool {
  const buf = new ArrayBuffer(bytes.length);
  const ptr = changetype<usize>(buf);
  for (let i = 0; i < bytes.length; i++) store<u8>(ptr + <usize>i, bytes[i]);
  return UTF8.validateUnsafe(ptr, bytes.length);
}

// Decode `s` via the simdutf port and assert bytes match the stdlib-encoded
// UTF-16 representation of `s`.
function decodeMatches(s: string): bool {
  const encoded = String.UTF8.encode(s);
  const src = changetype<usize>(encoded);
  const len = encoded.byteLength;
  const dstBuf = new ArrayBuffer((s.length + 8) * 2);
  const dst = changetype<usize>(dstBuf);
  const units = utf8_to_utf16le(src, len, dst);
  if (units < 0) return false;
  if (units != s.length) return false;
  for (let i = 0; i < s.length; i++) {
    const ours: u32 = load<u16>(dst + <usize>(i << 1));
    const ref: u32 = s.charCodeAt(i);
    if (ours != ref) return false;
  }
  return true;
}

function decodeBytesFails(bytes: u8[]): bool {
  const src = new ArrayBuffer(bytes.length);
  const srcPtr = changetype<usize>(src);
  for (let i = 0; i < bytes.length; i++) store<u8>(srcPtr + <usize>i, bytes[i]);
  const dst = new ArrayBuffer(bytes.length * 4 + 32);
  const result = utf8_to_utf16le(srcPtr, bytes.length, changetype<usize>(dst));
  return result == -1;
}

// Encode `s` via the simdutf port and assert bytes match the stdlib-encoded
// UTF-8 representation.
function encodeMatches(s: string): bool {
  const src = changetype<usize>(s);
  const len = s.length;
  const refBuf = String.UTF8.encode(s);
  const refLen = refBuf.byteLength;
  const refPtr = changetype<usize>(refBuf);
  const dstBuf = new ArrayBuffer(refLen + 32);
  const dst = changetype<usize>(dstBuf);
  const written = utf16le_to_utf8(src, len, dst);
  if (written != refLen) return false;
  for (let i = 0; i < refLen; i++) {
    if (load<u8>(dst + <usize>i) != load<u8>(refPtr + <usize>i)) return false;
  }
  return true;
}

function encodeUtf16Units(units: u16[]): i32 {
  const src = new ArrayBuffer(units.length * 2);
  const srcPtr = changetype<usize>(src);
  for (let i = 0; i < units.length; i++) store<u16>(srcPtr + (<usize>i << 1), units[i]);
  const dst = new ArrayBuffer(units.length * 4 + 32);
  return utf16le_to_utf8(srcPtr, units.length, changetype<usize>(dst));
}

describe("UTF8.validate / valid inputs", () => {
  test("empty input", () => {
    expect(UTF8.validateUnsafe(0, 0)).toBe(true);
  });

  test("ascii short", () => {
    expect(validStr("Hello, World!")).toBe(true);
  });

  test("ascii crossing 64-byte block boundary (200 chars)", () => {
    let s = "";
    for (let i = 0; i < 200; i++) s += "a";
    expect(validStr(s)).toBe(true);
  });

  test("ascii at exactly 64 bytes", () => {
    let s = "";
    for (let i = 0; i < 64; i++) s += "x";
    expect(validStr(s)).toBe(true);
  });

  test("ascii at 63 bytes (full tail)", () => {
    let s = "";
    for (let i = 0; i < 63; i++) s += "x";
    expect(validStr(s)).toBe(true);
  });

  test("ascii at 65 bytes (block + 1 byte tail)", () => {
    let s = "";
    for (let i = 0; i < 65; i++) s += "x";
    expect(validStr(s)).toBe(true);
  });

  test("cyrillic 2-byte UTF-8", () => {
    expect(validStr("Здравствуй, мир!")).toBe(true);
  });

  test("cjk 3-byte UTF-8", () => {
    expect(validStr("你好世界")).toBe(true);
  });

  test("emoji surrogate-pair (4-byte UTF-8)", () => {
    expect(validStr("𝄞🎵🎶")).toBe(true);
  });

  test("mixed BMP+supplementary, multi-block", () => {
    let s = "";
    for (let i = 0; i < 20; i++) s += "你好🎶Здравствуй mixed!";
    expect(validStr(s)).toBe(true);
  });

  test("padded boundary lengths around 64", () => {
    // Append ASCII to a small CJK string and walk lengths to exercise tail
    // copy under every alignment. Collapse to one assertion to keep the
    // report compact.
    const base = "你好"; // 6 bytes
    let allValid = true;
    for (let pad = 0; pad < 70; pad++) {
      let s = base;
      for (let i = 0; i < pad; i++) s += "a";
      if (!validStr(s)) { allValid = false; break; }
    }
    expect(allValid).toBe(true);
  });
});

describe("UTF8.validate / invalid inputs", () => {
  test("rejects lone continuation byte", () => {
    expect(validBytes([0x80])).toBe(false);
  });

  test("rejects overlong 2-byte [C0 80]", () => {
    expect(validBytes([0xc0, 0x80])).toBe(false);
  });

  test("rejects overlong 3-byte [E0 80 80]", () => {
    expect(validBytes([0xe0, 0x80, 0x80])).toBe(false);
  });

  test("rejects overlong 4-byte [F0 80 80 80]", () => {
    expect(validBytes([0xf0, 0x80, 0x80, 0x80])).toBe(false);
  });

  test("rejects truncated 3-byte at EOF", () => {
    expect(validBytes([0xe2, 0x82])).toBe(false); // missing 3rd byte
  });

  test("rejects truncated 4-byte at EOF", () => {
    expect(validBytes([0xf0, 0x9f, 0x8e])).toBe(false); // missing 4th
  });

  test("rejects 5-byte lead", () => {
    expect(validBytes([0xf8, 0x80, 0x80, 0x80, 0x80])).toBe(false);
  });

  test("rejects UTF-8-encoded lone high surrogate [ED A0 80]", () => {
    expect(validBytes([0xed, 0xa0, 0x80])).toBe(false);
  });

  test("rejects UTF-8-encoded lone low surrogate [ED B0 80]", () => {
    expect(validBytes([0xed, 0xb0, 0x80])).toBe(false);
  });

  test("rejects out-of-range codepoint > U+10FFFF [F4 90 80 80]", () => {
    expect(validBytes([0xf4, 0x90, 0x80, 0x80])).toBe(false);
  });

  test("rejects continuation where lead is expected (multi-block)", () => {
    const bytes: u8[] = [];
    for (let i = 0; i < 70; i++) bytes.push(0x41); // ASCII
    bytes.push(0x80); // lone continuation in tail
    expect(validBytes(bytes)).toBe(false);
  });

  test("rejects truncation right at block boundary", () => {
    // 63 bytes of ASCII + 1 byte 3-byte lead = invalid (no continuations)
    const bytes: u8[] = [];
    for (let i = 0; i < 63; i++) bytes.push(0x41);
    bytes.push(0xe0); // lead with no continuations
    expect(validBytes(bytes)).toBe(false);
  });
});

// 128 bytes (two 64-byte blocks) of `filler` with one inline byte sequence
// spliced in at `pos`. Helper for chunk-boundary edge case tests below.
function blockAt(filler: u8, pos: i32, replacement: u8[]): u8[] {
  const bytes: u8[] = [];
  for (let i = 0; i < 128; i++) bytes.push(filler);
  for (let j = 0; j < replacement.length; j++) bytes[pos + j] = replacement[j];
  return bytes;
}

// Adversarial fixtures for the per-chunk subdivided validator path. Each 64-byte
// block is checked as 4 × 16-byte chunks; these exercise the dirty→clean
// transition logic at every chunk boundary (positions 15/16, 31/32, 47/48).
describe("UTF8.validate / chunk-boundary edge cases", () => {
  test("rejects 2-byte lead at end of chunk 0 (pos 15) with ASCII in chunk 1", () => {
    expect(validBytes(blockAt(0x41, 15, [0xC2]))).toBe(false);
  });

  test("rejects 3-byte lead at end of chunk 1 (pos 31) with ASCII in chunk 2", () => {
    expect(validBytes(blockAt(0x41, 31, [0xE2]))).toBe(false);
  });

  test("rejects 4-byte lead at end of chunk 2 (pos 47) with ASCII in chunk 3", () => {
    expect(validBytes(blockAt(0x41, 47, [0xF0]))).toBe(false);
  });

  test("rejects 3-byte lead at pos 30 with one continuation at pos 31, ASCII in chunk 2", () => {
    expect(validBytes(blockAt(0x41, 30, [0xE2, 0x82]))).toBe(false);
  });

  test("rejects 4-byte lead at pos 45 with 2 continuations, ASCII in chunk 3", () => {
    expect(validBytes(blockAt(0x41, 45, [0xF0, 0x9F, 0x8E]))).toBe(false);
  });

  test("accepts 2-byte sequence straddling chunk 0→1 (pos 15-16)", () => {
    // 0xC2 0xA0 = U+00A0 NO-BREAK SPACE
    expect(validBytes(blockAt(0x41, 15, [0xC2, 0xA0]))).toBe(true);
  });

  test("accepts 3-byte sequence straddling chunk 1→2 (pos 30-32)", () => {
    // 0xE4 0xB8 0x96 = U+4E16 世
    expect(validBytes(blockAt(0x41, 30, [0xE4, 0xB8, 0x96]))).toBe(true);
  });

  test("accepts 4-byte sequence straddling chunk 2→3 (pos 45-48)", () => {
    // 0xF0 0x9F 0x8E 0xB6 = U+1F3B6 🎶
    expect(validBytes(blockAt(0x41, 45, [0xF0, 0x9F, 0x8E, 0xB6]))).toBe(true);
  });

  test("accepts 2-byte sequence straddling block boundary (pos 63-64)", () => {
    expect(validBytes(blockAt(0x41, 63, [0xC2, 0xA0]))).toBe(true);
  });

  test("rejects 3-byte lead at last byte of block (pos 63) with ASCII chunk 0 of next block", () => {
    expect(validBytes(blockAt(0x41, 63, [0xE2]))).toBe(false);
  });

  test("accepts mostly-ASCII block with a single 2-byte run in chunk 3 only", () => {
    // chunks 0/1/2 pure ASCII, chunk 3 has a 2-byte char
    expect(validBytes(blockAt(0x41, 50, [0xC3, 0xA9]))).toBe(true); // é
  });

  test("rejects mostly-ASCII block with truncated 2-byte at end of chunk 3", () => {
    // chunks 0/1/2 pure ASCII, chunk 3 ends with lone lead at last position
    expect(validBytes(blockAt(0x41, 63, [0xC2]))).toBe(false);
  });
});

// SIMD kernel exercised directly — gated so it DCEs in the nosimd build.
if (ASC_FEATURE_SIMD) describe("utf8_to_utf16le / valid round-trips", () => {
  test("empty input", () => {
    expect(utf8_to_utf16le(0, 0, 0)).toBe(0);
  });

  test("ascii short", () => {
    expect(decodeMatches("Hello, World!")).toBe(true);
  });

  test("ascii 64 bytes (exact block)", () => {
    let s = "";
    for (let i = 0; i < 64; i++) s += "x";
    expect(decodeMatches(s)).toBe(true);
  });

  test("ascii 128 bytes (two blocks)", () => {
    let s = "";
    for (let i = 0; i < 128; i++) s += "y";
    expect(decodeMatches(s)).toBe(true);
  });

  test("cyrillic short", () => {
    expect(decodeMatches("Здравствуй, мир!")).toBe(true);
  });

  test("cjk short", () => {
    expect(decodeMatches("你好世界")).toBe(true);
  });

  test("emoji surrogate-pair short", () => {
    expect(decodeMatches("𝄞🎵🎶")).toBe(true);
  });

  test("mixed multi-block (≥ 80 bytes)", () => {
    let s = "";
    for (let i = 0; i < 10; i++) s += "你好🎶Здравствуй mixed!";
    expect(decodeMatches(s)).toBe(true);
  });

  test("mixed boundary: 2-byte run into ASCII then 3-byte text", () => {
    expect(decodeMatches("твуй! 你好")).toBe(true);
  });

  test("mixed boundary: 3-byte run into ASCII then emoji", () => {
    expect(decodeMatches("好世界! 🎵")).toBe(true);
  });

  test("mixed boundary: emoji followed by ASCII run", () => {
    expect(decodeMatches("🎶 Hello, ")).toBe(true);
  });

  test("boundary walk: padded CJK to lengths 0..130", () => {
    const base = "你好"; // 6 bytes
    let allOk = true;
    let firstFail: i32 = -1;
    for (let pad = 0; pad < 130; pad++) {
      let s = base;
      for (let i = 0; i < pad; i++) s += "a";
      if (!decodeMatches(s)) { allOk = false; firstFail = pad; break; }
    }
    expect(firstFail).toBe(-1);
    expect(allOk).toBe(true);
  });

  test("emoji-heavy ≥ 200 bytes", () => {
    let s = "";
    for (let i = 0; i < 50; i++) s += "🎵";
    expect(decodeMatches(s)).toBe(true);
  });

  test("large mixed (~2KB)", () => {
    let s = "";
    for (let i = 0; i < 50; i++) s += "你好🎶Здравствуй mixed Hello! ";
    expect(decodeMatches(s)).toBe(true);
  });
});

if (ASC_FEATURE_SIMD) describe("utf8_to_utf16le / rejects malformed", () => {
  test("rejects lone continuation", () => {
    const bytes: u8[] = [];
    for (let i = 0; i < 100; i++) bytes.push(0x41);
    bytes.push(0x80); // lone continuation in tail
    expect(decodeBytesFails(bytes)).toBe(true);
  });

  test("rejects overlong sequences in the SIMD path", () => {
    // 60 bytes of ASCII + overlong 2-byte
    const bytes: u8[] = [];
    for (let i = 0; i < 60; i++) bytes.push(0x41);
    bytes.push(0xC0); bytes.push(0x80);
    for (let i = 0; i < 50; i++) bytes.push(0x41);
    expect(decodeBytesFails(bytes)).toBe(true);
  });

  test("rejects UTF-8 lone surrogate ED A0 80 in SIMD window", () => {
    const bytes: u8[] = [];
    for (let i = 0; i < 80; i++) bytes.push(0x41);
    bytes.push(0xED); bytes.push(0xA0); bytes.push(0x80);
    for (let i = 0; i < 20; i++) bytes.push(0x41);
    expect(decodeBytesFails(bytes)).toBe(true);
  });

  test("rejects truncated at EOF (tail path)", () => {
    expect(decodeBytesFails([0xE2, 0x82])).toBe(true);
  });

  test("rejects mixed window ending with a truncated 4-byte lead", () => {
    expect(decodeBytesFails([
      0xE5, 0xA5, 0xBD,
      0xE4, 0xB8, 0x96,
      0xE7, 0x95, 0x8C,
      0x21, 0x20, 0xF0,
    ])).toBe(true);
  });
});

if (ASC_FEATURE_SIMD) describe("utf16le_to_utf8 / valid round-trips", () => {
  test("empty input", () => {
    expect(utf16le_to_utf8(0, 0, 0)).toBe(0);
  });

  test("ascii short", () => {
    expect(encodeMatches("Hello, World!")).toBe(true);
  });

  test("ascii 32 units (one SIMD iter)", () => {
    let s = "";
    for (let i = 0; i < 32; i++) s += "z";
    expect(encodeMatches(s)).toBe(true);
  });

  test("ascii 200 units (multi SIMD iter)", () => {
    let s = "";
    for (let i = 0; i < 200; i++) s += "w";
    expect(encodeMatches(s)).toBe(true);
  });

  test("cyrillic", () => {
    expect(encodeMatches("Здравствуй, мир!")).toBe(true);
  });

  test("cjk", () => {
    expect(encodeMatches("你好世界")).toBe(true);
  });

  test("emoji surrogate pairs", () => {
    expect(encodeMatches("𝄞🎵🎶")).toBe(true);
  });

  test("mixed multi-block", () => {
    let s = "";
    for (let i = 0; i < 15; i++) s += "你好🎶Здравствуй mixed!";
    expect(encodeMatches(s)).toBe(true);
  });

  test("boundary walk: padded CJK to lengths 0..130", () => {
    const base = "你好";
    let allOk = true;
    let firstFail: i32 = -1;
    for (let pad = 0; pad < 130; pad++) {
      let s = base;
      for (let i = 0; i < pad; i++) s += "a";
      if (!encodeMatches(s)) { allOk = false; firstFail = pad; break; }
    }
    expect(firstFail).toBe(-1);
    expect(allOk).toBe(true);
  });

  test("large mixed (~3KB)", () => {
    let s = "";
    for (let i = 0; i < 60; i++) s += "你好🎶Здравствуй mixed Hello! ";
    expect(encodeMatches(s)).toBe(true);
  });
});

// Exercise the encoder's ctz-driven ASCII-run scan: place a 2-byte char at
// every possible position 0..14 inside the leading 16-unit window so the
// `n != 0` branches (partial-pack-then-resume) are all hit.
if (ASC_FEATURE_SIMD) describe("utf16le_to_utf8 / ASCII-run positions", () => {
  test("encode matches at every ASCII-run length 1..30 before a 2-byte char", () => {
    let allOk = true;
    let firstFail: i32 = -1;
    for (let runLen = 0; runLen < 31; runLen++) {
      // Build "AAAA...AéXXXX..." with runLen leading ASCII, one é (2-byte),
      // then enough trailing ASCII to push past the SIMD loop's safety margin.
      let s = "";
      for (let j = 0; j < runLen; j++) s += "A";
      s += "é";
      for (let j = 0; j < 64; j++) s += "X";
      if (!encodeMatches(s)) { allOk = false; firstFail = runLen; break; }
    }
    expect(firstFail).toBe(-1);
    expect(allOk).toBe(true);
  });

  test("encode matches with 3-byte char interleaved at every position 0..30", () => {
    let allOk = true;
    let firstFail: i32 = -1;
    for (let runLen = 0; runLen < 31; runLen++) {
      let s = "";
      for (let j = 0; j < runLen; j++) s += "A";
      s += "你"; // 3-byte UTF-8
      for (let j = 0; j < 64; j++) s += "X";
      if (!encodeMatches(s)) { allOk = false; firstFail = runLen; break; }
    }
    expect(firstFail).toBe(-1);
    expect(allOk).toBe(true);
  });

  test("encode matches with surrogate pair (4-byte) at every position 0..30", () => {
    let allOk = true;
    let firstFail: i32 = -1;
    for (let runLen = 0; runLen < 31; runLen++) {
      let s = "";
      for (let j = 0; j < runLen; j++) s += "A";
      s += "🎶"; // surrogate pair
      for (let j = 0; j < 64; j++) s += "X";
      if (!encodeMatches(s)) { allOk = false; firstFail = runLen; break; }
    }
    expect(firstFail).toBe(-1);
    expect(allOk).toBe(true);
  });
});

if (ASC_FEATURE_SIMD) describe("utf16le_to_utf8 / rejects malformed", () => {
  test("rejects lone high surrogate", () => {
    expect(encodeUtf16Units([0x0041, 0xD800, 0x0042])).toBe(-1);
  });

  test("rejects lone low surrogate", () => {
    expect(encodeUtf16Units([0x0041, 0xDC00, 0x0042])).toBe(-1);
  });

  test("rejects high surrogate at EOF", () => {
    expect(encodeUtf16Units([0x0041, 0xD800])).toBe(-1);
  });

  test("rejects lone high surrogate within SIMD window", () => {
    const units: u16[] = [];
    for (let i = 0; i < 30; i++) units.push(0x4E2D); // CJK
    units.push(0xD800);
    for (let i = 0; i < 30; i++) units.push(0x4E2D);
    expect(encodeUtf16Units(units)).toBe(-1);
  });
});

function utf16LenOf(s: string): i32 {
  const buf = String.UTF8.encode(s);
  return utf16_length_from_utf8(changetype<usize>(buf), buf.byteLength);
}
function utf8LenOf(s: string): i32 {
  return utf8_length_from_utf16(changetype<usize>(s), s.length);
}


describe("length helpers / agree with conversion", () => {
  test("utf16_length_from_utf8 — empty", () => {
    expect(utf16_length_from_utf8(0, 0)).toBe(0);
  });

  test("utf16_length_from_utf8 — ascii", () => {
    expect(utf16LenOf("Hello, World!")).toBe(13);
  });

  test("utf16_length_from_utf8 — cyrillic", () => {
    const s = "Здравствуй, мир!";
    expect(utf16LenOf(s)).toBe(s.length);
  });

  test("utf16_length_from_utf8 — cjk", () => {
    const s = "你好世界";
    expect(utf16LenOf(s)).toBe(s.length);
  });

  test("utf16_length_from_utf8 — emoji (surrogate pairs)", () => {
    const s = "𝄞🎵🎶";
    expect(utf16LenOf(s)).toBe(s.length);
  });

  test("utf16_length_from_utf8 — boundary walk", () => {
    const base = "你好🎶";
    let allOk = true;
    let firstFail: i32 = -1;
    for (let pad = 0; pad < 130; pad++) {
      let s = base;
      for (let i = 0; i < pad; i++) s += "a";
      if (utf16LenOf(s) != s.length) { allOk = false; firstFail = pad; break; }
    }
    expect(firstFail).toBe(-1);
    expect(allOk).toBe(true);
  });

  test("utf8_length_from_utf16 — empty", () => {
    expect(utf8_length_from_utf16(0, 0)).toBe(0);
  });

  test("utf8_length_from_utf16 — ascii", () => {
    const s = "Hello, World!";
    expect(utf8LenOf(s)).toBe(String.UTF8.byteLength(s));
  });

  test("utf8_length_from_utf16 — cyrillic", () => {
    const s = "Здравствуй, мир!";
    expect(utf8LenOf(s)).toBe(String.UTF8.byteLength(s));
  });

  test("utf8_length_from_utf16 — cjk", () => {
    const s = "你好世界";
    expect(utf8LenOf(s)).toBe(String.UTF8.byteLength(s));
  });

  test("utf8_length_from_utf16 — emoji", () => {
    const s = "𝄞🎵🎶";
    expect(utf8LenOf(s)).toBe(String.UTF8.byteLength(s));
  });

  test("utf8_length_from_utf16 — boundary walk", () => {
    const base = "你好🎶";
    let allOk = true;
    let firstFail: i32 = -1;
    for (let pad = 0; pad < 130; pad++) {
      let s = base;
      for (let i = 0; i < pad; i++) s += "a";
      if (utf8LenOf(s) != String.UTF8.byteLength(s)) {
        allOk = false; firstFail = pad; break;
      }
    }
    expect(firstFail).toBe(-1);
    expect(allOk).toBe(true);
  });

  test("utf8_length_from_utf16 — large mixed", () => {
    let s = "";
    for (let i = 0; i < 50; i++) s += "你好🎶Здравствуй mixed Hello! ";
    expect(utf8LenOf(s)).toBe(String.UTF8.byteLength(s));
  });

  test("utf8_length_from_utf16 — rejects lone low surrogate", () => {
    const units: u16[] = [0x0041, 0xDC00];
    const src = new ArrayBuffer(units.length * 2);
    const ptr = changetype<usize>(src);
    for (let i = 0; i < units.length; i++) store<u16>(ptr + (<usize>i << 1), units[i]);
    expect(utf8_length_from_utf16(ptr, units.length)).toBe(0);
  });

  test("utf8_length_from_utf16 — rejects high surrogate at EOF", () => {
    const units: u16[] = [0x0041, 0xD800];
    const src = new ArrayBuffer(units.length * 2);
    const ptr = changetype<usize>(src);
    for (let i = 0; i < units.length; i++) store<u16>(ptr + (<usize>i << 1), units[i]);
    expect(utf8_length_from_utf16(ptr, units.length)).toBe(0);
  });
});

// Bytes-equal helper for ArrayBuffer comparison.
function abEq(a: ArrayBuffer, b: ArrayBuffer): bool {
  if (a.byteLength != b.byteLength) return false;
  const pa = changetype<usize>(a);
  const pb = changetype<usize>(b);
  for (let i = 0; i < a.byteLength; i++) {
    if (load<u8>(pa + <usize>i) != load<u8>(pb + <usize>i)) return false;
  }
  return true;
}

describe("UTF8 namespace / round-trips through ArrayBuffer + string", () => {
  test("byteLength matches stdlib", () => {
    const s = "你好🎶Здравствуй Hello!";
    expect(UTF8.byteLength(s)).toBe(String.UTF8.byteLength(s));
  });

  test("encode produces same bytes as stdlib", () => {
    const s = "你好🎶Здравствуй Hello!";
    expect(abEq(UTF8.encode(s), String.UTF8.encode(s))).toBe(true);
  });

  test("decode produces the original string after encode", () => {
    const s = "Hello, 世界! 🌍";
    expect(UTF8.decode(UTF8.encode(s))).toBe(s);
  });

  test("decode matches stdlib decode", () => {
    const s = "Здравствуй! 你好 🎵";
    const buf = String.UTF8.encode(s);
    expect(UTF8.decode(buf)).toBe(String.UTF8.decode(buf));
  });

  test("utf16Length matches the decoded string length", () => {
    const s = "你好🎶Здравствуй mixed!";
    const buf = String.UTF8.encode(s);
    expect(UTF8.utf16Length(buf)).toBe(s.length);
  });

  test("validate accepts valid UTF-8", () => {
    expect(UTF8.validate(String.UTF8.encode("你好🎶 valid"))).toBe(true);
  });

  test("validate rejects malformed UTF-8", () => {
    const bytes: u8[] = [0xC0, 0x80]; // overlong
    const buf = new ArrayBuffer(bytes.length);
    const ptr = changetype<usize>(buf);
    for (let i = 0; i < bytes.length; i++) store<u8>(ptr + <usize>i, bytes[i]);
    expect(UTF8.validate(buf)).toBe(false);
  });

  // Direct kernel call — gated so it DCEs in the nosimd build.
  if (ASC_FEATURE_SIMD) test("encode throws on lone surrogate", () => {
    const units: u16[] = [0x0041, 0xD800, 0x0042];
    const src = new ArrayBuffer(units.length * 2);
    const ptr = changetype<usize>(src);
    for (let i = 0; i < units.length; i++) store<u16>(ptr + (<usize>i << 1), units[i]);
    let threw = false;
    // AS doesn't support try/catch in all targets; check via the unsafe
    // contract instead: encodeUnsafe is `@unsafe` and asserts.
    // For decode-side throwing we rely on the type system.
    const len = utf16le_to_utf8(ptr, units.length, changetype<usize>(new ArrayBuffer(32)));
    if (len < 0) threw = true;
    expect(threw).toBe(true);
  });

  test("empty round-trip", () => {
    expect(UTF8.decode(UTF8.encode(""))).toBe("");
    expect(UTF8.byteLength("")).toBe(0);
    expect(UTF8.utf16Length(new ArrayBuffer(0))).toBe(0);
  });

  test("encode/decode round-trip — multi-block CJK + emoji", () => {
    let s = "";
    for (let i = 0; i < 30; i++) s += "你好🎶Здравствуй mixed Hello! ";
    expect(UTF8.decode(UTF8.encode(s))).toBe(s);
  });
});

describe("UTF8.encodeUnsafe / decodeUnsafe", () => {
  test("encodeUnsafe writes bytes matching stdlib encode", () => {
    const s = "你好🎶Здравствуй mixed!";
    const ref = String.UTF8.encode(s);
    const dst = new ArrayBuffer(ref.byteLength);
    const written = UTF8.encodeUnsafe(
      changetype<usize>(s), s.length, changetype<usize>(dst)
    );
    expect(<i32>written).toBe(ref.byteLength);
    expect(abEq(dst, ref)).toBe(true);
  });

  test("encodeUnsafe — ASCII written bytes count matches input length", () => {
    const s = "Hello, World!";
    const dst = new ArrayBuffer(64);
    const written = UTF8.encodeUnsafe(
      changetype<usize>(s), s.length, changetype<usize>(dst)
    );
    expect(<i32>written).toBe(s.length);
  });

  test("encodeUnsafe — empty input writes 0 bytes", () => {
    const dst = new ArrayBuffer(8);
    const written = UTF8.encodeUnsafe(0, 0, changetype<usize>(dst));
    expect(<i32>written).toBe(0);
  });

  test("decodeUnsafe matches stdlib decode", () => {
    const s = "Здравствуй! 你好 🎵🎶";
    const buf = String.UTF8.encode(s);
    const result = UTF8.decodeUnsafe(changetype<usize>(buf), <usize>buf.byteLength);
    expect(result).toBe(s);
  });

  test("decodeUnsafe — empty input returns empty string", () => {
    expect(UTF8.decodeUnsafe(0, 0)).toBe("");
  });

  test("decodeUnsafe length matches utf16Length precompute", () => {
    const s = "你好🎶abc";
    const buf = String.UTF8.encode(s);
    const computed = UTF8.utf16Length(buf);
    const decoded = UTF8.decodeUnsafe(changetype<usize>(buf), <usize>buf.byteLength);
    expect(decoded.length).toBe(computed);
  });

  test("encodeUnsafe → decodeUnsafe round-trip multi-block", () => {
    let s = "";
    for (let i = 0; i < 25; i++) s += "你好🎶Здравствуй mixed Hello! ";
    const tmp = new ArrayBuffer(s.length * 3);
    const tmpPtr = changetype<usize>(tmp);
    const written = UTF8.encodeUnsafe(changetype<usize>(s), s.length, tmpPtr);
    const decoded = UTF8.decodeUnsafe(tmpPtr, written);
    expect(decoded).toBe(s);
  });

  test("validateUnsafe accepts valid UTF-8", () => {
    const buf = String.UTF8.encode("你好🎶 valid");
    expect(UTF8.validateUnsafe(changetype<usize>(buf), buf.byteLength)).toBe(true);
  });

  test("validateUnsafe rejects malformed UTF-8", () => {
    const bytes: u8[] = [0xC0, 0x80];
    const buf = new ArrayBuffer(bytes.length);
    const ptr = changetype<usize>(buf);
    for (let i = 0; i < bytes.length; i++) store<u8>(ptr + <usize>i, bytes[i]);
    expect(UTF8.validateUnsafe(ptr, bytes.length)).toBe(false);
  });

  test("utf16LengthUnsafe matches stdlib decoded length", () => {
    const s = "你好🎶abc";
    const buf = String.UTF8.encode(s);
    expect(
      UTF8.utf16LengthUnsafe(changetype<usize>(buf), buf.byteLength)
    ).toBe(s.length);
  });

});

// Direct kernel exercises + SIMD-block-straddle length cases — gated so the
// describe DCEs in the nosimd build (the scalar length path's surrogate
// handling is covered by the "length helpers" describe, which runs in both modes).
if (ASC_FEATURE_SIMD) describe("kernel edge cases", () => {
  test("utf8_to_utf16le rejects negative length", () => {
    expect(utf8_to_utf16le(0, -1, 0)).toBe(-1);
  });

  test("utf16le_to_utf8 rejects negative length", () => {
    expect(utf16le_to_utf8(0, -1, 0)).toBe(-1);
  });

  test("convert hits the 0x924 (all-3-byte) fast path", () => {
    // Need ≥ 81 bytes of pure 3-byte CJK so the SIMD loop runs and each
    // 12-byte chunk's end-of-code-point mask is 0x924. 30 CJK chars = 90 bytes.
    let s = "";
    for (let i = 0; i < 30; i++) s += "你";
    expect(decodeMatches(s)).toBe(true);
  });

  test("utf8_length_from_utf16 — surrogate pair straddles SIMD block", () => {
    // 7 ASCII + emoji (surrogate pair at positions 7,8) + ASCII tail.
    // Forces `lanes_low != lanes_high` in the first 8-unit SIMD window.
    const s = "aaaaaaa🎵aaa";
    expect(
      utf8_length_from_utf16(changetype<usize>(s), s.length)
    ).toBe(String.UTF8.byteLength(s));
  });

  test("utf8_length_from_utf16 — pair sweeps all SIMD boundaries", () => {
    // Slide one surrogate pair through every offset of a ≥32-unit string so it
    // lands on each sub-vector boundary (8/16/24) and the 32-unit chunk edge.
    // Straddling offsets bail to scalar; aligned offsets stay in SIMD — both
    // must match the stdlib byte length. Exercises every wide-loop bail branch.
    let firstFail: i32 = -1;
    for (let p = 0; p < 41; p++) {
      let s = "";
      for (let i = 0; i < p; i++) s += "a";
      s += "🎵";
      for (let i = 0; i < 40; i++) s += "a";
      if (utf8LenOf(s) != String.UTF8.byteLength(s)) { firstFail = p; break; }
    }
    expect(firstFail).toBe(-1);
  });

  test("scalar tail decodes truncated 2-byte as failure", () => {
    expect(decodeBytesFails([0xC2])).toBe(true);
  });

  test("scalar tail decodes bad-continuation 2-byte as failure", () => {
    expect(decodeBytesFails([0xC2, 0x41])).toBe(true);
  });

  test("scalar tail decodes bad-continuation 3-byte as failure", () => {
    expect(decodeBytesFails([0xE2, 0x82, 0x41])).toBe(true);
  });

  test("scalar tail decodes truncated 4-byte as failure", () => {
    expect(decodeBytesFails([0xF0, 0x9F])).toBe(true);
  });

  test("scalar tail decodes bad-continuation 4-byte as failure", () => {
    expect(decodeBytesFails([0xF0, 0x41, 0x82, 0x82])).toBe(true);
  });

  test("scalar tail decodes overlong 4-byte as failure", () => {
    expect(decodeBytesFails([0xF0, 0x80, 0x80, 0x80])).toBe(true);
  });

  test("scalar tail decodes out-of-range 4-byte as failure", () => {
    expect(decodeBytesFails([0xF4, 0x90, 0x80, 0x80])).toBe(true);
  });

  test("scalar tail decodes 5-byte lead as failure", () => {
    expect(decodeBytesFails([0xF8, 0x80, 0x80, 0x80, 0x80])).toBe(true);
  });
});

// Strings containing a lone surrogate code unit — used to exercise the
// WTF8 / REPLACE / ERROR error-mode paths and `decode` permissive behavior.
function strWithLoneHighSurrogate(): string {
  return "A" + String.fromCharCode(0xD800) + "B";
}
function strWithLoneLowSurrogate(): string {
  return "A" + String.fromCharCode(0xDC00) + "B";
}
function bufFromBytes(bytes: u8[]): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.length);
  const ptr = changetype<usize>(buf);
  for (let i = 0; i < bytes.length; i++) store<u8>(ptr + <usize>i, bytes[i]);
  return buf;
}

describe("UTF8 stdlib parity / byteLength", () => {
  test("nullTerminated adds trailing byte", () => {
    const s = "Hello";
    expect(UTF8.byteLength(s, true)).toBe(String.UTF8.byteLength(s, true));
    expect(UTF8.byteLength(s, true)).toBe(s.length + 1);
  });

  test("nullTerminated empty string", () => {
    expect(UTF8.byteLength("", true)).toBe(String.UTF8.byteLength("", true));
    expect(UTF8.byteLength("", false)).toBe(0);
  });

  test("lone high surrogate counts as 3 bytes (WTF8)", () => {
    const s = strWithLoneHighSurrogate();
    // stdlib counts the lone surrogate as a 3-byte UTF-8 sequence.
    expect(UTF8.byteLength(s)).toBe(String.UTF8.byteLength(s));
    expect(UTF8.byteLength(s)).toBe(5); // 1 + 3 + 1
  });

  test("lone low surrogate counts as 3 bytes (WTF8)", () => {
    const s = strWithLoneLowSurrogate();
    expect(UTF8.byteLength(s)).toBe(String.UTF8.byteLength(s));
  });
});

describe("UTF8 stdlib parity / encode", () => {
  test("nullTerminated round-trip ends with 0 byte", () => {
    const s = "Здравствуй!";
    const ours = UTF8.encode(s, true);
    const ref = String.UTF8.encode(s, true);
    expect(abEq(ours, ref)).toBe(true);
    // Last byte is the null terminator.
    expect(<u32>load<u8>(changetype<usize>(ours) + <usize>(ours.byteLength - 1))).toBe(0);
  });

  test("WTF8 default encodes lone high surrogate as 3-byte UTF-8", () => {
    const s = strWithLoneHighSurrogate();
    const ours = UTF8.encode(s);
    const ref = String.UTF8.encode(s);
    expect(abEq(ours, ref)).toBe(true);
    // Bytes: 'A' (0x41), ED A0 80 (lone high surrogate in WTF8), 'B' (0x42).
    expect(ours.byteLength).toBe(5);
    const p = changetype<usize>(ours);
    expect(<u32>load<u8>(p)).toBe(0x41);
    expect(<u32>load<u8>(p, 1)).toBe(0xED);
    expect(<u32>load<u8>(p, 2)).toBe(0xA0);
    expect(<u32>load<u8>(p, 3)).toBe(0x80);
    expect(<u32>load<u8>(p, 4)).toBe(0x42);
  });

  test("REPLACE mode substitutes U+FFFD for lone surrogate", () => {
    const s = strWithLoneHighSurrogate();
    const ours = UTF8.encode(s, false, UTF8.ErrorMode.REPLACE);
    const ref = String.UTF8.encode(s, false, String.UTF8.ErrorMode.REPLACE);
    expect(abEq(ours, ref)).toBe(true);
    // Bytes: 'A' (0x41), EF BF BD (U+FFFD), 'B' (0x42).
    const p = changetype<usize>(ours);
    expect(<u32>load<u8>(p, 1)).toBe(0xEF);
    expect(<u32>load<u8>(p, 2)).toBe(0xBF);
    expect(<u32>load<u8>(p, 3)).toBe(0xBD);
  });

  test("ERROR mode on valid string matches stdlib (no throw)", () => {
    const s = "Hello, 世界!";
    const ours = UTF8.encode(s, false, UTF8.ErrorMode.ERROR);
    const ref = String.UTF8.encode(s, false, String.UTF8.ErrorMode.ERROR);
    expect(abEq(ours, ref)).toBe(true);
  });

  test("nullTerminated truncates at embedded NUL", () => {
    const s = "AB\0CD";
    const ours = UTF8.encode(s, true);
    const ref = String.UTF8.encode(s, true);
    expect(abEq(ours, ref)).toBe(true);
  });

  test("nullTerminated WTF8 with lone surrogate matches stdlib", () => {
    const s = "x" + strWithLoneHighSurrogate() + "y";
    const ours = UTF8.encode(s, true);
    const ref = String.UTF8.encode(s, true);
    expect(abEq(ours, ref)).toBe(true);
  });
});

describe("UTF8 stdlib parity / decode permissive", () => {
  test("decode of malformed UTF-8 does not throw (matches stdlib bytes)", () => {
    // Lone continuation byte + ASCII.
    const buf = bufFromBytes([0x41, 0x80, 0x42]);
    const ours = UTF8.decode(buf);
    const ref = String.UTF8.decode(buf);
    expect(ours).toBe(ref);
  });

  test("decode of overlong sequence matches stdlib (best-effort)", () => {
    const buf = bufFromBytes([0xC0, 0x80, 0x41]);
    const ours = UTF8.decode(buf);
    const ref = String.UTF8.decode(buf);
    expect(ours).toBe(ref);
  });

  test("decode of truncated 3-byte sequence matches stdlib", () => {
    const buf = bufFromBytes([0xE2, 0x82]);
    const ours = UTF8.decode(buf);
    const ref = String.UTF8.decode(buf);
    expect(ours).toBe(ref);
  });

  test("decode of UTF-8-encoded lone surrogate matches stdlib", () => {
    // Round-trip: encode a string with a lone surrogate (WTF8 path),
    // then decode the resulting bytes. Output should match stdlib.
    const s = strWithLoneHighSurrogate();
    const encoded = UTF8.encode(s);
    expect(UTF8.decode(encoded)).toBe(String.UTF8.decode(encoded));
  });

  test("nullTerminated decode stops at first null", () => {
    const buf = bufFromBytes([0x41, 0x42, 0x00, 0x43, 0x44]);
    const ours = UTF8.decode(buf, true);
    const ref = String.UTF8.decode(buf, true);
    expect(ours).toBe(ref);
  });

  test("valid UTF-8 decode equals stdlib (sanity)", () => {
    const s = "你好🎶 mixed";
    const buf = String.UTF8.encode(s);
    expect(UTF8.decode(buf)).toBe(String.UTF8.decode(buf));
  });

  test("decode 4-byte emoji via scalar fallback matches stdlib", () => {
    // Lone continuation byte forces SIMD reject → scalar fallback path. The
    // 4-byte emoji encoding (F0 9F 8E B6 = 🎶) exercises the supplementary-
    // plane surrogate-pair branch inside scalarDecode.
    const buf = bufFromBytes([0x80, 0xF0, 0x9F, 0x8E, 0xB6]);
    const ours = UTF8.decode(buf);
    const ref = String.UTF8.decode(buf);
    expect(ours).toBe(ref);
  });

  test("decode truncated 4-byte at 3rd byte matches stdlib", () => {
    // Lone continuation + truncated 4-byte (F0 9F 8E with missing 4th byte).
    const buf = bufFromBytes([0x80, 0xF0, 0x9F, 0x8E]);
    const ours = UTF8.decode(buf);
    const ref = String.UTF8.decode(buf);
    expect(ours).toBe(ref);
  });

  test("decode 4-byte sequence truncated to exactly 3 bytes matches stdlib", () => {
    // Overlong 2-byte (C0 80 — SIMD rejects) followed by a 4-byte lead with
    // only 2 continuations (F0 80 80). Exercises the EOF break inside the
    // 4-byte branch of scalarDecode.
    const buf = bufFromBytes([0xC0, 0x80, 0xF0, 0x80, 0x80]);
    const ours = UTF8.decode(buf);
    const ref = String.UTF8.decode(buf);
    expect(ours).toBe(ref);
  });

  test("decode overlong 4-byte (cp < 0x10000) matches stdlib", () => {
    // Overlong 2-byte (C0 80, SIMD rejects) + overlong 4-byte encoding of
    // U+0000 (F0 80 80 80). Exercises the cp<0x10000 branch of scalarDecode.
    const buf = bufFromBytes([0xC0, 0x80, 0xF0, 0x80, 0x80, 0x80]);
    const ours = UTF8.decode(buf);
    const ref = String.UTF8.decode(buf);
    expect(ours).toBe(ref);
  });
});

if (ASC_FEATURE_SIMD) describe("utf8_to_utf16le / SIMD-window safety gates", () => {
  // These tests place malformed bytes deep enough that they land inside the
  // SIMD inner loop, not the scalar tail, so the kernel's cheap pre-check
  // and continuation-position guard are exercised.

  test("rejects F5+ lead byte in SIMD window", () => {
    // ≥ 208 bytes so that the 4th 64-byte outer iter starts; place 0xF5 at
    // its first byte so the cheap F5+ saturating-sub check fires.
    const bytes: u8[] = [];
    for (let i = 0; i < 192; i++) bytes.push(0x41);
    bytes.push(0xF5); // always-invalid lead — caught by the gate
    for (let i = 0; i < 80; i++) bytes.push(0x41);
    expect(decodeBytesFails(bytes)).toBe(true);
  });

  test("rejects FF byte in SIMD window", () => {
    const bytes: u8[] = [];
    for (let i = 0; i < 192; i++) bytes.push(0x41);
    bytes.push(0xFF);
    for (let i = 0; i < 80; i++) bytes.push(0x41);
    expect(decodeBytesFails(bytes)).toBe(true);
  });

  test("rejects lone continuation at start of SIMD block", () => {
    // Force the 4th outer iter to start with a continuation byte so the
    // `continuationMask & 1` guard returns -1.
    const bytes: u8[] = [];
    for (let i = 0; i < 192; i++) bytes.push(0x41);
    bytes.push(0x80); // continuation in lead position
    for (let i = 0; i < 80; i++) bytes.push(0x41);
    expect(decodeBytesFails(bytes)).toBe(true);
  });
});

describe("UTF16 namespace / stdlib parity", () => {
  test("byteLength matches stdlib", () => {
    const s = "你好🎶 Hello!";
    expect(UTF16.byteLength(s)).toBe(String.UTF16.byteLength(s));
  });

  test("encode matches stdlib byte-for-byte", () => {
    const s = "Здравствуй! 你好 🎵";
    expect(abEq(UTF16.encode(s), String.UTF16.encode(s))).toBe(true);
  });

  test("decode produces the original string after encode", () => {
    const s = "Hello, 世界! 🌍";
    expect(UTF16.decode(UTF16.encode(s))).toBe(s);
  });

  test("decode matches stdlib decode", () => {
    const s = "Здравствуй! 你好 🎵";
    const buf = String.UTF16.encode(s);
    expect(UTF16.decode(buf)).toBe(String.UTF16.decode(buf));
  });

  test("encodeUnsafe writes bytes matching stdlib", () => {
    const s = "你好🎶 abc";
    const ref = String.UTF16.encode(s);
    const dst = new ArrayBuffer(ref.byteLength);
    const written = UTF16.encodeUnsafe(
      changetype<usize>(s), s.length, changetype<usize>(dst)
    );
    expect(<i32>written).toBe(ref.byteLength);
    expect(abEq(dst, ref)).toBe(true);
  });

  test("decodeUnsafe matches stdlib", () => {
    const s = "你好🎶 abc";
    const buf = String.UTF16.encode(s);
    const result = UTF16.decodeUnsafe(changetype<usize>(buf), <usize>buf.byteLength);
    expect(result).toBe(s);
  });

  test("empty round-trip", () => {
    expect(UTF16.decode(UTF16.encode(""))).toBe("");
    expect(UTF16.byteLength("")).toBe(0);
  });

  test("odd-length decode rounds down (matches stdlib)", () => {
    const buf = new ArrayBuffer(5);
    expect(UTF16.decode(buf)).toBe(String.UTF16.decode(buf));
  });
});

function u16Buf(units: u16[]): ArrayBuffer {
  const buf = new ArrayBuffer(units.length * 2);
  const ptr = changetype<usize>(buf);
  for (let i = 0; i < units.length; i++) store<u16>(ptr + (<usize>i << 1), units[i]);
  return buf;
}

describe("UTF16 namespace / validate", () => {
  test("accepts BMP text", () => {
    expect(UTF16.validate(String.UTF16.encode("Hello, 世界! Здравствуй"))).toBe(true);
  });

  test("accepts well-formed surrogate pairs", () => {
    expect(UTF16.validate(String.UTF16.encode("🎵🎶🌍 emoji 😀"))).toBe(true);
  });

  test("accepts empty buffer", () => {
    expect(UTF16.validate(new ArrayBuffer(0))).toBe(true);
  });

  test("rejects odd byte length", () => {
    expect(UTF16.validate(new ArrayBuffer(5))).toBe(false);
  });

  test("rejects lone high surrogate", () => {
    expect(UTF16.validate(u16Buf([0x0041, 0xD800, 0x0042]))).toBe(false);
  });

  test("rejects lone low surrogate", () => {
    expect(UTF16.validate(u16Buf([0x0041, 0xDC00, 0x0042]))).toBe(false);
  });

  test("rejects reversed surrogate pair (low before high)", () => {
    expect(UTF16.validate(u16Buf([0xDC00, 0xD800]))).toBe(false);
  });

  test("rejects high surrogate at EOF", () => {
    expect(UTF16.validate(u16Buf([0x0041, 0xD800]))).toBe(false);
  });

  test("validateUnsafe agrees with validate", () => {
    const buf = String.UTF16.encode("ok 🎵 text");
    expect(UTF16.validateUnsafe(changetype<usize>(buf), buf.byteLength)).toBe(true);
    expect(UTF16.validateUnsafe(0, 3)).toBe(false); // odd byte length, short-circuits
  });

  test("pair sweeps all SIMD boundaries; lone high fails at every offset", () => {
    // Slide a surrogate pair (and, separately, a lone high) through every
    // offset of a ≥8-unit string so they land on each 8-unit block boundary
    // and the scalar tail. Valid pairs accept; lone highs reject — exercising
    // the cross-block `pendingHigh` carry into otherwise-skippable blocks.
    let firstBad: i32 = -1;
    for (let p = 0; p < 41; p++) {
      let prefix = "";
      for (let i = 0; i < p; i++) prefix += "a";
      let tail = "";
      for (let i = 0; i < 40; i++) tail += "a";

      const ok = prefix + "🎵" + tail;
      if (!UTF16.validate(String.UTF16.encode(ok))) { firstBad = p; break; }

      const bad = prefix + String.fromCharCode(0xD800) + tail;
      if (UTF16.validate(String.UTF16.encode(bad))) { firstBad = 1000 + p; break; }
    }
    expect(firstBad).toBe(-1);
  });
});
