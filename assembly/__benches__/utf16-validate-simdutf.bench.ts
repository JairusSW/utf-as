// UTF-16 validator throughput against simdutf's benchmark payloads
// (wikipedia_mars/*.html + emoji.txt), each decoded to UTF-16 first. Mirrors
// utf-validate-simdutf.bench.ts; throughput is reported over UTF-16 bytes.
// Bench routine reads the active source from module-level `curPtr`/`curUnits`
// — AS closures can't capture loop-locals.

import { bench, dumpToFile, blackbox } from "./lib/bench";
import { UTF16 } from "../utf";
import { validateUtf16Swar } from "../utf/validate_swar";
import { loadPayload, Payload } from "./fixtures/simdutf_loader";

const OPS: u64 = 500;

let curPtr: usize = 0;
let curUnits: i32 = 0;

// Hold decoded strings so the GC can't reclaim the buffers we point into.
const KEEP: string[] = [];

function runOne(file: string): void {
  const p: Payload = loadPayload(file);
  const s = String.UTF8.decode(p.buf);
  KEEP.push(s);
  curPtr = changetype<usize>(s);
  curUnits = s.length;

  // Dispatched path (SWAR below threshold, SIMD above) — effectively SIMD here.
  const desc = "utf16-validate-" + file;
  bench(desc, () => {
    blackbox(UTF16.validateUnsafe(curPtr, curUnits << 1));
  }, OPS, <u64>(curUnits << 1));
  dumpToFile(desc);

  // SWAR path directly, for the swar-vs-dispatched comparison on real text.
  const swar = "utf16-validate-swar-" + file;
  bench(swar, () => {
    blackbox(validateUtf16Swar(curPtr, curUnits << 1));
  }, OPS, <u64>(curUnits << 1));
  dumpToFile(swar);
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
