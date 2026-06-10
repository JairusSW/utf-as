// Solo throughput chart for `UTF16.validate` over simdutf's wikipedia_mars
// payloads + emoji.txt, decoded to UTF-16. Data comes from the
// `utf16-validate-simdutf` bench.

import {
  loadBench,
  generateChart,
  withRuntime,
} from "../lib/bench-chart.mjs";

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

const mbps = FILES.map((f) => loadBench(`utf16-validate-${f}`)?.mbps ?? 0);
const swar = FILES.map((f) => loadBench(`utf16-validate-swar-${f}`)?.mbps ?? 0);
if (mbps.every((v) => v === 0) && swar.every((v) => v === 0)) {
  console.log("utf16-validate-simdutf: no data (run `bash scripts/run-bench.sh utf16-validate-simdutf`)");
} else {
  const cfg = {
    type: "bar",
    data: {
      labels: FILES,
      datasets: [{
        label: "UTF16.validate (SIMD)",
        data: mbps,
        backgroundColor: "rgba(234, 88, 12, 0.85)",
        borderColor: "#c2410c",
        borderWidth: 1,
      }, {
        label: "UTF16.validate (SWAR)",
        data: swar,
        backgroundColor: "rgba(13, 148, 136, 0.85)",
        borderColor: "#0f766e",
        borderWidth: 1,
      }],
    },
    options: {
      responsive: false,
      plugins: {
        title: { display: true, text: "UTF16.validate throughput on simdutf payloads", font: { size: 22, weight: "bold" } },
        subtitle: { display: true, text: "MB/s of UTF-16 input (higher = better). SIMD vs SWAR.", color: "#475569" },
        legend: { position: "top" },
        datalabels: {
          anchor: "end",
          align: "end",
          color: "#111827",
          font: { size: 11 },
          formatter: (v) => v >= 10000 ? `${(v / 1024).toFixed(1)} GB/s` : `${Math.round(v)} MB/s`,
        },
      },
      scales: {
        x: { ticks: { font: { size: 11 }, maxRotation: 45, minRotation: 45 } },
        y: { beginAtZero: true, title: { display: true, text: "MB/s" } },
      },
    },
  };
  await generateChart(cfg, withRuntime("./charts/utf16-validate-simdutf.png"), { width: 1600, height: 720 });
}
