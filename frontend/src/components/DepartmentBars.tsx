import { useMemo } from "react";
import { motion } from "framer-motion";
import { deptTotalsForMonth } from "../data/selectors";
import { MONTH_LABELS, MONTH_STARTS } from "../data/generate";
import { deptColor, fmtUSD } from "../theme";
import { useNav } from "../state/store";

export default function DepartmentBars() {
  const monthStart = useNav((s) => s.monthStart)!;
  const selectDepartment = useNav((s) => s.selectDepartment);
  const monthLabel = MONTH_LABELS[MONTH_STARTS.indexOf(monthStart)] ?? monthStart;

  const data = useMemo(() => deptTotalsForMonth(monthStart), [monthStart]);
  const max = Math.max(...data.map((d) => d.total), 1);

  return (
    <div className="chart-wrap">
      <div className="view-title">
        <h2>{monthLabel} · Department Spend</h2>
        <p>Select a department to break down spend by employee</p>
      </div>
      <div className="bars">
        {data.map((d, i) => {
          const heightPct = Math.max((d.total / max) * 100, 1.5);
          const color = deptColor(d.department);
          return (
            <div className="bar-col" key={d.department} onClick={() => selectDepartment(d.department)}>
              <motion.div
                className="amount"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.25 + i * 0.04 }}
              >
                {fmtUSD(d.total)}
              </motion.div>
              <motion.div
                className="bar"
                initial={{ height: 0 }}
                animate={{ height: `${heightPct}%` }}
                transition={{ type: "spring", stiffness: 120, damping: 18, delay: i * 0.05 }}
                style={{
                  background: `linear-gradient(180deg, ${color}, ${color}33)`,
                  boxShadow: `0 0 30px ${color}44`,
                }}
              />
              <div className="label">
                {d.department}
                <div className="count">{d.count} txns</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
