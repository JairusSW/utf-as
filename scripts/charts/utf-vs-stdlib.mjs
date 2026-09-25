// stdlib UTF8.{encode,decode} vs the SIMD port, per simdutf payload file.
// Produces two PNGs: charts/utf-vs-stdlib-decode-<runtime>.png and
// charts/utf-vs-stdlib-encode-<runtime>.png. Throughput is labeled above each
// bar. Data comes from `npm run bench:vs-stdlib`.

import {
  loadBench,
  generateChart,
  withRuntime,
} from "../lib/bench-chart.mjs";

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

async function renderVs(direction) {
  const stdlib = FILES.map((f) => loadBench(`stdlib-${direction}-${f}`)?.mbps ?? 0);
  const ours   = FILES.map((f) => loadBench(`ours-${direction}-${f}`)?.mbps ?? 0);
  const swar   = FILES.map((f) => loadBench(`swar-${direction}-${f}`)?.mbps ?? 0);
  if (stdlib.every((v) => v === 0) && ours.every((v) => v === 0) && swar.every((v) => v === 0)) {
    console.log(`utf-vs-stdlib: skipping ${direction} (no data — run \`npm run bench:vs-stdlib\`)`);
    return;
  }

  const cfg = {
    type: "bar",
    data: {
      labels: FILES,
      datasets: [
        {
          label: `String.UTF8.${direction}`,
          data: stdlib,
        },
        {
          label: `UTF8.${direction} (SIMD)`,
          data: ours,
        },
        {
          label: `UTF8.${direction} (SWAR)`,
          data: swar,
        },
      ],
    },
    options: {
      responsive: false,
      plugins: {
        title: { display: true, text: `UTF8.${direction}: stdlib vs SIMD`, font: { size: 22, weight: "bold" } },
        subtitle: { display: true, text: "MB/s of UTF-8 input (higher = better). Bar labels are GB/s.", color: "#475569" },
        legend: { position: "top" },
      },
      scales: {
        x: { ticks: { font: { size: 11 }, maxRotation: 45, minRotation: 45 } },
        y: { ...(direction === "decode" ? { type: "linear", max: 20_000 } : {}), beginAtZero: true, title: { display: true, text: "MB/s" } },
      },
    },
  };

  await generateChart(cfg, withRuntime(`./charts/utf-vs-stdlib-${direction}.png`), { width: 1600, height: 720 });
}

await renderVs("decode");
await renderVs("encode");
