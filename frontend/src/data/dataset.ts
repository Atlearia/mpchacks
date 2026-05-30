import type { Employee, Transaction } from "./types";

// ---------------------------------------------------------------------------
// MongoDB-backed dataset. The raw employees + transactions are fetched once
// from the API (which reads them from MongoDB) and held in these module-level
// arrays. Selectors and components read from them synchronously, exactly as
// they did with the old in-browser dummy data — but the numbers are now real.
// `loadDataset()` must resolve before the app renders (see main.tsx).
// ---------------------------------------------------------------------------

// Mutated in place so any module that imported these bindings sees the data.
export const EMPLOYEES: Employee[] = [];
export const TRANSACTIONS: Transaction[] = [];
export const DEPARTMENTS: string[] = [];
export const MONTH_STARTS: string[] = [];
export const MONTH_LABELS: string[] = [];

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function monthLabel(monthStart: string): string {
  // monthStart is "YYYY-MM-01"
  const [year, month] = monthStart.split("-");
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
}

let loaded = false;

/** Fetch the dataset from the API and populate the module-level arrays. */
export async function loadDataset(): Promise<void> {
  if (loaded) return;

  const res = await fetch("/api/dataset");
  if (!res.ok) {
    throw new Error(`Failed to load dataset (${res.status})`);
  }
  const data: { employees: Employee[]; transactions: Transaction[] } = await res.json();

  EMPLOYEES.splice(0, EMPLOYEES.length, ...data.employees);
  TRANSACTIONS.splice(0, TRANSACTIONS.length, ...data.transactions);

  // Departments in first-seen order (preserves the canonical business order).
  const deptSeen = new Set<string>();
  const depts: string[] = [];
  for (const e of EMPLOYEES) {
    if (!deptSeen.has(e.department)) {
      deptSeen.add(e.department);
      depts.push(e.department);
    }
  }
  DEPARTMENTS.splice(0, DEPARTMENTS.length, ...depts);

  // Month buckets derived from transaction dates, ascending.
  const starts = [
    ...new Set(TRANSACTIONS.map((t) => `${t.transactionDate.slice(0, 8)}01`)),
  ].sort();
  MONTH_STARTS.splice(0, MONTH_STARTS.length, ...starts);
  MONTH_LABELS.splice(0, MONTH_LABELS.length, ...starts.map(monthLabel));

  loaded = true;
}
