// UTF-8 ↔ UTF-16LE benchmarks — ~1 MB inputs.

import { bench, dumpToFile, blackbox } from "./lib/bench";
import { UTF8 } from "../utf";
import { asciiCorpus, mixedCorpus } from "./fixtures/corpora";

const TARGET_BYTES: i32 = 1024 * 1024;
const OPS: u64 = 500;

const asciiStr = asciiCorpus(TARGET_BYTES);
const asciiUtf8 = String.UTF8.encode(asciiStr);
const mixedStr = mixedCorpus(TARGET_BYTES);
const mixedUtf8 = String.UTF8.encode(mixedStr);

bench("utf-large-ascii-simdutf-decode", () => {
  blackbox(UTF8.decode(asciiUtf8));
}, OPS, <u64>asciiUtf8.byteLength);
dumpToFile("utf-large-ascii-simdutf-decode");

bench("utf-large-ascii-simdutf-encode", () => {
  blackbox(UTF8.encode(asciiStr));
}, OPS, <u64>(asciiStr.length << 1));
dumpToFile("utf-large-ascii-simdutf-encode");

bench("utf-large-ascii-as-utf8-decode", () => {
  blackbox(String.UTF8.decode(asciiUtf8));
}, OPS, <u64>asciiUtf8.byteLength);
dumpToFile("utf-large-ascii-as-utf8-decode");

bench("utf-large-ascii-as-utf8-encode", () => {
  blackbox(String.UTF8.encode(asciiStr));
}, OPS, <u64>(asciiStr.length << 1));
dumpToFile("utf-large-ascii-as-utf8-encode");

bench("utf-large-mixed-simdutf-decode", () => {
  blackbox(UTF8.decode(mixedUtf8));
}, OPS, <u64>mixedUtf8.byteLength);
dumpToFile("utf-large-mixed-simdutf-decode");

bench("utf-large-mixed-simdutf-encode", () => {
  blackbox(UTF8.encode(mixedStr));
}, OPS, <u64>(mixedStr.length << 1));
dumpToFile("utf-large-mixed-simdutf-encode");

bench("utf-large-mixed-as-utf8-decode", () => {
  blackbox(String.UTF8.decode(mixedUtf8));
}, OPS, <u64>mixedUtf8.byteLength);
dumpToFile("utf-large-mixed-as-utf8-decode");

bench("utf-large-mixed-as-utf8-encode", () => {
  blackbox(String.UTF8.encode(mixedStr));
}, OPS, <u64>(mixedStr.length << 1));
dumpToFile("utf-large-mixed-as-utf8-encode");
