import { AnimatePresence, motion } from "framer-motion";
import Scatter3D from "./components/Scatter3D";
import DepartmentBars from "./components/DepartmentBars";
import EmployeeBreakdown from "./components/EmployeeBreakdown";
import EmployeeProfile from "./components/EmployeeProfile";
import { useNav } from "./state/store";
import { companyKpis, employeeById } from "./data/selectors";
import { MONTH_LABELS, MONTH_STARTS } from "./data/generate";
import { fmtUSD } from "./theme";

const kpis = companyKpis();

function Breadcrumb() {
  const { view, monthStart, department, employeeId, backToGalaxy, backToMonth, backToDept } = useNav();
  const monthLabel = monthStart ? MONTH_LABELS[MONTH_STARTS.indexOf(monthStart)] : null;
  const emp = employeeId ? employeeById(employeeId) : null;

  return (
    <div className="breadcrumb">
      <span className={`crumb ${view === "galaxy" ? "active" : ""}`} onClick={backToGalaxy}>
        All Departments
      </span>
      {monthLabel && (
        <>
          <span className="sep">›</span>
          <span className={`crumb ${view === "month" ? "active" : ""}`} onClick={backToMonth}>
            {monthLabel}
          </span>
        </>
      )}
      {department && (
        <>
          <span className="sep">›</span>
          <span className={`crumb ${view === "dept" ? "active" : ""}`} onClick={backToDept}>
            {department}
          </span>
        </>
      )}
      {emp && (
        <>
          <span className="sep">›</span>
          <span className="crumb active">{emp.name}</span>
        </>
      )}
    </div>
  );
}

const HINTS: Record<string, string> = {
  galaxy: "Drag to orbit · scroll to zoom · click a point to open that month",
  month: "Click a department bar to break it down by employee",
  dept: "Click an employee card to open their full profile",
  employee: "This person's spend profile · use the breadcrumb to zoom back out",
};

export default function App() {
  const view = useNav((s) => s.view);
  const goBack = useNav((s) => s.goBack);

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="logo" />
          <div>
            <div className="title">Brim · Expense Intelligence</div>
            <div className="sub">CFO Cockpit</div>
          </div>
        </div>
        <Breadcrumb />
        <div className="kpis">
          <div className="kpi"><div className="v">{fmtUSD(kpis.totalSpend)}</div><div className="l">6-mo spend</div></div>
          <div className="kpi"><div className="v">{kpis.txnCount.toLocaleString()}</div><div className="l">Transactions</div></div>
          <div className="kpi"><div className="v">{kpis.employees}</div><div className="l">Employees</div></div>
          <div className="kpi"><div className="v">{kpis.departments}</div><div className="l">Departments</div></div>
        </div>
      </div>

      <div className="stage">
        {view !== "galaxy" && (
          <button className="back-btn" onClick={goBack}>
            ‹ Back
          </button>
        )}

        {/* The 3D galaxy stays mounted so orbit state is preserved; we just
            fade it under the 2D layers as the CFO zooms in. */}
        <motion.div
          className="layer"
          animate={{ opacity: view === "galaxy" ? 1 : 0 }}
          transition={{ duration: 0.4 }}
          style={{ pointerEvents: view === "galaxy" ? "auto" : "none" }}
        >
          <Scatter3D />
        </motion.div>

        <AnimatePresence mode="wait">
          {view === "month" && (
            <motion.div
              key="month"
              className="layer"
              initial={{ opacity: 0, scale: 1.04 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.35 }}
            >
              <DepartmentBars />
            </motion.div>
          )}
          {view === "dept" && (
            <motion.div
              key="dept"
              className="layer"
              initial={{ opacity: 0, scale: 1.04 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.35 }}
            >
              <EmployeeBreakdown />
            </motion.div>
          )}
          {view === "employee" && (
            <motion.div
              key="employee"
              className="layer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <EmployeeProfile />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="hint">{HINTS[view]}</div>
      </div>
    </div>
  );
}
