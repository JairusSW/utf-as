// @ts-expect-error: readbuffer is defined in d8
const bytes = readbuffer("./build/" + arguments[0]);

// When --memory is on, the AS-side bench prints "heap:" lines with bytes
// keyed by runtime ID. The `addHeapAnalyzerInfo` transform from
// `as-heap-analyzer` emits a custom section mapping IDs → class names; we
// parse it here so `bench.ts` output reads as names rather than numbers.
const HEAP_CLASS_NAMES = extractHeapAnalyzerClassInfo(new Uint8Array(bytes));

const ARRAYBUFFER_ID = 1;
let memory = null;

const { exports } = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
  env: {
    abort: (msg, file, line) => {
      console.log("abort: " + __liftString(msg) + " in " + __liftString(file) + ":" + line);
    },
    "console.log": (ptr) => {
      console.log(rewriteHeapLine(__liftString(ptr)));
    },
    "Date.now": () => Date.now(),
    "performance.now": () => performance.now(),
    writeFile: (fileName, data) => {
      writeFile(__liftString(fileName), __liftString(data));
    },
    // Read a file from disk into a fresh ArrayBuffer in wasm memory.
    // Used by benches that load fixture payloads at init time.
    readFile: (pathPtr) => {
      const path = __liftString(pathPtr);
      // @ts-expect-error: readbuffer is defined in d8
      const data = readbuffer(path);
      return __lowerBuffer(data);
    },
  }
});

memory = exports.memory;

function __liftString(pointer) {
  if (!pointer) return null;
  const end = (pointer + new Uint32Array(memory.buffer)[(pointer - 4) >>> 2]) >>> 1;
  const memoryU16 = new Uint16Array(memory.buffer);
  let start = pointer >>> 1;
  let string = "";
  while (end - start > 1024) {
    string += String.fromCharCode(...memoryU16.subarray(start, (start += 1024)));
  }
  return string + String.fromCharCode(...memoryU16.subarray(start, end));
}

function __lowerBuffer(buf) {
  if (buf == null) return 0;
  const ptr = exports.__new(buf.byteLength, ARRAYBUFFER_ID) >>> 0;
  new Uint8Array(memory.buffer).set(new Uint8Array(buf), ptr);
  return ptr;
}

exports.start();

// ── heap-analyzer custom section ──────────────────────────────────────────

function rewriteHeapLine(line) {
  if (!HEAP_CLASS_NAMES || !line || !line.startsWith("   heap: ")) return line;
  return line.replace(/"(\d+)":/g, (m, id) => {
    const name = HEAP_CLASS_NAMES[id];
    return name ? `"${name}":` : m;
  });
}

function extractHeapAnalyzerClassInfo(buf) {
  if (buf.length < 8 || buf[0] !== 0x00 || buf[1] !== 0x61 || buf[2] !== 0x73 || buf[3] !== 0x6d) return null;
  let p = 8;
  while (p < buf.length) {
    const id = buf[p++];
    const [size, after] = readVarUint32(buf, p);
    p = after;
    const end = p + size;
    if (id === 0) {
      const [nameLen, afterNameLen] = readVarUint32(buf, p);
      const nameStart = afterNameLen;
      const nameEnd = nameStart + nameLen;
      const name = bytesToUtf8(buf, nameStart, nameEnd);
      if (name === "heapAnalyzerInfo") {
        try {
          const parsed = JSON.parse(bytesToUtf8(buf, nameEnd, end));
          return parsed && parsed.classInfo ? parsed.classInfo : null;
        } catch { return null; }
      }
    }
    p = end;
  }
  return null;
}

function readVarUint32(buf, p) {
  let result = 0, shift = 0;
  while (true) {
    const b = buf[p++];
    result |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return [result >>> 0, p];
}

function bytesToUtf8(buf, start, end) {
  let s = "";
  for (let i = start; i < end; i++) s += String.fromCharCode(buf[i]);
  return decodeURIComponent(escape(s));
}
