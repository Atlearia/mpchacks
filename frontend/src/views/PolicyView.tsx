import { useMemo, useState } from "react";
import { motion } from "framer-motion";
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
import { AlertIcon, SparkIcon } from "../components/icons";

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

function ViolationsTab() {
  const config = usePolicy((s) => s.config);
  const [filter, setFilter] = useState<Severity | "all">("all");
  const [brief, setBrief] = useState<PolicyBrief | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);

  const violations = useMemo(() => policyViolations(config), [config]);
  const stats = useMemo(() => violationStats(violations), [violations]);
  const offenders = useMemo(() => repeatOffenders(violations), [violations]);
  const spotlight = useMemo(
    () => violations.find((v) => v.type === "split_transaction"),
    [violations]
  );

  const filtered: Violation[] =
    filter === "all" ? violations : violations.filter((v) => v.severity === filter);

  const handleBrief = async () => {
    setBriefLoading(true);
    setBriefError(null);
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
      setBriefError("AI analysis unavailable — check that the backend is running.");
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

  return (
    <>
      <div className="kpi-row">
        <div className="stat-card">
          <div className="stat-card-label">Total Violations</div>
          <div className="stat-card-value">{stats.total}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Critical</div>
          <div className="stat-card-value" style={{ color: "var(--bad)" }}>
            {stats.bySeverity.critical}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">High</div>
          <div className="stat-card-value" style={{ color: "var(--warn)" }}>
            {stats.bySeverity.high}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Flagged Amount</div>
          <div className="stat-card-value">{fmtUSD(stats.flaggedAmount)}</div>
        </div>
      </div>

      {!brief && !briefLoading && (
        <motion.button
          className="ai-brief-btn"
          onClick={handleBrief}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <SparkIcon size={16} />
          Generate AI Policy Brief
          <span className="ai-brief-badge">Gemini 3.5 Flash</span>
        </motion.button>
      )}

      {briefLoading && (
        <div className="ai-brief-panel loading">
          <div className="typing">
            <span /><span /><span />
          </div>
          <span style={{ marginLeft: 12, fontSize: 13, color: "var(--text-dim)" }}>
            Analyzing {stats.total} violations with Gemini 3.5 Flash…
          </span>
        </div>
      )}

      {briefError && (
        <div className="ai-brief-panel error">
          <span>{briefError}</span>
          <button className="chip on" onClick={handleBrief} style={{ marginLeft: 12 }}>Retry</button>
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
              <span className="brief-title">AI Policy Brief</span>
              <span
                className="risk-badge"
                style={{ background: riskColors[brief.riskLevel] ?? "var(--text-dim)" }}
              >
                {brief.riskLevel.toUpperCase()} RISK
              </span>
            </div>
            <span className="ai-model-tag">Gemini 3.5 Flash</span>
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

      <div className="approvals-split">
        <div style={{ order: 2 }}>
          <div className="panel">
            <div className="panel-h">
              <h3>Repeat Offenders</h3>
              <span className="panel-sub">Ranked by risk</span>
            </div>
            {offenders.map((o, i) => (
              <div className="offender-row" key={o.employeeId}>
                <div className="offender-rank">{i + 1}</div>
                <div className="offender-body">
                  <div className="nm">{o.employeeName}</div>
                  <div className="mt">
                    {o.department} · {o.count} flags · mostly {o.topType}
                  </div>
                </div>
                <div className="offender-score">{o.riskScore}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ order: 1, gridColumn: "1 / 2" }}>
          {spotlight && (
            <motion.div
              className="panel spotlight"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ marginBottom: 16 }}
            >
              <div className="panel-h">
                <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <AlertIcon size={18} /> Split-Transaction Spotlight
                </h3>
                <SeverityBadge severity="critical" />
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{spotlight.title}</div>
              <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>
                {spotlight.detail}
              </div>
            </motion.div>
          )}

          <div className="panel">
            <div className="panel-h">
              <h3>Flagged Transactions</h3>
              <span className="panel-sub">{filtered.length} shown</span>
            </div>
            <div className="filter-bar">
              {FILTERS.map((f) => (
                <span
                  key={f.id}
                  className={`chip ${filter === f.id ? "on" : ""}`}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                </span>
              ))}
            </div>
            {filtered.slice(0, 60).map((v) => (
              <div className="violation-row" key={v.id}>
                <SeverityBadge severity={v.severity} />
                <div>
                  <div className="v-title">{v.title}</div>
                  <div className="v-detail">{v.detail}</div>
                </div>
                <div className="v-who">
                  {v.employeeName}
                  <div className="dept">{v.department}</div>
                </div>
                <div className="v-amt">{fmtUSD(v.amount)}</div>
              </div>
            ))}
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
