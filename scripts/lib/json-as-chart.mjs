// JavaScript port of generateChart in ../json-as/scripts/lib/bench-utils.ts.
// The rendering logic is unchanged; syntax and import paths suit this Node repo.
import fs from "node:fs";
import { ChartJSNodeCanvas } from "chartjs-node-canvas";
import { withAdaptiveLogScale } from "./chart-outliers.mjs";
import { MODE_BARS, INK } from "./json-as-palette.mjs";

// JavaScript port of createBarChart in ../json-as/scripts/lib/bench-utils.ts.
export function createBarChart(data, payloadLabels, options) {
  const payloadKeys = Object.keys(data);
  const labels = payloadKeys.map((k) => payloadLabels[k] ?? k);

  const maxMBps = Math.max(
    ...Object.values(data)
      .flat()
      .map((r) => r.mbps),
  );

  const yStep = options.yStep ?? 500;
  const rotated = Math.abs(options.labelRotation ?? 0) >= 45;
  const headroom = rotated ? maxMBps * 0.18 + yStep : yStep / 2;
  const yMax = Math.ceil((maxMBps + headroom) / yStep) * yStep;

  const datasetNames = options.datasetLabels ?? [
    "Built-in JSON (JS)",
    "JSON-AS (NAIVE)",
    "JSON-AS (SWAR)",
    "JSON-AS (SIMD)",
  ];

  const palette = options.colors ?? MODE_BARS;
  const numDatasets = Math.max(...payloadKeys.map((k) => data[k].length));

  return {
    type: "bar",
    data: {
      labels,
      datasets: Array.from({ length: numDatasets }, (_, i) => ({
        label: datasetNames[i] ?? `Series ${i + 1}`,
        data: payloadKeys.map((k) => data[k][i]?.mbps ?? 0),
        backgroundColor: palette[i % palette.length].bg,
        borderColor: palette[i % palette.length].border,
        borderWidth: !options.colors && i === 3 ? 2 : 1,
      })),
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: !!options.title,
          text: options.title,
          font: { size: 20, weight: "bold" },
        },
        legend: {
          position: "top",
          labels: {
            font: { size: 16, weight: "bold" },
            padding: 20,
          },
        },
        datalabels: {
          anchor: options.labelAnchor ?? "end",
          align: "end",
          rotation: options.labelRotation ?? 0,
          font: { weight: "bold", size: options.labelFontSize ?? 12 },
          formatter: (v) => Math.round(v).toLocaleString("en-US"),
        },
        subtitle: {
          display: true,
          text: "",
          font: { size: 14, weight: "bold" },
          color: INK.subtitle,
          padding: 16,
          position: "right",
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          max: yMax,
          title: {
            display: true,
            text: options.yLabel ?? "Throughput (MB/s)",
            font: { size: 16, weight: "bold" },
          },
          ticks: {
            stepSize: yStep,
            font: { size: 14, weight: "bold" },
          },
        },
        x: {
          title: {
            display: true,
            text: options.xLabel ?? "Payload",
            font: { size: 16, weight: "bold" },
          },
          ticks: {
            maxRotation: 0,
            minRotation: 0,
            font: { size: 14, weight: "bold" },
          },
        },
      },
    },
  };
}

export function generateChart(config, outfile, dims) {
  const isSvg = outfile.endsWith(".svg");

  config = withAdaptiveLogScale(config);

  // SVG is resolution-independent (dpr 1); PNG renders at 3x density so the
  // logical 1000x600 layout becomes a crisp 3000x1800 raster.
  config = {
    ...config,
    options: { ...(config.options ?? {}), devicePixelRatio: isSvg ? 1 : 3 },
  };

  // Strip any inline datalabels plugin instance a caller added to its config:
  // it's the shared module instance, and reusing it across renders is exactly
  // the stale-state bug we avoid by registering a fresh copy per render (below).
  if (Array.isArray(config.plugins)) {
    const kept = config.plugins.filter((p) => p?.id !== "datalabels");
    config = { ...config, plugins: kept.length ? kept : undefined };
  }

  const canvas = new ChartJSNodeCanvas({
    width: dims?.width ?? 1000,
    height: dims?.height ?? 600,
    type: isSvg ? "svg" : "png",
    // Register chartjs-plugin-datalabels through the `modern` option so
    // chartjs-node-canvas freshRequire()s a CLEAN copy of the plugin per render.
    // The plugin holds mutable module-level state that, reused across renders in
    // one process, collapses rotated value labels onto the x-axis baseline on
    // every render after the first - which is why the serialize chart (rendered
    // after the deserialize one) had its labels stuck at the bottom while
    // deserialize looked fine. A fresh module each render sidesteps it; no dpr or
    // anchor-flip workarounds needed.
    plugins: { modern: ["chartjs-plugin-datalabels"] },
  });

  const buffer = canvas.renderToBufferSync(
    config,
    isSvg ? "image/svg+xml" : "image/png",
  );

  fs.writeFileSync(outfile, buffer);
  console.log(`> ${outfile}`);
}
