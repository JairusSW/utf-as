import { describe, expect, test } from "as-test";
import { utf16_length_from_utf8 } from "../utf/length";
import { UTF8 } from "../utf";

describe("UTF-8 length / dense and mixed streams", () => {
  test("agrees with UTF-16 strings across word boundaries", () => {
    const points: i32[] = [0x61, 0x7F, 0x80, 0x7FF, 0x800, 0x4E2D, 0xFFFF, 0x10000, 0x1F600, 0x10FFFF];
    let seed: u32 = 0x9E3779B9;
    let s = "";
    for (let n = 0; n < 160; n++) {
      const encoded = String.UTF8.encode(s);
      expect(utf16_length_from_utf8(changetype<usize>(encoded), encoded.byteLength)).toBe(s.length);
      seed = seed * 1664525 + 1013904223;
      s += String.fromCodePoint(points[<i32>(seed % <u32>points.length)]);
    }
  });
});

describe("UTF-8 byte length / word boundaries", () => {
  test("counts mixed widths and WTF-8 lone surrogates", () => {
    const mixed = "aaaaé中😀bbbb";
    expect(UTF8.byteLengthUnsafe(changetype<usize>(mixed), mixed.length)).toBe(17);
    const lone = "aaaa" + String.fromCharCode(0xD800) + "bbbb";
    expect(UTF8.byteLengthUnsafe(changetype<usize>(lone), lone.length)).toBe(11);
  });
  test("retains null-terminated length semantics", () => {
    const s = "aaaa\0bbbb";
    expect(UTF8.byteLengthUnsafe(changetype<usize>(s), s.length, true)).toBe(5);
  });
});
