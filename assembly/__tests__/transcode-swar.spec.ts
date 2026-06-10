// Differential + fuzz tests for the SWAR UTF-8 encode/decode transcoders.
//
// Runs in two as-test modes (see the `modes` block in as-test.config.json):
//   • simd   — four-way oracle on valid input: SWAR kernel == SIMD kernel ==
//              public UTF8.{encode,decode} == stdlib String.UTF8.
//   • nosimd — built with `--disable simd`: SIMD kernels are dead-code-
//              eliminated; SWAR kernels + dispatcher must still match stdlib.
//
// Only valid input is used for the kernel↔kernel differential: decode is
// permissive (SWAR is strict and defers malformed input to scalarDecode, the
// SIMD kernel may decode it permissively), so the two paths are only contractually
// identical on well-formed UTF-8.

import { describe, expect, test } from "as-test";
import { UTF8 } from "../utf";
import { utf8_to_utf16le_swar, utf16le_to_utf8_swar } from "../utf/utf8_swar";
import { utf8_to_utf16le, utf16le_to_utf8 } from "../utf/utf8";

// Output scratch — large enough for any test string below.
const A: usize = memory.data(8192);
const B: usize = memory.data(8192);

function bytesEq(p: usize, q: usize, n: i32): bool {
  for (let i = 0; i < n; i++) {
    if (load<u8>(p + <usize>i) != load<u8>(q + <usize>i)) return false;
  }
  return true;
}

// --- Decode: UTF-8 bytes → UTF-16. Differential against stdlib + SIMD. -------
function checkDecode(s: string): void {
  const enc = String.UTF8.encode(s);
  const src = changetype<usize>(enc);
  const n = enc.byteLength;

  const unitsSwar = utf8_to_utf16le_swar(src, n, A);
  expect(unitsSwar).toBe(s.length); // valid input → exact unit count
  for (let i = 0; i < s.length; i++) {
    expect(<i32>load<u16>(A + (<usize>i << 1))).toBe(<i32>s.charCodeAt(i));
  }

  if (ASC_FEATURE_SIMD) {
    const unitsSimd = utf8_to_utf16le(src, n, B);
    expect(unitsSimd).toBe(unitsSwar);
    expect(bytesEq(A, B, unitsSwar << 1)).toBe(true);
  }

  // Public dispatcher (size-routed) round-trips through the string type.
  expect(UTF8.decode(enc) == s).toBe(true);
}

// --- Encode: UTF-16 → UTF-8 bytes. Differential against stdlib + SIMD. -------
function checkEncode(s: string): void {
  const ref = String.UTF8.encode(s);
  const refPtr = changetype<usize>(ref);
  const refLen = ref.byteLength;

  const wSwar = utf16le_to_utf8_swar(changetype<usize>(s), s.length, A);
  expect(wSwar).toBe(refLen);
  expect(bytesEq(A, refPtr, refLen)).toBe(true);

  if (ASC_FEATURE_SIMD) {
    const wSimd = utf16le_to_utf8(changetype<usize>(s), s.length, B);
    expect(wSimd).toBe(refLen);
    expect(bytesEq(B, refPtr, refLen)).toBe(true);
  }

  // Public dispatcher.
  const out = UTF8.encode(s);
  expect(out.byteLength).toBe(refLen);
  expect(bytesEq(changetype<usize>(out), refPtr, refLen)).toBe(true);
}

function roundTrip(s: string): void {
  checkEncode(s);
  checkDecode(s);
}

// Representative seeds spanning every UTF-8 length class.
const ASCII = "The quick brown fox jumps over the lazy dog. 0123456789 ";
const LATIN = "café résumé naïve Zürich Köln Málaga ";   // 2-byte
const CJK = "你好世界こんにちは안녕하세요 ";                 // 3-byte
const EMOJI = "🌍🎵🎶😀🚀✨🎉 area";                          // 4-byte (surrogate pairs) + BMP
const MIXED = "Hi 你好 café 🌍 mix Здравствуй ✓ ";

describe("SWAR transcode / representative round-trips", () => {
  test("ascii", () => { roundTrip(ASCII); });
  test("latin (2-byte)", () => { roundTrip(LATIN); });
  test("cjk (3-byte)", () => { roundTrip(CJK); });
  test("emoji (4-byte / surrogate pairs)", () => { roundTrip(EMOJI); });
  test("mixed", () => { roundTrip(MIXED); });
  test("empty", () => { roundTrip(""); });
  test("single chars", () => {
    roundTrip("a"); roundTrip("é"); roundTrip("世"); roundTrip("🌍");
  });
});

// ASCII at every length 0..200: exercises the 8-unit fast path, its tail, and
// both dispatch thresholds (encode 32 units, decode 80 bytes).
describe("SWAR transcode / ascii size sweep", () => {
  test("lengths 0..200", () => {
    let s = "";
    for (let n = 0; n <= 200; n++) {
      roundTrip(s);
      s += String.fromCharCode(0x41 + (n % 26));
    }
  });
});

// Multibyte char placed at every offset within a long ASCII run — exercises the
// fast-path → scalar-fallback → fast-path transitions and word boundaries.
describe("SWAR transcode / multibyte at sweep of offsets", () => {
  test("é / 世 / 🌍 at each offset in a 40-char run", () => {
    const inserts: string[] = ["é", "世", "🌍"];
    for (let ii = 0; ii < inserts.length; ii++) {
      const ch = inserts[ii];
      for (let off = 0; off <= 24; off++) {
        let s = "";
        for (let k = 0; k < off; k++) s += "a";
        s += ch;
        for (let k = 0; k < 24 - off; k++) s += "b";
        roundTrip(s);
      }
    }
  });
});

// --- Fuzz: random valid code points -----------------------------------------
let seed: u64 = 0x243F6A8885A308D3;
function rnd(): u32 {
  seed = seed * 6364136223846793005 + 1442695040888963407;
  return <u32>(seed >> 33);
}

// A random scalar value (excluding surrogates), as 1 or 2 UTF-16 units appended
// to `parts` via fromCodePoint-style expansion done by the caller.
function randCp(): u32 {
  const r = rnd() % 100;
  if (r < 70) return 0x20 + (rnd() % 0x5F);          // ASCII
  if (r < 85) return 0x80 + (rnd() % (0x800 - 0x80)); // 2-byte
  if (r < 96) {                                       // 3-byte (skip surrogates)
    let cp = 0x800 + (rnd() % (0x10000 - 0x800));
    if (cp >= 0xD800 && cp <= 0xDFFF) cp = 0x4E16;
    return cp;
  }
  return 0x10000 + (rnd() % (0x110000 - 0x10000));    // 4-byte
}

describe("SWAR transcode / fuzz round-trips", () => {
  test("random valid strings", () => {
    for (let iter = 0; iter < 600; iter++) {
      const count = <i32>(rnd() % 120);
      let s = "";
      for (let k = 0; k < count; k++) s += String.fromCodePoint(<i32>randCp());
      roundTrip(s);
    }
  });
});
