// Benchmark corpora. Each function returns a pair (utf8 bytes, utf16 string)
// of approximately the requested byte length. Strings are AssemblyScript
// `string` values so they can be passed straight to `String.UTF8.encode`
// or used as a UTF-16 source via `changetype<usize>(s)`.
//
// We expose two textures:
//   ASCII   — Latin alphabet (single-byte UTF-8)
//   MIXED   — concatenation of Cyrillic (2-byte), CJK (3-byte), emoji
//             (4-byte / surrogate pair), and ASCII filler, to exercise
//             every UTF-8 length class

const ASCII_SEED = "The quick brown fox jumps over the lazy dog. ";
const MIXED_SEED = "Здравствуй! 你好世界! 🎵🎶 Hello, mixed text. ";

export function asciiCorpus(targetBytes: i32): string {
  let s = "";
  while (s.length < targetBytes) s += ASCII_SEED;
  return s.substr(0, targetBytes);
}

export function mixedCorpus(targetBytes: i32): string {
  // Build with the mixed seed. Each iteration adds ~70-80 UTF-8 bytes; loop
  // until we exceed the target, then return the full string (UTF-16 length
  // and UTF-8 byte length differ for mixed content — that's fine, the
  // benchmarks report UTF-8 input bytes).
  let s = "";
  while (String.UTF8.byteLength(s) < targetBytes) s += MIXED_SEED;
  return s;
}
