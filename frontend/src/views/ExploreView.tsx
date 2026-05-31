import { AnimatePresence, motion } from "framer-motion";
import Scatter3D from "../components/Scatter3D";
import DataQualityPanel from "../components/DataQualityPanel";
import DepartmentBars from "../components/DepartmentBars";
import EmployeeBreakdown from "../components/EmployeeBreakdown";
import EmployeeProfile from "../components/EmployeeProfile";
import { useNav } from "../state/store";
import { employeeById } from "../data/selectors";

function Breadcrumb() {
  const { view, department, employeeId, backToDept } =
    useNav();
  const emp = employeeId ? employeeById(employeeId) : null;

  // Don't show breadcrumb in galaxy view — it's just the 3D scene
  if (view === "galaxy") return null;

  return (
    <div className="breadcrumb">
      {department && (
        <>
          <span className={`crumb ${view === "dept" ? "active" : ""}`} onClick={backToDept}>
            {department}
          </span>
        </>
      )}
      {emp && (
        <>
          {department && <span className="sep">›</span>}
          <span className="crumb active">{emp.name}</span>
        </>
      )}
    </div>
  );
}

const HINTS: Record<string, string> = {};

export default function ExploreView() {
  const view = useNav((s) => s.view);
  const goBack = useNav((s) => s.goBack);

  return (
    <div className="layer" style={{ position: "absolute", inset: 0 }}>
      {/* Back button — only shows when drilled in past galaxy */}
      {view !== "galaxy" && (
        <button className="back-btn" style={{ top: 16 }} onClick={goBack}>
          ‹ Back
        </button>
      )}

      {/* The 3D galaxy stays mounted; camera resets to overview when backing out of a drill-down */}
      <motion.div
        className="layer"
        animate={{ opacity: view === "galaxy" ? 1 : 0 }}
        transition={{ duration: 0.4 }}
        style={{ pointerEvents: view === "galaxy" ? "auto" : "none" }}
      >
        <Scatter3D />
        <DataQualityPanel />
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

      {/* Hint bar for non-galaxy views */}
      {view !== "galaxy" && HINTS[view] && (
        <div className="hint">{HINTS[view]}</div>
      )}
    </div>
  );
}
