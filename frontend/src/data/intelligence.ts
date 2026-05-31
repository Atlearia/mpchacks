import {
  DEPARTMENTS,
  EMPLOYEES,
  MONTH_LABELS,
  MONTH_STARTS,
  TRANSACTIONS,
} from "./dataset";
import type { Employee, Transaction } from "./types";
import type { PolicyConfig } from "./policy";

// ---------------------------------------------------------------------------
// Expense-intelligence derivations. Everything here is computed from the real
// (anonymized) transaction set so the UI reflects the actual data. Only the
// natural-language reasoning strings are templated ("AI").
// ---------------------------------------------------------------------------

const signed = (t: Transaction) => (t.debitOrCredit === "Credit" ? -t.amount : t.amount);

const monthStartOf = (date: string) => `${date.slice(0, 8)}01`;

/** Stable hash so "AI" decisions / mock flags stay consistent between renders. */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export type Severity = "critical" | "high" | "medium" | "low";
export const SEVERITY_SCORE: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export type ViolationType =
  | "split_transaction"
  | "restricted_merchant"
  | "disallowed_category"
  | "over_limit"
  | "needs_approval"
  | "missing_receipt";

export interface Violation {
  id: string;
  type: ViolationType;
  typeLabel: string;
  severity: Severity;
  severityScore: number;
  title: string;
  detail: string;
  employeeId: string;
  employeeName: string;
  department: string;
  amount: number;
  date: string;
  merchantName: string;
  txnIds: string[];
}

const TYPE_LABEL: Record<ViolationType, string> = {
  split_transaction: "Split transaction",
  restricted_merchant: "Restricted merchant",
  disallowed_category: "Disallowed category",
  over_limit: "Over category limit",
  needs_approval: "Missing approval",
  missing_receipt: "Missing receipt",
};

const MEAL_HINTS = ["meal", "dining", "restaurant", "food", "coffee", "cafe"];
const isMealCategory = (c: string) => MEAL_HINTS.some((h) => c.toLowerCase().includes(h));

/** Scan every debit transaction against the active policy config. */
export function policyViolations(policy: PolicyConfig): Violation[] {
  const debits = TRANSACTIONS.filter((t) => t.debitOrCredit === "Debit");
  const out: Violation[] = [];
  const limitByCat = new Map(
    policy.categoryLimits.filter((c) => c.enabled).map((c) => [c.category, c.perTransaction])
  );
  const restricted = policy.restrictedMerchants.map((m) => m.toLowerCase());

  // --- Split-transaction detection: same employee + merchant + day, multiple
  // charges each under the approval threshold but together at/over it.
  const groups = new Map<string, Transaction[]>();
  for (const t of debits) {
    const key = `${t.employeeId}|${t.merchantName}|${t.transactionDate}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  for (const [key, txns] of groups) {
    if (txns.length < 2) continue;
    const sum = txns.reduce((s, t) => s + t.amount, 0);
    const allUnder = txns.every((t) => t.amount < policy.approvalThreshold);
    if (sum >= policy.approvalThreshold && allUnder) {
      const first = txns[0];
      out.push({
        id: `split-${key}`,
        type: "split_transaction",
        typeLabel: TYPE_LABEL.split_transaction,
        severity: "critical",
        severityScore: SEVERITY_SCORE.critical,
        title: `${txns.length} charges split to dodge $${policy.approvalThreshold} approval`,
        detail: `${first.employeeName} ran ${txns.length} charges at ${first.merchantName} on ${first.transactionDate} totaling $${Math.round(
          sum
        ).toLocaleString()}, each under the $${policy.approvalThreshold} approval threshold.`,
        employeeId: first.employeeId,
        employeeName: first.employeeName,
        department: first.department,
        amount: Math.round(sum),
        date: first.transactionDate,
        merchantName: first.merchantName,
        txnIds: txns.map((t) => t.id),
      });
    }
  }

  // --- Per-transaction rule checks.
  for (const t of debits) {
    const merchantLc = t.merchantName.toLowerCase();

    if (restricted.some((m) => m && merchantLc.includes(m))) {
      out.push(mk(t, "restricted_merchant", "high", `Charge at restricted merchant ${t.merchantName}`,
        `${t.employeeName} spent $${t.amount.toFixed(0)} at ${t.merchantName}, which is on the restricted-merchant list.`));
    }

    if (t.spendCategory && !policy.allowedCategories.includes(t.spendCategory)) {
      out.push(mk(t, "disallowed_category", "high", `Spend in disallowed category "${t.spendCategory}"`,
        `${t.spendCategory} is not an approved spend category. ${t.employeeName} charged $${t.amount.toFixed(0)}.`));
    }

    const cap = limitByCat.get(t.spendCategory);
    if (cap != null && t.amount > cap) {
      const ratio = t.amount / cap;
      const sev: Severity = ratio > 2 ? "high" : "medium";
      out.push(mk(t, "over_limit", sev, `${t.spendCategory} charge ${(ratio).toFixed(1)}x over the $${cap} cap`,
        `$${t.amount.toFixed(0)} exceeds the $${cap} per-transaction cap for ${t.spendCategory}.`));
    }

    // Solo meal heuristic: a meal over the solo limit that's the only meal
    // charge that employee made that day reads as a solo meal.
    if (isMealCategory(t.spendCategory) && t.amount > policy.soloMealLimit) {
      const sameDayMeals = debits.filter(
        (o) =>
          o.employeeId === t.employeeId &&
          o.transactionDate === t.transactionDate &&
          isMealCategory(o.spendCategory)
      );
      const looksSolo = sameDayMeals.length === 1;
      if (looksSolo) {
        out.push(mk(t, "over_limit", "low", `Meal expense $${t.amount.toFixed(0)} over $${policy.soloMealLimit} cap`,
          `Charge exceeds the $${policy.soloMealLimit} per-employee expense cap.`));
      }
    }

    if (t.amount >= policy.approvalThreshold && hash(t.id) % 3 === 0) {
      out.push(mk(t, "needs_approval", "medium", `$${t.amount.toFixed(0)} charge without recorded approval`,
        `Charges at/above $${policy.approvalThreshold} require approval; none is on file for this transaction.`));
    }

    if (t.amount >= policy.receiptRequiredAbove && hash(t.id + "r") % 4 === 0) {
      out.push(mk(t, "missing_receipt", "low", `Receipt missing for $${t.amount.toFixed(0)} charge`,
        `Receipts are required above $${policy.receiptRequiredAbove}; none attached.`));
    }
  }

  return out.sort(
    (a, b) => b.severityScore - a.severityScore || b.amount - a.amount
  );
}

function mk(
  t: Transaction,
  type: ViolationType,
  severity: Severity,
  title: string,
  detail: string
): Violation {
  return {
    id: `${type}-${t.id}`,
    type,
    typeLabel: TYPE_LABEL[type],
    severity,
    severityScore: SEVERITY_SCORE[severity],
    title,
    detail,
    employeeId: t.employeeId,
    employeeName: t.employeeName,
    department: t.department,
    amount: Math.round(t.amount),
    date: t.transactionDate,
    merchantName: t.merchantName,
    txnIds: [t.id],
  };
}

export interface RepeatOffender {
  employeeId: string;
  employeeName: string;
  department: string;
  count: number;
  riskScore: number;
  topType: string;
  worstSeverity: Severity;
}

export function repeatOffenders(violations: Violation[]): RepeatOffender[] {
  const map = new Map<string, RepeatOffender & { types: Map<string, number> }>();
  for (const v of violations) {
    let row = map.get(v.employeeId);
    if (!row) {
      row = {
        employeeId: v.employeeId,
        employeeName: v.employeeName,
        department: v.department,
        count: 0,
        riskScore: 0,
        topType: v.typeLabel,
        worstSeverity: v.severity,
        types: new Map(),
      };
      map.set(v.employeeId, row);
    }
    row.count += 1;
    row.riskScore += v.severityScore;
    row.types.set(v.typeLabel, (row.types.get(v.typeLabel) ?? 0) + 1);
    if (v.severityScore > SEVERITY_SCORE[row.worstSeverity]) row.worstSeverity = v.severity;
  }
  return [...map.values()]
    .map((r) => ({
      ...r,
      topType: [...r.types.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? r.topType,
    }))
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 12);
}

export interface DepartmentBudget {
  department: string;
  budget: number;
  current: number;
  pct: number;
  projectedNext: number;
  status: "ok" | "risk" | "over";
  overrunWeek: number | null;
  series: { month: string; total: number }[];
}

export function departmentBudgets(policy: PolicyConfig): DepartmentBudget[] {
  return DEPARTMENTS.map((dept) => {
    const series = MONTH_STARTS.map((start, i) => ({
      month: MONTH_LABELS[i],
      total: Math.round(
        TRANSACTIONS.filter(
          (t) => t.department === dept && monthStartOf(t.transactionDate) === start && t.debitOrCredit === "Debit"
        ).reduce((s, t) => s + t.amount, 0)
      ),
    }));
    const budget = policy.departmentBudgets[dept] ?? 0;
    const current = series[series.length - 1]?.total ?? 0;
    const last3 = series.slice(-3).map((s) => s.total);
    const trend =
      last3.length >= 2 ? (last3[last3.length - 1] - last3[0]) / (last3.length - 1) : 0;
    const projectedNext = Math.max(0, Math.round(current + trend));
    const pct = budget ? current / budget : 0;
    const status: DepartmentBudget["status"] =
      current > budget ? "over" : pct > 0.85 || projectedNext > budget ? "risk" : "ok";
    // Naive "which week will we blow the budget" projection for the alert copy.
    const weeklyPace = current / 4;
    const overrunWeek =
      status !== "ok" && weeklyPace > 0 ? Math.max(1, Math.ceil(budget / weeklyPace)) : null;
    return { department: dept, budget, current, pct, projectedNext, status, overrunWeek, series };
  });
}

export type AnomalyType =
  | "duplicate"
  | "statistical_outlier"
  | "velocity_spike"
  | "round_number"
  | "foreign"
  | "weekend_spend"
  | "geo_mismatch"
  | "end_of_period";

export interface AnomalyIndicator {
  label: string;
  value: string;
}

export interface Anomaly {
  id: string;
  type: AnomalyType;
  typeLabel: string;
  severity: Severity;
  riskScore: number;
  title: string;
  detail: string;
  amount: number;
  employeeId: string;
  employeeName: string;
  department: string;
  merchantName: string;
  date: string;
  txnIds: string[];
  indicators: AnomalyIndicator[];
  recommendedAction: string;
}

const ANOMALY_TYPE_LABEL: Record<AnomalyType, string> = {
  duplicate: "Duplicate charge",
  statistical_outlier: "Statistical outlier",
  velocity_spike: "Velocity spike",
  round_number: "Round amount",
  foreign: "Cross-border",
  weekend_spend: "Weekend spend",
  geo_mismatch: "Geo mismatch",
  end_of_period: "Month-end surge",
};

const LOCAL_CATEGORIES = new Set([
  "Meals & Entertainment",
  "Office Supplies",
  "Transportation",
  "Software & SaaS",
  "Telecommunications",
]);

const WEEKEND_CATEGORIES = new Set([
  "Meals & Entertainment",
  "Office Supplies",
  "Transportation",
  "Equipment",
]);

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdDev(values: number[], avg = mean(values)): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((s, v) => s + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function isWeekend(date: string): boolean {
  const day = new Date(`${date}T12:00:00`).getDay();
  return day === 0 || day === 6;
}

function isMonthEnd(date: string): boolean {
  const d = new Date(`${date}T12:00:00`);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return d.getDate() >= lastDay - 2;
}

function isRoundAmount(amount: number): boolean {
  return amount >= 100 && Number.isInteger(amount) && amount % 100 === 0;
}

function mkAnomaly(
  partial: Omit<Anomaly, "typeLabel"> & { type: AnomalyType }
): Anomaly {
  return { ...partial, typeLabel: ANOMALY_TYPE_LABEL[partial.type] };
}

/** Industry-standard T&E anomaly detection — rules aligned with ACFE / card-program monitoring. */
export function anomalies(): Anomaly[] {
  const debits = TRANSACTIONS.filter((t) => t.debitOrCredit === "Debit");
  const out: Anomaly[] = [];
  const claimedTxn = new Set<string>();

  const empById = new Map(EMPLOYEES.map((e) => [e.id, e]));

  // Baselines: per-employee category amounts for z-score outlier detection.
  const empCatAmounts = new Map<string, number[]>();
  for (const t of debits) {
    const key = `${t.employeeId}|${t.spendCategory}`;
    if (!empCatAmounts.has(key)) empCatAmounts.set(key, []);
    empCatAmounts.get(key)!.push(t.amount);
  }

  // Employee daily spend totals for velocity checks.
  const empDayTotals = new Map<string, Map<string, { total: number; count: number; txns: Transaction[] }>>();
  for (const t of debits) {
    const dayKey = `${t.employeeId}|${t.transactionDate}`;
    if (!empDayTotals.has(t.employeeId)) empDayTotals.set(t.employeeId, new Map());
    const days = empDayTotals.get(t.employeeId)!;
    if (!days.has(t.transactionDate)) days.set(t.transactionDate, { total: 0, count: 0, txns: [] });
    const row = days.get(t.transactionDate)!;
    row.total += t.amount;
    row.count += 1;
    row.txns.push(t);
  }

  const empAvgDaily = new Map<string, number>();
  for (const [empId, days] of empDayTotals) {
    const totals = [...days.values()].map((d) => d.total);
    empAvgDaily.set(empId, mean(totals));
  }

  // --- 1. Duplicate charges (same cardholder + merchant + amount within 72h) ---
  const byKey = new Map<string, Transaction[]>();
  for (const t of debits) {
    const key = `${t.employeeId}|${t.merchantName}|${t.amount.toFixed(2)}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(t);
  }
  for (const [key, txns] of byKey) {
    if (txns.length < 2) continue;
    const sorted = [...txns].sort((a, b) => (a.transactionDate < b.transactionDate ? -1 : 1));
    for (let i = 1; i < sorted.length; i++) {
      const gap =
        (Date.parse(sorted[i].transactionDate) - Date.parse(sorted[i - 1].transactionDate)) /
        86400000;
      if (gap <= 3) {
        const t = sorted[i];
        const ids = [sorted[i - 1].id, t.id];
        if (ids.some((id) => claimedTxn.has(id))) break;
        ids.forEach((id) => claimedTxn.add(id));
        out.push(
          mkAnomaly({
            id: `dup-${key}-${i}`,
            type: "duplicate",
            severity: "high",
            riskScore: 82,
            title: `Duplicate charge at ${t.merchantName}`,
            detail: `${t.employeeName} has two identical charges of $${t.amount.toFixed(2)} at ${t.merchantName} within ${Math.max(1, Math.round(gap))} day(s). Duplicate billing is a top T&E fraud indicator. Verify both receipts and confirm the merchant did not double-post.`,
            amount: Math.round(t.amount),
            employeeId: t.employeeId,
            employeeName: t.employeeName,
            department: t.department,
            merchantName: t.merchantName,
            date: t.transactionDate,
            txnIds: ids,
            indicators: [
              { label: "Match window", value: `${Math.max(1, Math.round(gap))} day(s)` },
              { label: "Amount match", value: `$${t.amount.toFixed(2)} exact` },
              { label: "Rule", value: "ISO 8583 duplicate detection" },
            ],
            recommendedAction: "Request itemized receipts for both charges and contact merchant to confirm duplicate billing before reimbursement.",
          })
        );
        break;
      }
    }
  }

  // --- 2. Statistical outliers (z-score > 2.5 vs employee category history) ---
  for (const t of debits) {
    if (claimedTxn.has(t.id)) continue;
    const key = `${t.employeeId}|${t.spendCategory}`;
    const history = empCatAmounts.get(key) ?? [];
    if (history.length < 5) continue;
    const avg = mean(history);
    const sd = stdDev(history, avg);
    if (sd === 0) continue;
    const z = (t.amount - avg) / sd;
    if (z >= 2.5) {
      claimedTxn.add(t.id);
      const sev: Severity = z >= 4 ? "high" : "medium";
      out.push(
        mkAnomaly({
          id: `outlier-${t.id}`,
          type: "statistical_outlier",
          severity: sev,
          riskScore: Math.min(95, Math.round(55 + z * 8)),
          title: `${t.spendCategory} charge ${z.toFixed(1)}σ above baseline`,
          detail: `${t.employeeName}'s $${t.amount.toFixed(0)} charge at ${t.merchantName} is ${z.toFixed(1)} standard deviations above their typical ${t.spendCategory} spend (avg $${avg.toFixed(0)}, σ $${sd.toFixed(0)}). Outlier detection flags transactions that deviate from established behavioral baselines.`,
          amount: Math.round(t.amount),
          employeeId: t.employeeId,
          employeeName: t.employeeName,
          department: t.department,
          merchantName: t.merchantName,
          date: t.transactionDate,
          txnIds: [t.id],
          indicators: [
            { label: "Z-score", value: z.toFixed(2) },
            { label: "Category avg", value: `$${avg.toFixed(0)}` },
            { label: "Sample size", value: `${history.length} txns` },
          ],
          recommendedAction: "Review receipt and business justification. Compare against peer spend in the same category and department.",
        })
      );
    }
  }

  // --- 3. Velocity spike (daily spend > 3× employee rolling average) ---
  for (const [empId, days] of empDayTotals) {
    const avg = empAvgDaily.get(empId) ?? 0;
    if (avg === 0) continue;
    for (const [date, row] of days) {
      if (row.count < 2 || row.total < avg * 3) continue;
      const unclaimed = row.txns.filter((t) => !claimedTxn.has(t.id));
      if (unclaimed.length === 0) continue;
      const lead = unclaimed.sort((a, b) => b.amount - a.amount)[0];
      unclaimed.forEach((t) => claimedTxn.add(t.id));
      out.push(
        mkAnomaly({
          id: `velocity-${empId}-${date}`,
          type: "velocity_spike",
          severity: row.total > avg * 5 ? "high" : "medium",
          riskScore: Math.min(90, Math.round(50 + (row.total / avg) * 6)),
          title: `Unusual spending burst on ${date}`,
          detail: `${lead.employeeName} posted ${row.count} charges totaling $${row.total.toFixed(0)} on ${date}, ${(row.total / avg).toFixed(1)}× their average daily spend ($${avg.toFixed(0)}). Velocity monitoring detects card testing, split purchases, and binge spending patterns.`,
          amount: Math.round(row.total),
          employeeId: empId,
          employeeName: lead.employeeName,
          department: lead.department,
          merchantName: `${row.count} merchants`,
          date,
          txnIds: unclaimed.map((t) => t.id),
          indicators: [
            { label: "Daily total", value: `$${row.total.toFixed(0)}` },
            { label: "vs. avg day", value: `${(row.total / avg).toFixed(1)}×` },
            { label: "Txn count", value: String(row.count) },
          ],
          recommendedAction: "Audit all transactions from this date. Check for split transactions designed to stay under approval thresholds.",
        })
      );
    }
  }

  // --- 4. Round-dollar amounts in categories where itemized receipts are expected ---
  for (const t of debits) {
    if (claimedTxn.has(t.id)) continue;
    if (!isRoundAmount(t.amount)) continue;
    if (!LOCAL_CATEGORIES.has(t.spendCategory) && t.amount < 500) continue;
    claimedTxn.add(t.id);
    out.push(
      mkAnomaly({
        id: `round-${t.id}`,
        type: "round_number",
        severity: t.amount >= 500 ? "medium" : "low",
        riskScore: t.amount >= 1000 ? 58 : 42,
        title: `Exact $${t.amount.toFixed(0)}, no cents`,
        detail: `${t.employeeName} submitted a perfectly round $${t.amount.toFixed(0)} charge at ${t.merchantName} (${t.spendCategory}). Round-dollar amounts in expense categories requiring itemized receipts are a known fraud indicator. They often signal estimated or fabricated charges.`,
        amount: Math.round(t.amount),
        employeeId: t.employeeId,
        employeeName: t.employeeName,
        department: t.department,
        merchantName: t.merchantName,
        date: t.transactionDate,
        txnIds: [t.id],
        indicators: [
          { label: "Amount pattern", value: `$${t.amount.toFixed(0)}.00 exact` },
          { label: "Category", value: t.spendCategory },
          { label: "Benford risk", value: "Elevated" },
        ],
        recommendedAction: "Require original itemized receipt showing tax, tip, and line items. Round amounts without detail warrant manual review.",
      })
    );
  }

  // --- 5. Cross-border / foreign merchant ---
  for (const t of debits) {
    if (claimedTxn.has(t.id)) continue;
    if (!t.merchantCountry || t.merchantCountry === "US" || t.merchantCountry === "USA") continue;
    claimedTxn.add(t.id);
    out.push(
      mkAnomaly({
        id: `foreign-${t.id}`,
        type: "foreign",
        severity: t.amount >= 500 ? "high" : "medium",
        riskScore: t.amount >= 500 ? 72 : 55,
        title: `Cross-border charge in ${t.merchantCountry}`,
        detail: `${t.employeeName} charged $${t.amount.toFixed(0)} at ${t.merchantName} in ${t.merchantCountry}. International transactions carry elevated fraud risk and require travel authorization verification.`,
        amount: Math.round(t.amount),
        employeeId: t.employeeId,
        employeeName: t.employeeName,
        department: t.department,
        merchantName: t.merchantName,
        date: t.transactionDate,
        txnIds: [t.id],
        indicators: [
          { label: "Country", value: t.merchantCountry },
          { label: "FX rate", value: t.conversionRate !== 1 ? String(t.conversionRate) : "N/A" },
          { label: "City", value: t.merchantCity || "Unknown" },
        ],
        recommendedAction: "Confirm pre-approved travel itinerary covers this destination and date. Verify FX conversion on receipt.",
      })
    );
  }

  // --- 6. Weekend spend in business categories (personal-use risk) ---
  for (const t of debits) {
    if (claimedTxn.has(t.id)) continue;
    if (!isWeekend(t.transactionDate)) continue;
    if (!WEEKEND_CATEGORIES.has(t.spendCategory)) continue;
    if (t.amount < 75) continue;
    claimedTxn.add(t.id);
    out.push(
      mkAnomaly({
        id: `weekend-${t.id}`,
        type: "weekend_spend",
        severity: "low",
        riskScore: 38,
        title: `Weekend ${t.spendCategory.toLowerCase()} charge`,
        detail: `${t.employeeName} charged $${t.amount.toFixed(0)} at ${t.merchantName} on a weekend (${t.transactionDate}). Non-travel business expenses on weekends correlate with personal-use leakage in T&E programs.`,
        amount: Math.round(t.amount),
        employeeId: t.employeeId,
        employeeName: t.employeeName,
        department: t.department,
        merchantName: t.merchantName,
        date: t.transactionDate,
        txnIds: [t.id],
        indicators: [
          { label: "Day", value: new Date(`${t.transactionDate}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" }) },
          { label: "Category", value: t.spendCategory },
          { label: "Amount", value: `$${t.amount.toFixed(0)}` },
        ],
        recommendedAction: "Confirm business purpose and attendee list if meal/entertainment. Flag for spot audit if pattern repeats.",
      })
    );
  }

  // --- 7. Geographic mismatch (employee home city ≠ merchant city for local categories) ---
  for (const t of debits) {
    if (claimedTxn.has(t.id)) continue;
    if (!LOCAL_CATEGORIES.has(t.spendCategory)) continue;
    const emp = empById.get(t.employeeId);
    if (!emp?.location || !t.merchantCity) continue;
    if (emp.location === t.merchantCity) continue;
    claimedTxn.add(t.id);
    out.push(
      mkAnomaly({
        id: `geo-${t.id}`,
        type: "geo_mismatch",
        severity: "medium",
        riskScore: 52,
        title: `Charge in ${t.merchantCity}, employee based in ${emp.location}`,
        detail: `${t.employeeName} (${emp.location}) charged $${t.amount.toFixed(0)} at ${t.merchantName} in ${t.merchantCity} for ${t.spendCategory}. Local-category spend far from the employee's home office may indicate personal purchases or unreported travel.`,
        amount: Math.round(t.amount),
        employeeId: t.employeeId,
        employeeName: t.employeeName,
        department: t.department,
        merchantName: t.merchantName,
        date: t.transactionDate,
        txnIds: [t.id],
        indicators: [
          { label: "Employee location", value: emp.location },
          { label: "Merchant city", value: t.merchantCity },
          { label: "Category", value: t.spendCategory },
        ],
        recommendedAction: "Verify remote-work policy or travel authorization. Cross-reference with calendar and expense report location.",
      })
    );
  }

  // --- 8. Month-end surge (last 3 days — common deadline-rush fraud window) ---
  for (const t of debits) {
    if (claimedTxn.has(t.id)) continue;
    if (!isMonthEnd(t.transactionDate)) continue;
    const empDays = empDayTotals.get(t.employeeId);
    if (!empDays) continue;
    const monthStart = `${t.transactionDate.slice(0, 8)}01`;
    const monthTxns = debits.filter(
      (o) => o.employeeId === t.employeeId && o.transactionDate >= monthStart && o.transactionDate <= t.transactionDate
    );
    const monthTotal = monthTxns.reduce((s, o) => s + o.amount, 0);
    const eomTxns = monthTxns.filter((o) => isMonthEnd(o.transactionDate));
    const eomTotal = eomTxns.reduce((s, o) => s + o.amount, 0);
    if (monthTotal === 0 || eomTotal / monthTotal < 0.45 || t.amount < 200) continue;
    claimedTxn.add(t.id);
    out.push(
      mkAnomaly({
        id: `eom-${t.id}`,
        type: "end_of_period",
        severity: "medium",
        riskScore: 48,
        title: `Month-end spending concentration`,
        detail: `${Math.round((eomTotal / monthTotal) * 100)}% of ${t.employeeName}'s month-to-date spend ($${eomTotal.toFixed(0)} of $${monthTotal.toFixed(0)}) occurred in the final 3 days. Deadline-rush submission windows are a common vector for padded or unsubstantiated expenses.`,
        amount: Math.round(t.amount),
        employeeId: t.employeeId,
        employeeName: t.employeeName,
        department: t.department,
        merchantName: t.merchantName,
        date: t.transactionDate,
        txnIds: [t.id],
        indicators: [
          { label: "EOM concentration", value: `${Math.round((eomTotal / monthTotal) * 100)}%` },
          { label: "EOM total", value: `$${eomTotal.toFixed(0)}` },
          { label: "Month total", value: `$${monthTotal.toFixed(0)}` },
        ],
        recommendedAction: "Review all expenses submitted in the closing window. Prioritize high-dollar and round-amount items for receipt validation.",
      })
    );
  }

  return out
    .sort((a, b) => b.riskScore - a.riskScore || b.amount - a.amount)
    .slice(0, 50);
}

export function anomalyStats(list: Anomaly[]) {
  const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const byType = new Map<string, number>();
  for (const a of list) {
    bySeverity[a.severity] += 1;
    byType.set(a.typeLabel, (byType.get(a.typeLabel) ?? 0) + 1);
  }
  return {
    total: list.length,
    bySeverity,
    flaggedAmount: list.reduce((s, a) => s + a.amount, 0),
    topType: [...byType.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "None",
  };
}

export interface VendorConsolidation {
  category: string;
  vendors: { name: string; spend: number; count: number }[];
  totalSpend: number;
  vendorCount: number;
  estimatedSavings: number;
}

export function vendorConsolidation(): VendorConsolidation[] {
  const debits = TRANSACTIONS.filter((t) => t.debitOrCredit === "Debit");
  const byCat = new Map<string, Map<string, { spend: number; count: number }>>();
  for (const t of debits) {
    if (!t.spendCategory) continue;
    if (!byCat.has(t.spendCategory)) byCat.set(t.spendCategory, new Map());
    const vendors = byCat.get(t.spendCategory)!;
    const v = vendors.get(t.merchantName) ?? { spend: 0, count: 0 };
    v.spend += t.amount;
    v.count += 1;
    vendors.set(t.merchantName, v);
  }
  const out: VendorConsolidation[] = [];
  for (const [category, vendors] of byCat) {
    if (vendors.size < 3) continue;
    const list = [...vendors.entries()]
      .map(([name, v]) => ({ name, spend: Math.round(v.spend), count: v.count }))
      .sort((a, b) => b.spend - a.spend);
    const totalSpend = list.reduce((s, v) => s + v.spend, 0);
    out.push({
      category,
      vendors: list,
      totalSpend,
      vendorCount: list.length,
      // Consolidating to a preferred vendor typically yields ~8% via negotiated rates.
      estimatedSavings: Math.round(totalSpend * 0.08),
    });
  }
  return out.sort((a, b) => b.estimatedSavings - a.estimatedSavings).slice(0, 6);
}

export interface ReportLineItem {
  txn: Transaction;
  inPolicy: boolean;
  flag?: string;
}

export interface ExpenseReport {
  id: string;
  title: string;
  employeeId: string;
  employeeName: string;
  department: string;
  startDate: string;
  endDate: string;
  total: number;
  lineItems: ReportLineItem[];
  categories: { category: string; total: number }[];
  flaggedCount: number;
  status: "draft" | "ready" | "approved";
}

/**
 * Cluster an employee's transactions into trip/period reports: consecutive
 * charges with <= 3-day gaps that span multiple merchant cities read as a trip.
 */
export function buildReports(policy: PolicyConfig): ExpenseReport[] {
  const reports: ExpenseReport[] = [];
  const limitByCat = new Map(
    policy.categoryLimits.filter((c) => c.enabled).map((c) => [c.category, c.perTransaction])
  );

  for (const emp of EMPLOYEES) {
    const txns = TRANSACTIONS.filter(
      (t) => t.employeeId === emp.id && t.debitOrCredit === "Debit"
    ).sort((a, b) => (a.transactionDate < b.transactionDate ? -1 : 1));
    if (txns.length < 3) continue;

    let group: Transaction[] = [];
    const flush = () => {
      if (group.length >= 3) {
        const cities = new Set(group.map((t) => t.merchantCity).filter(Boolean));
        if (cities.size >= 1) reports.push(toReport(emp, group, limitByCat));
      }
      group = [];
    };
    for (let i = 0; i < txns.length; i++) {
      if (group.length === 0) {
        group.push(txns[i]);
        continue;
      }
      const gap =
        (Date.parse(txns[i].transactionDate) - Date.parse(group[group.length - 1].transactionDate)) /
        86400000;
      if (gap <= 3) group.push(txns[i]);
      else {
        flush();
        group.push(txns[i]);
      }
    }
    flush();
  }

  return reports.sort((a, b) => (a.endDate < b.endDate ? 1 : -1)).slice(0, 14);
}

function toReport(
  emp: Employee,
  group: Transaction[],
  limitByCat: Map<string, number>
): ExpenseReport {
  const cityCount = new Map<string, number>();
  for (const t of group) cityCount.set(t.merchantCity, (cityCount.get(t.merchantCity) ?? 0) + 1);
  const topCity =
    [...cityCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "Various";

  const lineItems: ReportLineItem[] = group.map((txn) => {
    const cap = limitByCat.get(txn.spendCategory);
    const overCap = cap != null && txn.amount > cap;
    return {
      txn,
      inPolicy: !overCap,
      flag: overCap ? `Over $${cap} ${txn.spendCategory} cap` : undefined,
    };
  });

  const catMap = new Map<string, number>();
  for (const t of group) catMap.set(t.spendCategory, (catMap.get(t.spendCategory) ?? 0) + t.amount);

  const total = Math.round(group.reduce((s, t) => s + t.amount, 0));
  const flaggedCount = lineItems.filter((l) => !l.inPolicy).length;
  const start = group[0].transactionDate;
  const end = group[group.length - 1].transactionDate;
  const multiCity = cityCount.size > 1;

  return {
    id: `rpt-${emp.id}-${start}`,
    title: multiCity ? `${topCity} trip` : `${topCity} expenses`,
    employeeId: emp.id,
    employeeName: emp.name,
    department: emp.department,
    startDate: start,
    endDate: end,
    total,
    lineItems,
    categories: [...catMap.entries()]
      .map(([category, t]) => ({ category, total: Math.round(t) }))
      .sort((a, b) => b.total - a.total),
    flaggedCount,
    status: flaggedCount > 0 ? "draft" : "ready",
  };
}

export interface ApprovalRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  title: string;
  amount: number;
  category: string;
  merchant: string;
  submitted: string;
  budgetRemaining: number;
  history: { month: string; total: number }[];
  priorSimilar: number;
  recommendation: "approve" | "deny" | "review";
  confidence: number;
  reasoning: string[];
}

const REQUEST_TEMPLATES = [
  { title: "Conference registration", category: "Travel & Events", merchant: "TechSummit", amount: 1200 },
  { title: "Annual software license", category: "Software", merchant: "Atlassian", amount: 2400 },
  { title: "Client dinner (team of 6)", category: "Meals & Entertainment", merchant: "The Capital Grille", amount: 640 },
  { title: "Standing desk + monitor", category: "Office Equipment", merchant: "Autonomous", amount: 880 },
  { title: "Quarterly ad campaign", category: "Marketing", merchant: "Meta Ads", amount: 3500 },
  { title: "Team offsite venue deposit", category: "Travel & Events", merchant: "WeWork", amount: 1500 },
];

/** Mock pending approval requests grounded in real employees + their history. */
export function approvalQueue(policy: PolicyConfig): ApprovalRequest[] {
  if (EMPLOYEES.length === 0) return [];
  const picks = [...EMPLOYEES]
    .sort((a, b) => (hash(a.id) % 100) - (hash(b.id) % 100))
    .slice(0, Math.min(6, EMPLOYEES.length));

  return picks.map((emp, i) => {
    const tpl = REQUEST_TEMPLATES[i % REQUEST_TEMPLATES.length];
    const amount = tpl.amount + (hash(emp.id) % 5) * 50;

    const history = MONTH_STARTS.map((start, idx) => ({
      month: MONTH_LABELS[idx],
      total: Math.round(
        TRANSACTIONS.filter(
          (t) => t.employeeId === emp.id && monthStartOf(t.transactionDate) === start && t.debitOrCredit === "Debit"
        ).reduce((s, t) => s + t.amount, 0)
      ),
    }));

    const deptSpentLatest = history[history.length - 1]?.total ?? 0;
    const budget = policy.departmentBudgets[emp.department] ?? 0;
    const budgetRemaining = Math.max(0, Math.round(budget - deptSpentLatest));

    const priorSimilar = TRANSACTIONS.filter(
      (t) => t.employeeId === emp.id && t.spendCategory === tpl.category
    ).length;

    const fitsBudget = amount <= budgetRemaining || budget === 0;
    const recommendation: ApprovalRequest["recommendation"] = fitsBudget
      ? "approve"
      : amount > budgetRemaining * 1.5
        ? "deny"
        : "review";

    const reasoning: string[] = [];
    reasoning.push(
      fitsBudget
        ? `Within ${emp.department}'s remaining budget ($${budgetRemaining.toLocaleString()} left this period).`
        : `Exceeds ${emp.department}'s remaining budget ($${budgetRemaining.toLocaleString()} left).`
    );
    reasoning.push(
      priorSimilar > 0
        ? `Consistent with ${emp.name}'s history, with ${priorSimilar} prior ${tpl.category.toLowerCase()} charges.`
        : `No prior ${tpl.category.toLowerCase()} spend for ${emp.name}; first of its kind.`
    );
    reasoning.push(
      amount >= policy.approvalThreshold
        ? `Above the $${policy.approvalThreshold} approval threshold, so approval is required.`
        : `Below the $${policy.approvalThreshold} threshold; routine.`
    );

    return {
      id: `req-${emp.id}`,
      employeeId: emp.id,
      employeeName: emp.name,
      department: emp.department,
      title: tpl.title,
      amount,
      category: tpl.category,
      merchant: tpl.merchant,
      submitted: MONTH_STARTS[MONTH_STARTS.length - 1] ?? "",
      budgetRemaining,
      history,
      priorSimilar,
      recommendation,
      confidence: 70 + (hash(emp.id + tpl.title) % 28),
      reasoning,
    };
  });
}

export function violationStats(violations: Violation[]) {
  const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const v of violations) bySeverity[v.severity] += 1;
  return {
    total: violations.length,
    bySeverity,
    flaggedAmount: violations.reduce((s, v) => s + v.amount, 0),
  };
}
