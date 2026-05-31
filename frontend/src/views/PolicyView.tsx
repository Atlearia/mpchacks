import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePolicy } from "../data/policy";
import { DEPARTMENTS } from "../data/dataset";
import {
  policyViolations,
  repeatOffenders,
  violationStats,
  type Severity,
  type Violation,
} from "../data/intelligence";
import { employeeById } from "../data/selectors";
import { fmtUSD } from "../theme";
import { Avatar, SeverityBadge } from "../components/charts";
import { AlertIcon, DocIcon, ShieldIcon } from "../components/icons";

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      className={`toggle ${on ? "on" : ""}`}
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
    >
      <div className="knob" />
    </button>
  );
}

function SettingField({
  label,
  hint,
  value,
  onChange,
  step,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <div className="setting-field">
      <div className="setting-field-label">
        <span>{label}</span>
        {hint && <span className="setting-field-hint">{hint}</span>}
      </div>
      <div className="rule-input">
        <span className="rule-input-prefix">$</span>
        <input
          type="number"
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
    </div>
  );
}

function RulesTab() {
  const { config } = usePolicy();
  const setApprovalThreshold = usePolicy((s) => s.setApprovalThreshold);
  const setSoloMealLimit = usePolicy((s) => s.setSoloMealLimit);
  const setReceiptRequiredAbove = usePolicy((s) => s.setReceiptRequiredAbove);
  const setDepartmentBudget = usePolicy((s) => s.setDepartmentBudget);
  const setCategoryLimit = usePolicy((s) => s.setCategoryLimit);
  const toggleCategoryLimit = usePolicy((s) => s.toggleCategoryLimit);
  const reset = usePolicy((s) => s.reset);

  const activeRules = config.categoryLimits.filter((c) => c.enabled).length;

  return (
    <div className="policy-rules">
      <div className="policy-rules-header">
        <div>
          <h2 className="policy-rules-title">Expense Policy Configuration</h2>
          <p className="policy-rules-desc">
            Adjust thresholds, budgets, and restrictions. Changes apply instantly to the violation
            engine.
          </p>
        </div>
        <button type="button" className="policy-reset-btn" onClick={reset}>
          Reset to defaults
        </button>
      </div>

      <div className="policy-rules-summary">
        <div className="policy-rules-stat">
          <span className="policy-rules-stat-val">{activeRules}</span>
          <span className="policy-rules-stat-lbl">Active rules</span>
        </div>
        <div className="policy-rules-stat">
          <span className="policy-rules-stat-val">{DEPARTMENTS.length}</span>
          <span className="policy-rules-stat-lbl">Dept budgets</span>
        </div>
      </div>

      <div className="policy-rules-grid">
        <div className="panel policy-rules-panel">
          <div className="panel-h">
            <div className="panel-h-left">
              <span className="panel-icon"><ShieldIcon size={16} /></span>
              <div>
                <h3>Spend Thresholds</h3>
                <span className="panel-desc">Single-transaction limits and approval gates</span>
              </div>
            </div>
          </div>
          <div className="setting-fields">
            <SettingField
              label="Pre-approval threshold"
              hint="Any charge at or above requires manager sign-off"
              value={config.approvalThreshold}
              onChange={setApprovalThreshold}
            />
            <SettingField
              label="Per-employee expense cap"
              hint="Single charges above this are flagged for policy review"
              value={config.soloMealLimit}
              onChange={setSoloMealLimit}
            />
            <SettingField
              label="Receipt required above"
              hint="Charges over this amount need an attached receipt"
              value={config.receiptRequiredAbove}
              onChange={setReceiptRequiredAbove}
            />
          </div>
        </div>

        <div className="panel policy-rules-panel">
          <div className="panel-h">
            <div className="panel-h-left">
              <span className="panel-icon"><DocIcon size={16} /></span>
              <div>
                <h3>Department Monthly Budgets</h3>
                <span className="panel-desc">Monthly spend ceilings by department</span>
              </div>
            </div>
          </div>
          <div className="dept-budget-grid">
            {DEPARTMENTS.map((dept) => (
              <div className="dept-budget-item" key={dept}>
                <label className="dept-budget-name">{dept}</label>
                <div className="rule-input">
                  <span className="rule-input-prefix">$</span>
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
        </div>

        <div className="panel policy-rules-panel policy-rules-panel-wide">
          <div className="panel-h">
            <div className="panel-h-left">
              <span className="panel-icon"><AlertIcon size={16} /></span>
              <div>
                <h3>Per-Category Transaction Caps</h3>
                <span className="panel-desc">Maximum amount per transaction by spend category</span>
              </div>
            </div>
          </div>
          <div className="category-limit-list">
            {config.categoryLimits.map((c) => (
              <div className={`category-limit-row ${c.enabled ? "" : "disabled"}`} key={c.category}>
                <div className="category-limit-info">
                  <span className="category-limit-name">{c.category}</span>
                  <span className="category-limit-val">{fmtUSD(c.perTransaction)}</span>
                </div>
                <input
                  type="range"
                  className="category-limit-slider"
                  min={50}
                  max={5000}
                  step={50}
                  value={c.perTransaction}
                  disabled={!c.enabled}
                  onChange={(e) => setCategoryLimit(c.category, Number(e.target.value))}
                />
                <Toggle
                  on={c.enabled}
                  onClick={() => toggleCategoryLimit(c.category)}
                  label={`Toggle ${c.category} limit`}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const FILTERS: { id: Severity | "all"; label: string; color?: string }[] = [
  { id: "all", label: "All" },
  { id: "critical", label: "Critical", color: "var(--bad)" },
  { id: "high", label: "High", color: "var(--warn)" },
  { id: "medium", label: "Medium", color: "#c9920a" },
  { id: "low", label: "Low" },
];

const TYPE_META: Record<string, { label: string; tone: "bad" | "warn" | "neutral" }> = {
  restricted_merchant: { label: "Blocked", tone: "bad" },
  disallowed_category: { label: "Category", tone: "bad" },
  over_limit: { label: "Over cap", tone: "warn" },
  needs_approval: { label: "Approval", tone: "neutral" },
  missing_receipt: { label: "Receipt", tone: "neutral" },
};

function ViolationTypeBadge({ type }: { type: string }) {
  if (type === "split_transaction") return null;
  const meta = TYPE_META[type] ?? { label: "Flag", tone: "neutral" as const };
  return <span className={`viol-type-badge tone-${meta.tone}`}>{meta.label}</span>;
}

function ViolationsTab() {
  const config = usePolicy((s) => s.config);
  const [filter, setFilter] = useState<Severity | "all">("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const violations = useMemo(() => policyViolations(config), [config]);
  const stats = useMemo(() => violationStats(violations), [violations]);
  const offenders = useMemo(() => repeatOffenders(violations), [violations]);

  const filtered: Violation[] = useMemo(() => {
    let list = filter === "all" ? violations : violations.filter((v) => v.severity === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (v) =>
          v.title.toLowerCase().includes(q) ||
          v.employeeName.toLowerCase().includes(q) ||
          v.department.toLowerCase().includes(q) ||
          v.merchantName.toLowerCase().includes(q)
      );
    }
    return list;
  }, [violations, filter, search]);

  const sevCounts: Record<string, number> = {
    all: violations.length,
    critical: stats.bySeverity.critical,
    high: stats.bySeverity.high,
    medium: stats.bySeverity.medium,
    low: stats.bySeverity.low,
  };

  return (
    <div className="policy-violations">
      <div className="policy-layout">
        <div className="policy-main-col">
          <div className="panel viol-panel">
            <div className="panel-h">
              <div className="panel-h-left">
                <h3>Flagged Transactions</h3>
                <span className="panel-desc">Click a row to view full details</span>
              </div>
              <span className="panel-sub">{filtered.length} of {violations.length}</span>
            </div>

            <div className="policy-toolbar">
              <input
                type="search"
                className="policy-search policy-search-wide"
                placeholder="Search by employee, merchant, or title…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="filter-bar">
                {FILTERS.map((f) => (
                  <button
                    type="button"
                    key={f.id}
                    className={`viol-filter-chip ${filter === f.id ? "active" : ""}`}
                    onClick={() => setFilter(f.id)}
                  >
                    {f.label}
                    <span className="viol-filter-count">{sevCounts[f.id]}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="viol-list">
              <AnimatePresence initial={false}>
                {filtered.slice(0, 60).map((v) => {
                  const isExpanded = expandedId === v.id;
                  const emp = employeeById(v.employeeId);
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
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setExpandedId(isExpanded ? null : v.id);
                        }
                      }}
                    >
                      <div className="viol-card-top">
                        <Avatar
                          name={v.employeeName}
                          hue={emp?.avatarHue ?? 220}
                          size={38}
                        />
                        <div className="viol-card-main">
                          <div className="viol-card-title-row">
                            <div className="viol-card-title">{v.title}</div>
                            <ViolationTypeBadge type={v.type} />
                          </div>
                          <div className="viol-card-meta">
                            <span className="viol-card-who">{v.employeeName}</span>
                            <span className="viol-card-dept">{v.department}</span>
                            <span className="viol-card-date">{v.date}</span>
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
                                <span><strong>Merchant</strong> {v.merchantName}</span>
                                <span><strong>Type</strong> {v.typeLabel}</span>
                                <span><strong>Date</strong> {v.date}</span>
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
                  <CheckCircleEmpty />
                  <p>No violations match your filters</p>
                  <span className="viol-empty-hint">Try adjusting severity or search terms</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="policy-side-col">
          <div className="panel offender-panel">
            <div className="panel-h">
              <div className="panel-h-left">
                <h3>Repeat Offenders</h3>
                <span className="panel-desc">Ranked by composite risk score</span>
              </div>
            </div>
            <div className="offender-list">
              {offenders.map((o, i) => {
                const emp = employeeById(o.employeeId);
                const maxScore = offenders[0]?.riskScore ?? 1;
                const pct = Math.round((o.riskScore / maxScore) * 100);
                return (
                  <div className="offender-card" key={o.employeeId}>
                    <div className="offender-card-top">
                      <span className="offender-rank-badge">{i + 1}</span>
                      <Avatar
                        name={o.employeeName}
                        hue={emp?.avatarHue ?? 220}
                        size={34}
                      />
                      <div className="offender-info">
                        <div className="offender-name">{o.employeeName}</div>
                        <div className="offender-dept">{o.department}</div>
                      </div>
                      <div className="offender-risk-wrap">
                        <div className="offender-risk-score">{o.riskScore}</div>
                        <div className="offender-risk-lbl">risk</div>
                      </div>
                    </div>
                    <div className="offender-details">
                      <span>{o.count} flags</span>
                      <span className="offender-dot">·</span>
                      <span>{o.topType}</span>
                      <SeverityBadge severity={o.worstSeverity} />
                    </div>
                    <div className="offender-bar-track">
                      <motion.div
                        className="offender-bar-fill"
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.6, delay: i * 0.05 }}
                        style={{
                          background:
                            pct > 80 ? "var(--bad)" : pct > 50 ? "var(--warn)" : "var(--accent)",
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
    </div>
  );
}

function CheckCircleEmpty() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--good)" strokeWidth="1.7">
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.4 2.4L16 9.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function PolicyView() {
  const [tab, setTab] = useState<"rules" | "violations">("violations");
  const config = usePolicy((s) => s.config);
  const violationCount = useMemo(() => policyViolations(config).length, [config]);

  return (
    <div className="view view-policy">
      <div className="view-inner">
        <div className="policy-tab-bar" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "violations"}
            className={`policy-tab ${tab === "violations" ? "active" : ""}`}
            onClick={() => setTab("violations")}
          >
            <AlertIcon size={15} />
            Violations
            <span className="policy-tab-count">{violationCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "rules"}
            className={`policy-tab ${tab === "rules" ? "active" : ""}`}
            onClick={() => setTab("rules")}
          >
            <ShieldIcon size={15} />
            Policy Rules
          </button>
        </div>

        <div className="policy-body">
          {tab === "rules" ? <RulesTab /> : <ViolationsTab />}
        </div>
      </div>
    </div>
  );
}
