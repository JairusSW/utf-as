// Loads simdutf payload files into wasm memory at bench-init time.
//
// V8 runner: each fixture is pulled from disk via the runner's `readFile`
// hostcall (see bench/runners/assemblyscript.js).
//
// WASI runtimes (wavm / wazero): there is no `readFile` hostcall, so the
// harness instead pipes a framed blob of every fixture into stdin and we read
// it with `fd_read`. The blob is:
//
//   u32 count
//   count × ( u32 nameLen, name bytes (utf8), u32 dataLen, data bytes )
//
// all little-endian (wasm-native). We slurp it once, parse it into a
// name → ArrayBuffer table, and serve `loadPayload` lookups from there. See
// scripts/pack-simdutf-fixtures.mjs for the writer.

import { readFile } from "./../lib/bench";

// Selected by the WASI builds in run-bench.sh (`--use AS_BENCH_RUNTIME_*=1`).
// On V8 neither is defined, so the stdin path below is statically dead and
// `fd_read` is never imported; on WASI the `readFile` path is dead instead.
// @ts-expect-error: compile-time flags may be undefined.
const STDIN_INPUT: bool = isDefined(AS_BENCH_RUNTIME_WAVM) || isDefined(AS_BENCH_RUNTIME_WAZERO);

const FIXTURE_ROOT: string = "./assembly/__benches__/fixtures/simdutf/";

export class Payload {
  buf!: ArrayBuffer;
  ptr!: usize;
  len!: i32;
  name!: string;
}

export function loadPayload(file: string): Payload {
  const buf = STDIN_INPUT ? lookupFromStdin(file) : readFile(FIXTURE_ROOT + file);
  const p = new Payload();
  p.buf = buf;
  p.ptr = changetype<usize>(buf);
  p.len = buf.byteLength;
  p.name = file;
  KEEP.push(buf);
  return p;
}

const KEEP: ArrayBuffer[] = [];

// ── WASI stdin path ────────────────────────────────────────────────────────

// @ts-ignore: decorator allowed
@external("wasi_snapshot_preview1", "fd_read")
declare function fd_read(fd: u32, iovs: usize, iovsLen: u32, nread: usize): u32;

// iovec (ptr, len) + nread slot.
const IOV: usize = memory.data(12);

let manifestNames: string[] | null = null;
let manifestBufs: ArrayBuffer[] = [];

function lookupFromStdin(file: string): ArrayBuffer {
  ensureManifest();
  const names = manifestNames!;
  for (let i = 0; i < names.length; i++) {
    if (names[i] == file) return manifestBufs[i];
  }
  // The harness packs every fixture, so a miss means the file wasn't fetched.
  assert(false, "payload not found on stdin: " + file);
  return new ArrayBuffer(0);
}

function ensureManifest(): void {
  if (manifestNames != null) return;
  manifestNames = [];

  const blob = readAllStdin();
  const base = changetype<usize>(blob);
  const total = <usize>blob.byteLength;
  let off: usize = 0;

  const count = load<u32>(base + off); off += 4;
  for (let i: u32 = 0; i < count; i++) {
    const nameLen = load<u32>(base + off); off += 4;
    const name = String.UTF8.decodeUnsafe(base + off, nameLen); off += nameLen;
    const dataLen = load<u32>(base + off); off += 4;
    const b = changetype<ArrayBuffer>(__new(dataLen, idof<ArrayBuffer>()));
    memory.copy(changetype<usize>(b), base + off, dataLen); off += dataLen;
    manifestNames!.push(name);
    manifestBufs.push(b);
  }
  assert(off == total, "stdin manifest framing mismatch");
}

// Slurp all of fd 0 into a single ArrayBuffer, reading in 64 KiB chunks until
// EOF (a zero-length read).
function readAllStdin(): ArrayBuffer {
  const CHUNK: i32 = 1 << 16;
  const chunks: ArrayBuffer[] = [];
  const sizes: i32[] = [];
  let total: i32 = 0;

  while (true) {
    const b = changetype<ArrayBuffer>(__new(CHUNK, idof<ArrayBuffer>()));
    const n = stdinRead(b);
    if (n <= 0) break;
    chunks.push(b);
    sizes.push(n);
    total += n;
  }

  const out = changetype<ArrayBuffer>(__new(total, idof<ArrayBuffer>()));
  let off: usize = 0;
  for (let i = 0; i < chunks.length; i++) {
    memory.copy(changetype<usize>(out) + off, changetype<usize>(chunks[i]), <usize>sizes[i]);
    off += <usize>sizes[i];
  }
  return out;
}

// One `fd_read` of up to `buf.byteLength` bytes; returns bytes read (0 = EOF).
function stdinRead(buf: ArrayBuffer): i32 {
  store<u32>(IOV, <u32>changetype<usize>(buf));   // iov_base
  store<u32>(IOV + 4, <u32>buf.byteLength);        // iov_len
  const err = fd_read(0, IOV, 1, IOV + 8);         // nread → IOV+8
  if (err != 0) return -1;
  return <i32>load<u32>(IOV + 8);
}
