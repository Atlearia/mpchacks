import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { usePolicy } from "../data/policy";
import { buildReports, type ExpenseReport } from "../data/intelligence";
import { employeeById } from "../data/selectors";
import { fmtUSD, fmtUSDc } from "../theme";
import { Avatar, DonutChart } from "../components/charts";
import { AlertIcon, CheckCircleIcon, SparkIcon } from "../components/icons";

const STATUS_CLASS: Record<ExpenseReport["status"], string> = {
  draft: "status-draft",
  ready: "status-ready",
  approved: "status-approved",
};

function aiSummary(r: ExpenseReport): string {
  const top = r.categories[0];
  const flag = r.flaggedCount
    ? ` ${r.flaggedCount} line item${r.flaggedCount > 1 ? "s" : ""} need review before sign-off.`
    : " All line items are within policy.";
  return `${r.lineItems.length} transactions from ${r.startDate} to ${r.endDate}, grouped into "${r.title}". Largest category is ${top?.category} (${fmtUSD(
    top?.total ?? 0
  )}).${flag}`;
}

function Detail({
  report,
  approved,
  onApprove,
}: {
  report: ExpenseReport;
  approved: boolean;
  onApprove: () => void;
}) {
  const emp = employeeById(report.employeeId);
  return (
    <motion.div className="panel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} key={report.id}>
      <div className="detail-hero">
        <Avatar name={report.employeeName} hue={emp?.avatarHue ?? 220} size={56} />
        <div style={{ flex: 1 }}>
          <div className="h-title">{report.title}</div>
          <div className="h-sub">
            {report.employeeName} · {report.department} · {report.startDate} → {report.endDate}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{fmtUSD(report.total)}</div>
          <span className={`status-tag ${STATUS_CLASS[approved ? "approved" : report.status]}`}>
            {approved ? "approved" : report.status}
          </span>
        </div>
      </div>

      <div className="rec-card" style={{ background: "linear-gradient(120deg, rgba(110,168,254,0.1), transparent)" }}>
        <div className="rec-head">
          <SparkIcon size={16} />
          <span className="lab">AI Summary</span>
        </div>
        <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>{aiSummary(report)}</div>
      </div>

      <div className="detail-grid">
        <div className="panel" style={{ background: "rgba(255,255,255,0.02)" }}>
          <div className="panel-h">
            <h3 style={{ fontSize: 13 }}>Categories</h3>
          </div>
          <DonutChart data={report.categories.map((c) => ({ label: c.category, value: c.total }))} />
        </div>
        <div className="panel" style={{ background: "rgba(255,255,255,0.02)" }}>
          <div className="panel-h">
            <h3 style={{ fontSize: 13 }}>Policy Check</h3>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.7 }}>
            <div className={report.flaggedCount ? "policy-flag" : "policy-ok"}>
              {report.flaggedCount ? <AlertIcon size={14} /> : <CheckCircleIcon size={14} />}
              {report.flaggedCount
                ? `${report.flaggedCount} of ${report.lineItems.length} items flagged`
                : `All ${report.lineItems.length} items in policy`}
            </div>
            <div style={{ color: "var(--text-dim)", marginTop: 8 }}>
              Receipts matched · spend categories assigned · totals reconciled.
            </div>
          </div>
        </div>
      </div>

      <div className="panel" style={{ background: "rgba(255,255,255,0.02)", marginBottom: 0 }}>
        <div className="panel-h">
          <h3 style={{ fontSize: 13 }}>Line Items</h3>
          <span className="panel-sub">{report.lineItems.length} transactions</span>
        </div>
        <div style={{ maxHeight: 320, overflowY: "auto" }}>
        {report.lineItems.map((li) => (
          <div className="line-item" key={li.txn.id}>
            <span className="li-date">{li.txn.transactionDate}</span>
            <span className="li-merch">
              {li.txn.merchantName}
              <span className="tag" style={{ marginLeft: 8 }}>
                {li.txn.spendCategory}
              </span>
            </span>
            {li.inPolicy ? (
              <span className="policy-ok">
                <CheckCircleIcon size={13} /> In policy
              </span>
            ) : (
              <span className="policy-flag">
                <AlertIcon size={13} /> {li.flag}
              </span>
            )}
            <span className="li-amt">{fmtUSDc(li.txn.amount)}</span>
          </div>
        ))}
        </div>
      </div>

      <div className="report-approve-bar">
        <div className="ra-text">
          {approved
            ? "Report approved and routed to accounting for reimbursement."
            : "Reviewed against the active expense policy and ready for CFO sign-off."}
        </div>
        <button className="btn approve" style={{ flex: "0 0 auto", padding: "12px 22px" }} onClick={onApprove} disabled={approved}>
          {approved ? "Approved" : "Approve Report"}
        </button>
      </div>
    </motion.div>
  );
}

export default function ReportsView() {
  const config = usePolicy((s) => s.config);
  const reports = useMemo(() => buildReports(config), [config]);
  const [selected, setSelected] = useState<string | null>(reports[0]?.id ?? null);
  const [approved, setApproved] = useState<Record<string, boolean>>({});

  const active = reports.find((r) => r.id === selected) ?? null;

  return (
    <div className="view">
      <div className="view-inner">
        <div className="reports-split">
          <div>
            <div className="panel-h" style={{ marginBottom: 4 }}>
              <h3>Generated Reports</h3>
              <span className="panel-sub">{reports.length} auto-grouped</span>
            </div>
            {reports.map((r) => {
              const emp = employeeById(r.employeeId);
              const status = approved[r.id] ? "approved" : r.status;
              return (
                <div
                  key={r.id}
                  className={`report-card ${selected === r.id ? "active" : ""}`}
                  onClick={() => setSelected(r.id)}
                >
                  <div className="rc-title">
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Avatar name={r.employeeName} hue={emp?.avatarHue ?? 220} size={26} />
                      {r.title}
                    </span>
                    {r.flaggedCount > 0 && <AlertIcon size={15} className="" />}
                  </div>
                  <div className="rc-sub">
                    {r.employeeName} · {r.lineItems.length} items · {r.startDate}
                  </div>
                  <div className="rc-foot">
                    <span className="rc-total">{fmtUSD(r.total)}</span>
                    <span className={`status-tag ${STATUS_CLASS[status]}`}>{status}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div>
            {active ? (
              <Detail
                report={active}
                approved={!!approved[active.id]}
                onApprove={() => setApproved((p) => ({ ...p, [active.id]: true }))}
              />
            ) : (
              <div className="empty-detail">Select a report to review</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
