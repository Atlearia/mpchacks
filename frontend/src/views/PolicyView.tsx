import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePolicy } from "../data/policy";
import { DEPARTMENTS, TRANSACTIONS } from "../data/dataset";
import {
  policyViolations,
  repeatOffenders,
  violationStats,
  type Severity,
  type Violation,
} from "../data/intelligence";
import { fetchPolicyBrief, type PolicyBrief } from "../data/ai";
import { fmtUSD } from "../theme";
import { SeverityBadge } from "../components/charts";
import { SparkIcon } from "../components/icons";

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <div className={`toggle ${on ? "on" : ""}`} onClick={onClick}>
      <div className="knob" />
    </div>
  );
}

function topMerchants(n = 14): string[] {
  const map = new Map<string, number>();
  for (const t of TRANSACTIONS) {
    if (t.debitOrCredit !== "Debit") continue;
    map.set(t.merchantName, (map.get(t.merchantName) ?? 0) + t.amount);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([m]) => m);
}

function RulesTab() {
  const { config } = usePolicy();
  const setApprovalThreshold = usePolicy((s) => s.setApprovalThreshold);
  const setSoloMealLimit = usePolicy((s) => s.setSoloMealLimit);
  const setReceiptRequiredAbove = usePolicy((s) => s.setReceiptRequiredAbove);
  const setDepartmentBudget = usePolicy((s) => s.setDepartmentBudget);
  const setCategoryLimit = usePolicy((s) => s.setCategoryLimit);
  const toggleCategoryLimit = usePolicy((s) => s.toggleCategoryLimit);
  const toggleAllowedCategory = usePolicy((s) => s.toggleAllowedCategory);
  const toggleRestrictedMerchant = usePolicy((s) => s.toggleRestrictedMerchant);
  const reset = usePolicy((s) => s.reset);

  const merchants = useMemo(() => topMerchants(), []);

  return (
    <div className="rule-grid">
      <div className="panel">
        <div className="panel-h">
          <h3>Spend Thresholds</h3>
          <span className="panel-sub" style={{ cursor: "pointer" }} onClick={reset}>
            Reset defaults
          </span>
        </div>
        <div className="rule-row">
          <div className="rule-label">
            Pre-approval threshold
            <div className="rule-hint">Any single charge at/above needs sign-off</div>
          </div>
          <div className="rule-input">
            <span>$</span>
            <input
              type="number"
              value={config.approvalThreshold}
              onChange={(e) => setApprovalThreshold(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="rule-row">
          <div className="rule-label">
            Solo meal limit
            <div className="rule-hint">Team meals get more headroom (AI context-aware)</div>
          </div>
          <div className="rule-input">
            <span>$</span>
            <input
              type="number"
              value={config.soloMealLimit}
              onChange={(e) => setSoloMealLimit(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="rule-row">
          <div className="rule-label">
            Receipt required above
            <div className="rule-hint">Charges over this need an attached receipt</div>
          </div>
          <div className="rule-input">
            <span>$</span>
            <input
              type="number"
              value={config.receiptRequiredAbove}
              onChange={(e) => setReceiptRequiredAbove(Number(e.target.value))}
            />
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-h">
          <h3>Department Monthly Budgets</h3>
        </div>
        {DEPARTMENTS.map((dept) => (
          <div className="rule-row" key={dept}>
            <div className="rule-label">{dept}</div>
            <div className="rule-input">
              <span>$</span>
              <input
                type="number"
                step={500}
                value={config.departmentBudgets[dept] ?? 0}
                onChange={(e) => setDepartmentBudget(dept, Number(e.target.value))}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="panel">
        <div className="panel-h">
          <h3>Per-Category Transaction Caps</h3>
        </div>
        {config.categoryLimits.map((c) => (
          <div className="rule-row" key={c.category}>
            <div className="rule-label" style={{ flex: 1 }}>
              {c.category}
              <div className="rule-hint">{fmtUSD(c.perTransaction)} per transaction</div>
            </div>
            <input
              type="range"
              min={50}
              max={5000}
              step={50}
              value={c.perTransaction}
              disabled={!c.enabled}
              onChange={(e) => setCategoryLimit(c.category, Number(e.target.value))}
            />
            <Toggle on={c.enabled} onClick={() => toggleCategoryLimit(c.category)} />
          </div>
        ))}
      </div>

      <div className="row-gap">
        <div className="panel">
          <div className="panel-h">
            <h3>Allowed Categories</h3>
            <span className="panel-sub">Toggle off to restrict</span>
          </div>
          <div className="chip-set">
            {config.categoryLimits.map((c) => {
              const on = config.allowedCategories.includes(c.category);
              return (
                <span
                  className={`chip ${on ? "on" : ""}`}
                  key={c.category}
                  onClick={() => toggleAllowedCategory(c.category)}
                >
                  {c.category}
                </span>
              );
            })}
          </div>
        </div>

        <div className="panel">
          <div className="panel-h">
            <h3>Restricted Merchants</h3>
            <span className="panel-sub">Charges here get flagged</span>
          </div>
          <div className="chip-set">
            {merchants.map((m) => {
              const on = config.restrictedMerchants.includes(m);
              return (
                <span
                  className={`chip danger ${on ? "on" : ""}`}
                  key={m}
                  onClick={() => toggleRestrictedMerchant(m)}
                >
                  {m}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

const FILTERS: { id: Severity | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "critical", label: "Critical" },
  { id: "high", label: "High" },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" },
];

/* Compact violation type icon — replaces the full-width severity badge in the row */
function ViolationTypeIcon({ type }: { type: string }) {
  const icons: Record<string, string> = {
    split_transaction: "✂",
    restricted_merchant: "🚫",
    disallowed_category: "⛔",
    over_limit: "📈",
    needs_approval: "🔒",
    missing_receipt: "📄",
  };
  return <span className="viol-type-icon">{icons[type] ?? "⚠"}</span>;
}

function ViolationsTab() {
  const config = usePolicy((s) => s.config);
  const [filter, setFilter] = useState<Severity | "all">("all");
  const [brief, setBrief] = useState<PolicyBrief | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const violations = useMemo(() => policyViolations(config), [config]);
  const stats = useMemo(() => violationStats(violations), [violations]);
  const offenders = useMemo(() => repeatOffenders(violations), [violations]);

  const filtered: Violation[] =
    filter === "all" ? violations : violations.filter((v) => v.severity === filter);

  const handleBrief = async () => {
    setBriefLoading(true);
    try {
      const top = violations.slice(0, 30).map((v) => ({
        type: v.type,
        severity: v.severity,
        employeeName: v.employeeName,
        department: v.department,
        amount: v.amount,
        merchantName: v.merchantName,
        title: v.title,
        detail: v.detail,
      }));
      const result = await fetchPolicyBrief(top);
      setBrief(result);
    } catch {
      /* brief unavailable — user can retry via Generate Policy Brief */
    } finally {
      setBriefLoading(false);
    }
  };

  const riskColors: Record<string, string> = {
    critical: "var(--bad)",
    elevated: "var(--warn)",
    moderate: "#e0c040",
    healthy: "var(--good)",
  };

  /* Severity counts for filter chips */
  const sevCounts: Record<string, number> = {
    all: violations.length,
    critical: stats.bySeverity.critical,
    high: stats.bySeverity.high,
    medium: stats.bySeverity.medium,
    low: stats.bySeverity.low,
  };

  return (
    <>
      {/* ── KPI summary row ── */}
      <div className="kpi-row policy-kpi-row">
        <div className="stat-card policy-kpi critical-kpi">
          <div className="stat-card-label">Critical</div>
          <div className="stat-card-value" style={{ color: "var(--bad)" }}>
            {stats.bySeverity.critical}
          </div>
          <div className="stat-card-sub">Immediate action required</div>
        </div>
        <div className="stat-card policy-kpi high-kpi">
          <div className="stat-card-label">High</div>
          <div className="stat-card-value" style={{ color: "var(--warn)" }}>
            {stats.bySeverity.high}
          </div>
          <div className="stat-card-sub">Review needed</div>
        </div>
        <div className="stat-card policy-kpi">
          <div className="stat-card-label">Total Violations</div>
          <div className="stat-card-value">{stats.total}</div>
          <div className="stat-card-sub">Across all severity levels</div>
        </div>
        <div className="stat-card policy-kpi">
          <div className="stat-card-label">Flagged Amount</div>
          <div className="stat-card-value">{fmtUSD(stats.flaggedAmount)}</div>
          <div className="stat-card-sub">Combined value at risk</div>
        </div>
      </div>

      {/* ── AI Policy Brief ── */}
      {!brief && !briefLoading && (
        <motion.button
          className="ai-brief-btn"
          onClick={handleBrief}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <SparkIcon size={16} />
          Generate Policy Brief
        </motion.button>
      )}

      {briefLoading && (
        <div className="ai-brief-panel loading">
          <div className="typing">
            <span /><span /><span />
          </div>
          <span style={{ marginLeft: 12, fontSize: 13, color: "var(--text-dim)" }}>
            Analyzing {stats.total} violations…
          </span>
        </div>
      )}

      {brief && (
        <motion.div
          className="ai-brief-panel"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="brief-header">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <SparkIcon size={16} />
              <span className="brief-title">Policy Brief</span>
              <span
                className="risk-badge"
                style={{ background: riskColors[brief.riskLevel] ?? "var(--text-dim)" }}
              >
                {brief.riskLevel.toUpperCase()} RISK
              </span>
            </div>
          </div>
          <div className="brief-headline">{brief.headline}</div>
          <div className="brief-narrative">{brief.narrative}</div>
          {brief.topActions.length > 0 && (
            <div className="brief-actions">
              <div className="brief-actions-title">Priority Actions</div>
              {brief.topActions.map((a, i) => (
                <div className="brief-action" key={i}>
                  <span className="brief-action-num">{a.priority}</span>
                  <div>
                    <div className="brief-action-text">{a.action}</div>
                    <div className="brief-action-impact">{a.impact}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {brief.trendInsight && (
            <div className="brief-trend">{brief.trendInsight}</div>
          )}
        </motion.div>
      )}

      {/* ── Main content: Violations + Offenders side-by-side ── */}
      <div className="policy-layout">
        {/* Left: Flagged transactions list */}
        <div className="policy-main-col">
          <div className="panel viol-panel">
            <div className="panel-h">
              <h3>Flagged Transactions</h3>
              <span className="panel-sub">{filtered.length} shown</span>
            </div>

            {/* Filter bar with counts */}
            <div className="filter-bar">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  className={`viol-filter-chip ${filter === f.id ? "active" : ""}`}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                  <span className="viol-filter-count">{sevCounts[f.id]}</span>
                </button>
              ))}
            </div>

            {/* Violation list */}
            <div className="viol-list">
              <AnimatePresence initial={false}>
                {filtered.slice(0, 60).map((v) => {
                  const isExpanded = expandedId === v.id;
                  return (
                    <motion.div
                      className={`viol-card ${isExpanded ? "expanded" : ""}`}
                      key={v.id}
                      layout
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.15 }}
                      onClick={() => setExpandedId(isExpanded ? null : v.id)}
                    >
                      <div className="viol-card-top">
                        <ViolationTypeIcon type={v.type} />
                        <div className="viol-card-main">
                          <div className="viol-card-title">{v.title}</div>
                          <div className="viol-card-meta">
                            <span className="viol-card-who">{v.employeeName}</span>
                            <span className="viol-card-dept">{v.department}</span>
                          </div>
                        </div>
                        <div className="viol-card-right">
                          <div className="viol-card-amt">{fmtUSD(v.amount)}</div>
                          <SeverityBadge severity={v.severity} />
                        </div>
                      </div>
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            className="viol-card-detail"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                          >
                            <div className="viol-detail-inner">
                              <div className="viol-detail-text">{v.detail}</div>
                              <div className="viol-detail-meta">
                                <span>📅 {v.date}</span>
                                <span>🏪 {v.merchantName}</span>
                                <span>📂 {v.typeLabel}</span>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              {filtered.length === 0 && (
                <div className="viol-empty">
                  <span>✅</span>
                  <p>No violations match this filter</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Repeat offenders sidebar */}
        <div className="policy-side-col">
          <div className="panel offender-panel">
            <div className="panel-h">
              <h3>Repeat Offenders</h3>
              <span className="panel-sub">Ranked by risk</span>
            </div>
            <div className="offender-list">
              {offenders.map((o, i) => {
                const maxScore = offenders[0]?.riskScore ?? 1;
                const pct = Math.round((o.riskScore / maxScore) * 100);
                return (
                  <div className="offender-card" key={o.employeeId}>
                    <div className="offender-card-top">
                      <div className="offender-rank-badge">
                        {i + 1}
                      </div>
                      <div className="offender-info">
                        <div className="offender-name">{o.employeeName}</div>
                        <div className="offender-dept">{o.department}</div>
                      </div>
                      <div className="offender-risk-score">{o.riskScore}</div>
                    </div>
                    <div className="offender-details">
                      <span>{o.count} flags</span>
                      <span className="offender-dot">·</span>
                      <span>{o.topType}</span>
                    </div>
                    <div className="offender-bar-track">
                      <motion.div
                        className="offender-bar-fill"
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.6, delay: i * 0.05 }}
                        style={{
                          background: pct > 80 ? "var(--bad)" : pct > 50 ? "var(--warn)" : "var(--accent)",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default function PolicyView() {
  const [tab, setTab] = useState<"rules" | "violations">("violations");
  const config = usePolicy((s) => s.config);
  const violationCount = useMemo(() => policyViolations(config).length, [config]);

  return (
    <div className="view">
      <div className="view-inner">
        <div className="tabs">
          <div className={`tab ${tab === "violations" ? "active" : ""}`} onClick={() => setTab("violations")}>
            Violations
            <span className="tab-count">{violationCount}</span>
          </div>
          <div className={`tab ${tab === "rules" ? "active" : ""}`} onClick={() => setTab("rules")}>
            Policy Rules
          </div>
        </div>

        {tab === "rules" ? <RulesTab /> : <ViolationsTab />}
      </div>
    </div>
  );
}
