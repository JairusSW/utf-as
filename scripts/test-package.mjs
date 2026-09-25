import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = mkdtempSync(path.join(os.tmpdir(), "utf-as-package-"));

function run(command, args, cwd, env = process.env) {
  return execFileSync(command, args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

try {
  const packEnv = { ...process.env, npm_config_dry_run: "false", NPM_CONFIG_DRY_RUN: "false" };
  const [packed] = JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--dry-run=false", "--pack-destination", temporary], root, packEnv));
  const modules = path.join(temporary, "node_modules");
  const packageDir = path.join(modules, "utf-as");
  mkdirSync(packageDir, { recursive: true });
  run("tar", ["-xzf", path.join(temporary, packed.filename), "--strip-components=1", "-C", packageDir], root);
  symlinkSync(path.join(root, "node_modules", "as-simd"), path.join(modules, "as-simd"), "dir");

  const source = path.join(temporary, "consumer.ts");
  writeFileSync(source, `
import { UTF8, UTF16 } from "utf-as";
import { UTF8 as SubpathUTF8 } from "utf-as/utf";
import { validateWide256, validateWide512, utf16LengthWide256, utf8LengthWide512 } from "utf-as/wide";

export function smoke(): i32 {
  const input = String.UTF8.encode("aé中😀");
  const ptr = changetype<usize>(input);
  const str = UTF8.decode(input);
  return i32(SubpathUTF8.validateUnsafe(ptr, input.byteLength))
    + i32(validateWide256(ptr, input.byteLength))
    + i32(validateWide512(ptr, input.byteLength))
    + utf16LengthWide256(ptr, input.byteLength)
    + utf8LengthWide512(changetype<usize>(str), str.length)
    + i32(UTF16.validateUnsafe(changetype<usize>(str), str.length << 1));
}
`);

  const compiler = path.join(root, "node_modules", "assemblyscript", "bin", "asc.js");
  for (const simd of [true, false]) {
    const output = path.join(temporary, simd ? "simd.wasm" : "nosimd.wasm");
    run(process.execPath, [compiler, source, simd ? "--enable" : "--disable", "simd", "--enable", "bulk-memory", "--exportRuntime", "-o", output], temporary);
    const wasm = new WebAssembly.Module(readFileSync(output));
    const instance = new WebAssembly.Instance(wasm, { env: { abort() { throw new Error("consumer aborted"); } } });
    const actual = instance.exports.smoke();
    if (actual !== 19) throw new Error(`${simd ? "SIMD" : "no-SIMD"} consumer returned ${actual}, expected 19`);
  }
  console.log("Packed consumer imports and execution passed with SIMD and without SIMD.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
