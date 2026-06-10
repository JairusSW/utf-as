// Differential + boundary + fuzz tests for the SWAR UTF-8 validator.
//
// Runs in two as-test modes (see the `modes` block in as-test.config.json):
//   • simd   — three-way oracle: validateSwar == validateUnsafe == validateSimd
//              == refValidate (the independent value-based reference below).
//   • nosimd — built with `--disable simd`: only the SWAR path + dispatcher
//              exist (validateSimd is dead-code-eliminated). Proves the library
//              compiles and validates correctly with no SIMD.
//
// This spec deliberately touches only the validators — no decode/encode — so it
// reaches zero v128 ops under the nosimd mode.

import { describe, expect, test } from "as-test";
import { UTF8, UTF16 } from "../utf";
import { validateSwar, validateUtf16Swar } from "../utf/validate_swar";
import { validateSimd, validateUtf16Simd } from "../utf/validate";

// Scratch input buffer (max test input < 4096 bytes).
const BUF: usize = memory.data(4096);

// --- Independent reference -------------------------------------------------
// Canonical value-based UTF-8 validator: decode each code point and reject by
// *value* (overlong via minimum, > U+10FFFF, surrogate range). Structurally
// distinct from decodeOne's byte-range form, so it's a genuine cross-check.
function refValidate(ptr: usize, len: i32): bool {
  let i = 0;
  while (i < len) {
    const b0 = <u32>load<u8>(ptr + <usize>i);
    if (b0 < 0x80) { i += 1; continue; }
    let extra: i32; let cp: u32; let min: u32;
    if ((b0 & 0xE0) == 0xC0) { extra = 1; cp = b0 & 0x1F; min = 0x80; }
    else if ((b0 & 0xF0) == 0xE0) { extra = 2; cp = b0 & 0x0F; min = 0x800; }
    else if ((b0 & 0xF8) == 0xF0) { extra = 3; cp = b0 & 0x07; min = 0x10000; }
    else return false; // continuation byte as lead, or 0xF8+ lead
    if (i + 1 + extra > len) return false; // truncated
    for (let k = 1; k <= extra; k++) {
      const c = <u32>load<u8>(ptr + <usize>i + k);
      if ((c & 0xC0) != 0x80) return false;
      cp = (cp << 6) | (c & 0x3F);
    }
    if (cp < min) return false;                       // overlong
    if (cp > 0x10FFFF) return false;                  // too large
    if (cp >= 0xD800 && cp <= 0xDFFF) return false;   // surrogate
    i += 1 + extra;
  }
  return true;
}

// --- Helpers ---------------------------------------------------------------
function put(bytes: u8[]): i32 {
  for (let i = 0; i < bytes.length; i++) store<u8>(BUF + <usize>i, bytes[i]);
  return bytes.length;
}

// Assert every path agrees with the reference; returns the reference verdict.
function agree(len: i32): bool {
  const r = refValidate(BUF, len);
  expect(validateSwar(BUF, len)).toBe(r);
  expect(UTF8.validateUnsafe(BUF, len)).toBe(r);
  if (ASC_FEATURE_SIMD) expect(validateSimd(BUF, len)).toBe(r);
  return r;
}

// Fill `len` bytes of `BUF` with ASCII 'a', then overlay `seq` at `off`.
function asciiWith(len: i32, off: i32, seq: u8[]): void {
  for (let i = 0; i < len; i++) store<u8>(BUF + <usize>i, 0x61);
  for (let i = 0; i < seq.length; i++) store<u8>(BUF + <usize>(off + i), seq[i]);
}

// Representative multibyte sequences.
const C2: u8[] = [0xC3, 0xA9];             // é   U+00E9
const C3: u8[] = [0xE4, 0xB8, 0x96];       // 世  U+4E16
const C4: u8[] = [0xF0, 0x9F, 0x8C, 0x8D]; // 🌍  U+1F30D

// --- Error-class table (each must be rejected) -----------------------------
describe("SWAR validate / error classes vs reference", () => {
  test("stray continuation", () => { expect(agree(put([0x80]))).toBe(false); });
  test("lone 0xC0 / 0xC1 (overlong-2)", () => {
    expect(agree(put([0xC0, 0x80]))).toBe(false);
    expect(agree(put([0xC1, 0xBF]))).toBe(false);
  });
  test("overlong-3 (E0 80)", () => { expect(agree(put([0xE0, 0x80, 0x80]))).toBe(false); });
  test("overlong-4 (F0 80)", () => { expect(agree(put([0xF0, 0x80, 0x80, 0x80]))).toBe(false); });
  test("surrogate high (ED A0 80)", () => { expect(agree(put([0xED, 0xA0, 0x80]))).toBe(false); });
  test("surrogate low (ED B0 80)", () => { expect(agree(put([0xED, 0xB0, 0x80]))).toBe(false); });
  test("too-large (F4 90 80 80)", () => { expect(agree(put([0xF4, 0x90, 0x80, 0x80]))).toBe(false); });
  test("F5 lead", () => { expect(agree(put([0xF5, 0x80, 0x80, 0x80]))).toBe(false); });
  test("5-byte lead (F8)", () => { expect(agree(put([0xF8, 0x80, 0x80, 0x80, 0x80]))).toBe(false); });
  test("missing continuation (C3 alone)", () => { expect(agree(put([0xC3]))).toBe(false); });
  test("bad continuation (C3 then ASCII)", () => { expect(agree(put([0xC3, 0x41]))).toBe(false); });
});

describe("SWAR validate / valid minimal cases", () => {
  test("empty", () => { expect(agree(0)).toBe(true); });
  test("2/3/4-byte boundaries", () => {
    expect(agree(put(C2))).toBe(true);
    expect(agree(put(C3))).toBe(true);
    expect(agree(put(C4))).toBe(true);
    expect(agree(put([0xC2, 0x80]))).toBe(true);          // U+0080 min 2-byte
    expect(agree(put([0xE0, 0xA0, 0x80]))).toBe(true);    // U+0800 min 3-byte
    expect(agree(put([0xED, 0x9F, 0xBF]))).toBe(true);    // U+D7FF just below surrogates
    expect(agree(put([0xEE, 0x80, 0x80]))).toBe(true);    // U+E000 just above
    expect(agree(put([0xF4, 0x8F, 0xBF, 0xBF]))).toBe(true); // U+10FFFF max
  });
});

// --- Size sweep across the dispatch threshold (64) -------------------------
describe("SWAR validate / size sweep × offset", () => {
  test("pure ASCII at every length", () => {
    const lens: i32[] = [0,1,2,3,4,5,6,7,8,9,63,64,65,127,128,129,255,256,257];
    for (let li = 0; li < lens.length; li++) {
      const L = lens[li];
      for (let i = 0; i < L; i++) store<u8>(BUF + <usize>i, 0x61);
      expect(agree(L)).toBe(true);
    }
  });

  test("one multibyte char at sweep of offsets", () => {
    const lens: i32[] = [8,9,16,32,63,64,65,128,129,256,257];
    const seqs: u8[][] = [C2, C3, C4];
    for (let li = 0; li < lens.length; li++) {
      const L = lens[li];
      for (let si = 0; si < seqs.length; si++) {
        const seq = seqs[si];
        const maxOff = L - seq.length;
        if (maxOff < 0) continue;
        // offsets: 0, every byte 0..18 (covers word + threshold edges), and tail.
        for (let off = 0; off <= maxOff; off++) {
          if (off > 18 && off < maxOff - 1) continue; // thin the middle
          asciiWith(L, off, seq);
          expect(agree(L)).toBe(true);
        }
      }
    }
  });
});

// --- Word / ctz boundary (SWAR-specific) -----------------------------------
describe("SWAR validate / word + ctz boundaries", () => {
  test("multibyte lead straddling 8-byte word edges", () => {
    const offs: i32[] = [5,6,7,8,9,13,14,15,16,17];
    const seqs: u8[][] = [C2, C3, C4];
    for (let oi = 0; oi < offs.length; oi++) {
      for (let si = 0; si < seqs.length; si++) {
        const seq = seqs[si];
        const L = 40;
        asciiWith(L, offs[oi], seq);
        expect(agree(L)).toBe(true);
      }
    }
  });
});

// --- Truncation (especially the <8-byte tail loop) -------------------------
describe("SWAR validate / truncation rejected", () => {
  test("drop trailing bytes of a multibyte sequence", () => {
    const seqs: u8[][] = [C2, C3, C4];
    // Place the sequence so that it runs off the end at various total lengths,
    // including lengths whose tail (len % 8) lands the truncation in the
    // byte-wise tail loop (e.g. 5,6,7).
    const totals: i32[] = [1,2,3,5,6,7,8,9,15,16,17];
    for (let si = 0; si < seqs.length; si++) {
      const seq = seqs[si];
      for (let drop = 1; drop < seq.length; drop++) {
        for (let ti = 0; ti < totals.length; ti++) {
          const L = totals[ti];
          if (L < drop) continue;
          // ASCII fill then a truncated lead at the very end.
          const partial = seq.length - drop; // bytes of seq we keep
          if (partial < 1 || partial >= L + 1) continue;
          const off = L - partial;
          if (off < 0) continue;
          for (let i = 0; i < L; i++) store<u8>(BUF + <usize>i, 0x61);
          for (let k = 0; k < partial; k++) store<u8>(BUF + <usize>(off + k), seq[k]);
          // A truncated multibyte at end-of-input is always invalid.
          expect(agree(L)).toBe(false);
        }
      }
    }
  });
});

// --- Fuzz parity -----------------------------------------------------------
// 64-bit LCG (deterministic). Module scope — AS has no closures.
let seed: u64 = 0x9E3779B97F4A7C15;
function rnd(): u32 {
  seed = seed * 6364136223846793005 + 1442695040888963407;
  return <u32>(seed >> 33);
}

// --- UTF-16 ----------------------------------------------------------------
// Independent reference UTF-16LE validator (value-based, distinct from the
// stepUnit/wordHasSurrogate forms).
function refUtf16(ptr: usize, byteLen: i32): bool {
  if (byteLen & 1) return false;
  const units = byteLen >> 1;
  let i = 0;
  while (i < units) {
    const u = <u32>load<u16>(ptr + (<usize>i << 1));
    if (u >= 0xD800 && u <= 0xDBFF) {
      if (i + 1 >= units) return false;
      const v = <u32>load<u16>(ptr + (<usize>(i + 1) << 1));
      if (v < 0xDC00 || v > 0xDFFF) return false;
      i += 2;
    } else if (u >= 0xDC00 && u <= 0xDFFF) {
      return false;
    } else {
      i += 1;
    }
  }
  return true;
}

function putU16(units: u16[]): i32 {
  for (let i = 0; i < units.length; i++) store<u16>(BUF + (<usize>i << 1), units[i]);
  return units.length << 1; // byte length
}

function agree16(byteLen: i32): bool {
  const r = refUtf16(BUF, byteLen);
  expect(validateUtf16Swar(BUF, byteLen)).toBe(r);
  expect(UTF16.validateUnsafe(BUF, byteLen)).toBe(r);
  if (ASC_FEATURE_SIMD) expect(validateUtf16Simd(BUF, byteLen)).toBe(r);
  return r;
}

describe("SWAR UTF-16 validate / vs reference", () => {
  test("valid: empty / BMP / surrogate pairs", () => {
    expect(agree16(putU16([]))).toBe(true);
    expect(agree16(putU16([0x0041, 0x0042, 0x0043]))).toBe(true);
    expect(agree16(putU16([0xD800, 0xDC00]))).toBe(true);            // 🌍-style pair
    expect(agree16(putU16([0x0041, 0xD83C, 0xDF0D, 0x0042]))).toBe(true);
    expect(agree16(putU16([0xD7FF, 0xE000]))).toBe(true);            // boundaries, not surrogates
  });
  test("invalid: lone / mispaired surrogates, odd length", () => {
    expect(agree16(putU16([0xD800]))).toBe(false);                  // lone high at end
    expect(agree16(putU16([0xDC00]))).toBe(false);                  // lone low
    expect(agree16(putU16([0xD800, 0x0041]))).toBe(false);          // high not followed by low
    expect(agree16(putU16([0xD800, 0xD800]))).toBe(false);          // high+high
    expect(agree16(putU16([0x0041, 0xDC00, 0x0042]))).toBe(false);  // lone low mid-string
    expect(UTF16.validateUnsafe(BUF, 3)).toBe(false);               // odd byte length
  });
});

describe("SWAR UTF-16 validate / sweeps", () => {
  test("BMP at every length 0..40", () => {
    for (let n = 0; n <= 40; n++) {
      for (let k = 0; k < n; k++) store<u16>(BUF + (<usize>k << 1), <u16>(0x41 + (k % 26)));
      expect(agree16(n << 1)).toBe(true);
    }
  });
  test("a surrogate pair at every offset (word boundaries)", () => {
    for (let off = 0; off <= 16; off++) {
      const total = off + 2 + 4; // pair + trailing BMP
      for (let k = 0; k < total; k++) store<u16>(BUF + (<usize>k << 1), 0x0061);
      store<u16>(BUF + (<usize>off << 1), 0xD83C);
      store<u16>(BUF + (<usize>(off + 1) << 1), 0xDF0D);
      expect(agree16(total << 1)).toBe(true);
    }
  });
  test("a lone high surrogate at every offset", () => {
    for (let off = 0; off <= 16; off++) {
      const total = off + 1 + 4;
      for (let k = 0; k < total; k++) store<u16>(BUF + (<usize>k << 1), 0x0061);
      store<u16>(BUF + (<usize>off << 1), 0xD800);
      expect(agree16(total << 1)).toBe(false);
    }
  });
});

describe("SWAR UTF-16 validate / fuzz parity", () => {
  test("random units", () => {
    let s: u64 = 0xC0FFEE123456789;
    for (let iter = 0; iter < 2000; iter++) {
      s = s * 6364136223846793005 + 1442695040888963407;
      const units = <i32>((s >> 40) % 300);
      let t = s;
      for (let k = 0; k < units; k++) {
        t = t * 6364136223846793005 + 1442695040888963407;
        // Bias toward surrogate range so pairing logic is exercised often.
        const pick = <u32>(t >> 40) % 5;
        const u: u32 = pick == 0
          ? 0xD800 + (<u32>(t >> 16) & 0x7FF)   // random surrogate
          : (<u32>(t >> 16) & 0xFFFF);          // random unit
        store<u16>(BUF + (<usize>k << 1), <u16>u);
      }
      agree16(units << 1);
    }
  });
});

describe("SWAR validate / fuzz parity", () => {
  test("random bytes (uniform)", () => {
    for (let iter = 0; iter < 1500; iter++) {
      const L = <i32>(rnd() % 600);
      for (let i = 0; i < L; i++) store<u8>(BUF + <usize>i, <u8>(rnd() & 0xFF));
      agree(L); // asserts all paths concur with the reference
    }
  });

  test("mostly-ASCII with noise (exercises decodeOne often)", () => {
    for (let iter = 0; iter < 1500; iter++) {
      const L = <i32>(rnd() % 600);
      for (let i = 0; i < L; i++) {
        const r = rnd();
        // ~80% ASCII, ~20% random high byte.
        store<u8>(BUF + <usize>i, (r % 5) == 0 ? <u8>(r & 0xFF) : <u8>(r % 0x80));
      }
      agree(L);
    }
  });

  test("valid multibyte stream + random truncation", () => {
    const seqs: u8[][] = [C2, C3, C4];
    for (let iter = 0; iter < 1500; iter++) {
      let pos = 0;
      const cap = <i32>(rnd() % 500) + 1;
      while (pos < cap) {
        const pick = rnd() % 6;
        if (pick < 3) { store<u8>(BUF + <usize>pos, <u8>(0x20 + (rnd() % 0x5F))); pos += 1; }
        else {
          const seq = seqs[<i32>(pick - 3)];
          if (pos + seq.length > cap + 4) break;
          for (let k = 0; k < seq.length; k++) store<u8>(BUF + <usize>(pos + k), seq[k]);
          pos += seq.length;
        }
      }
      // Randomly truncate to land partial sequences sometimes.
      const L = <i32>(rnd() % <u32>(pos + 1));
      agree(L);
    }
  });
});
