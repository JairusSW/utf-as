// Port of simdutf's sse_utf8_utf16_decode.py and sse_convert_utf16_to_utf8.py.
// Emits assembly/utf/tables.ts with three lookup tables encoded as `memory.data`
// segments. Re-run after changing the encoding scheme; the file is otherwise
// stable.
//
// Tables:
//   - UTF8_BIG_INDEX: 4096 × u16 (low byte = shuf index, high byte = bytes consumed)
//   - SHUF_UTF8:      209  × 16 bytes (i8x16 shuffle patterns)
//   - PACK_123:       256  × 17 bytes (first byte = total UTF-8 output bytes, then 16-byte shuffle)
//
// Source: simdutf master, scripts/sse_utf8_utf16_decode.py + scripts/sse_convert_utf16_to_utf8.py

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outPath = path.join(root, "assembly", "utf", "tables.ts");

// ----- Code-point size analysis (mirror of Python `compute_code_point_size`).
// The "end-of-code-point" mask has bit i set iff byte i is the LAST byte of a
// code point. The byte distance from one 1-bit to the next is the size of the
// next code point.
function computeCodePointSizes(mask) {
  const sizes = [];
  let prev = -1;
  let i = 0;
  let m = mask;
  while (m > 0) {
    if ((m & 1) !== 0) {
      sizes.push(i - prev);
      prev = i;
    }
    m >>>= 1;
    i++;
  }
  return sizes;
}

const easy12 = (s) => s.length >= 6 && Math.max(...s.slice(0, 6)) <= 2;
const easy123 = (s) => s.length >= 4 && Math.max(...s.slice(0, 4)) <= 3;
const easy1234 = (s) => s.length >= 3 && Math.max(...s.slice(0, 3)) <= 4;

function shuf12(sizes) {
  // 6 code units → 12 UTF-16 bytes. For each code point, set the byte positions
  // in the output. 1-byte code points emit (b, 0xff); 2-byte code points emit
  // (b1, b0) reversed.
  const out = new Array(16).fill(0);
  let pos = 0;
  for (let i = 0; i < sizes.length; i++) {
    if (sizes[i] === 1) {
      out[2 * i] = pos;
      out[2 * i + 1] = 0xff;
      pos += 1;
    } else {
      out[2 * i] = pos + 1;
      out[2 * i + 1] = pos;
      pos += 2;
    }
  }
  return out;
}

function shuf123(sizes) {
  // 4 code units → 16 bytes (4 lanes × 4 bytes). Pad unused with 0xff.
  const out = new Array(16).fill(0);
  let pos = 0;
  for (let i = 0; i < sizes.length; i++) {
    if (sizes[i] === 1) {
      out[4 * i] = pos;
      out[4 * i + 1] = 0xff;
      out[4 * i + 2] = 0xff;
      out[4 * i + 3] = 0xff;
      pos += 1;
    } else if (sizes[i] === 2) {
      out[4 * i] = pos + 1;
      out[4 * i + 1] = pos;
      out[4 * i + 2] = 0xff;
      out[4 * i + 3] = 0xff;
      pos += 2;
    } else {
      out[4 * i] = pos + 2;
      out[4 * i + 1] = pos + 1;
      out[4 * i + 2] = pos;
      out[4 * i + 3] = 0xff;
      pos += 3;
    }
  }
  return out;
}

function shuf1234(sizes) {
  const out = new Array(16).fill(0);
  let pos = 0;
  for (let i = 0; i < sizes.length; i++) {
    if (sizes[i] === 1) {
      out[4 * i] = pos;
      out[4 * i + 1] = 0xff;
      out[4 * i + 2] = 0xff;
      out[4 * i + 3] = 0xff;
      pos += 1;
    } else if (sizes[i] === 2) {
      out[4 * i] = pos + 1;
      out[4 * i + 1] = pos;
      out[4 * i + 2] = 0xff;
      out[4 * i + 3] = 0xff;
      pos += 2;
    } else if (sizes[i] === 3) {
      out[4 * i] = pos + 2;
      out[4 * i + 1] = pos + 1;
      out[4 * i + 2] = pos;
      out[4 * i + 3] = 0xff;
      pos += 3;
    } else {
      out[4 * i] = pos + 3;
      out[4 * i + 1] = pos + 2;
      out[4 * i + 2] = pos + 1;
      out[4 * i + 3] = pos;
      pos += 4;
    }
  }
  return out;
}

function buildUtf8DecodeTables() {
  const set12 = new Set();
  const set123 = new Set();
  const set1234 = new Set();
  for (let x = 0; x < 1 << 12; x++) {
    const s = computeCodePointSizes(x);
    if (easy12(s)) set12.add(s.slice(0, 6).join(","));
    else if (easy123(s)) set123.add(s.slice(0, 4).join(","));
    else if (easy1234(s)) set1234.add(s.slice(0, 3).join(","));
  }
  const sorted12 = [...set12].sort();
  const sorted123 = [...set123].sort();
  const sorted1234 = [...set1234].sort();

  const allShuf = [
    ...sorted12.map((k) => shuf12(k.split(",").map(Number))),
    ...sorted123.map((k) => shuf123(k.split(",").map(Number))),
    ...sorted1234.map((k) => shuf1234(k.split(",").map(Number))),
  ];
  // Used as an invalid/bogus index; simdutf rejects such inputs at the validate step.
  const INVALID_IDX = allShuf.length;

  const index = new Map();
  let c = 0;
  for (const k of [...sorted12, ...sorted123, ...sorted1234]) {
    index.set(k, c++);
  }

  const utf8big = new Array(1 << 12);
  for (let x = 0; x < 1 << 12; x++) {
    const s = computeCodePointSizes(x);
    let entry;
    if (easy12(s)) {
      const z = s.slice(0, 6);
      entry = [index.get(z.join(",")), z.reduce((a, b) => a + b, 0)];
    } else if (easy123(s)) {
      const z = s.slice(0, 4);
      entry = [index.get(z.join(",")), z.reduce((a, b) => a + b, 0)];
    } else if (easy1234(s)) {
      const z = s.slice(0, 3);
      entry = [index.get(z.join(",")), z.reduce((a, b) => a + b, 0)];
    } else {
      entry = [INVALID_IDX, 12];
    }
    utf8big[x] = entry;
  }

  return { utf8big, shuf: allShuf, invalidIdx: INVALID_IDX };
}

// ----- pack_1_2_3_utf8_bytes ([256][17])
// 8 UTF-16 code units → up to 24 UTF-8 bytes via a 16-byte shuffle of a
// pre-bit-merged 32-bit-per-lane vector. Each entry is (totalBytes, ...shuffle16).
function buildPack123() {
  const table = [];
  for (let mask0 = 0; mask0 < 256; mask0++) {
    let mask = mask0;
    const shuffle = [];
    for (let i = 0; i < 4; i++) {
      const subword = mask & 0b11;
      mask >>>= 2;
      // 00 → 3 bytes; 01 → invalid (never produced by C++); 10 → 2 bytes; 11 → 1 byte.
      if (subword === 0) {
        shuffle.push(i * 4 + 2, i * 4 + 3, i * 4 + 1);
      } else if (subword === 3) {
        shuffle.push(i * 4 + 0);
      } else if (subword === 2) {
        shuffle.push(i * 4 + 3, i * 4 + 1);
      }
    }
    const total = shuffle.length;
    while (shuffle.length < 16) shuffle.push(0x80);
    table.push([total, ...shuffle]);
  }
  return table;
}

function hex(n, w = 2) {
  return "0x" + n.toString(16).padStart(w, "0");
}

function emitU8Array(rows) {
  // Flatten and break into 16-per-line for readability.
  const flat = rows.flat();
  const lines = [];
  for (let i = 0; i < flat.length; i += 16) {
    lines.push("  " + flat.slice(i, i + 16).map((v) => hex(v)).join(", ") + ",");
  }
  return lines.join("\n");
}

function emitU16Array(rows) {
  // utf8bigindex packed as u16 = (consumed << 8) | shufIdx.
  const flat = rows.map(([idx, consumed]) => ((consumed & 0xff) << 8) | (idx & 0xff));
  const lines = [];
  for (let i = 0; i < flat.length; i += 16) {
    lines.push("  " + flat.slice(i, i + 16).map((v) => hex(v, 4)).join(", ") + ",");
  }
  return lines.join("\n");
}

function emitPack123Padded(rows) {
  // Pad each 17-byte row to 32 bytes so v128.load can read the shuffle aligned
  // at offset +1 cleanly. The header byte (total) lives at offset 0.
  const lines = [];
  for (const r of rows) {
    const padded = r.concat(new Array(32 - r.length).fill(0));
    lines.push("  " + padded.map((v) => hex(v)).join(", ") + ",");
  }
  return lines.join("\n");
}

const decode = buildUtf8DecodeTables();
const pack = buildPack123();

const header = `// AUTO-GENERATED by scripts/gen-utf-tables.mjs. DO NOT EDIT.
// Ported from simdutf's sse_utf8_utf16_decode.py + sse_convert_utf16_to_utf8.py.
//
// All three tables live in a single immutable data segment per export; the
// returned pointer is valid for the module lifetime.

`;

const utf8BigSrc = `
// Lookup keyed by the 12-bit "end-of-code-point" mask. Each u16 packs:
//   low byte  = index into SHUF_UTF8
//   high byte = number of input bytes consumed
// Special index ${decode.invalidIdx} marks "input cannot be processed by the SIMD chunk"
// (caller falls back to scalar; validation has already rejected truly malformed input).
export const UTF8_BIG_INDEX_INVALID: u8 = ${decode.invalidIdx};
export const UTF8_BIG_INDEX_PTR: usize = memory.data<u16>([
${emitU16Array(decode.utf8big)}
]);
`;

const shufSrc = `
// 16-byte shuffle patterns, indexed by the low byte of UTF8_BIG_INDEX.
// Lane value 0xff means "lane is don't-care / zero this output byte".
// Each row is 16 bytes; load with \`v128.load(SHUF_UTF8_PTR + (idx << 4))\`.
export const SHUF_UTF8_PTR: usize = memory.data<u8>([
${emitU8Array(decode.shuf)}
]);
`;

const packSrc = `
// pack_1_2_3_utf8_bytes, padded from [256][17] to [256][32] for v128.load
// access. Row layout:
//   byte  0     = total UTF-8 bytes produced (0..24)
//   bytes 1..16 = i8x16 shuffle pattern (0x80 = lane-zero)
//   bytes 17..31 = zero padding (unused by kernel)
// Stride 32 bytes per row; load with \`v128.load(PACK_123_PTR + (mask << 5) + 1)\`.
export const PACK_123_PTR: usize = memory.data<u8>([
${emitPack123Padded(pack)}
]);
`;

fs.writeFileSync(outPath, header + utf8BigSrc + shufSrc + packSrc);
console.log("wrote", path.relative(root, outPath));
console.log("  UTF8_BIG_INDEX entries:", decode.utf8big.length, "→", decode.utf8big.length * 2, "bytes");
console.log("  SHUF_UTF8 entries:     ", decode.shuf.length, "→", decode.shuf.length * 16, "bytes");
console.log("  PACK_123 entries:      ", pack.length, "→", pack.length * 32, "bytes (padded from 17)");
