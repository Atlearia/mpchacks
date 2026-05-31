import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  employeeById,
  employeeCategoryBreakdown,
  employeeMonthlySeries,
  employeeTransactions,
} from "../data/selectors";
import { deptColor, fmtUSD, fmtUSDc } from "../theme";
import { useNav } from "../state/store";

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("");
}

export default function EmployeeProfile() {
  const employeeId = useNav((s) => s.employeeId)!;
  const emp = employeeById(employeeId);

  const series = useMemo(() => employeeMonthlySeries(employeeId), [employeeId]);
  const cats = useMemo(() => employeeCategoryBreakdown(employeeId), [employeeId]);
  const txns = useMemo(() => employeeTransactions(employeeId), [employeeId]);

  if (!emp) return null;

  const color = deptColor(emp.department);
  const total = series.reduce((s, m) => s + m.total, 0);
  const avgMonthly = Math.round(total / series.length);
  const maxMonth = Math.max(...series.map((m) => m.total), 1);
  const maxCat = Math.max(...cats.map((c) => c.total), 1);
  const limitUse = Math.round((avgMonthly / emp.monthlyLimit) * 100);

  return (
    <motion.div
      className="profile"
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35 }}
    >
      <div className="profile-inner">
        <div>
          <div className="card profile-hero">
            <div className="avatar" style={{ background: `hsl(${emp.avatarHue} 70% 70%)` }}>
              {initials(emp.name)}
            </div>
            <div className="pname">{emp.name}</div>
            <div className="ptitle">{emp.title}</div>
            <div className="dept-chip" style={{ background: `${color}22`, color }}>
              {emp.department}
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="section-h">Profile</div>
            <div className="meta-row"><span className="k">Employee ID</span><span>{emp.id}</span></div>
            <div className="meta-row"><span className="k">Email</span><span>{emp.email}</span></div>
            <div className="meta-row"><span className="k">Location</span><span>{emp.location}</span></div>
            <div className="meta-row"><span className="k">Joined</span><span>{emp.joinedDate}</span></div>
            <div className="meta-row"><span className="k">Card</span><span>•••• {emp.cardLast4}</span></div>
            <div className="meta-row"><span className="k">Monthly limit</span><span>{fmtUSD(emp.monthlyLimit)}</span></div>
          </div>
        </div>

        <div>
          <div className="stat-grid">
            <div className="stat"><div className="v">{fmtUSD(total)}</div><div className="l">Total spend</div></div>
            <div className="stat"><div className="v">{fmtUSD(avgMonthly)}</div><div className="l">Avg / month</div></div>
            <div className="stat"><div className="v">{txns.length}</div><div className="l">Transactions</div></div>
            <div className="stat">
              <div className="v" style={{ color: limitUse > 90 ? "var(--bad)" : limitUse > 70 ? "var(--warn)" : "var(--good)" }}>
                {limitUse}%
              </div>
              <div className="l">Limit usage</div>
            </div>
          </div>

          <div className="card">
            <div className="section-h">Monthly spend trend</div>
            <div className="spark">
              {series.map((m) => (
                <div className="col" key={m.month}>
                  <motion.div
                    className="b"
                    initial={{ height: 0 }}
                    animate={{ height: `${(m.total / maxMonth) * 100}%` }}
                    transition={{ type: "spring", stiffness: 120, damping: 18 }}
                    title={fmtUSD(m.total)}
                  />
                  <div className="m">{m.month.split(" ")[0]}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="section-h">Spend by category</div>
            {cats.map((c) => (
              <div className="cat-row" key={c.category}>
                <span className="cname">{c.category}</span>
                <span className="ctrack">
                  <motion.span
                    className="cfill"
                    style={{ display: "block", background: color }}
                    initial={{ width: 0 }}
                    animate={{ width: `${(c.total / maxCat) * 100}%` }}
                    transition={{ type: "spring", stiffness: 120, damping: 20 }}
                  />
                </span>
                <span className="cval">{fmtUSD(c.total)}</span>
              </div>
            ))}
          </div>

          <div className="card full" style={{ marginTop: 16 }}>
            <div className="section-h">Recent transactions</div>
            <table className="txn-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Merchant</th>
                  <th>Category</th>
                  <th>Location</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {txns.slice(0, 12).map((t) => (
                  <tr key={t.id}>
                    <td>{t.transactionDate}</td>
                    <td>{t.merchantName}</td>
                    <td><span className="tag">{t.spendCategory}</span></td>
                    <td>{t.merchantCity}, {t.merchantState}</td>
                    <td
                      style={{ textAlign: "right" }}
                      className={t.debitOrCredit === "Credit" ? "amt-credit" : "amt-debit"}
                    >
                      {t.debitOrCredit === "Credit" ? "-" : ""}
                      {fmtUSDc(t.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
