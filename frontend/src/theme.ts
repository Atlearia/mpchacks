// Accent palette reused across the 3D + 2D views.
const PALETTE = [
  "#6ea8fe", // blue
  "#f5a97f", // orange
  "#f38ba8", // pink
  "#a6da95", // green
  "#eed49f", // amber
  "#8bd5ca", // teal
  "#c6a0f6", // violet
  "#f0c6c6", // rose
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
