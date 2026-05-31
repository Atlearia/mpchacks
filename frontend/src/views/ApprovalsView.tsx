import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { usePolicy } from "../data/policy";
import { approvalQueue, type ApprovalRequest } from "../data/intelligence";
import { employeeById } from "../data/selectors";
import { fmtUSD } from "../theme";
import { Avatar, BarChart, BudgetGauge } from "../components/charts";
import { CheckCircleIcon, SparkIcon } from "../components/icons";

type Decision = "approved" | "denied";

const REC_LABEL = { approve: "Recommend approve", deny: "Recommend deny", review: "Needs review" };
const REC_CLASS = { approve: "rec-approve", deny: "rec-deny", review: "rec-review" };

function Detail({
  req,
  decision,
  onDecide,
}: {
  req: ApprovalRequest;
  decision?: Decision;
  onDecide: (d: Decision) => void;
}) {
  const emp = employeeById(req.employeeId);
  const fitsRemaining = req.amount <= req.budgetRemaining;

  return (
    <motion.div className="panel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} key={req.id}>
      <div className="detail-hero">
        <Avatar name={req.employeeName} hue={emp?.avatarHue ?? 220} size={56} />
        <div style={{ flex: 1 }}>
          <div className="h-title">{req.title}</div>
          <div className="h-sub">
            {req.employeeName} · {req.department} · {req.merchant}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{fmtUSD(req.amount)}</div>
          <div style={{ fontSize: 12, color: "var(--text-faint)" }}>{req.category}</div>
        </div>
      </div>

      <div className="detail-grid">
        <div className="panel" style={{ background: "rgba(255,255,255,0.02)" }}>
          <div className="panel-h">
            <h3 style={{ fontSize: 13 }}>Department Budget</h3>
          </div>
          <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 10 }}>
            <b style={{ color: "var(--text)" }}>{fmtUSD(req.budgetRemaining)}</b> remaining ·
            request is {fitsRemaining ? "within" : "over"} budget
          </div>
          <BudgetGauge
            pct={req.budgetRemaining ? req.amount / req.budgetRemaining : 1}
            status={fitsRemaining ? "ok" : "over"}
          />
        </div>

        <div className="panel" style={{ background: "rgba(255,255,255,0.02)" }}>
          <div className="panel-h">
            <h3 style={{ fontSize: 13 }}>Spend History</h3>
            <span className="panel-sub">{req.priorSimilar} prior similar</span>
          </div>
          <BarChart
            data={req.history.map((h) => ({ label: h.month, value: h.total }))}
            orientation="vertical"
            height={120}
          />
        </div>
      </div>

      <div className="rec-card">
        <div className="rec-head">
          <SparkIcon size={16} />
          <span className="lab">AI Recommendation</span>
          <span className={`rec-tag ${REC_CLASS[req.recommendation]}`} style={{ marginLeft: 8 }}>
            {REC_LABEL[req.recommendation]}
          </span>
          <span className="conf">{req.confidence}% confidence</span>
        </div>
        <div className="rec-reasons">
          {req.reasoning.map((r, i) => (
            <div className="rec-reason" key={i}>
              <span className="dot">•</span>
              {r}
            </div>
          ))}
        </div>
      </div>

      {decision ? (
        <div className={`decided-banner ${decision}`}>
          <CheckCircleIcon size={18} />
          {decision === "approved" ? "Approved" : "Denied"} · decision recorded and the requester was
          notified.
        </div>
      ) : (
        <div className="decision-bar">
          <button className="btn approve" onClick={() => onDecide("approved")}>
            Approve {fmtUSD(req.amount)}
          </button>
          <button className="btn deny" onClick={() => onDecide("denied")}>
            Deny
          </button>
        </div>
      )}
    </motion.div>
  );
}

export default function ApprovalsView() {
  const config = usePolicy((s) => s.config);
  const queue = useMemo(() => approvalQueue(config), [config]);
  const [selected, setSelected] = useState<string | null>(queue[0]?.id ?? null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});

  const active = queue.find((q) => q.id === selected) ?? null;
  const pending = queue.filter((q) => !decisions[q.id]).length;

  return (
    <div className="view">
      <div className="view-inner">
        <div className="approvals-split">
          <div className="queue-list">
            <div className="panel-h" style={{ marginBottom: 4 }}>
              <h3>Pending Requests</h3>
              <span className="panel-sub">{pending} awaiting</span>
            </div>
            {queue.map((req) => {
              const emp = employeeById(req.employeeId);
              const done = decisions[req.id];
              return (
                <div
                  key={req.id}
                  className={`queue-card ${selected === req.id ? "active" : ""} ${done ? "done" : ""}`}
                  onClick={() => setSelected(req.id)}
                >
                  <div className="queue-top">
                    <Avatar name={req.employeeName} hue={emp?.avatarHue ?? 220} size={36} />
                    <div className="meta">
                      <div className="t">{req.title}</div>
                      <div className="s">
                        {req.employeeName} · {req.department}
                      </div>
                    </div>
                  </div>
                  <div className="queue-amt">
                    <span className="a">{fmtUSD(req.amount)}</span>
                    {done ? (
                      <span className={`rec-tag ${done === "approved" ? "rec-approve" : "rec-deny"}`}>
                        {done}
                      </span>
                    ) : (
                      <span className={`rec-tag ${REC_CLASS[req.recommendation]}`}>
                        {req.recommendation}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div>
            {active ? (
              <Detail
                req={active}
                decision={decisions[active.id]}
                onDecide={(d) => setDecisions((prev) => ({ ...prev, [active.id]: d }))}
              />
            ) : (
              <div className="empty-detail">Select a request to review</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
