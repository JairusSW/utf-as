// JavaScript port of ../json-as/scripts/lib/chart-outliers.ts.
// Keep the scale decision identical to json-as's chart generator.

function quantile(sorted, percentile) {
  const position = (sorted.length - 1) * percentile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
}

export function detectExtremeUpperTail(input) {
  const values = input
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  if (values.length < 6) return null;

  const q1 = quantile(values, 0.25);
  const median = quantile(values, 0.5);
  const q3 = quantile(values, 0.75);
  const iqr = q3 - q1;

  const deviations = values
    .map((value) => Math.abs(value - median))
    .sort((a, b) => a - b);
  const mad = quantile(deviations, 0.5);

  const fences = [];
  if (iqr > 0) fences.push(q3 + 3 * iqr);
  if (mad > 0) fences.push(median + 6 * mad);

  if (fences.length === 0 && median > 0) fences.push(median * 4);
  if (fences.length === 0) return null;

  const fence = Math.min(...fences);
  const firstOutlierIndex = values.findIndex((value) => value > fence);
  if (firstOutlierIndex <= 0) return null;

  const outlierCount = values.length - firstOutlierIndex;
  if (outlierCount / values.length > 0.2) return null;

  const normalMax = values[firstOutlierIndex - 1];
  const firstOutlier = values[firstOutlierIndex];
  if (firstOutlier / normalMax < 1.35) return null;

  return { firstOutlier, outlierCount };
}

function objectRecord(value) {
  return value && typeof value === "object" ? value : {};
}

function measuredValue(point, horizontal) {
  if (typeof point === "number" && Number.isFinite(point)) return point;
  if (!point || typeof point !== "object") return null;
  const key = horizontal ? "x" : "y";
  const value = point[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function axisTitleWithLogScale(title) {
  const record = objectRecord(title);
  if (!record.text) return title;
  const text = String(record.text);
  return text.includes("log10 scale")
    ? title
    : { ...record, text: `${text} · log10 scale` };
}

function logTickLabel(value) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  const magnitude = 10 ** Math.floor(Math.log10(numeric));
  const mantissa = numeric / magnitude;
  const major = [1, 2, 5].some(
    (candidate) => Math.abs(mantissa - candidate) < 1e-8,
  );
  return major ? numeric.toLocaleString("en-US") : "";
}

export function withAdaptiveLogScale(config, force = false) {
  const source = config;
  const type = source.type;
  if (type !== "bar" && type !== "line") return config;

  const data = objectRecord(source.data);
  const datasets = Array.isArray(data.datasets) ? data.datasets : [];
  const options = objectRecord(source.options);
  const horizontal = type === "bar" && options.indexAxis === "y";
  const values = datasets.flatMap((dataset) =>
    (dataset.data ?? [])
      .map((point) => measuredValue(point, horizontal))
      .filter((value) => value !== null && value > 0),
  );
  if (values.length === 0) return config;
  if (!force && !detectExtremeUpperTail(values)) return config;

  const scales = objectRecord(options.scales);
  const axisKey = horizontal ? "x" : "y";
  const axis = objectRecord(scales[axisKey]);
  // A chart that selects its axis type explicitly opts out of auto scaling.
  if (axis.type) return config;
  const ticks = objectRecord(axis.ticks);
  const maxValue = Math.max(...values);
  const logarithmicAxis = {
    ...axis,
    type: "logarithmic",
    beginAtZero: false,
    grace: "10%",
    suggestedMax: maxValue * (horizontal ? 2 : 1.25),
    title: axisTitleWithLogScale(axis.title),
    ticks: { ...ticks, callback: logTickLabel },
  };

  delete logarithmicAxis.max;
  delete logarithmicAxis.ticks.stepSize;

  return {
    ...source,
    options: {
      ...options,
      scales: { ...scales, [axisKey]: logarithmicAxis },
    },
  };
}
