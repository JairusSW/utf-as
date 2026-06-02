// Head-to-head: stdlib `String.UTF8.{encode,decode}` vs our `UTF8.{encode,decode}`
// against simdutf's wikipedia_mars + emoji.txt payloads. Each file runs four
// benches (stdlib decode, ours decode, stdlib encode, ours encode); throughput
// is reported in UTF-8 bytes/sec so the four numbers are directly comparable.

import { bench, dumpToFile, blackbox } from "./lib/bench";
import { UTF8 } from "../utf";
import { loadPayload } from "./fixtures/simdutf_loader";

const OPS: u64 = 200;

// AS closures can't capture loop-locals; the bench routines read these
// module-level slots, which `runFile` rewrites before each `bench(...)` call.
let curBuf: ArrayBuffer = new ArrayBuffer(0);
let curStr: string = "";

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

  desc = "stdlib-encode-" + file;
  bench(desc, () => { blackbox(String.UTF8.encode(curStr)); }, OPS, utf8Bytes);
  dumpToFile(desc);

  desc = "ours-encode-" + file;
  bench(desc, () => { blackbox(UTF8.encode(curStr)); }, OPS, utf8Bytes);
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
