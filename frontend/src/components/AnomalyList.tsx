import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Anomaly } from "../data/intelligence";
import { fmtUSD } from "../theme";
import { SeverityBadge } from "./charts";
import { ChevronDownIcon, SparkIcon } from "./icons";

const TYPE_TONE: Record<string, string> = {
  "Duplicate charge": "critical",
  "Statistical outlier": "warn",
  "Velocity spike": "bad",
  "Round amount": "neutral",
  "Cross-border": "bad",
  "Weekend spend": "neutral",
  "Geo mismatch": "warn",
  "Month-end surge": "warn",
};

const DISPOSITION: Record<
  Anomaly["severity"],
  { label: string; className: string }
> = {
  critical: { label: "Escalate immediately", className: "rec-deny" },
  high: { label: "Investigate", className: "rec-deny" },
  medium: { label: "Manual review", className: "rec-review" },
  low: { label: "Monitor", className: "rec-approve" },
};

function AnomalyTypeBadge({ label }: { label: string }) {
  const tone = TYPE_TONE[label] ?? "neutral";
  return <span className={`anomaly-type-badge tone-${tone}`}>{label}</span>;
}

function aiSummaryBullets(anomaly: Anomaly): string[] {
  const bullets = [anomaly.detail];
  for (const ind of anomaly.indicators.slice(0, 2)) {
    bullets.push(`${ind.label}: ${ind.value}`);
  }
  return bullets;
}

function AnomalyCard({
  anomaly,
  expanded,
  onToggle,
}: {
  anomaly: Anomaly;
  expanded: boolean;
  onToggle: () => void;
}) {
  const disposition = DISPOSITION[anomaly.severity];

  return (
    <motion.div
      className={`anomaly-card ${expanded ? "expanded" : ""}`}
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <div className="anomaly-card-top">
        <div className={`anomaly-card-icon ${anomaly.severity}`}>
          <SparkIcon size={15} />
        </div>
        <div className="anomaly-card-main">
          <div className="anomaly-card-title-row">
            <div className="anomaly-card-title">{anomaly.title}</div>
            <AnomalyTypeBadge label={anomaly.typeLabel} />
          </div>
          <div className="anomaly-card-meta">
            <span>{anomaly.employeeName}</span>
            <span className="anomaly-card-dot">·</span>
            <span>{fmtUSD(anomaly.amount)}</span>
            <span className="anomaly-card-dot">·</span>
            <span>{anomaly.date}</span>
          </div>
        </div>
        <div className="anomaly-card-right">
          <SeverityBadge severity={anomaly.severity} />
          <ChevronDownIcon
            size={14}
            className={`anomaly-chevron ${expanded ? "open" : ""}`}
          />
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            className="anomaly-card-detail"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="anomaly-detail-inner">
              <div className="rec-card anomaly-rec-summary">
                <div className="rec-head">
                  <SparkIcon size={16} />
                  <span className="lab">AI Summary</span>
                  <span className="conf">Risk {anomaly.riskScore}/100</span>
                </div>
                <div className="rec-reasons">
                  {aiSummaryBullets(anomaly).map((line, i) => (
                    <div className="rec-reason" key={i}>
                      <span className="dot">•</span>
                      {line}
                    </div>
                  ))}
                </div>
              </div>

              <div className="rec-card rec-card--action anomaly-rec-action">
                <div className="rec-head">
                  <SparkIcon size={16} />
                  <span className="lab">Recommendation</span>
                  <span className={`rec-tag ${disposition.className}`}>
                    {disposition.label}
                  </span>
                </div>
                <p className="anomaly-rec-text">{anomaly.recommendedAction}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function AnomalyList({
  items,
  limit,
}: {
  items: Anomaly[];
  limit?: number;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const shown = limit ? items.slice(0, limit) : items;

  if (shown.length === 0) {
    return (
      <div className="anomaly-empty">
        <SparkIcon size={24} />
        <p>No anomalies detected</p>
        <span>Transaction patterns look normal against fraud monitoring rules</span>
      </div>
    );
  }

  return (
    <div className="anomaly-list">
      {shown.map((a) => (
        <AnomalyCard
          key={a.id}
          anomaly={a}
          expanded={expandedId === a.id}
          onToggle={() => setExpandedId(expandedId === a.id ? null : a.id)}
        />
      ))}
    </div>
  );
}
