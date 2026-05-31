import type { DebitCredit, Employee, Transaction } from "./types";

// ---------------------------------------------------------------------------
// Deterministic dummy data. Replaced by the Mongo-backed API once it is wired.
// ---------------------------------------------------------------------------

// Mulberry32 seeded PRNG so the dashboard renders identically every load.
function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(20260530);

const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
const between = (min: number, max: number) => min + rng() * (max - min);
const round2 = (n: number) => Math.round(n * 100) / 100;

export const DEPARTMENTS = [
  "Engineering",
  "Sales",
  "Marketing",
  "Operations",
  "Finance",
  "Customer Success",
  "Product",
  "People Ops",
] as const;

export type Department = (typeof DEPARTMENTS)[number];

// Each department leans on a characteristic mix of spend categories + merchants.
const DEPT_PROFILE: Record<
  Department,
  { headcount: number; avgTicket: number; categories: string[] }
> = {
  Engineering: { headcount: 12, avgTicket: 210, categories: ["Cloud & Hosting", "Software", "Hardware"] },
  Sales: { headcount: 9, avgTicket: 180, categories: ["Travel", "Meals & Entertainment", "Software"] },
  Marketing: { headcount: 7, avgTicket: 320, categories: ["Advertising", "Software", "Events"] },
  Operations: { headcount: 6, avgTicket: 140, categories: ["Logistics", "Office Supplies", "Software"] },
  Finance: { headcount: 4, avgTicket: 90, categories: ["Software", "Professional Services", "Office Supplies"] },
  "Customer Success": { headcount: 6, avgTicket: 120, categories: ["Software", "Travel", "Meals & Entertainment"] },
  Product: { headcount: 5, avgTicket: 160, categories: ["Software", "Research", "Events"] },
  "People Ops": { headcount: 4, avgTicket: 130, categories: ["Recruiting", "Office Supplies", "Events"] },
};

const MERCHANTS: Record<string, { name: string; mcc: string; min: number; max: number }[]> = {
  "Cloud & Hosting": [
    { name: "AMAZON WEB SERVICES", mcc: "7372", min: 400, max: 4200 },
    { name: "GOOGLE CLOUD EMEA", mcc: "7372", min: 250, max: 3100 },
    { name: "VERCEL INC", mcc: "5734", min: 20, max: 480 },
    { name: "DATADOG INC", mcc: "5734", min: 90, max: 1400 },
  ],
  Software: [
    { name: "FIGMA INC", mcc: "5734", min: 12, max: 75 },
    { name: "NOTION LABS", mcc: "5734", min: 8, max: 60 },
    { name: "SLACK TECHNOLOGIES", mcc: "5734", min: 15, max: 320 },
    { name: "GITHUB INC", mcc: "5734", min: 21, max: 210 },
    { name: "ATLASSIAN PTY", mcc: "5734", min: 30, max: 540 },
  ],
  Hardware: [
    { name: "APPLE STORE #R042", mcc: "5732", min: 120, max: 2600 },
    { name: "DELL TECHNOLOGIES", mcc: "5732", min: 220, max: 1900 },
    { name: "BEST BUY #1187", mcc: "5732", min: 40, max: 900 },
  ],
  Travel: [
    { name: "DELTA AIR LINES", mcc: "3058", min: 180, max: 1450 },
    { name: "MARRIOTT BONVOY", mcc: "3509", min: 140, max: 980 },
    { name: "UBER TRIP", mcc: "4121", min: 9, max: 88 },
    { name: "AIR CANADA", mcc: "3008", min: 210, max: 1620 },
    { name: "ENTERPRISE RENT-A-CAR", mcc: "3387", min: 70, max: 540 },
  ],
  "Meals & Entertainment": [
    { name: "STARBUCKS #8842", mcc: "5814", min: 4, max: 38 },
    { name: "THE KEG STEAKHOUSE", mcc: "5812", min: 45, max: 620 },
    { name: "CHIPOTLE 2245", mcc: "5814", min: 9, max: 140 },
    { name: "DOORDASH", mcc: "5812", min: 18, max: 260 },
  ],
  Advertising: [
    { name: "META PLATFORMS ADS", mcc: "7311", min: 300, max: 6800 },
    { name: "GOOGLE ADS", mcc: "7311", min: 250, max: 5400 },
    { name: "LINKEDIN ADS", mcc: "7311", min: 180, max: 2900 },
  ],
  Events: [
    { name: "EVENTBRITE", mcc: "7922", min: 60, max: 1800 },
    { name: "HUBSPOT INBOUND REG", mcc: "8398", min: 600, max: 1950 },
    { name: "CVENT CONFERENCE", mcc: "7399", min: 400, max: 2400 },
  ],
  Logistics: [
    { name: "FEDEX 2885758", mcc: "4215", min: 12, max: 340 },
    { name: "UPS STORE #4471", mcc: "4215", min: 9, max: 280 },
    { name: "ULINE SHIPPING SUPPLY", mcc: "5085", min: 40, max: 720 },
  ],
  "Office Supplies": [
    { name: "STAPLES #00921", mcc: "5943", min: 12, max: 410 },
    { name: "AMAZON BUSINESS", mcc: "5943", min: 8, max: 680 },
    { name: "COSTCO WHOLESALE", mcc: "5300", min: 40, max: 920 },
  ],
  "Professional Services": [
    { name: "QUICKBOOKS PAYROLL", mcc: "8931", min: 80, max: 1400 },
    { name: "STRIPE BILLING", mcc: "7392", min: 25, max: 1200 },
    { name: "DELOITTE ADVISORY", mcc: "8931", min: 800, max: 5200 },
  ],
  Research: [
    { name: "GARTNER INC", mcc: "8999", min: 400, max: 4800 },
    { name: "STATISTA", mcc: "5734", min: 40, max: 600 },
    { name: "USERTESTING.COM", mcc: "7372", min: 90, max: 1100 },
  ],
  Recruiting: [
    { name: "LINKEDIN RECRUITER", mcc: "7361", min: 200, max: 2400 },
    { name: "GREENHOUSE SOFTWARE", mcc: "5734", min: 120, max: 1600 },
    { name: "INDEED HIRE", mcc: "7361", min: 80, max: 1900 },
  ],
};

const CITIES = [
  { city: "TORONTO", state: "ON", country: "CAN", postal: "M5V2T6", conv: 1.376 },
  { city: "VANCOUVER", state: "BC", country: "CAN", postal: "V6B1A1", conv: 1.376 },
  { city: "NEW YORK", state: "NY", country: "USA", postal: "10001", conv: 1.0 },
  { city: "SAN FRANCISCO", state: "CA", country: "USA", postal: "94105", conv: 1.0 },
  { city: "AUSTIN", state: "TX", country: "USA", postal: "73301", conv: 1.0 },
  { city: "NASHVILLE", state: "TN", country: "USA", postal: "37243", conv: 1.0 },
  { city: "CHICAGO", state: "IL", country: "USA", postal: "60601", conv: 1.0 },
  { city: "SEATTLE", state: "WA", country: "USA", postal: "98101", conv: 1.0 },
];

const FIRST = [
  "Sarah", "James", "Priya", "Marcus", "Elena", "David", "Aisha", "Liam", "Nora", "Chen",
  "Olivia", "Noah", "Maya", "Ethan", "Sofia", "Lucas", "Hana", "Diego", "Zoe", "Omar",
  "Grace", "Felix", "Amara", "Ryan", "Yuki", "Carlos", "Leah", "Ivan", "Mira", "Theo",
  "Nadia", "Jonah", "Bianca", "Sam", "Priti", "Kwame", "Tara", "Victor", "Lena", "Hugo",
  "Anika", "Mateo", "Iris", "Paolo", "Reem", "Caleb", "Yara", "Niko", "Dana", "Tariq",
];
const LAST = [
  "Chen", "Okafor", "Nguyen", "Patel", "Rossi", "Kim", "Brooks", "Garcia", "Singh", "Mueller",
  "Haddad", "Lopez", "Walsh", "Ivanov", "Tanaka", "Costa", "Reyes", "Dubois", "Novak", "Khan",
  "Sato", "Romano", "Bauer", "Mensah", "Park", "Silva", "Adeyemi", "Cohen", "Ortiz", "Larsson",
];

function makeEmployees(): Employee[] {
  const employees: Employee[] = [];
  let n = 0;
  for (const dept of DEPARTMENTS) {
    const profile = DEPT_PROFILE[dept];
    for (let i = 0; i < profile.headcount; i++) {
      const first = FIRST[n % FIRST.length];
      const last = pick(LAST);
      const loc = pick(CITIES);
      const title = TITLES[dept] ? pick(TITLES[dept]) : "Specialist";
      const joinedYear = 2019 + Math.floor(rng() * 6);
      const joinedMonth = String(1 + Math.floor(rng() * 12)).padStart(2, "0");
      employees.push({
        id: `E${String(1000 + n)}`,
        name: `${first} ${last}`,
        department: dept,
        title,
        email: `${first.toLowerCase()}.${last.toLowerCase()}@brimco.io`,
        location: `${loc.city.charAt(0) + loc.city.slice(1).toLowerCase()}, ${loc.state}`,
        joinedDate: `${joinedYear}-${joinedMonth}-15`,
        cardLast4: String(1000 + Math.floor(rng() * 9000)),
        monthlyLimit: Math.round((profile.avgTicket * between(14, 28)) / 50) * 50,
        avatarHue: Math.floor(rng() * 360),
      });
      n++;
    }
  }
  return employees;
}

const TITLES: Record<string, string[]> = {
  Engineering: ["Software Engineer", "Senior Engineer", "Staff Engineer", "Eng Manager", "Platform Lead"],
  Sales: ["Account Executive", "SDR", "Sales Manager", "Enterprise AE", "RevOps Lead"],
  Marketing: ["Marketing Manager", "Content Lead", "Growth Marketer", "Brand Designer", "Demand Gen"],
  Operations: ["Ops Analyst", "Ops Manager", "Logistics Lead", "Facilities Coordinator"],
  Finance: ["Financial Analyst", "Controller", "FP&A Lead", "Accountant"],
  "Customer Success": ["CSM", "Senior CSM", "Support Lead", "Onboarding Specialist"],
  Product: ["Product Manager", "Senior PM", "Product Designer", "UX Researcher"],
  "People Ops": ["Recruiter", "People Partner", "Talent Lead", "Office Manager"],
};

// 6 months of data, anchored to the brief's example date window.
const MONTHS = [
  { label: "Apr 2025", start: "2025-04-01", days: 30 },
  { label: "May 2025", start: "2025-05-01", days: 31 },
  { label: "Jun 2025", start: "2025-06-01", days: 30 },
  { label: "Jul 2025", start: "2025-07-01", days: 31 },
  { label: "Aug 2025", start: "2025-08-01", days: 31 },
  { label: "Sep 2025", start: "2025-09-01", days: 30 },
];

export const MONTH_LABELS = MONTHS.map((m) => m.label);
export const MONTH_STARTS = MONTHS.map((m) => m.start);

function makeTransactions(employees: Employee[]): Transaction[] {
  const txns: Transaction[] = [];
  let counter = 0;
  for (const emp of employees) {
    const profile = DEPT_PROFILE[emp.department as Department];
    for (const month of MONTHS) {
      // seasonal bump for marketing in summer, sales toward quarter ends, etc.
      const base = 4 + Math.floor(rng() * 7);
      const count = Math.max(2, Math.round(base * between(0.7, 1.4)));
      for (let i = 0; i < count; i++) {
        const category = pick(profile.categories);
        const merchant = pick(MERCHANTS[category]);
        const loc = pick(CITIES);
        const day = 1 + Math.floor(rng() * month.days);
        const dateStr = `${month.start.slice(0, 8)}${String(day).padStart(2, "0")}`;
        const postDay = Math.min(month.days, day + Math.floor(rng() * 3));
        const postStr = `${month.start.slice(0, 8)}${String(postDay).padStart(2, "0")}`;
        const amount = round2(between(merchant.min, merchant.max));
        const isCredit = rng() < 0.04; // occasional refund
        counter++;
        txns.push({
          id: `T${String(100000 + counter)}`,
          transactionCode: "3001",
          transactionCategory: "0001",
          postingDate: postStr,
          transactionDate: dateStr,
          merchantName: merchant.name,
          amount,
          debitOrCredit: (isCredit ? "Credit" : "Debit") as DebitCredit,
          merchantCategoryCode: merchant.mcc,
          merchantCity: loc.city,
          merchantCountry: loc.country,
          merchantPostalCode: loc.postal,
          merchantState: loc.state,
          conversionRate: loc.country === "CAN" ? round2(loc.conv) : 1,
          department: emp.department,
          employeeId: emp.id,
          employeeName: emp.name,
          spendCategory: category,
        });
      }
    }
  }
  return txns;
}

export const EMPLOYEES: Employee[] = makeEmployees();
export const TRANSACTIONS: Transaction[] = makeTransactions(EMPLOYEES);
