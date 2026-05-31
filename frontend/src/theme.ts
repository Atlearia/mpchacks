// Department palette — distinct, vivid hues so each department is instantly
// recognizable. Deliberately skips pure green/red, which are reserved for the
// budget-health gradient on the 3D nodes (so the two encodings never clash).
const PALETTE = [
  "#5b9dff", // bright blue
  "#a78bfa", // violet
  "#ffb454", // amber
  "#22d3ee", // cyan
  "#f472b6", // pink
  "#818cf8", // indigo
  "#fb923c", // orange
  "#38bdf8", // sky
  "#c084fc", // purple
];

// Hash the department name to a palette slot so every department keeps a
// stable color regardless of when the (async) dataset finishes loading.
function hashIndex(name: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % mod;
}

export function deptColor(dept: string): string {
  if (!dept) return "#9aa5ce";
  return PALETTE[hashIndex(dept, PALETTE.length)];
}

export const fmtUSD = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export const fmtUSDc = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
