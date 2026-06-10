// Head-to-head: stdlib `String.UTF8.{encode,decode}` vs our `UTF8.{encode,decode}`
// against simdutf's wikipedia_mars + emoji.txt payloads. Each file runs four
// benches (stdlib decode, ours decode, stdlib encode, ours encode); throughput
// is reported in UTF-8 bytes/sec so the four numbers are directly comparable.

import { bench, dumpToFile, blackbox } from "./lib/bench";
import { UTF8 } from "../utf";
import { utf8_to_utf16le_swar, utf16le_to_utf8_swar } from "../utf/utf8_swar";
import { loadPayload } from "./fixtures/simdutf_loader";

const OPS: u64 = 200;

// AS closures can't capture loop-locals; the bench routines read these
// module-level slots, which `runFile` rewrites before each `bench(...)` call.
let curBuf: ArrayBuffer = new ArrayBuffer(0);
let curStr: string = "";

// Raw operands + scratch destination for the SWAR transcoders, which write
// into a caller-supplied buffer rather than allocating a string.
let curSrc: usize = 0;
let curN: i32 = 0;
let curDst: usize = 0;

// Keep each file's scratch buffers alive so the incremental GC can't reclaim
// one mid-measurement.
const keep: ArrayBuffer[] = [];

function runFile(file: string): void {
  const p = loadPayload(file);
  curBuf = p.buf;
  curStr = UTF8.decode(p.buf); // baseline string for the encode benches
  const utf8Bytes = <u64>p.len;

  let desc = "stdlib-decode-" + file;
  bench(desc, () => { blackbox(String.UTF8.decode(curBuf)); }, OPS, utf8Bytes);
  dumpToFile(desc);

  desc = "ours-decode-" + file;
  bench(desc, () => { blackbox(UTF8.decode(curBuf)); }, OPS, utf8Bytes);
  dumpToFile(desc);

  // SWAR decode: UTF-8 bytes → UTF-16LE units into scratch (≤ 2 bytes/byte).
  curSrc = p.ptr;
  curN = p.len;
  let dst = new ArrayBuffer(p.len * 2 + 64); keep.push(dst);
  curDst = changetype<usize>(dst);
  desc = "swar-decode-" + file;
  bench(desc, () => { blackbox(utf8_to_utf16le_swar(curSrc, curN, curDst)); }, OPS, utf8Bytes);
  dumpToFile(desc);

  desc = "stdlib-encode-" + file;
  bench(desc, () => { blackbox(String.UTF8.encode(curStr)); }, OPS, utf8Bytes);
  dumpToFile(desc);

  desc = "ours-encode-" + file;
  bench(desc, () => { blackbox(UTF8.encode(curStr)); }, OPS, utf8Bytes);
  dumpToFile(desc);

  // SWAR encode: UTF-16LE units (the baseline string) → UTF-8 bytes into scratch.
  curSrc = changetype<usize>(curStr);
  curN = curStr.length;
  dst = new ArrayBuffer(p.len + 64); keep.push(dst);
  curDst = changetype<usize>(dst);
  desc = "swar-encode-" + file;
  bench(desc, () => { blackbox(utf16le_to_utf8_swar(curSrc, curN, curDst)); }, OPS, utf8Bytes);
  dumpToFile(desc);
}

runFile("arabic.html");
runFile("chinese.html");
runFile("english.html");
runFile("french.html");
runFile("german.html");
runFile("hebrew.html");
runFile("hindi.html");
runFile("japanese.html");
runFile("korean.html");
runFile("portuguese.html");
runFile("russian.html");
runFile("thai.html");
runFile("turkish.html");
runFile("vietnamese.html");
runFile("emoji.txt");
