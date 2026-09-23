import { describe, expect, test } from "as-test";
import { UTF8, UTF16 } from "../utf";
import {
  validateWide256, validateWide512,
  validateUtf16Wide256, validateUtf16Wide512,
  utf16LengthWide256, utf16LengthWide512,
  utf8LengthWide256, utf8LengthWide512,
} from "../utf/wide";
import { utf16_length_from_utf8, utf8_length_from_utf16 } from "../utf/length";

let seed: u32 = 0x12345678;
function randomByte(): u8 { seed = seed * 1664525 + 1013904223; return <u8>(seed >> 24); }

// The input crosses every 32/64-byte boundary and includes malformed tails.
describe("Wide UTF-8 validation", () => {
  test("matches the existing validator on arbitrary byte strings", () => {
    let matching = true;
    for (let len = 0; len < 150; len++) {
      const input = new ArrayBuffer(len);
      const ptr = changetype<usize>(input);
      for (let trial = 0; trial < 30; trial++) {
        for (let i = 0; i < len; i++) store<u8>(ptr + <usize>i, randomByte());
        const expected = UTF8.validateUnsafe(ptr, len);
        matching = matching && validateWide256(ptr, len) == expected && validateWide512(ptr, len) == expected;
      }
    }
    expect(matching).toBe(true);
  });
});

describe("Wide UTF-16 validation", () => {
  test("matches the existing validator on arbitrary code units", () => {
    let matching = true;
    for (let units = 0; units < 100; units++) {
      const input = new ArrayBuffer(units * 2 + 1);
      const ptr = changetype<usize>(input);
      for (let trial = 0; trial < 20; trial++) {
        for (let i = 0; i < units * 2 + 1; i++) store<u8>(ptr + <usize>i, randomByte());
        const bytes = units * 2;
        const expected = UTF16.validateUnsafe(ptr, bytes);
        matching = matching && validateUtf16Wide256(ptr, bytes) == expected && validateUtf16Wide512(ptr, bytes) == expected;
        matching = matching && !validateUtf16Wide256(ptr, bytes + 1) && !validateUtf16Wide512(ptr, bytes + 1);
      }
    }
    expect(matching).toBe(true);
  });
});

describe("Wide UTF length counters", () => {
  test("match the existing counters for well formed strings", () => {
    let matching = true;
    const samples = ["a", "é", "中", "😀", "aé中😀"];
    for (let j = 0; j < samples.length; j++) {
      for (let n = 0; n < 130; n++) {
        let s = "";
        for (let i = 0; i < n; i++) s += samples[j];
        const encoded = String.UTF8.encode(s);
        const utf8ptr = changetype<usize>(encoded);
        const utf16ptr = changetype<usize>(s);
        matching = matching && utf16LengthWide256(utf8ptr, encoded.byteLength) == utf16_length_from_utf8(utf8ptr, encoded.byteLength);
        matching = matching && utf16LengthWide512(utf8ptr, encoded.byteLength) == utf16_length_from_utf8(utf8ptr, encoded.byteLength);
        matching = matching && utf8LengthWide256(utf16ptr, s.length) == utf8_length_from_utf16(utf16ptr, s.length);
        matching = matching && utf8LengthWide512(utf16ptr, s.length) == utf8_length_from_utf16(utf16ptr, s.length);
      }
    }
    expect(matching).toBe(true);
  });
});
