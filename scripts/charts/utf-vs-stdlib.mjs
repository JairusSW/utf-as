// stdlib UTF8.{encode,decode} vs the SIMD port, per simdutf payload file.
// Produces two PNGs: charts/utf-vs-stdlib-decode-<runtime>.png and
// charts/utf-vs-stdlib-encode-<runtime>.png. Speedup is labeled on each
// "ours" bar. Data comes from `npm run bench:vs-stdlib`.

import {
  loadBench,
  generateChart,
  withRuntime,
} from "../lib/bench-chart.mjs";
import ChartDataLabels from "chartjs-plugin-datalabels";

// Left → right: ASCII-heavy → 4-byte heavy, so the chart reads as a
// difficulty gradient against the UTF-8 byte class.
const FILES = [
  "english.html",
  "french.html",
  "german.html",
  "portuguese.html",
  "turkish.html",
  "vietnamese.html",
  "arabic.html",
  "hebrew.html",
  "russian.html",
  "chinese.html",
  "japanese.html",
  "korean.html",
  "hindi.html",
  "thai.html",
  "emoji.txt",
];

const palette = {
  stdlib: { fill: "rgba(37, 99, 235, 0.85)", border: "#1d4ed8" },
  ours:   { fill: "rgba(22, 163, 74, 0.85)", border: "#15803d" },
};

async function renderVs(direction) {
  const stdlib = FILES.map((f) => loadBench(`stdlib-${direction}-${f}`)?.mbps ?? 0);
  const ours   = FILES.map((f) => loadBench(`ours-${direction}-${f}`)?.mbps ?? 0);
  if (stdlib.every((v) => v === 0) && ours.every((v) => v === 0)) {
    console.log(`utf-vs-stdlib: skipping ${direction} (no data — run \`npm run bench:vs-stdlib\`)`);
    return;
  }

  const speedups = ours.map((o, i) => stdlib[i] > 0 ? o / stdlib[i] : 0);

  const cfg = {
    type: "bar",
    data: {
      labels: FILES,
      datasets: [
        {
          label: `String.UTF8.${direction}`,
          data: stdlib,
          backgroundColor: palette.stdlib.fill,
          borderColor: palette.stdlib.border,
          borderWidth: 1,
          datalabels: { display: false },
        },
        {
          label: `UTF8.${direction} (SIMD)`,
          data: ours,
          backgroundColor: palette.ours.fill,
          borderColor: palette.ours.border,
          borderWidth: 1,
          datalabels: {
            anchor: "end",
            align: "end",
            color: "#15803d",
            font: { size: 11, weight: "bold" },
            formatter: (_v, ctx) => {
              const s = speedups[ctx.dataIndex];
              return s > 0 ? `${s.toFixed(1)}×` : "";
            },
          },
        },
      ],
    },
    options: {
      responsive: false,
      plugins: {
        title: { display: true, text: `UTF8.${direction}: stdlib vs SIMD`, font: { size: 22, weight: "bold" } },
        subtitle: { display: true, text: "MB/s of UTF-8 input (higher = better). Label = SIMD speedup vs stdlib.", color: "#475569" },
        legend: { position: "top" },
      },
      scales: {
        x: { ticks: { font: { size: 11 }, maxRotation: 45, minRotation: 45 } },
        y: { beginAtZero: true, title: { display: true, text: "MB/s" } },
      },
    },
    plugins: [ChartDataLabels],
  };

  await generateChart(cfg, withRuntime(`./charts/utf-vs-stdlib-${direction}.png`), { width: 1600, height: 720 });
}

await renderVs("decode");
await renderVs("encode");
