import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { deptColor, fmtUSD } from "../theme";
import type { Severity } from "../data/intelligence";
import { TrendDownIcon, TrendUpIcon } from "./icons";

// ---------------------------------------------------------------------------
// Reusable, dependency-free chart + UI primitives shared across every view.
// ---------------------------------------------------------------------------

export interface Datum {
  label: string;
  value: number;
  color?: string;
}

/* ---------------------------------- StatCard ---------------------------------- */

export function StatCard({
  label,
  value,
  sub,
  accent,
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: string;
  icon?: ReactNode;
}) {
  const iconStyle = accent
    ? { color: accent, background: `color-mix(in srgb, ${accent} 14%, transparent)` }
    : undefined;

  return (
    <div className="stat-card">
      <div className="stat-card-top">
        <span className="stat-card-label">{label}</span>
        <span className="stat-card-icon" style={iconStyle} aria-hidden={!icon}>
          {icon}
        </span>
      </div>
      <div className="stat-card-body">
        <div className="stat-card-value" style={accent ? { color: accent } : undefined}>
          {value}
        </div>
        <div className="stat-card-sub">{sub ?? "\u00A0"}</div>
      </div>
    </div>
  );
}

/* ---------------------------------- TrendPill --------------------------------- */

export function TrendPill({ delta, suffix = "%" }: { delta: number; suffix?: string }) {
  const up = delta >= 0;
  return (
    <span className={`trend-pill ${up ? "up" : "down"}`}>
      {up ? <TrendUpIcon size={13} /> : <TrendDownIcon size={13} />}
      {Math.abs(delta).toFixed(1)}
      {suffix}
    </span>
  );
}

/* --------------------------------- SeverityBadge ------------------------------ */

const SEV_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`sev-badge sev-${severity}`}>{SEV_LABEL[severity]}</span>;
}

/* ---------------------------------- BarChart ---------------------------------- */

export function BarChart({
  data,
  format = "usd",
  orientation = "horizontal",
  height = 220,
  highlightLabel,
}: {
  data: Datum[];
  format?: "usd" | "number";
  orientation?: "horizontal" | "vertical";
  height?: number;
  highlightLabel?: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const fmtV = (n: number) => (format === "usd" ? fmtUSD(n) : n.toLocaleString());

  if (orientation === "vertical") {
    return (
      <div className="vbars" style={{ height }}>
        {data.map((d, i) => {
          const color = d.color ?? deptColor(d.label);
          const h = Math.max((d.value / max) * 100, 1.5);
          return (
            <div className="vbar-col" key={d.label + i} title={`${d.label}: ${fmtV(d.value)}`}>
              <div className="vbar-value">{fmtV(d.value)}</div>
              <div className="vbar-track">
                <motion.div
                  className="vbar-fill"
                  initial={{ height: 0 }}
                  animate={{ height: `${h}%` }}
                  transition={{ type: "spring", stiffness: 120, damping: 18, delay: i * 0.04 }}
                  style={{ background: `linear-gradient(180deg, ${color}, ${color}33)` }}
                />
              </div>
              <div className="vbar-label">{d.label}</div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="hbars">
      {data.map((d, i) => {
        const color = d.color ?? deptColor(d.label);
        const w = Math.max((d.value / max) * 100, 1.5);
        const hot = highlightLabel === d.label;
        return (
          <div className={`hbar-row ${hot ? "hot" : ""}`} key={d.label + i}>
            <div className="hbar-label">{d.label}</div>
            <div className="hbar-track">
              <motion.div
                className="hbar-fill"
                initial={{ width: 0 }}
                animate={{ width: `${w}%` }}
                transition={{ type: "spring", stiffness: 120, damping: 20, delay: i * 0.03 }}
                style={{ background: `linear-gradient(90deg, ${color}aa, ${color})` }}
              />
            </div>
            <div className="hbar-value">{fmtV(d.value)}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------- DonutChart -------------------------------- */

export function DonutChart({
  data,
  format = "usd",
}: {
  data: Datum[];
  format?: "usd" | "number";
}) {
  const total = data.reduce((s, d) => s + Math.max(d.value, 0), 0) || 1;
  const fmtV = (n: number) => (format === "usd" ? fmtUSD(n) : n.toLocaleString());

  let acc = 0;
  const segments = data.map((d) => {
    const start = (acc / total) * 360;
    acc += Math.max(d.value, 0);
    const end = (acc / total) * 360;
    return { ...d, start, end, color: d.color ?? deptColor(d.label) };
  });
  const gradient = segments
    .map((s) => `${s.color} ${s.start}deg ${s.end}deg`)
    .join(", ");

  return (
    <div className="donut-wrap">
      <div className="donut" style={{ background: `conic-gradient(${gradient})` }}>
        <div className="donut-hole">
          <span className="donut-total">{fmtV(total)}</span>
          <span className="donut-cap">total</span>
        </div>
      </div>
      <div className="donut-legend">
        {segments.slice(0, 8).map((s) => (
          <div className="legend-row" key={s.label}>
            <span className="legend-dot" style={{ background: s.color }} />
            <span className="legend-label">{s.label}</span>
            <span className="legend-value">{fmtV(s.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------- Sparkline ---------------------------------- */

export function Sparkline({
  values,
  color = "var(--accent)",
  height = 44,
  width = 140,
}: {
  values: number[];
  color?: string;
  height?: number;
  width?: number;
}) {
  if (values.length === 0) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = width / Math.max(values.length - 1, 1);
  const pts = values.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `0,${height} ${pts.join(" ")} ${width},${height}`;
  return (
    <svg width={width} height={height} className="sparkline">
      <polyline points={area} fill={color} opacity={0.12} stroke="none" />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={2} />
      <circle
        cx={(values.length - 1) * step}
        cy={height - ((values[values.length - 1] - min) / range) * height}
        r={3}
        fill={color}
      />
    </svg>
  );
}

/* ---------------------------------- Gauge ------------------------------------- */

export function BudgetGauge({
  pct,
  status,
}: {
  pct: number;
  status: "ok" | "risk" | "over";
}) {
  const color =
    status === "over" ? "var(--bad)" : status === "risk" ? "var(--warn)" : "var(--good)";
  const clamped = Math.min(pct, 1.15);
  return (
    <div className="gauge-track">
      <motion.div
        className="gauge-fill"
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(clamped * 100, 100)}%` }}
        transition={{ type: "spring", stiffness: 120, damping: 20 }}
        style={{ background: color }}
      />
      <div className="gauge-100" />
    </div>
  );
}

/* --------------------------------- DataTable ---------------------------------- */

export function DataTable({
  columns,
  rows,
  align,
}: {
  columns: string[];
  rows: ReactNode[][];
  align?: ("left" | "right")[];
}) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          {columns.map((c, i) => (
            <th key={c} style={{ textAlign: align?.[i] ?? "left" }}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri}>
            {row.map((cell, ci) => (
              <td key={ci} style={{ textAlign: align?.[ci] ?? "left" }}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ---------------------------------- Avatar ------------------------------------ */

export function Avatar({ name, hue, size = 40 }: { name: string; hue: number; size?: number }) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
  return (
    <div
      className="ui-avatar"
      style={{
        width: size,
        height: size,
        background: `hsl(${hue} 70% 68%)`,
        fontSize: size * 0.36,
        borderRadius: size * 0.3,
      }}
    >
      {initials}
    </div>
  );
}
