// Overview chart layout copied from ../json-as/scripts/build-overview-serialize.ts.
// The payloads, series, titles, and captured benchmark numbers are utf-as data.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBarChart, generateChart } from "./lib/json-as-chart.mjs";
import { MODE_BARS } from "./lib/json-as-palette.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const capture = JSON.parse(fs.readFileSync(path.join(ROOT, "bench/results/2026-09-24-arm64.json")));
const byPayload = Object.fromEntries(capture.rows.map((row) => [row.payload, row]));

const PAYLOADS = {
  "english.html": "English\n   (HTML)",
  "german.html": "German\n   (HTML)",
  "french.html": "French\n   (HTML)",
  "turkish.html": "Turkish\n   (HTML)",
  "chinese.html": "Chinese\n   (HTML)",
  "japanese.html": "Japanese\n   (HTML)",
  "emoji.txt": "Emoji\n   (TXT)",
};

const OUTPUT_DIR = path.join(ROOT, "docs/charts/2026-09-23");
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const whiteBackground = {
  id: "whiteBackground",
  beforeDraw(chart) {
    const { ctx, width, height } = chart;
    ctx.save();
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  },
};

const CHARTS = [
  {
    file: "utf8-decode",
    title: "UTF-8 Decode Performance",
    datasetLabels: ["String.UTF8.decode", "utf-as UTF8.decode"],
    colors: [MODE_BARS[0], MODE_BARS[3]],
    values: (row) => [row.decode.stdlib, row.decode.utfAs],
    yLabel: "Throughput (MB/s of UTF-8 input)",
  },
  {
    file: "utf8-encode",
    title: "UTF-8 Encode Performance",
    datasetLabels: ["String.UTF8.encode", "utf-as UTF8.encode"],
    colors: [MODE_BARS[0], MODE_BARS[3]],
    values: (row) => [row.encode.stdlib, row.encode.utfAs],
    yLabel: "Throughput (MB/s of UTF-8 input)",
  },
  {
    file: "validation",
    title: "Unicode Validation Performance",
    datasetLabels: ["UTF8.validate", "UTF16.validate"],
    colors: [MODE_BARS[3], MODE_BARS[2]],
    values: (row) => [row.validateUtf8, row.validateUtf16],
    yLabel: "Throughput (MB/s of input bytes)",
  },
];

for (const chart of CHARTS) {
  const chartData = {};
  for (const payload of Object.keys(PAYLOADS)) {
    chartData[payload] = chart.values(byPayload[payload]).map((gbps) => ({ mbps: gbps * 1000 }));
  }

  const config = createBarChart(chartData, PAYLOADS, {
    title: chart.title,
    yLabel: chart.yLabel,
    xLabel: "",
    datasetLabels: chart.datasetLabels,
    colors: chart.colors,
    // Stand the value labels up off each bar top so adjacent ones don't collide.
    labelRotation: -90,
    labelFontSize: 10,
  });
  config.options.plugins.subtitle.text =
    `${capture.date} • ${capture.host.replace(/^Apple /, "")} • ${capture.runtime} • ${capture.commit}`;
  config.options.plugins.subtitle.font.size = 11;
  config.plugins = [whiteBackground];

  // SVG (vector, fast-loading) + PNG (3x density), as in json-as.
  const outputFile = path.join(OUTPUT_DIR, `${chart.file}.svg`);
  generateChart(config, outputFile);
  generateChart(config, outputFile.replace(/\.svg$/, ".png"));
}
