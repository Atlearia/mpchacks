import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Anomaly } from "../data/intelligence";
import { TRANSACTIONS } from "../data/dataset";
import { employeeById } from "../data/selectors";
import { fmtUSD } from "../theme";
import { Avatar, SeverityBadge } from "./charts";
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

function AnomalyTypeBadge({ label }: { label: string }) {
  const tone = TYPE_TONE[label] ?? "neutral";
  return <span className={`anomaly-type-badge tone-${tone}`}>{label}</span>;
}

function RelatedTxns({ ids }: { ids: string[] }) {
  const txns = ids
    .map((id) => TRANSACTIONS.find((t) => t.id === id))
    .filter(Boolean)
    .slice(0, 4);

  if (txns.length === 0) return null;

  return (
    <div className="anomaly-txn-block">
      <div className="anomaly-txn-label">Related transactions</div>
      <div className="anomaly-txn-list">
        {txns.map((t) => (
          <div className="anomaly-txn-row" key={t!.id}>
            <span className="anomaly-txn-date">{t!.transactionDate}</span>
            <span className="anomaly-txn-merchant">{t!.merchantName}</span>
            <span className="anomaly-txn-amt">{fmtUSD(t!.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
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
  const emp = employeeById(anomaly.employeeId);

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
          <span className="anomaly-risk-score">{anomaly.riskScore}</span>
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
              <div className="anomaly-detail-hero">
                <Avatar name={anomaly.employeeName} hue={emp?.avatarHue ?? 220} size={40} />
                <div>
                  <div className="anomaly-detail-who">{anomaly.employeeName}</div>
                  <div className="anomaly-detail-sub">
                    {anomaly.department} · {anomaly.merchantName}
                  </div>
                </div>
                <div className="anomaly-detail-amt">{fmtUSD(anomaly.amount)}</div>
              </div>

              <p className="anomaly-detail-text">{anomaly.detail}</p>

              <div className="anomaly-indicators">
                {anomaly.indicators.map((ind) => (
                  <div className="anomaly-indicator" key={ind.label}>
                    <span className="anomaly-indicator-label">{ind.label}</span>
                    <span className="anomaly-indicator-value">{ind.value}</span>
                  </div>
                ))}
              </div>

              <RelatedTxns ids={anomaly.txnIds} />

              <div className="anomaly-action-callout">
                <strong>Recommended action</strong>
                <p>{anomaly.recommendedAction}</p>
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
