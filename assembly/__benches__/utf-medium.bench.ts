// UTF-8 ↔ UTF-16LE benchmarks — ~64 KB inputs.

import { bench, dumpToFile, blackbox } from "./lib/bench";
import { UTF8 } from "../utf";
import { asciiCorpus, mixedCorpus } from "./fixtures/corpora";

const TARGET_BYTES: i32 = 64 * 1024;
const OPS: u64 = 5_000;

const asciiStr = asciiCorpus(TARGET_BYTES);
const asciiUtf8 = String.UTF8.encode(asciiStr);
const mixedStr = mixedCorpus(TARGET_BYTES);
const mixedUtf8 = String.UTF8.encode(mixedStr);

bench("utf-medium-ascii-simdutf-decode", () => {
  blackbox(UTF8.decode(asciiUtf8));
}, OPS, <u64>asciiUtf8.byteLength);
dumpToFile("utf-medium-ascii-simdutf-decode");

bench("utf-medium-ascii-simdutf-encode", () => {
  blackbox(UTF8.encode(asciiStr));
}, OPS, <u64>(asciiStr.length << 1));
dumpToFile("utf-medium-ascii-simdutf-encode");

bench("utf-medium-ascii-as-utf8-decode", () => {
  blackbox(String.UTF8.decode(asciiUtf8));
}, OPS, <u64>asciiUtf8.byteLength);
dumpToFile("utf-medium-ascii-as-utf8-decode");

bench("utf-medium-ascii-as-utf8-encode", () => {
  blackbox(String.UTF8.encode(asciiStr));
}, OPS, <u64>(asciiStr.length << 1));
dumpToFile("utf-medium-ascii-as-utf8-encode");

bench("utf-medium-mixed-simdutf-decode", () => {
  blackbox(UTF8.decode(mixedUtf8));
}, OPS, <u64>mixedUtf8.byteLength);
dumpToFile("utf-medium-mixed-simdutf-decode");

bench("utf-medium-mixed-simdutf-encode", () => {
  blackbox(UTF8.encode(mixedStr));
}, OPS, <u64>(mixedStr.length << 1));
dumpToFile("utf-medium-mixed-simdutf-encode");

bench("utf-medium-mixed-as-utf8-decode", () => {
  blackbox(String.UTF8.decode(mixedUtf8));
}, OPS, <u64>mixedUtf8.byteLength);
dumpToFile("utf-medium-mixed-as-utf8-decode");

bench("utf-medium-mixed-as-utf8-encode", () => {
  blackbox(String.UTF8.encode(mixedStr));
}, OPS, <u64>(mixedStr.length << 1));
dumpToFile("utf-medium-mixed-as-utf8-encode");
