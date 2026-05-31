import { useMemo } from "react";
import { motion } from "framer-motion";
import { useNav } from "../state/store";
import { usePolicy } from "../data/policy";
import { companyKpis } from "../data/selectors";
import {
  anomalies,
  departmentBudgets,
  policyViolations,
  vendorConsolidation,
  violationStats,
} from "../data/intelligence";
import { fmtUSD } from "../theme";
import { BudgetGauge, SeverityBadge, Sparkline, StatCard } from "../components/charts";
import { AlertIcon, SparkIcon, TrendUpIcon } from "../components/icons";

export default function OverviewDashboard() {
  const config = usePolicy((s) => s.config);
  const setSection = useNav((s) => s.setSection);

  const kpis = useMemo(() => companyKpis(), []);
  const budgets = useMemo(() => departmentBudgets(config), [config]);
  const violations = useMemo(() => policyViolations(config), [config]);
  const stats = useMemo(() => violationStats(violations), [violations]);
  const anomalyList = useMemo(() => anomalies(), []);
  const consolidation = useMemo(() => vendorConsolidation(), []);

  const totalSavings = consolidation.reduce((s, c) => s + c.estimatedSavings, 0);
  const atRisk = budgets.filter((b) => b.status !== "ok");
  const topViolations = violations.slice(0, 6);

  return (
    <div className="view">
      <div className="view-inner">
        <div className="kpi-row">
          <StatCard
            label="Total Spend"
            value={fmtUSD(kpis.totalSpend)}
            sub={<>Avg ticket {fmtUSD(kpis.avgTicket)}</>}
            accent="var(--accent)"
            icon={<TrendUpIcon />}
          />
          <StatCard
            label="Open Violations"
            value={stats.bySeverity.critical + stats.bySeverity.high}
            sub={<>{stats.bySeverity.critical} critical · {stats.bySeverity.high} high</>}
            accent="var(--bad)"
            icon={<AlertIcon />}
          />
          <StatCard
            label="Budgets At Risk"
            value={atRisk.length}
            sub={<>of {budgets.length} departments</>}
            accent={atRisk.length ? "var(--warn)" : "var(--good)"}
          />
          <StatCard
            label="Potential Savings"
            value={fmtUSD(totalSavings)}
            sub={<>via vendor consolidation</>}
            accent="var(--good)"
            icon={<SparkIcon />}
          />
        </div>

        <div className="ov-grid">
          {/* LEFT: budget tracking */}
          <div className="panel">
            <div className="panel-h">
              <h3>Department Budget Tracking</h3>
              <span className="panel-sub">Current month vs. monthly ceiling</span>
            </div>
            {budgets.map((b) => (
              <motion.div
                className="budget-card"
                key={b.department}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div className="budget-top">
                  <span className="budget-name">{b.department}</span>
                  <span className="budget-figs">
                    <b>{fmtUSD(b.current)}</b> / {fmtUSD(b.budget)}
                  </span>
                </div>
                <BudgetGauge pct={b.pct} status={b.status} />
                <div className={`budget-alert ${b.status}`}>
                  {b.status === "over" && (
                    <>
                      <AlertIcon size={14} /> Over budget by {fmtUSD(b.current - b.budget)} this month
                    </>
                  )}
                  {b.status === "risk" && (
                    <>
                      <AlertIcon size={14} /> Projected to exceed budget — trending to{" "}
                      {fmtUSD(b.projectedNext)} next month
                    </>
                  )}
                  {b.status === "ok" && <>On track · {Math.round(b.pct * 100)}% of budget used</>}
                </div>
              </motion.div>
            ))}
          </div>

          {/* RIGHT: alerts, anomalies, consolidation */}
          <div className="row-gap">
            <div className="panel">
              <div className="panel-h">
                <h3>Top Policy Alerts</h3>
                <span className="panel-sub" style={{ cursor: "pointer" }} onClick={() => setSection("policy")}>
                  View all →
                </span>
              </div>
              <div className="alert-list">
                {topViolations.map((v) => (
                  <div className="alert-item" key={v.id} onClick={() => setSection("policy")}>
                    <div className="alert-icon">
                      <AlertIcon size={16} />
                    </div>
                    <div className="alert-body">
                      <div className="alert-title">{v.title}</div>
                      <div className="alert-meta">
                        {v.employeeName} · {v.department} · {fmtUSD(v.amount)}
                      </div>
                    </div>
                    <SeverityBadge severity={v.severity} />
                  </div>
                ))}
              </div>
            </div>

            <div className="panel">
              <div className="panel-h">
                <h3>Anomalies Detected</h3>
                <span className="panel-sub">{anomalyList.length} flagged</span>
              </div>
              <div className="alert-list">
                {anomalyList.slice(0, 4).map((a) => (
                  <div className="alert-item" key={a.id}>
                    <div className="alert-icon warn">
                      <SparkIcon size={16} />
                    </div>
                    <div className="alert-body">
                      <div className="alert-title">{a.title}</div>
                      <div className="alert-detail">{a.detail}</div>
                    </div>
                    <span className="tag">{a.typeLabel}</span>
                  </div>
                ))}
              </div>
            </div>

            {consolidation[0] && (
              <div className="consolidation-callout">
                <div>
                  <div className="save">{fmtUSD(totalSavings)}</div>
                  <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>
                    estimated annual savings
                  </div>
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                  You're paying <b>{consolidation[0].vendorCount} vendors</b> for{" "}
                  <b>{consolidation[0].category}</b> ({fmtUSD(consolidation[0].totalSpend)}).
                  Consolidating to a preferred vendor could save{" "}
                  <b style={{ color: "var(--good)" }}>{fmtUSD(consolidation[0].estimatedSavings)}</b>.
                </div>
                <Sparkline values={consolidation[0].vendors.map((v) => v.spend)} color="var(--good)" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
