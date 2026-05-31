import type { Employee, Transaction } from "./types";
import { invalidateValidationCache } from "./validation";

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

// ---------------------------------------------------------------------------
// Dummy data generator – produces a realistic-looking dataset so the full UI
// can be previewed locally without MongoDB / the FastAPI backend running.
// Only activates when the /api/dataset fetch fails.
// ---------------------------------------------------------------------------

const DUMMY_DEPARTMENTS = [
  "Engineering", "Sales", "Marketing", "Finance", "HR",
  "Legal", "R&D", "Customer Service", "Supply Chain",
];

const DUMMY_TITLES: Record<string, string[]> = {
  Engineering: ["Software Engineer", "Staff Engineer", "Engineering Manager", "DevOps Lead", "QA Engineer"],
  Sales: ["Account Executive", "Sales Manager", "BDR", "Sales Director", "Solutions Architect"],
  Marketing: ["Marketing Manager", "Content Strategist", "Growth Lead", "Brand Designer", "SEO Analyst"],
  Finance: ["Financial Analyst", "Controller", "Accountant", "FP&A Manager", "Treasury Analyst"],
  HR: ["HR Business Partner", "Recruiter", "People Ops Lead", "L&D Coordinator", "Comp Analyst"],
  Legal: ["Corporate Counsel", "Paralegal", "Compliance Officer", "Contract Manager", "IP Attorney"],
  "R&D": ["Research Scientist", "Lab Technician", "Product Researcher", "Data Scientist", "R&D Director"],
  "Customer Service": ["Support Lead", "CS Representative", "Success Manager", "Support Engineer", "CS Director"],
  "Supply Chain": ["Procurement Manager", "Logistics Analyst", "Vendor Manager", "Operations Lead", "Buyer"],
};

const FIRST_NAMES = [
  "James", "Olivia", "Liam", "Emma", "Noah", "Ava", "Sophia", "Mason",
  "Isabella", "Lucas", "Mia", "Ethan", "Amelia", "Alexander", "Harper",
  "Benjamin", "Evelyn", "Daniel", "Abigail", "Henry", "Emily", "Sebastian",
  "Ella", "Jack", "Scarlett", "Aiden", "Grace", "Owen", "Chloe", "Samuel",
  "Victoria", "Ryan", "Riley", "Nathan", "Aria", "Leo", "Lily", "Ian",
  "Zoey", "Christian", "Penelope", "Jonathan", "Layla", "Dylan", "Nora",
];

const LAST_NAMES = [
  "Chen", "Rodriguez", "Patel", "Kim", "O'Brien", "Nakamura", "Thompson",
  "Garcia", "Müller", "Santos", "Wilson", "Nguyen", "Anderson", "Taylor",
  "Martinez", "Lee", "Brown", "Davis", "Moore", "Clark", "Hall", "Young",
  "Wright", "Scott", "Adams", "Baker", "Hill", "Green", "Evans", "Turner",
];

const MERCHANTS = [
  "Amazon Business", "Uber", "Delta Air Lines", "Marriott Hotels",
  "WeWork", "Starbucks", "FedEx", "Adobe Systems", "Zoom Video",
  "Google Cloud", "Microsoft Azure", "Slack Technologies", "Notion Labs",
  "DoorDash", "Lyft", "Hilton Hotels", "United Airlines", "Southwest Airlines",
  "Office Depot", "Staples", "Best Buy", "Apple Store", "LinkedIn Premium",
  "GitHub Enterprise", "Atlassian", "Salesforce", "HubSpot", "Figma",
  "Grubhub", "Postmates", "The Ritz-Carlton", "Four Seasons", "Hyatt",
];

const SPEND_CATEGORIES = [
  "Travel", "Meals & Entertainment", "Software & SaaS", "Office Supplies",
  "Transportation", "Conferences", "Training", "Equipment", "Professional Services",
  "Telecommunications", "Marketing Spend", "Cloud Infrastructure",
];

const CITIES = [
  "New York", "San Francisco", "Chicago", "Austin", "Seattle",
  "Boston", "Denver", "Atlanta", "Miami", "Portland",
];

/** Seeded pseudo-random (keeps dummy data stable across refreshes). */
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateDummyData(): DatasetPayload {
  const rand = mulberry32(42);
  const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
  const randRange = (lo: number, hi: number) => lo + rand() * (hi - lo);

  // Generate employees — 5 per department
  const employees: Employee[] = [];
  const usedNames = new Set<string>();
  for (const dept of DUMMY_DEPARTMENTS) {
    const titles = DUMMY_TITLES[dept];
    for (let i = 0; i < 5; i++) {
      let name: string;
      do {
        name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
      } while (usedNames.has(name));
      usedNames.add(name);

      employees.push({
        id: `emp-${dept.toLowerCase().replace(/[^a-z]/g, "")}-${i}`,
        name,
        department: dept,
        title: titles[i % titles.length],
        email: `${name.toLowerCase().replace(/ /g, ".")}@brim.co`,
        location: pick(CITIES),
        joinedDate: `202${Math.floor(rand() * 4)}-0${1 + Math.floor(rand() * 9)}-${String(1 + Math.floor(rand() * 28)).padStart(2, "0")}`,
        cardLast4: String(1000 + Math.floor(rand() * 9000)),
        monthlyLimit: [3000, 5000, 7500, 10000][Math.floor(rand() * 4)],
        avatarHue: Math.floor(rand() * 360),
      });
    }
  }

  // Generate transactions — ~8-12 per employee per month, across 7 months
  const transactions: Transaction[] = [];
  const monthStarts = [
    "2025-09-01", "2025-10-01", "2025-11-01", "2025-12-01",
    "2026-01-01", "2026-02-01", "2026-03-01",
  ];

  let txnIdx = 0;
  for (const emp of employees) {
    for (const ms of monthStarts) {
      const txnCount = 8 + Math.floor(rand() * 5);
      const [year, month] = ms.split("-");
      for (let t = 0; t < txnCount; t++) {
        const day = 1 + Math.floor(rand() * 28);
        const dateStr = `${year}-${month}-${String(day).padStart(2, "0")}`;
        const isCredit = rand() < 0.06; // ~6% credits/refunds
        const category = pick(SPEND_CATEGORIES);

        // Amount varies by category
        let amount: number;
        switch (category) {
          case "Travel":
            amount = randRange(120, 2800);
            break;
          case "Meals & Entertainment":
            amount = randRange(12, 280);
            break;
          case "Software & SaaS":
            amount = randRange(15, 600);
            break;
          case "Cloud Infrastructure":
            amount = randRange(200, 8000);
            break;
          case "Equipment":
            amount = randRange(80, 3500);
            break;
          case "Conferences":
            amount = randRange(200, 4000);
            break;
          default:
            amount = randRange(10, 800);
        }
        amount = Math.round(amount * 100) / 100;

        const merchant = pick(MERCHANTS);
        const city = pick(CITIES);
        transactions.push({
          id: `txn-${txnIdx++}`,
          transactionCode: `TXN${String(txnIdx).padStart(6, "0")}`,
          transactionCategory: category,
          postingDate: dateStr,
          transactionDate: dateStr,
          merchantName: merchant,
          amount,
          debitOrCredit: isCredit ? "Credit" : "Debit",
          merchantCategoryCode: String(5000 + Math.floor(rand() * 4000)),
          merchantCity: city,
          merchantCountry: "US",
          merchantPostalCode: String(10000 + Math.floor(rand() * 89999)),
          merchantState: "CA",
          conversionRate: 1,
          department: emp.department,
          employeeId: emp.id,
          employeeName: emp.name,
          spendCategory: category,
        });
      }
    }
  }

  return { employees, transactions };
}

// ---------------------------------------------------------------------------

function populateFromPayload(data: DatasetPayload) {
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

  invalidateValidationCache();
  loaded = true;
}

/** Fetch the dataset once and populate the live arrays + derived dimensions. */
export async function loadDataset(): Promise<void> {
  try {
    const res = await fetch("/api/dataset");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as DatasetPayload;
    populateFromPayload(data);
  } catch {
    // API unavailable (no backend running) — use dummy data so the UI works
    console.warn("[dataset] API unreachable, loading dummy data for local preview");
    populateFromPayload(generateDummyData());
  }
}
