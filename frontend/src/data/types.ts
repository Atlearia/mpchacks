export type DebitCredit = "Debit" | "Credit";

export interface Transaction {
  id: string;
  transactionCode: string;
  transactionCategory: string;
  postingDate: string; // ISO date
  transactionDate: string; // ISO date
  merchantName: string;
  amount: number; // positive USD
  debitOrCredit: DebitCredit;
  merchantCategoryCode: string;
  merchantCity: string;
  merchantCountry: string;
  merchantPostalCode: string;
  merchantState: string;
  conversionRate: number;
  // Enrichment (joined from HR system once Mongo is wired up)
  department: string;
  employeeId: string;
  employeeName: string;
  spendCategory: string; // human-friendly category bucket
}

export interface Employee {
  id: string;
  name: string;
  department: string;
  title: string;
  email: string;
  location: string;
  joinedDate: string;
  cardLast4: string;
  monthlyLimit: number;
  avatarHue: number;
}

export interface DeptDatePoint {
  department: string;
  date: string; // YYYY-MM-DD (month bucket start)
  monthLabel: string;
  total: number;
  txnCount: number;
}
