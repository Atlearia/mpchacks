import { useEffect, useMemo } from "react";
import { useNav, type Section } from "./state/store";
import { usePolicy } from "./data/policy";
import { companyKpis } from "./data/selectors";
import { approvalQueue, policyViolations } from "./data/intelligence";
import { fmtUSD } from "./theme";
import { Avatar } from "./components/charts";
import {
  AlertIcon,
  ChatIcon,
  CheckCircleIcon,
  CubeIcon,
  DocIcon,
  GridIcon,
} from "./components/icons";
import ExploreView from "./views/ExploreView";
import OverviewDashboard from "./views/OverviewDashboard";
import AskView from "./views/AskView";
import PolicyView from "./views/PolicyView";
import ApprovalsView from "./views/ApprovalsView";
import ReportsView from "./views/ReportsView";

const SECTION_META: Record<Section, { title: string; sub: string }> = {
  overview: { title: "Executive Overview", sub: "Company-wide spend health at a glance" },
  explore: { title: "Spend Explorer", sub: "3D galaxy of department spend over time" },
  ask: { title: "Ask Your Data", sub: "Conversational analytics across every transaction" },
  policy: { title: "Policy Compliance", sub: "Rules, violations, and repeat offenders" },
  approvals: { title: "Pre-Approval Queue", sub: "AI-assisted spend approvals" },
  reports: { title: "Expense Reports", sub: "Auto-generated, policy-checked, approval-ready" },
};

interface NavDef {
  id: Section;
  label: string;
  icon: React.ReactNode;
}

export default function App() {
  const section = useNav((s) => s.section);
  const setSection = useNav((s) => s.setSection);
  const policyInit = usePolicy((s) => s.init);
  const config = usePolicy((s) => s.config);

  useEffect(() => {
    policyInit();
  }, [policyInit]);

  const kpis = useMemo(() => companyKpis(), []);
  const openViolations = useMemo(() => {
    const v = policyViolations(config);
    return v.filter((x) => x.severity === "critical" || x.severity === "high").length;
  }, [config]);
  const pendingApprovals = useMemo(() => approvalQueue(config).length, [config]);

  const navItems: NavDef[] = [
    { id: "overview", label: "Overview", icon: <GridIcon /> },
    { id: "explore", label: "Explore", icon: <CubeIcon /> },
    { id: "ask", label: "Ask Your Data", icon: <ChatIcon /> },
    { id: "policy", label: "Policy", icon: <AlertIcon /> },
    { id: "approvals", label: "Approvals", icon: <CheckCircleIcon /> },
    { id: "reports", label: "Reports", icon: <DocIcon /> },
  ];

  const meta = SECTION_META[section];

  return (
    <div className="shell">
      <nav className="nav-rail">
        <div className="nav-brand">
          <div className="logo" />
          <div>
            <div className="title">Brim</div>
            <div className="sub">Expense Intelligence</div>
          </div>
        </div>

        <div className="nav-section-label">Workspace</div>
        {navItems.map((item) => {
          const badge =
            item.id === "policy" && openViolations > 0
              ? { n: openViolations, warn: false }
              : item.id === "approvals" && pendingApprovals > 0
                ? { n: pendingApprovals, warn: true }
                : null;
          return (
            <div
              key={item.id}
              className={`nav-item ${section === item.id ? "active" : ""}`}
              onClick={() => setSection(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
              {badge && (
                <span className={`nav-badge ${badge.warn ? "warn" : ""}`}>{badge.n}</span>
              )}
            </div>
          );
        })}

        <div className="nav-foot">
          <Avatar name="Dana Reyes" hue={214} size={34} />
          <div className="who">
            <div className="n">Dana Reyes</div>
            <div className="r">CFO</div>
          </div>
        </div>
      </nav>

      <div className="main">
        <header className="main-top">
          <div className="sec-title">
            <h1>{meta.title}</h1>
            <p>{meta.sub}</p>
          </div>
          <div className="kpis">
            <div className="kpi">
              <div className="v">{fmtUSD(kpis.totalSpend)}</div>
              <div className="l">Total spend</div>
            </div>
            <div className="kpi">
              <div className="v">{kpis.txnCount.toLocaleString()}</div>
              <div className="l">Transactions</div>
            </div>
            <div className="kpi">
              <div className="v">{kpis.employees}</div>
              <div className="l">Employees</div>
            </div>
            <div className="kpi">
              <div className="v">{kpis.departments}</div>
              <div className="l">Departments</div>
            </div>
          </div>
        </header>

        <div className="main-content">
          {/* Explore stays mounted so the 3D orbit state survives section
              switches; it is simply hidden when another section is active. */}
          <div style={{ position: "absolute", inset: 0, display: section === "explore" ? "block" : "none" }}>
            <ExploreView />
          </div>

          {section === "overview" && <OverviewDashboard />}
          {section === "ask" && <AskView />}
          {section === "policy" && <PolicyView />}
          {section === "approvals" && <ApprovalsView />}
          {section === "reports" && <ReportsView />}
        </div>
      </div>
    </div>
  );
}
