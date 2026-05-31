// Department palette — kept within Brim's navy-to-white range: a cohesive
// family of blues, steels and teals so the data reads as one institutional
// brand. Warm hues are reserved for risk signaling elsewhere.
const PALETTE = [
  "#4f8df0", // azure
  "#7eb3ff", // sky
  "#2f6bff", // brand blue
  "#3fb6d8", // cyan
  "#8da6e0", // steel
  "#46c7a8", // teal
  "#5fa0e8", // cornflower
  "#a7c4f5", // pale blue
  "#356fd6", // royal navy
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
