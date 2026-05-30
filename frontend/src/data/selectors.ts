import { DEPARTMENTS, EMPLOYEES, MONTH_LABELS, MONTH_STARTS, TRANSACTIONS } from "./generate";
import type { DeptDatePoint, Employee, Transaction } from "./types";

const signed = (t: Transaction) => (t.debitOrCredit === "Credit" ? -t.amount : t.amount);

/** Aggregate net spend per (department, month) — the source for the 3D scatter. */
export function deptDatePoints(): DeptDatePoint[] {
  const map = new Map<string, DeptDatePoint>();
  for (let mi = 0; mi < MONTH_STARTS.length; mi++) {
    for (const dept of DEPARTMENTS) {
      const key = `${dept}|${MONTH_STARTS[mi]}`;
      map.set(key, {
        department: dept,
        date: MONTH_STARTS[mi],
        monthLabel: MONTH_LABELS[mi],
        total: 0,
        txnCount: 0,
      });
    }
  }
  for (const t of TRANSACTIONS) {
    const monthStart = `${t.transactionDate.slice(0, 8)}01`;
    const key = `${t.department}|${monthStart}`;
    const point = map.get(key);
    if (point) {
      point.total += signed(t);
      point.txnCount += 1;
    }
  }
  return [...map.values()].map((p) => ({ ...p, total: Math.round(p.total) }));
}

/** Department totals for a single month — drives the 2D bar view. */
export function deptTotalsForMonth(monthStart: string) {
  const totals = new Map<string, { total: number; count: number }>();
  for (const dept of DEPARTMENTS) totals.set(dept, { total: 0, count: 0 });
  for (const t of TRANSACTIONS) {
    if (`${t.transactionDate.slice(0, 8)}01` !== monthStart) continue;
    const entry = totals.get(t.department)!;
    entry.total += signed(t);
    entry.count += 1;
  }
  return DEPARTMENTS.map((dept) => ({
    department: dept,
    total: Math.round(totals.get(dept)!.total),
    count: totals.get(dept)!.count,
  }));
}

/** Per-employee spend within a department for a month — the breakdown view. */
export function employeeTotals(monthStart: string, department: string) {
  const totals = new Map<string, { total: number; count: number }>();
  for (const t of TRANSACTIONS) {
    if (t.department !== department) continue;
    if (`${t.transactionDate.slice(0, 8)}01` !== monthStart) continue;
    const cur = totals.get(t.employeeId) ?? { total: 0, count: 0 };
    cur.total += signed(t);
    cur.count += 1;
    totals.set(t.employeeId, cur);
  }
  return EMPLOYEES.filter((e) => e.department === department)
    .map((e) => ({
      employee: e,
      total: Math.round(totals.get(e.id)?.total ?? 0),
      count: totals.get(e.id)?.count ?? 0,
    }))
    .sort((a, b) => b.total - a.total);
}

export function employeeById(id: string): Employee | undefined {
  return EMPLOYEES.find((e) => e.id === id);
}

export function employeeTransactions(id: string, monthStart?: string): Transaction[] {
  return TRANSACTIONS.filter(
    (t) =>
      t.employeeId === id &&
      (!monthStart || `${t.transactionDate.slice(0, 8)}01` === monthStart)
  ).sort((a, b) => (a.transactionDate < b.transactionDate ? 1 : -1));
}

export function employeeMonthlySeries(id: string) {
  return MONTH_STARTS.map((start, i) => {
    const total = TRANSACTIONS.filter(
      (t) => t.employeeId === id && `${t.transactionDate.slice(0, 8)}01` === start
    ).reduce((sum, t) => sum + signed(t), 0);
    return { month: MONTH_LABELS[i], total: Math.round(total) };
  });
}

export function employeeCategoryBreakdown(id: string) {
  const map = new Map<string, number>();
  for (const t of TRANSACTIONS) {
    if (t.employeeId !== id) continue;
    map.set(t.spendCategory, (map.get(t.spendCategory) ?? 0) + signed(t));
  }
  return [...map.entries()]
    .map(([category, total]) => ({ category, total: Math.round(total) }))
    .sort((a, b) => b.total - a.total);
}

export function maxDeptMonthTotal(): number {
  return deptDatePoints().reduce((m, p) => Math.max(m, p.total), 0);
}

export function companyKpis() {
  const debit = TRANSACTIONS.filter((t) => t.debitOrCredit === "Debit");
  const total = debit.reduce((s, t) => s + t.amount, 0);
  return {
    totalSpend: Math.round(total),
    txnCount: TRANSACTIONS.length,
    employees: EMPLOYEES.length,
    departments: DEPARTMENTS.length,
    avgTicket: Math.round(total / debit.length),
  };
}
