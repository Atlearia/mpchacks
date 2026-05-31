import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { usePolicy } from "../data/policy";
import { approvalQueue, type ApprovalRequest } from "../data/intelligence";
import { fetchApprovalRecommendation, type ApprovalAIResult } from "../data/ai";
import { employeeById } from "../data/selectors";
import { fmtUSD } from "../theme";
import { Avatar, BarChart, BudgetGauge } from "../components/charts";
import { CheckCircleIcon, SparkIcon } from "../components/icons";

type Decision = "approved" | "denied";

interface PastDecision {
  id: string;
  title: string;
  employeeName: string;
  amount: number;
  decision: Decision;
}

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

  const [aiResult, setAiResult] = useState<ApprovalAIResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setAiResult(null);
    setAiLoading(true);
    setAiError(false);

    fetchApprovalRecommendation({
      employeeName: req.employeeName,
      department: req.department,
      title: req.title,
      amount: req.amount,
      category: req.category,
      merchant: req.merchant,
      budgetRemaining: req.budgetRemaining,
      priorSimilar: req.priorSimilar,
      history: req.history,
    })
      .then((result) => {
        if (!cancelled) {
          setAiResult(result);
          setAiLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAiError(true);
          setAiLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [req.id]);

  // Use AI result if available, otherwise fall back to template data
  const recommendation = aiResult?.recommendation ?? req.recommendation;
  const confidence = aiResult?.confidence ?? req.confidence;
  const reasoning = aiResult?.reasoning ?? req.reasoning;

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
          {aiLoading ? (
            <span className="ai-model-tag" style={{ marginLeft: 8 }}>
              <div className="typing" style={{ display: "inline-flex", gap: 3 }}>
                <span /><span /><span />
              </div>
              &nbsp;Analyzing…
            </span>
          ) : (
            <>
              <span className={`rec-tag ${REC_CLASS[recommendation as keyof typeof REC_CLASS] ?? "rec-review"}`} style={{ marginLeft: 8 }}>
                {REC_LABEL[recommendation as keyof typeof REC_LABEL] ?? "Needs review"}
              </span>
              <span className="conf">{confidence}% confidence</span>
              {aiResult && <span className="ai-model-tag" style={{ marginLeft: "auto" }}>Crest AI</span>}
              {aiError && <span className="ai-model-tag" style={{ marginLeft: "auto", opacity: 0.6 }}>Local engine</span>}
            </>
          )}
        </div>
        <div className="rec-reasons">
          {aiLoading ? (
            <div className="rec-reason" style={{ color: "var(--text-dim)" }}>
              <span className="dot">•</span>
              Generating contextual recommendation…
            </div>
          ) : (
            reasoning.map((r, i) => (
              <div className="rec-reason" key={i}>
                <span className="dot">•</span>
                {r}
              </div>
            ))
          )}
        </div>
        {aiResult?.riskFlags && aiResult.riskFlags.length > 0 && (
          <div className="rec-risks">
            {aiResult.riskFlags.map((f, i) => (
              <span className="risk-flag" key={i}>⚠ {f}</span>
            ))}
          </div>
        )}
        {aiResult?.suggestedConditions && (
          <div className="rec-conditions">
            <strong>Suggested conditions:</strong> {aiResult.suggestedConditions}
          </div>
        )}
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
  const [dismissing, setDismissing] = useState<Set<string>>(new Set());
  const [pastDecisions, setPastDecisions] = useState<PastDecision[]>([]);
  const [showPast, setShowPast] = useState(false);

  const active = queue.find((q) => q.id === selected) ?? null;
  const pendingQueue = queue.filter((q) => !decisions[q.id] && !dismissing.has(q.id));
  const pending = pendingQueue.length;

  const handleDecide = (d: Decision) => {
    if (!active) return;
    const id = active.id;

    // Record the decision
    setDecisions((prev) => ({ ...prev, [id]: d }));

    // Start dismiss animation
    setDismissing((prev) => new Set(prev).add(id));

    // After the animation completes (450ms), move to past decisions
    setTimeout(() => {
      setDismissing((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });

      // Add to past decisions
      setPastDecisions((prev) => [
        { id, title: active.title, employeeName: active.employeeName, amount: active.amount, decision: d },
        ...prev,
      ]);

      // Auto-select next pending item
      const nextPending = queue.find((q) => q.id !== id && !decisions[q.id]);
      setSelected(nextPending?.id ?? null);
    }, 480);
  };

  return (
    <div className="view">
      <div className="view-inner">
        <div className="approvals-split">
          <div className="queue-list">
            <div className="panel-h" style={{ marginBottom: 4, flexShrink: 0 }}>
              <h3>Pending Requests</h3>
              <span className="panel-sub">{pending} awaiting</span>
            </div>
            {queue.map((req) => {
              const emp = employeeById(req.employeeId);
              const done = decisions[req.id];
              const isDismissing = dismissing.has(req.id);

              // Don't render items that have completed their dismiss animation
              if (done && !isDismissing) return null;

              return (
                <div
                  key={req.id}
                  className={`queue-card ${selected === req.id ? "active" : ""} ${done ? "done" : ""} ${isDismissing ? "dismissing" : ""}`}
                  onClick={() => !isDismissing && setSelected(req.id)}
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

            {/* Past Decisions bucket */}
            {pastDecisions.length > 0 && (
              <div className="past-decisions-bucket">
                <div
                  className={`past-decisions-toggle ${showPast ? "open" : ""}`}
                  onClick={() => setShowPast(!showPast)}
                >
                  <span className="pd-icon">▸</span>
                  <span>Past Decisions</span>
                  <span className="nav-badge" style={{ marginLeft: "auto", background: "var(--accent)", color: "#fff", fontSize: 10, minWidth: 18, height: 18 }}>
                    {pastDecisions.length}
                  </span>
                </div>
                {showPast && (
                  <div className="past-decisions-list">
                    {pastDecisions.map((pd) => (
                      <div className="past-decision-item" key={pd.id}>
                        <span className={`rec-tag ${pd.decision === "approved" ? "rec-approve" : "rec-deny"}`} style={{ fontSize: 9, padding: "2px 6px" }}>
                          {pd.decision === "approved" ? "✓" : "✕"}
                        </span>
                        <span className="pd-title">{pd.title}</span>
                        <span className="pd-amt">{fmtUSD(pd.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            {active && !dismissing.has(active.id) ? (
              <Detail
                req={active}
                decision={decisions[active.id]}
                onDecide={handleDecide}
              />
            ) : (
              <div className="empty-detail">
                {pending === 0 && pastDecisions.length > 0
                  ? "All requests have been reviewed 🎉"
                  : "Select a request to review"}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
