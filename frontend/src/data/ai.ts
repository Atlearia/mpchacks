import { DEPARTMENTS, MONTH_LABELS, MONTH_STARTS, TRANSACTIONS } from "./dataset";
import type { Transaction } from "./types";
import { deptColor } from "../theme";

// ---------------------------------------------------------------------------
// "Talk to Your Data" engine. Two modes:
//   1. LIVE MODE — calls the backend /api/ask endpoint which uses Gemini 3.5 Flash
//      with the full dataset context and multi-turn conversation history.
//   2. FALLBACK MODE — if the backend is unreachable, uses the local intent
//      matcher (same logic as before) so the demo still works offline.
// ---------------------------------------------------------------------------

export type ChartSpec =
  | { kind: "bars"; data: { label: string; value: number; color?: string }[] }
  | { kind: "donut"; data: { label: string; value: number; color?: string }[] }
  | { kind: "table"; columns: string[]; rows: (string | number)[][] }
  | { kind: "stat"; stats: { label: string; value: string }[] };

export interface AiAnswer {
  summary: string;
  spec?: ChartSpec;
  followups: string[];
  focus: AiFocus;
  model?: string;
  isLive?: boolean;
}

export interface AiFocus {
  department?: string;
  category?: string;
}

// ---------------------------------------------------------------------------
// Live Gemini API call
// ---------------------------------------------------------------------------

interface ApiMessage {
  role: "user" | "ai";
  content: string;
}

interface ApiAskResponse {
  summary: string;
  chartType: string;
  chartData: any;
  followups: string[];
  model: string;
}

function apiChartToSpec(chartType: string, chartData: any): ChartSpec | undefined {
  if (!chartData || chartType === "none") return undefined;

  if (chartType === "bars" && Array.isArray(chartData)) {
    return {
      kind: "bars",
      data: chartData.map((d: any) => ({
        label: String(d.label ?? ""),
        value: Number(d.value ?? 0),
        color: d.color,
      })),
    };
  }

  if (chartType === "donut" && Array.isArray(chartData)) {
    return {
      kind: "donut",
      data: chartData.map((d: any) => ({
        label: String(d.label ?? ""),
        value: Number(d.value ?? 0),
        color: d.color,
      })),
    };
  }

  if (chartType === "table" && chartData.columns && chartData.rows) {
    return {
      kind: "table",
      columns: chartData.columns.map(String),
      rows: chartData.rows.map((r: any[]) => r.map((c) => (typeof c === "number" ? c : String(c)))),
    };
  }

  if (chartType === "stat" && Array.isArray(chartData)) {
    return {
      kind: "stat",
      stats: chartData.map((s: any) => ({
        label: String(s.label ?? ""),
        value: String(s.value ?? ""),
      })),
    };
  }

  return undefined;
}

export async function askGemini(
  question: string,
  history: ApiMessage[],
): Promise<AiAnswer> {
  const res = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, history }),
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }

  const data: ApiAskResponse = await res.json();
  const spec = apiChartToSpec(data.chartType, data.chartData);

  return {
    summary: data.summary,
    spec,
    followups: data.followups ?? [],
    focus: {},
    model: data.model,
    isLive: true,
  };
}

// ---------------------------------------------------------------------------
// Policy AI — executive brief
// ---------------------------------------------------------------------------

export interface PolicyBrief {
  headline: string;
  riskLevel: string;
  topActions: { priority: number; action: string; impact: string }[];
  narrative: string;
  trendInsight: string;
}

export async function fetchPolicyBrief(
  violations: {
    type: string;
    severity: string;
    employeeName: string;
    department: string;
    amount: number;
    merchantName: string;
    title: string;
    detail: string;
  }[]
): Promise<PolicyBrief> {
  const res = await fetch("/api/policy/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ violations: violations.slice(0, 30) }),
  });

  if (!res.ok) throw new Error(`Policy AI error: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Approval AI — recommendation
// ---------------------------------------------------------------------------

export interface ApprovalAIResult {
  recommendation: string;
  confidence: number;
  reasoning: string[];
  riskFlags: string[];
  suggestedConditions: string;
}

export async function fetchApprovalRecommendation(request: {
  employeeName: string;
  department: string;
  title: string;
  amount: number;
  category: string;
  merchant: string;
  budgetRemaining: number;
  priorSimilar: number;
  history: { month: string; total: number }[];
}): Promise<ApprovalAIResult> {
  const res = await fetch("/api/approvals/recommend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!res.ok) throw new Error(`Approval AI error: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// LOCAL FALLBACK — the original intent matcher (used when backend is down)
// ---------------------------------------------------------------------------

const signed = (t: Transaction) => (t.debitOrCredit === "Credit" ? -t.amount : t.amount);
const debits = () => TRANSACTIONS.filter((t) => t.debitOrCredit === "Debit");
const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function monthStartOf(date: string) {
  return `${date.slice(0, 8)}01`;
}

function distinctCategories(): string[] {
  return [...new Set(TRANSACTIONS.map((t) => t.spendCategory).filter(Boolean))];
}

function matchDepartment(q: string): string | undefined {
  const lc = q.toLowerCase();
  return DEPARTMENTS.find((d) => lc.includes(d.toLowerCase()));
}

function matchCategory(q: string): string | undefined {
  const lc = q.toLowerCase();
  return distinctCategories().find((c) => lc.includes(c.toLowerCase().split(" ")[0]));
}

function spendByDepartment(): { label: string; value: number; color?: string }[] {
  return DEPARTMENTS.map((dept) => ({
    label: dept,
    value: Math.round(
      debits().filter((t) => t.department === dept).reduce((s, t) => s + t.amount, 0)
    ),
    color: deptColor(dept),
  })).sort((a, b) => b.value - a.value);
}

function spendByCategory(filter?: (t: Transaction) => boolean) {
  const map = new Map<string, number>();
  for (const t of debits()) {
    if (filter && !filter(t)) continue;
    map.set(t.spendCategory, (map.get(t.spendCategory) ?? 0) + t.amount);
  }
  return [...map.entries()]
    .map(([label, value]) => ({ label, value: Math.round(value) }))
    .sort((a, b) => b.value - a.value);
}

function monthlySeries(filter?: (t: Transaction) => boolean) {
  return MONTH_STARTS.map((start, i) => ({
    label: MONTH_LABELS[i].split(" ")[0],
    value: Math.round(
      debits()
        .filter((t) => monthStartOf(t.transactionDate) === start && (!filter || filter(t)))
        .reduce((s, t) => s + t.amount, 0)
    ),
  }));
}

function topMerchants(n = 8) {
  const map = new Map<string, { spend: number; count: number }>();
  for (const t of debits()) {
    const v = map.get(t.merchantName) ?? { spend: 0, count: 0 };
    v.spend += t.amount;
    v.count += 1;
    map.set(t.merchantName, v);
  }
  return [...map.entries()]
    .map(([name, v]) => ({ name, spend: Math.round(v.spend), count: v.count }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, n);
}

const DEFAULT_FOLLOWUPS = [
  "How does that compare to last quarter?",
  "Break it down by category",
  "Who are the top spenders?",
];

/** Local fallback: map a natural-language question (plus prior focus) to a live answer. */
export function answerQuestion(question: string, prevFocus: AiFocus = {}): AiAnswer {
  const q = question.toLowerCase();
  const dept = matchDepartment(question) ?? (q.includes("that") || q.includes("compare") ? prevFocus.department : undefined);
  const category = matchCategory(question) ?? (q.includes("that") ? prevFocus.category : undefined);
  const focus: AiFocus = { department: dept, category };

  // Comparison across two departments.
  const mentioned = DEPARTMENTS.filter((d) => q.includes(d.toLowerCase()));
  if ((q.includes("compare") || q.includes("vs") || mentioned.length >= 2) && (mentioned.length >= 1)) {
    const targets = mentioned.length >= 2 ? mentioned : [prevFocus.department, mentioned[0]].filter(Boolean) as string[];
    const data = targets.map((d) => ({
      label: d,
      value: Math.round(
        debits()
          .filter((t) => t.department === d && (!category || t.spendCategory === category))
          .reduce((s, t) => s + t.amount, 0)
      ),
      color: deptColor(d),
    }));
    const lead = data[0];
    const diff = data.length === 2 ? Math.abs(data[0].value - data[1].value) : 0;
    return {
      summary: `Comparing ${targets.join(" vs ")}${category ? ` on ${category}` : ""}: ${data
        .map((d) => `${d.label} ${fmt(d.value)}`)
        .join(", ")}.${data.length === 2 ? ` That's a ${fmt(diff)} gap, led by ${lead.value >= data[1].value ? data[0].label : data[1].label}.` : ""}`,
      spec: { kind: "bars", data },
      followups: ["Break it down by month", "Which categories drove the difference?", "Show the top merchants"],
      focus,
    };
  }

  // Department + (optional) category spend over time.
  if (dept) {
    const filtered = (t: Transaction) =>
      t.department === dept && (!category || t.spendCategory === category);
    const series = monthlySeries(filtered);
    const total = series.reduce((s, m) => s + m.value, 0);
    return {
      summary: `${dept}${category ? ` spent ${fmt(total)} on ${category}` : ` spent ${fmt(total)}`} across the period, peaking at ${fmt(
        Math.max(...series.map((s) => s.value))
      )}.`,
      spec: { kind: "bars", data: series.map((s) => ({ ...s, color: deptColor(dept) })) },
      followups: [`How does ${dept} compare to engineering?`, "Break it down by category", "Any policy violations here?"],
      focus,
    };
  }

  // Category-only question.
  if (category) {
    const series = monthlySeries((t) => t.spendCategory === category);
    const total = series.reduce((s, m) => s + m.value, 0);
    return {
      summary: `Company-wide ${category} spend totaled ${fmt(total)} over the period.`,
      spec: { kind: "bars", data: series },
      followups: ["Which department spends the most on this?", "Show me the vendors", ...DEFAULT_FOLLOWUPS.slice(0, 1)],
      focus,
    };
  }

  // Top merchants / vendors.
  if (q.includes("merchant") || q.includes("vendor") || q.includes("supplier")) {
    const rows = topMerchants(8).map((m) => [m.name, m.count, fmt(m.spend)]);
    return {
      summary: `Your top vendor is ${rows[0]?.[0]} at ${rows[0]?.[2]}. Here are the 8 largest by spend.`,
      spec: { kind: "table", columns: ["Merchant", "Txns", "Spend"], rows },
      followups: ["Where could we consolidate vendors?", "Break spend down by category", "Show department totals"],
      focus,
    };
  }

  // Category breakdown.
  if (q.includes("category") || q.includes("categories")) {
    const data = spendByCategory().slice(0, 8);
    return {
      summary: `Spend spans ${data.length} categories. ${data[0]?.label} leads at ${fmt(data[0]?.value ?? 0)}.`,
      spec: { kind: "donut", data },
      followups: ["Which department drives software spend?", "Show the trend over time", "Top merchants?"],
      focus,
    };
  }

  // Trend over time.
  if (q.includes("trend") || q.includes("month") || q.includes("over time") || q.includes("quarter")) {
    const series = monthlySeries();
    return {
      summary: `Total monthly spend ranges from ${fmt(Math.min(...series.map((s) => s.value)))} to ${fmt(
        Math.max(...series.map((s) => s.value))
      )} across the 6 months.`,
      spec: { kind: "bars", data: series },
      followups: ["Break it down by department", "Which category is growing fastest?", "Any anomalies?"],
      focus,
    };
  }

  // Default: company overview by department.
  const data = spendByDepartment();
  const total = data.reduce((s, d) => s + d.value, 0);
  return {
    summary: `Across all departments, total spend is ${fmt(total)}. ${data[0]?.label} is the largest at ${fmt(
      data[0]?.value ?? 0
    )}.`,
    spec: { kind: "bars", data },
    followups: DEFAULT_FOLLOWUPS,
    focus,
  };
}

export const SUGGESTED_PROMPTS = [
  "What did marketing spend on software last quarter?",
  "How does that compare to engineering?",
  "Show me spend by category",
  "Who are our top vendors?",
  "What's the monthly spend trend?",
];
