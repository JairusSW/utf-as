// Reproducible release charts from the checked-in median benchmark snapshots.
// Palette and dual SVG/PNG rendering follow ../json-as/scripts/lib/{palette,bench-utils}.ts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const captures = ["arm64", "amd64"].map((arch) => ({
  arch,
  v8: JSON.parse(fs.readFileSync(path.join(root, `bench/results/2026-09-24-${arch}.json`))),
  wide: JSON.parse(fs.readFileSync(path.join(root, `bench/results/2026-09-24-wide-${arch}.json`))),
}));
const out = path.join(root, "docs/charts/2026-09-24");
fs.mkdirSync(out, { recursive: true });

// The shared json-as colors keep related AssemblyScript projects visually consistent.
const colors = {
  stdlib: "#F8333C", utfAs: "#2B9EB3", swar: "#44AF69",
  v128: "#2B9EB3", wide256: "#FA6F26", wide512: "#9E7153",
  utf8: "#2B9EB3", utf16: "#44AF69",
};
const ink = "#263449";
const grid = "#E6EBF0";
function base(title, subtitle, horizontal = true) {
  return {
    responsive: false,
    animation: false,
    indexAxis: horizontal ? "y" : "x",
    layout: { padding: { top: 12, right: 24, bottom: 8, left: 12 } },
    plugins: {
      title: { display: true, text: title, align: "start", color: ink, font: { family: "Arial", size: 25, weight: "bold" }, padding: { bottom: 9 } },
      subtitle: { display: true, text: subtitle, align: "start", color: "#66758B", font: { family: "Arial", size: 13 }, padding: { bottom: 22 } },
      legend: { position: "top", align: "start", labels: { color: ink, boxWidth: 16, boxHeight: 12, padding: 19, font: { family: "Arial", size: 13, weight: "bold" } } },
      tooltip: { enabled: false },
    },
    scales: {
      x: { beginAtZero: true, border: { display: false }, grid: { color: grid }, ticks: { color: "#66758B", font: { family: "Arial", size: 12 } } },
      y: { border: { display: false }, grid: { display: false }, ticks: { color: ink, font: { family: "Arial", size: 13 } } },
    },
  };
}

function dataset(label, data, color) {
  return { label, data, backgroundColor: color, borderRadius: 3, barPercentage: 0.83, categoryPercentage: 0.76 };
}

function conversion(capture, direction) {
  const options = base(
    `UTF-8 ${direction} throughput`,
    `${capture.host}  ·  ${capture.runtime}  ·  ${capture.date}  ·  three-run median  ·  higher is better`,
  );
  options.scales.x.title = { display: true, text: "GB/s of UTF-8 input", color: ink, font: { size: 13, weight: "bold" } };
  return {
    type: "bar",
    data: { labels: capture.rows.map((r) => r.payload.replace(/\.(html|txt)$/, "")), datasets: [
      dataset(`String.UTF8.${direction}`, capture.rows.map((r) => r[direction].stdlib), colors.stdlib),
      dataset(`utf-as UTF8.${direction}`, capture.rows.map((r) => r[direction].utfAs), colors.utfAs),
    ] },
    options,
  };
}

function validation(capture) {
  const options = base(
    "Unicode validation throughput",
    `${capture.host}  ·  ${capture.runtime}  ·  ${capture.date}  ·  three-run median  ·  higher is better`,
  );
  options.scales.x.title = { display: true, text: "GB/s of input bytes", color: ink, font: { size: 13, weight: "bold" } };
  return {
    type: "bar",
    data: { labels: capture.rows.map((r) => r.payload.replace(/\.(html|txt)$/, "")), datasets: [
      dataset("UTF8.validate · UTF-8 bytes", capture.rows.map((r) => r.validateUtf8), colors.utf8),
      dataset("UTF16.validate · UTF-16 bytes", capture.rows.map((r) => r.validateUtf16), colors.utf16),
    ] },
    options,
  };
}

function wideValidation(wide, encoding) {
  const options = base(
    `${encoding.toUpperCase()} validation latency · 4 KiB`,
    `${wide.host}  ·  ${wide.runtime}  ·  three-run median  ·  lower is better`,
    false,
  );
  options.scales.y = { type: "logarithmic", min: 0.08, max: encoding === "utf8" ? 30 : 5,
    border: { display: false }, grid: { color: (context) => [0.1, 0.3, 1, 3, 10, 30].includes(context.tick.value) ? grid : "transparent" },
    title: { display: true, text: "µs per call · logarithmic scale", color: ink, font: { size: 13, weight: "bold" } },
    ticks: { color: "#66758B", callback: (v) => [0.1, 0.3, 1, 3, 10, 30].includes(v) ? v : "" },
  };
  options.scales.x = { border: { display: false }, grid: { display: false }, ticks: { color: ink, font: { size: 14 } } };
  const names = ["SWAR", "v128", "Wide 256", "Wide 512"];
  const hues = [colors.swar, colors.v128, colors.wide256, colors.wide512];
  return {
    type: "bar",
    data: { labels: wide.rows.map((r) => r.input), datasets: names.map((name, i) => dataset(name, wide.rows.map((r) => r[encoding][i]), hues[i])) },
    options,
  };
}

const charts = captures.flatMap(({ arch, v8, wide }) => [
  [`utf8-decode-${arch}`, conversion(v8, "decode"), 1280, 830],
  [`utf8-encode-${arch}`, conversion(v8, "encode"), 1280, 830],
  [`validation-${arch}`, validation(v8), 1280, 830],
  [`wide-utf8-${arch}`, wideValidation(wide, "utf8"), 1100, 620],
  [`wide-utf16-${arch}`, wideValidation(wide, "utf16"), 1100, 620],
]);
for (const [name, config, width, height] of charts) {
  for (const type of ["svg", "png"]) {
    const canvas = new ChartJSNodeCanvas({ width, height, type, backgroundColour: "white" });
    const file = path.join(out, `${name}.${type}`);
    const renderConfig = { ...config, options: { ...config.options, devicePixelRatio: type === "png" ? 2 : 1 } };
    fs.writeFileSync(file, canvas.renderToBufferSync(renderConfig, type === "svg" ? "image/svg+xml" : "image/png"));
    console.log(path.relative(root, file));
  }
}
