import { DEPARTMENTS, EMPLOYEES, TRANSACTIONS } from "./dataset";
import type { Transaction } from "./types";

export type ValidationIssue =
  | "missing_id"
  | "missing_employee_id"
  | "unknown_employee"
  | "missing_department"
  | "unknown_department"
  | "missing_date"
  | "invalid_date"
  | "invalid_amount"
  | "invalid_debit_credit"
  | "extreme_amount";

export const ISSUE_LABELS: Record<ValidationIssue, string> = {
  missing_id: "Missing transaction ID",
  missing_employee_id: "Missing employee ID",
  unknown_employee: "Employee ID not in roster",
  missing_department: "Missing department",
  unknown_department: "Department not recognized",
  missing_date: "Missing transaction date",
  invalid_date: "Invalid transaction date",
  invalid_amount: "Invalid amount (null, zero, or not a number)",
  invalid_debit_credit: "Invalid debit/credit type",
  extreme_amount: "Amount outside expected range",
};

/** Max single-card amount we treat as plausible for the explore viz. */
const MAX_PLAUSIBLE_AMOUNT = 250_000;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

let employeeIds: Set<string> | null = null;
let invalidCache: InvalidEntry[] | null = null;

export interface InvalidEntry {
  transaction: Transaction;
  issues: ValidationIssue[];
}

function rosterIds(): Set<string> {
  if (!employeeIds) {
    employeeIds = new Set(EMPLOYEES.map((e) => e.id).filter(Boolean));
  }
  return employeeIds;
}

function isBlank(value: string | undefined | null): boolean {
  return value == null || String(value).trim() === "";
}

function parseAmount(amount: number): number | null {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  return amount;
}

export function getTransactionIssues(t: Transaction): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (isBlank(t.id)) issues.push("missing_id");
  if (isBlank(t.employeeId)) issues.push("missing_employee_id");
  else if (!rosterIds().has(t.employeeId)) issues.push("unknown_employee");

  if (isBlank(t.department)) issues.push("missing_department");
  else if (!DEPARTMENTS.includes(t.department)) issues.push("unknown_department");

  if (isBlank(t.transactionDate)) {
    issues.push("missing_date");
  } else if (!ISO_DATE.test(t.transactionDate.slice(0, 10))) {
    issues.push("invalid_date");
  }

  const amount = parseAmount(t.amount);
  if (amount == null || amount <= 0) {
    issues.push("invalid_amount");
  } else if (amount > MAX_PLAUSIBLE_AMOUNT) {
    issues.push("extreme_amount");
  }

  if (t.debitOrCredit !== "Debit" && t.debitOrCredit !== "Credit") {
    issues.push("invalid_debit_credit");
  }

  return issues;
}

export function isValidTransaction(t: Transaction): boolean {
  return getTransactionIssues(t).length === 0;
}

export function invalidateValidationCache(): void {
  employeeIds = null;
  invalidCache = null;
}

export function getInvalidTransactions(): InvalidEntry[] {
  if (invalidCache) return invalidCache;
  invalidCache = TRANSACTIONS.filter((t) => !isValidTransaction(t)).map((transaction) => ({
    transaction,
    issues: getTransactionIssues(transaction),
  }));
  return invalidCache;
}

/** Transactions that pass validation — used for explore aggregations and charts. */
export function getValidTransactions(): Transaction[] {
  return TRANSACTIONS.filter(isValidTransaction);
}

export function validationSummary() {
  const invalid = getInvalidTransactions();
  const byIssue = new Map<ValidationIssue, number>();
  for (const entry of invalid) {
    for (const issue of entry.issues) {
      byIssue.set(issue, (byIssue.get(issue) ?? 0) + 1);
    }
  }
  return {
    total: TRANSACTIONS.length,
    invalidCount: invalid.length,
    validCount: TRANSACTIONS.length - invalid.length,
    byIssue: [...byIssue.entries()].sort((a, b) => b[1] - a[1]),
  };
}
