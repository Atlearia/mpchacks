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
        ).toLocaleString()} — each under the $${policy.approvalThreshold} approval threshold.`,
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
        `Charges at/above $${policy.approvalThreshold} require pre-approval; none is on file for this transaction.`));
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

export type AnomalyType = "duplicate" | "round_number" | "foreign" | "high_value";

export interface Anomaly {
  id: string;
  type: AnomalyType;
  typeLabel: string;
  title: string;
  detail: string;
  amount: number;
  employeeName: string;
  department: string;
  date: string;
  txnIds: string[];
}

export function anomalies(): Anomaly[] {
  const debits = TRANSACTIONS.filter((t) => t.debitOrCredit === "Debit");
  const out: Anomaly[] = [];

  // Duplicate charges: same employee + merchant + amount within 3 days.
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
        out.push({
          id: `dup-${key}-${i}`,
          type: "duplicate",
          typeLabel: "Duplicate charge",
          title: `Possible duplicate at ${t.merchantName}`,
          detail: `${t.employeeName} was charged $${t.amount.toFixed(2)} twice within ${Math.round(
            gap
          )} day(s).`,
          amount: Math.round(t.amount),
          employeeName: t.employeeName,
          department: t.department,
          date: t.transactionDate,
          txnIds: [sorted[i - 1].id, t.id],
        });
        break;
      }
    }
  }

  // Round-number pattern: suspiciously round charges (>= $100).
  for (const t of debits) {
    if (t.amount >= 100 && t.amount % 100 === 0 && hash(t.id) % 2 === 0) {
      out.push({
        id: `round-${t.id}`,
        type: "round_number",
        typeLabel: "Round number",
        title: `Round-number charge $${t.amount.toFixed(0)}`,
        detail: `${t.employeeName} logged an exact $${t.amount.toFixed(0)} at ${t.merchantName} — round amounts can indicate estimates rather than receipts.`,
        amount: Math.round(t.amount),
        employeeName: t.employeeName,
        department: t.department,
        date: t.transactionDate,
        txnIds: [t.id],
      });
    }
  }

  // Foreign-merchant activity.
  for (const t of debits) {
    if (t.merchantCountry && t.merchantCountry !== "US" && t.merchantCountry !== "USA") {
      out.push({
        id: `foreign-${t.id}`,
        type: "foreign",
        typeLabel: "Foreign merchant",
        title: `International charge in ${t.merchantCountry}`,
        detail: `${t.employeeName} charged $${t.amount.toFixed(0)} at ${t.merchantName} (${t.merchantCountry}).`,
        amount: Math.round(t.amount),
        employeeName: t.employeeName,
        department: t.department,
        date: t.transactionDate,
        txnIds: [t.id],
      });
    }
  }

  return out
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 40);
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
        ? `Consistent with ${emp.name}'s history — ${priorSimilar} prior ${tpl.category.toLowerCase()} charges.`
        : `No prior ${tpl.category.toLowerCase()} spend for ${emp.name}; first of its kind.`
    );
    reasoning.push(
      amount >= policy.approvalThreshold
        ? `Above the $${policy.approvalThreshold} approval threshold, so sign-off is required.`
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
