// Render bench results from build/logs/as/<runtime>/ as a markdown table on
// stdout. Useful for PR descriptions or quick before/after compares.
//
// Usage:
//   node scripts/bench-summary.mjs                # v8 (default)
//   node scripts/bench-summary.mjs --wavm         # wavm logs
//   node scripts/bench-summary.mjs --wazero       # wazero logs
//   node scripts/bench-summary.mjs --metric gbps  # field name from BenchResult

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const LOGS = path.join(ROOT, "build", "logs", "as");

let runtime = "v8";
let metric = "mbps";
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--v8") runtime = "v8";
  else if (a === "--wavm") runtime = "wavm";
  else if (a === "--wazero") runtime = "wazero";
  else if (a === "--metric") metric = process.argv[++i];
}

const dir = path.join(LOGS, runtime);
if (!fs.existsSync(dir)) {
  console.error(`No logs in ${path.relative(ROOT, dir)}. Run \`npm run bench -- --${runtime}\` first.`);
  process.exit(1);
}

const rows = fs.readdirSync(dir)
  .filter((f) => f.endsWith(".as.json"))
  .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))
  .sort((a, b) => a.description.localeCompare(b.description));

if (rows.length === 0) {
  console.error(`No bench JSONs in ${path.relative(ROOT, dir)}.`);
  process.exit(1);
}

const fmt = (v) => {
  if (typeof v !== "number") return String(v ?? "");
  if (metric === "nsPerOp") return v.toFixed(1);
  if (metric === "gbps") return v.toFixed(2);
  return Math.round(v).toLocaleString();
};

const unit = metric === "nsPerOp" ? "ns/op"
  : metric === "gbps" ? "GB/s"
  : metric === "mbps" ? "MB/s"
  : metric === "opsPerSecond" ? "ops/s"
  : metric;

const hasMemory = rows.some((r) => r.memoryRetainedBytes > 0 || r.memoryPostGcMs > 0);

console.log(`### Bench summary (${runtime})`);
console.log();
const cols = ["bench", `${unit}`, "ns/op", "ops/s"];
if (hasMemory) cols.push("retained", "post-GC");
console.log("| " + cols.join(" | ") + " |");
console.log("| " + cols.map(() => "---:").join(" | ").replace("---:", "---") + " |");
for (const r of rows) {
  const row = [
    r.description,
    fmt(r[metric]),
    r.nsPerOp.toFixed(1),
    Math.round(r.opsPerSecond).toLocaleString(),
  ];
  if (hasMemory) {
    row.push(formatBytes(r.memoryRetainedBytes ?? 0));
    row.push((r.memoryPostGcMs ?? 0).toFixed(1) + " ms");
  }
  console.log("| " + row.join(" | ") + " |");
}

function formatBytes(n) {
  if (!n) return "0";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}
