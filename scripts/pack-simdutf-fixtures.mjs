// Packs every simdutf fixture into the framed blob that assembly's
// simdutf_loader reads from stdin on WASI runtimes (wavm / wazero), and writes
// it to stdout. Format (all u32 little-endian, wasm-native):
//
//   u32 count
//   count × ( u32 nameLen, name bytes (utf8), u32 dataLen, data bytes )
//
// The V8 runner doesn't use this — it reads fixtures directly via a `readFile`
// hostcall. See scripts/run-bench.sh for where this is piped in.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "assembly/__benches__/fixtures/simdutf");

let entries;
try {
  entries = readdirSync(DIR)
    .filter((f) => statSync(join(DIR, f)).isFile())
    .sort();
} catch {
  process.stderr.write(
    `pack-simdutf-fixtures: no fixtures at ${DIR}. Run \`npm run bench:fetch\` first.\n`
  );
  process.exit(1);
}

const u32 = (n) => {
  const b = Buffer.allocUnsafe(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
};

const parts = [u32(entries.length)];
for (const name of entries) {
  const nameBuf = Buffer.from(name, "utf8");
  const data = readFileSync(join(DIR, name));
  parts.push(u32(nameBuf.length), nameBuf, u32(data.length), data);
}

process.stdout.write(Buffer.concat(parts));
