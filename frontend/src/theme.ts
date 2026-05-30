import { DEPARTMENTS } from "./data/generate";

// One stable accent color per department, reused across 3D + 2D views.
const PALETTE = [
  "#6ea8fe", // Engineering - blue
  "#f5a97f", // Sales - orange
  "#f38ba8", // Marketing - pink
  "#a6da95", // Operations - green
  "#eed49f", // Finance - amber
  "#8bd5ca", // Customer Success - teal
  "#c6a0f6", // Product - violet
  "#f0c6c6", // People Ops - rose
];

export const DEPT_COLORS: Record<string, string> = Object.fromEntries(
  DEPARTMENTS.map((d, i) => [d, PALETTE[i % PALETTE.length]])
);

export function deptColor(dept: string): string {
  return DEPT_COLORS[dept] ?? "#9aa5ce";
}

export const fmtUSD = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export const fmtUSDc = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
