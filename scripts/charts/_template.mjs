// Chart template — copy this to a new file under scripts/charts/ and edit
// the marked sections. The build-charts.sh runner picks up every .mjs file
// in this directory (except those starting with `_`) and runs it with the
// selected runtime (--v8 / --wavm / --wazero) wired through env.
//
// Conventions:
//   - JSON inputs live in build/logs/as/<runtime>/<stem>.as.json
//   - PNG outputs land in charts/<name>-<runtime>.png
//   - withRuntime() handles the `-<runtime>` suffix for you

import {
  loadResults,
  createBarChart,
  generateChart,
  withRuntime,
} from "../lib/bench-chart.mjs";

// 1. List the bench file stems you want plotted (these are the values you
//    passed to `bench("...", ...)` in the .bench.ts file).
const STEMS = [
  // "mybench-ascii",
  // "mybench-mixed",
];

// 2. Optional: rename them for the chart x-axis.
const LABELS = {
  // "mybench-ascii": "ASCII (64 KiB)",
  // "mybench-mixed": "Mixed (64 KiB)",
};

// 3. Load and reshape: createBarChart wants `{ groupLabel: { seriesLabel: BenchResult } }`.
const results = loadResults(STEMS);
const data = {};
for (const stem of STEMS) {
  if (!results[stem]) continue;
  data[LABELS[stem] ?? stem] = { [results[stem].description]: results[stem] };
}

if (Object.keys(data).length === 0) {
  console.log("(template) no inputs — edit STEMS and rerun");
} else {
  const cfg = createBarChart(data, {
    title: "Template chart",
    metric: "mbps",
  });
  await generateChart(cfg, withRuntime("./charts/template.png"));
}
