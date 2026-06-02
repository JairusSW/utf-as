// Shared helpers for chart-building scripts under scripts/charts/*.mjs.
// Runtime is selected by the BENCH_CHART_RUNTIME env var (set by
// scripts/build-charts.sh from --v8/--wavm/--wazero flags). Default: v8.
//
// Each chart .mjs file:
//   1. import { loadResults, createBarChart, generateChart } from "../lib/bench-chart.mjs"
//   2. assemble a Record<label, BenchResult[]>
//   3. createBarChart + generateChart("./charts/<name>-<runtime>.png")

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import ChartDataLabels from "chartjs-plugin-datalabels";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const LOGS_DIR = path.join(ROOT, "build", "logs", "as");

const RAW_RUNTIME = (process.env.BENCH_CHART_RUNTIME ?? "v8").trim().toLowerCase();
export const RUNTIME = ["v8", "wavm", "wazero"].includes(RAW_RUNTIME) ? RAW_RUNTIME : "v8";

/** Read a single bench JSON (returns null if missing). */
export function loadBench(stem) {
  const p = path.join(LOGS_DIR, RUNTIME, `${stem}.as.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Bulk load — returns { stem: payload } for every stem found. Stems missing
 *  on disk are silently omitted; check `.length` if completeness matters. */
export function loadResults(stems) {
  const out = {};
  for (const stem of stems) {
    const v = loadBench(stem);
    if (v) out[stem] = v;
  }
  return out;
}

/** Git/version subtitle. Best-effort — silently degrades if shell commands fail. */
export function subtitle() {
  const tokens = [new Date().toDateString()];
  try {
    const v = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
    if (v && v !== "0.0.0") tokens.push("v" + v);
  } catch {}
  try {
    tokens.push("git " + execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim());
  } catch {}
  tokens.push("runtime: " + RUNTIME);
  return tokens.join(" • ");
}

// Palette index — overflow falls back to the gray catch-all.
const PALETTE = [
  { fill: "rgba(37, 99, 235, 0.85)",  border: "#1d4ed8" },  // blue (baseline)
  { fill: "rgba(22, 163, 74, 0.85)",  border: "#15803d" },  // green (ours)
  { fill: "rgba(239, 68, 68, 0.85)",  border: "#dc2626" },  // red
  { fill: "rgba(168, 85, 247, 0.85)", border: "#7e22ce" },  // purple
  { fill: "rgba(234, 179, 8, 0.85)",  border: "#ca8a04" },  // amber
  { fill: "rgba(20, 184, 166, 0.85)", border: "#0d9488" },  // teal
];
const GRAY = { fill: "rgba(107, 114, 128, 0.85)", border: "#4b5563" };
const colorFor = (i) => PALETTE[i] ?? GRAY;

/**
 * Build a grouped-bar chart config.
 *
 * `data` shape: `{ <groupLabel>: { <seriesLabel>: BenchResult } }`
 * The chart groups by group (x-axis) and one bar per series.
 *
 * `opts.metric` picks the field to plot — default "mbps". Use "gbps" for
 * GB/s, or any other numeric field on BenchResult.
 */
export function createBarChart(data, opts = {}) {
  const groups = Object.keys(data);
  if (groups.length === 0) throw new Error("createBarChart: no groups");
  const seriesLabels = [...new Set(groups.flatMap((g) => Object.keys(data[g])))];
  const metric = opts.metric ?? "mbps";

  const datasets = seriesLabels.map((label, i) => {
    const { fill, border } = colorFor(i);
    return {
      label,
      data: groups.map((g) => data[g][label]?.[metric] ?? 0),
      backgroundColor: fill,
      borderColor: border,
      borderWidth: 1,
    };
  });

  return {
    type: "bar",
    data: { labels: groups, datasets },
    options: {
      responsive: false,
      plugins: {
        title: opts.title ? {
          display: true,
          text: opts.title,
          font: { size: 20, weight: "bold" },
        } : { display: false },
        subtitle: {
          display: true,
          text: opts.subtitle ?? subtitle(),
          color: "#475569",
          padding: { bottom: 10 },
        },
        legend: { position: "top", labels: { font: { size: 13 } } },
        datalabels: {
          anchor: "end",
          align: "end",
          color: "#111827",
          font: { size: 11 },
          formatter: opts.labelFormatter ?? ((v) => Math.round(v).toLocaleString()),
        },
      },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: opts.yLabel ?? metricLabel(metric) } },
        x: { ticks: { font: { size: 11 }, maxRotation: opts.xRotation ?? 45, minRotation: opts.xRotation ?? 45 } },
      },
    },
    plugins: [ChartDataLabels],
  };
}

function metricLabel(metric) {
  if (metric === "mbps") return "MB/s";
  if (metric === "gbps") return "GB/s";
  if (metric === "nsPerOp") return "ns/op";
  if (metric === "opsPerSecond") return "ops/s";
  return metric;
}

// Canvases cached by (width × height). Reusing avoids re-running the
// `chartCallback` (which re-registers chartjs-plugin-datalabels) — repeated
// registrations confuse per-dataset anchor positioning in grouped bar charts.
const _canvases = new Map();
function _canvasFor(width, height) {
  const key = `${width}x${height}`;
  let c = _canvases.get(key);
  if (!c) {
    c = new ChartJSNodeCanvas({
      width,
      height,
      backgroundColour: "white",
      chartCallback: (ChartJS) => ChartJS.register(ChartDataLabels),
    });
    _canvases.set(key, c);
  }
  return c;
}

/** Render a Chart.js config to PNG. Returns the absolute output path. */
export async function generateChart(config, outPath, { width = 1280, height = 720 } = {}) {
  const canvas = _canvasFor(width, height);
  const abs = path.isAbsolute(outPath) ? outPath : path.join(ROOT, outPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, await canvas.renderToBuffer(config));
  console.log("wrote", path.relative(ROOT, abs));
  return abs;
}

/** Append `-<runtime>` before the extension. `/x/chart.png` → `/x/chart-v8.png`. */
export function withRuntime(outPath) {
  const ext = path.extname(outPath);
  return outPath.slice(0, -ext.length) + "-" + RUNTIME + ext;
}
