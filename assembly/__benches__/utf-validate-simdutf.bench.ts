// UTF-8 validator throughput against simdutf's published benchmark payloads
// (wikipedia_mars/*.html + emoji.txt). Files load via the V8 runner's
// `readFile` hostcall. Bench routine reads the active payload from
// module-level `curPtr`/`curLen` — AS closures can't capture loop-locals.

import { bench, dumpToFile, blackbox } from "./lib/bench";
import { UTF8 } from "../utf";
import { loadPayload, Payload } from "./fixtures/simdutf_loader";

const OPS: u64 = 500;

let curPtr: usize = 0;
let curLen: i32 = 0;

function runOne(file: string): void {
  const p: Payload = loadPayload(file);
  curPtr = p.ptr;
  curLen = p.len;
  const desc = "utf-validate-" + file;
  bench(desc, () => {
    blackbox(UTF8.validateUnsafe(curPtr, curLen));
  }, OPS, <u64>p.len);
  dumpToFile(desc);
}

runOne("arabic.html");
runOne("chinese.html");
runOne("english.html");
runOne("french.html");
runOne("german.html");
runOne("hebrew.html");
runOne("hindi.html");
runOne("japanese.html");
runOne("korean.html");
runOne("portuguese.html");
runOne("russian.html");
runOne("thai.html");
runOne("turkish.html");
runOne("vietnamese.html");
runOne("emoji.txt");
