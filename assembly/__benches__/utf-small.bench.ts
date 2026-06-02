// UTF-8 ↔ UTF-16LE conversion benchmarks — ~1 KB inputs.
// Apples-to-apples: the simdutf-style `UTF8` namespace vs stdlib
// `String.UTF8`. Both paths allocate fresh buffers per call.

import { bench, dumpToFile, blackbox } from "./lib/bench";
import { UTF8 } from "../utf";
import { asciiCorpus, mixedCorpus } from "./fixtures/corpora";

const TARGET_BYTES: i32 = 1024;
const OPS: u64 = 100_000;

const asciiStr = asciiCorpus(TARGET_BYTES);
const asciiUtf8 = String.UTF8.encode(asciiStr);
const mixedStr = mixedCorpus(TARGET_BYTES);
const mixedUtf8 = String.UTF8.encode(mixedStr);

// --- ASCII corpus
bench("utf-small-ascii-simdutf-decode", () => {
  blackbox(UTF8.decode(asciiUtf8));
}, OPS, <u64>asciiUtf8.byteLength);
dumpToFile("utf-small-ascii-simdutf-decode");

bench("utf-small-ascii-simdutf-encode", () => {
  blackbox(UTF8.encode(asciiStr));
}, OPS, <u64>(asciiStr.length << 1));
dumpToFile("utf-small-ascii-simdutf-encode");

bench("utf-small-ascii-as-utf8-decode", () => {
  blackbox(String.UTF8.decode(asciiUtf8));
}, OPS, <u64>asciiUtf8.byteLength);
dumpToFile("utf-small-ascii-as-utf8-decode");

bench("utf-small-ascii-as-utf8-encode", () => {
  blackbox(String.UTF8.encode(asciiStr));
}, OPS, <u64>(asciiStr.length << 1));
dumpToFile("utf-small-ascii-as-utf8-encode");

// --- Mixed corpus
bench("utf-small-mixed-simdutf-decode", () => {
  blackbox(UTF8.decode(mixedUtf8));
}, OPS, <u64>mixedUtf8.byteLength);
dumpToFile("utf-small-mixed-simdutf-decode");

bench("utf-small-mixed-simdutf-encode", () => {
  blackbox(UTF8.encode(mixedStr));
}, OPS, <u64>(mixedStr.length << 1));
dumpToFile("utf-small-mixed-simdutf-encode");

bench("utf-small-mixed-as-utf8-decode", () => {
  blackbox(String.UTF8.decode(mixedUtf8));
}, OPS, <u64>mixedUtf8.byteLength);
dumpToFile("utf-small-mixed-as-utf8-decode");

bench("utf-small-mixed-as-utf8-encode", () => {
  blackbox(String.UTF8.encode(mixedStr));
}, OPS, <u64>(mixedStr.length << 1));
dumpToFile("utf-small-mixed-as-utf8-encode");
