import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  getInvalidTransactions,
  ISSUE_LABELS,
  validationSummary,
  type InvalidEntry,
  type ValidationIssue,
} from "../data/validation";
import { fmtUSD } from "../theme";
import { ChevronDownIcon } from "./icons";

function IssueChips({ issues }: { issues: ValidationIssue[] }) {
  return (
    <div className="dq-issue-chips">
      {issues.map((issue) => (
        <span key={issue} className="dq-issue-chip">
          {ISSUE_LABELS[issue]}
        </span>
      ))}
    </div>
  );
}

function InvalidRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: InvalidEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { transaction: t } = entry;
  const title = t.merchantName?.trim() || t.transactionCategory || "Unnamed transaction";
  const meta = [
    t.employeeName || "—",
    t.department || "—",
    t.transactionDate?.slice(0, 10) || "—",
  ].join(" · ");

  return (
    <div
      className={`dq-row ${expanded ? "expanded" : ""}`}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <div className="dq-row-top">
        <div className="dq-row-main">
          <div className="dq-row-title">{title}</div>
          <div className="dq-row-meta">{meta}</div>
          {!expanded && <IssueChips issues={entry.issues} />}
        </div>
        <div className="dq-row-right">
          <div className="dq-row-amount">{fmtUSD(t.amount)}</div>
          <ChevronDownIcon size={14} className={`dq-chevron ${expanded ? "open" : ""}`} />
        </div>
      </div>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            className="dq-row-detail"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <IssueChips issues={entry.issues} />
            <dl className="dq-fields">
              <div>
                <dt>Transaction ID</dt>
                <dd>{t.id || "—"}</dd>
              </div>
              <div>
                <dt>Employee ID</dt>
                <dd>{t.employeeId || "—"}</dd>
              </div>
              <div>
                <dt>Department</dt>
                <dd>{t.department || "—"}</dd>
              </div>
              <div>
                <dt>Date</dt>
                <dd>{t.transactionDate || "—"}</dd>
              </div>
              <div>
                <dt>Type</dt>
                <dd>{t.debitOrCredit || "—"}</dd>
              </div>
            </dl>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function DataQualityPanel() {
  const summary = useMemo(() => validationSummary(), []);
  const invalid = useMemo(() => getInvalidTransactions(), []);
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (summary.invalidCount === 0) return null;

  const rowKey = (entry: InvalidEntry, index: number) =>
    entry.transaction.id || `invalid-${index}`;

  return (
    <>
      <button
        type="button"
        className="dq-trigger"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="dq-trigger-dot" aria-hidden />
        <span className="dq-trigger-text">
          {summary.invalidCount.toLocaleString()} excluded from chart
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.button
              type="button"
              className="dq-backdrop"
              aria-label="Close data quality panel"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.aside
              className="dq-panel"
              role="dialog"
              aria-labelledby="dq-panel-title"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 320 }}
            >
              <header className="dq-panel-head">
                <div>
                  <h2 id="dq-panel-title">Data quality</h2>
                  <p className="dq-panel-sub">
                    These rows are hidden from the 3D explore chart because they fail
                    validation checks.
                  </p>
                </div>
                <button
                  type="button"
                  className="dq-close"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                >
                  ×
                </button>
              </header>

              <div className="dq-stats">
                <div className="dq-stat">
                  <span className="dq-stat-v">{summary.validCount.toLocaleString()}</span>
                  <span className="dq-stat-l">Valid</span>
                </div>
                <div className="dq-stat bad">
                  <span className="dq-stat-v">{summary.invalidCount.toLocaleString()}</span>
                  <span className="dq-stat-l">Excluded</span>
                </div>
              </div>

              {summary.byIssue.length > 0 && (
                <div className="dq-breakdown">
                  <div className="dq-breakdown-title">Issues</div>
                  <ul className="dq-breakdown-list">
                    {summary.byIssue.map(([issue, count]) => (
                      <li key={issue}>
                        <span>{ISSUE_LABELS[issue]}</span>
                        <span className="dq-breakdown-n">{count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="dq-list-label">Excluded transactions</div>
              <div className="dq-list">
                {invalid.slice(0, 200).map((entry, i) => {
                  const key = rowKey(entry, i);
                  return (
                    <InvalidRow
                      key={key}
                      entry={entry}
                      expanded={expandedId === key}
                      onToggle={() =>
                        setExpandedId((cur) => (cur === key ? null : key))
                      }
                    />
                  );
                })}
                {invalid.length > 200 && (
                  <p className="dq-list-more">
                    Showing 200 of {invalid.length.toLocaleString()} excluded rows.
                  </p>
                )}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
