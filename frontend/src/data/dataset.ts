import type { Employee, Transaction } from "./types";

// ---------------------------------------------------------------------------
// Live dataset loaded from the Mongo-backed API (/api/dataset). These arrays
// are mutated in place by loadDataset() so any module that imported them keeps
// a valid reference. The app awaits loadDataset() before the first render, so
// they are fully populated by the time any component or selector reads them.
// ---------------------------------------------------------------------------

export const EMPLOYEES: Employee[] = [];
export const TRANSACTIONS: Transaction[] = [];
export const DEPARTMENTS: string[] = [];
export const MONTH_STARTS: string[] = [];
export const MONTH_LABELS: string[] = [];

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2025-09-01" -> "Sep 2025" */
function monthLabel(start: string): string {
  const [year, month] = start.split("-");
  const idx = Number(month) - 1;
  return `${MONTH_NAMES[idx] ?? month} ${year}`;
}

/** "2025-09-02" -> "2025-09-01" (bucket start for the transaction's month). */
function monthStartOf(transactionDate: string): string {
  return `${transactionDate.slice(0, 8)}01`;
}

interface DatasetPayload {
  employees: Employee[];
  transactions: Transaction[];
}

let loaded = false;

export function isLoaded(): boolean {
  return loaded;
}

/** Fetch the dataset once and populate the live arrays + derived dimensions. */
export async function loadDataset(): Promise<void> {
  const res = await fetch("/api/dataset");
  if (!res.ok) {
    throw new Error(`Failed to load dataset (HTTP ${res.status})`);
  }
  const data = (await res.json()) as DatasetPayload;

  EMPLOYEES.splice(0, EMPLOYEES.length, ...data.employees);
  TRANSACTIONS.splice(0, TRANSACTIONS.length, ...data.transactions);

  // Departments present in the data, ordered by total net spend (largest first)
  // so the busiest department anchors the left of the 3D galaxy.
  const deptSpend = new Map<string, number>();
  for (const t of data.transactions) {
    if (!t.department) continue;
    const signed = t.debitOrCredit === "Credit" ? -t.amount : t.amount;
    deptSpend.set(t.department, (deptSpend.get(t.department) ?? 0) + signed);
  }
  const depts = [...deptSpend.keys()].sort(
    (a, b) => (deptSpend.get(b) ?? 0) - (deptSpend.get(a) ?? 0)
  );
  DEPARTMENTS.splice(0, DEPARTMENTS.length, ...depts);

  // Distinct month buckets, chronologically ascending.
  const starts = [
    ...new Set(
      data.transactions
        .filter((t) => t.transactionDate)
        .map((t) => monthStartOf(t.transactionDate))
    ),
  ].sort();
  MONTH_STARTS.splice(0, MONTH_STARTS.length, ...starts);
  MONTH_LABELS.splice(0, MONTH_LABELS.length, ...starts.map(monthLabel));

  loaded = true;
}
