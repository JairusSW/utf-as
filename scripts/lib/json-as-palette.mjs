// Values copied from ../json-as/scripts/lib/palette.ts for overview bar charts.
export const BASE = {
  jungleGreen: "#44AF69",
  fadedCopper: "#9E7153",
  strawberryRed: "#F8333C",
  atomicTangerine: "#FA6F26",
  orange: "#FCAB10",
  palmLeaf: "#94A562",
  pacificBlue: "#2B9EB3",
  mutedTeal: "#83BAB4",
  sandDune: "#DBD5B5",
};

const RGB = {
  jungleGreen: "68,175,105",
  fadedCopper: "158,113,83",
  strawberryRed: "248,51,60",
  atomicTangerine: "250,111,38",
  orange: "252,171,16",
  palmLeaf: "148,165,98",
  pacificBlue: "43,158,179",
  mutedTeal: "131,186,180",
  sandDune: "219,213,181",
};

export const rgba = (name, alpha = 1) => `rgba(${RGB[name]},${alpha})`;

export const MODE_BARS = [
  { bg: rgba("strawberryRed", 0.85), border: BASE.strawberryRed },
  { bg: rgba("orange", 0.85), border: BASE.orange },
  { bg: rgba("jungleGreen", 0.85), border: BASE.jungleGreen },
  { bg: rgba("pacificBlue", 0.9), border: BASE.pacificBlue },
];

export const INK = {
  subtitle: "#6b7280",
  label: "#374151",
  grid: "rgba(0,0,0,0.08)",
};
