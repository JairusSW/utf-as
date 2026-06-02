import { bench, dumpToFile, blackbox } from "./lib/bench";
import { UTF8 } from "../utf";
import { mixedCorpus, asciiCorpus } from "./fixtures/corpora";

const TARGET_BYTES: i32 = 64 * 1024;
const OPS: u64 = 5_000;

const mixedUtf8 = String.UTF8.encode(mixedCorpus(TARGET_BYTES));
const asciiUtf8 = String.UTF8.encode(asciiCorpus(TARGET_BYTES));

bench("utf-validate-ascii", () => {
  blackbox(UTF8.validateUnsafe(changetype<usize>(asciiUtf8), asciiUtf8.byteLength));
}, OPS, <u64>asciiUtf8.byteLength);
dumpToFile("utf-validate-ascii");

bench("utf-validate-mixed", () => {
  blackbox(UTF8.validateUnsafe(changetype<usize>(mixedUtf8), mixedUtf8.byteLength));
}, OPS, <u64>mixedUtf8.byteLength);
dumpToFile("utf-validate-mixed");
