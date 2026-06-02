// Solo throughput chart for `UTF8.validate` over simdutf's wikipedia_mars
// payloads + emoji.txt. Data comes from `npm run bench:simdutf`.

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

const mbps = FILES.map((f) => loadBench(`utf-validate-${f}`)?.mbps ?? 0);
if (mbps.every((v) => v === 0)) {
  console.log("utf-validate-simdutf: no data (run `npm run bench:simdutf`)");
} else {
  const cfg = {
    type: "bar",
    data: {
      labels: FILES,
      datasets: [{
        label: "UTF8.validate",
        data: mbps,
        backgroundColor: "rgba(168, 85, 247, 0.85)",
        borderColor: "#7e22ce",
        borderWidth: 1,
      }],
    },
    options: {
      responsive: false,
      plugins: {
        title: { display: true, text: "UTF8.validate throughput on simdutf payloads", font: { size: 22, weight: "bold" } },
        subtitle: { display: true, text: "MB/s of UTF-8 input (higher = better)", color: "#475569" },
        legend: { display: false },
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
  await generateChart(cfg, withRuntime("./charts/utf-validate-simdutf.png"), { width: 1600, height: 720 });
}
