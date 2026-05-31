import { useMemo } from "react";
import { motion } from "framer-motion";
import { employeeTotals } from "../data/selectors";
import { MONTH_LABELS, MONTH_STARTS } from "../data/generate";
import { deptColor, fmtUSD } from "../theme";
import { useNav } from "../state/store";

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
}

export default function EmployeeBreakdown() {
  const monthStart = useNav((s) => s.monthStart)!;
  const department = useNav((s) => s.department)!;
  const selectEmployee = useNav((s) => s.selectEmployee);
  const monthLabel = MONTH_LABELS[MONTH_STARTS.indexOf(monthStart)] ?? monthStart;
  const color = deptColor(department);

  const rows = useMemo(() => employeeTotals(monthStart, department), [monthStart, department]);
  const deptTotal = rows.reduce((s, r) => s + Math.max(r.total, 0), 0) || 1;
  const max = Math.max(...rows.map((r) => r.total), 1);

  return (
    <div className="emp-grid">
      <div className="view-title">
        <h2 style={{ color }}>{department}</h2>
        <p>
          {monthLabel} · {fmtUSD(rows.reduce((s, r) => s + r.total, 0))} across {rows.length} people ·
          select someone to open their profile
        </p>
      </div>
      <div className="emp-cards">
        {rows.map((r, i) => {
          const share = Math.max(r.total, 0) / deptTotal;
          return (
            <motion.div
              key={r.employee.id}
              className="emp-card"
              onClick={() => selectEmployee(r.employee.id)}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
            >
              <div className="emp-head">
                <div
                  className="avatar"
                  style={{ background: `hsl(${r.employee.avatarHue} 70% 70%)` }}
                >
                  {initials(r.employee.name)}
                </div>
                <div>
                  <div className="name">{r.employee.name}</div>
                  <div className="title">{r.employee.title}</div>
                </div>
              </div>
              <div className="spend">
                <span className="v">{fmtUSD(r.total)}</span>
                <span className="c">{r.count} txns</span>
              </div>
              <div className="share-track">
                <motion.div
                  className="share-fill"
                  style={{ background: color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${(r.total / max) * 100}%` }}
                  transition={{ delay: 0.15 + i * 0.03, type: "spring", stiffness: 120, damping: 20 }}
                />
              </div>
              <div className="share-label">{(share * 100).toFixed(1)}% of department spend</div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
