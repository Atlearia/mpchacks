import { create } from "zustand";
import { DEPARTMENTS, MONTH_STARTS, TRANSACTIONS } from "./dataset";

// ---------------------------------------------------------------------------
// Digitized expense policy. The Policy view edits this config in-memory and
// the violation engine + approval workflow read from it live. Defaults are
// derived from the real transaction distribution so that a realistic slice of
// spend actually trips the rules (instead of hand-tuned magic numbers).
// ---------------------------------------------------------------------------

export interface CategoryLimit {
  category: string;
  /** Per-transaction cap for this spend category, in USD. */
  perTransaction: number;
  enabled: boolean;
}

export interface PolicyConfig {
  /** Any single transaction at or above this needs pre-approval. */
  approvalThreshold: number;
  /** Per-employee expense cap; meal charges above this may be flagged. */
  soloMealLimit: number;
  /** Per-department monthly budget ceilings (USD). */
  departmentBudgets: Record<string, number>;
  /** Per spend-category transaction caps. */
  categoryLimits: CategoryLimit[];
  /** Spend categories the company permits at all. */
  allowedCategories: string[];
  /** Merchant names (case-insensitive substring) that are off-limits. */
  restrictedMerchants: string[];
  /** Receipts are required for anything at/above this amount. */
  receiptRequiredAbove: number;
}

const round = (n: number, step = 50) => Math.max(step, Math.round(n / step) * step);

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export function distinctCategories(): string[] {
  return [...new Set(TRANSACTIONS.map((t) => t.spendCategory).filter(Boolean))].sort();
}

/** Build a sensible default policy from the live data distribution. */
export function buildDefaultPolicy(): PolicyConfig {
  const debits = TRANSACTIONS.filter((t) => t.debitOrCredit === "Debit");
  const cats = distinctCategories();

  // Per-category cap ~= 92nd percentile so roughly the top ~8% trip the rule.
  const categoryLimits: CategoryLimit[] = cats.map((category) => {
    const amts = debits.filter((t) => t.spendCategory === category).map((t) => t.amount);
    return {
      category,
      perTransaction: round(percentile(amts, 92) || 500),
      enabled: true,
    };
  });

  // Monthly budget ~= 1.1x the average monthly department spend.
  const months = Math.max(1, MONTH_STARTS.length);
  const departmentBudgets: Record<string, number> = {};
  for (const dept of DEPARTMENTS) {
    const spend = debits
      .filter((t) => t.department === dept)
      .reduce((s, t) => s + t.amount, 0);
    departmentBudgets[dept] = round((spend / months) * 1.1, 500);
  }

  // Pick a couple of real, frequently-seen merchants to mark restricted so the
  // engine has something concrete to flag (editable in the UI).
  const freq = new Map<string, number>();
  for (const t of debits) freq.set(t.merchantName, (freq.get(t.merchantName) ?? 0) + 1);
  const restrictedMerchants = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(2, 4)
    .map(([name]) => name)
    .filter(Boolean);

  return {
    approvalThreshold: 500,
    soloMealLimit: 75,
    departmentBudgets,
    categoryLimits,
    allowedCategories: cats,
    restrictedMerchants,
    receiptRequiredAbove: 250,
  };
}

interface PolicyStore {
  config: PolicyConfig;
  initialized: boolean;
  init: () => void;
  setApprovalThreshold: (v: number) => void;
  setSoloMealLimit: (v: number) => void;
  setReceiptRequiredAbove: (v: number) => void;
  setDepartmentBudget: (dept: string, v: number) => void;
  setCategoryLimit: (category: string, v: number) => void;
  toggleCategoryLimit: (category: string) => void;
  toggleAllowedCategory: (category: string) => void;
  toggleRestrictedMerchant: (merchant: string) => void;
  reset: () => void;
}

export const usePolicy = create<PolicyStore>((set, get) => ({
  config: {
    approvalThreshold: 500,
    soloMealLimit: 75,
    departmentBudgets: {},
    categoryLimits: [],
    allowedCategories: [],
    restrictedMerchants: [],
    receiptRequiredAbove: 250,
  },
  initialized: false,

  init: () => {
    if (get().initialized) return;
    set({ config: buildDefaultPolicy(), initialized: true });
  },

  setApprovalThreshold: (v) =>
    set((s) => ({ config: { ...s.config, approvalThreshold: v } })),
  setSoloMealLimit: (v) => set((s) => ({ config: { ...s.config, soloMealLimit: v } })),
  setReceiptRequiredAbove: (v) =>
    set((s) => ({ config: { ...s.config, receiptRequiredAbove: v } })),

  setDepartmentBudget: (dept, v) =>
    set((s) => ({
      config: { ...s.config, departmentBudgets: { ...s.config.departmentBudgets, [dept]: v } },
    })),

  setCategoryLimit: (category, v) =>
    set((s) => ({
      config: {
        ...s.config,
        categoryLimits: s.config.categoryLimits.map((c) =>
          c.category === category ? { ...c, perTransaction: v } : c
        ),
      },
    })),

  toggleCategoryLimit: (category) =>
    set((s) => ({
      config: {
        ...s.config,
        categoryLimits: s.config.categoryLimits.map((c) =>
          c.category === category ? { ...c, enabled: !c.enabled } : c
        ),
      },
    })),

  toggleAllowedCategory: (category) =>
    set((s) => {
      const has = s.config.allowedCategories.includes(category);
      return {
        config: {
          ...s.config,
          allowedCategories: has
            ? s.config.allowedCategories.filter((c) => c !== category)
            : [...s.config.allowedCategories, category],
        },
      };
    }),

  toggleRestrictedMerchant: (merchant) =>
    set((s) => {
      const has = s.config.restrictedMerchants.includes(merchant);
      return {
        config: {
          ...s.config,
          restrictedMerchants: has
            ? s.config.restrictedMerchants.filter((m) => m !== merchant)
            : [...s.config.restrictedMerchants, merchant],
        },
      };
    }),

  reset: () => set({ config: buildDefaultPolicy() }),
}));
