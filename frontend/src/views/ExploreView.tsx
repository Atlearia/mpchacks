import { AnimatePresence, motion } from "framer-motion";
import Scatter3D from "../components/Scatter3D";
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
      {/* Breadcrumb — only shows when drilled in past galaxy */}
      {view !== "galaxy" && (
        <div style={{ position: "absolute", top: 16, left: 22, zIndex: 16 }}>
          <Breadcrumb />
        </div>
      )}

      {view !== "galaxy" && (
        <button className="back-btn" style={{ top: 54 }} onClick={goBack}>
          ‹ Back
        </button>
      )}

      {/* Subtle floating interaction hint for galaxy view */}
      <AnimatePresence>
        {view === "galaxy" && (
          <motion.div
            className="explore-hint-float"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.4, delay: 0.8 }}
          >
            <div className="explore-hint-inner">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                <circle cx="8" cy="8" r="7" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
                <circle cx="8" cy="8" r="2" fill="rgba(255,255,255,0.5)" />
                <path d="M8 1v3M8 12v3M1 8h3M12 8h3" stroke="rgba(255,255,255,0.25)" strokeWidth="0.8" />
              </svg>
              <span>Orbit</span>
              <span className="explore-hint-sep">·</span>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                <rect x="5" y="1" width="6" height="10" rx="3" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
                <line x1="8" y1="3" x2="8" y2="5" stroke="rgba(255,255,255,0.5)" strokeWidth="1" strokeLinecap="round" />
                <path d="M4 13l4 2 4-2" stroke="rgba(255,255,255,0.25)" strokeWidth="0.8" strokeLinejoin="round" />
              </svg>
              <span>Zoom</span>
              <span className="explore-hint-sep">·</span>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                <circle cx="8" cy="8" r="4" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
                <circle cx="8" cy="8" r="1.5" fill="rgba(77,166,255,0.6)" />
              </svg>
              <span>Select a point to explore</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The 3D galaxy stays mounted so orbit state is preserved */}
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

      {/* Hint bar for non-galaxy views */}
      {view !== "galaxy" && HINTS[view] && (
        <div className="hint">{HINTS[view]}</div>
      )}
    </div>
  );
}
