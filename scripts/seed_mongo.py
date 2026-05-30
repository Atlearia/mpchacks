"""Seed the MongoDB cluster with the expense dataset.

This replaces the frontend's old in-browser dummy generator. The same
deterministic data now lives in MongoDB and is served via /api/dataset.

Usage (from the repo root, with .env containing MONGODB_URI):

    python -m scripts.seed_mongo

Re-running is safe: the employees/transactions collections are cleared and
rewritten each time.
"""

from __future__ import annotations

import sys
from pathlib import Path

import certifi
from pymongo import ASCENDING, MongoClient

# Allow `python scripts/seed_mongo.py` as well as `-m scripts.seed_mongo`.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# ---------------------------------------------------------------------------
# Deterministic PRNG (faithful port of the frontend's mulberry32) so the seeded
# data is stable across runs.
# ---------------------------------------------------------------------------

_MASK = 0xFFFFFFFF


def _u32(x: int) -> int:
    return x & _MASK


def _s32(x: int) -> int:
    x &= _MASK
    return x - 0x100000000 if x >= 0x80000000 else x


def _imul(a: int, b: int) -> int:
    return _s32((_s32(a) * _s32(b)) & _MASK)


def _ushr(x: int, n: int) -> int:
    return _u32(x) >> n


class Rng:
    def __init__(self, seed: int) -> None:
        self.a = _u32(seed)

    def __call__(self) -> float:
        self.a = _s32(self.a)
        self.a = _s32(self.a + 0x6D2B79F5)
        t = _imul(_s32(self.a ^ _ushr(self.a, 15)), _s32(1 | self.a))
        t = _s32(_s32(t + _imul(_s32(t ^ _ushr(t, 7)), _s32(61 | t))) ^ t)
        return _u32(t ^ _ushr(t, 14)) / 4294967296


rng = Rng(20260530)


def pick(arr: list):
    return arr[int(rng() * len(arr))]


def between(lo: float, hi: float) -> float:
    return lo + rng() * (hi - lo)


def round2(n: float) -> float:
    return round(n * 100) / 100


# ---------------------------------------------------------------------------
# Reference data
# ---------------------------------------------------------------------------

DEPARTMENTS = [
    "Engineering",
    "Sales",
    "Marketing",
    "Operations",
    "Finance",
    "Customer Success",
    "Product",
    "People Ops",
]

DEPT_PROFILE = {
    "Engineering": {"headcount": 12, "avgTicket": 210, "categories": ["Cloud & Hosting", "Software", "Hardware"]},
    "Sales": {"headcount": 9, "avgTicket": 180, "categories": ["Travel", "Meals & Entertainment", "Software"]},
    "Marketing": {"headcount": 7, "avgTicket": 320, "categories": ["Advertising", "Software", "Events"]},
    "Operations": {"headcount": 6, "avgTicket": 140, "categories": ["Logistics", "Office Supplies", "Software"]},
    "Finance": {"headcount": 4, "avgTicket": 90, "categories": ["Software", "Professional Services", "Office Supplies"]},
    "Customer Success": {"headcount": 6, "avgTicket": 120, "categories": ["Software", "Travel", "Meals & Entertainment"]},
    "Product": {"headcount": 5, "avgTicket": 160, "categories": ["Software", "Research", "Events"]},
    "People Ops": {"headcount": 4, "avgTicket": 130, "categories": ["Recruiting", "Office Supplies", "Events"]},
}

MERCHANTS = {
    "Cloud & Hosting": [
        {"name": "AMAZON WEB SERVICES", "mcc": "7372", "min": 400, "max": 4200},
        {"name": "GOOGLE CLOUD EMEA", "mcc": "7372", "min": 250, "max": 3100},
        {"name": "VERCEL INC", "mcc": "5734", "min": 20, "max": 480},
        {"name": "DATADOG INC", "mcc": "5734", "min": 90, "max": 1400},
    ],
    "Software": [
        {"name": "FIGMA INC", "mcc": "5734", "min": 12, "max": 75},
        {"name": "NOTION LABS", "mcc": "5734", "min": 8, "max": 60},
        {"name": "SLACK TECHNOLOGIES", "mcc": "5734", "min": 15, "max": 320},
        {"name": "GITHUB INC", "mcc": "5734", "min": 21, "max": 210},
        {"name": "ATLASSIAN PTY", "mcc": "5734", "min": 30, "max": 540},
    ],
    "Hardware": [
        {"name": "APPLE STORE #R042", "mcc": "5732", "min": 120, "max": 2600},
        {"name": "DELL TECHNOLOGIES", "mcc": "5732", "min": 220, "max": 1900},
        {"name": "BEST BUY #1187", "mcc": "5732", "min": 40, "max": 900},
    ],
    "Travel": [
        {"name": "DELTA AIR LINES", "mcc": "3058", "min": 180, "max": 1450},
        {"name": "MARRIOTT BONVOY", "mcc": "3509", "min": 140, "max": 980},
        {"name": "UBER TRIP", "mcc": "4121", "min": 9, "max": 88},
        {"name": "AIR CANADA", "mcc": "3008", "min": 210, "max": 1620},
        {"name": "ENTERPRISE RENT-A-CAR", "mcc": "3387", "min": 70, "max": 540},
    ],
    "Meals & Entertainment": [
        {"name": "STARBUCKS #8842", "mcc": "5814", "min": 4, "max": 38},
        {"name": "THE KEG STEAKHOUSE", "mcc": "5812", "min": 45, "max": 620},
        {"name": "CHIPOTLE 2245", "mcc": "5814", "min": 9, "max": 140},
        {"name": "DOORDASH", "mcc": "5812", "min": 18, "max": 260},
    ],
    "Advertising": [
        {"name": "META PLATFORMS ADS", "mcc": "7311", "min": 300, "max": 6800},
        {"name": "GOOGLE ADS", "mcc": "7311", "min": 250, "max": 5400},
        {"name": "LINKEDIN ADS", "mcc": "7311", "min": 180, "max": 2900},
    ],
    "Events": [
        {"name": "EVENTBRITE", "mcc": "7922", "min": 60, "max": 1800},
        {"name": "HUBSPOT INBOUND REG", "mcc": "8398", "min": 600, "max": 1950},
        {"name": "CVENT CONFERENCE", "mcc": "7399", "min": 400, "max": 2400},
    ],
    "Logistics": [
        {"name": "FEDEX 2885758", "mcc": "4215", "min": 12, "max": 340},
        {"name": "UPS STORE #4471", "mcc": "4215", "min": 9, "max": 280},
        {"name": "ULINE SHIPPING SUPPLY", "mcc": "5085", "min": 40, "max": 720},
    ],
    "Office Supplies": [
        {"name": "STAPLES #00921", "mcc": "5943", "min": 12, "max": 410},
        {"name": "AMAZON BUSINESS", "mcc": "5943", "min": 8, "max": 680},
        {"name": "COSTCO WHOLESALE", "mcc": "5300", "min": 40, "max": 920},
    ],
    "Professional Services": [
        {"name": "QUICKBOOKS PAYROLL", "mcc": "8931", "min": 80, "max": 1400},
        {"name": "STRIPE BILLING", "mcc": "7392", "min": 25, "max": 1200},
        {"name": "DELOITTE ADVISORY", "mcc": "8931", "min": 800, "max": 5200},
    ],
    "Research": [
        {"name": "GARTNER INC", "mcc": "8999", "min": 400, "max": 4800},
        {"name": "STATISTA", "mcc": "5734", "min": 40, "max": 600},
        {"name": "USERTESTING.COM", "mcc": "7372", "min": 90, "max": 1100},
    ],
    "Recruiting": [
        {"name": "LINKEDIN RECRUITER", "mcc": "7361", "min": 200, "max": 2400},
        {"name": "GREENHOUSE SOFTWARE", "mcc": "5734", "min": 120, "max": 1600},
        {"name": "INDEED HIRE", "mcc": "7361", "min": 80, "max": 1900},
    ],
}

CITIES = [
    {"city": "TORONTO", "state": "ON", "country": "CAN", "postal": "M5V2T6", "conv": 1.376},
    {"city": "VANCOUVER", "state": "BC", "country": "CAN", "postal": "V6B1A1", "conv": 1.376},
    {"city": "NEW YORK", "state": "NY", "country": "USA", "postal": "10001", "conv": 1.0},
    {"city": "SAN FRANCISCO", "state": "CA", "country": "USA", "postal": "94105", "conv": 1.0},
    {"city": "AUSTIN", "state": "TX", "country": "USA", "postal": "73301", "conv": 1.0},
    {"city": "NASHVILLE", "state": "TN", "country": "USA", "postal": "37243", "conv": 1.0},
    {"city": "CHICAGO", "state": "IL", "country": "USA", "postal": "60601", "conv": 1.0},
    {"city": "SEATTLE", "state": "WA", "country": "USA", "postal": "98101", "conv": 1.0},
]

FIRST = [
    "Sarah", "James", "Priya", "Marcus", "Elena", "David", "Aisha", "Liam", "Nora", "Chen",
    "Olivia", "Noah", "Maya", "Ethan", "Sofia", "Lucas", "Hana", "Diego", "Zoe", "Omar",
    "Grace", "Felix", "Amara", "Ryan", "Yuki", "Carlos", "Leah", "Ivan", "Mira", "Theo",
    "Nadia", "Jonah", "Bianca", "Sam", "Priti", "Kwame", "Tara", "Victor", "Lena", "Hugo",
    "Anika", "Mateo", "Iris", "Paolo", "Reem", "Caleb", "Yara", "Niko", "Dana", "Tariq",
]
LAST = [
    "Chen", "Okafor", "Nguyen", "Patel", "Rossi", "Kim", "Brooks", "Garcia", "Singh", "Mueller",
    "Haddad", "Lopez", "Walsh", "Ivanov", "Tanaka", "Costa", "Reyes", "Dubois", "Novak", "Khan",
    "Sato", "Romano", "Bauer", "Mensah", "Park", "Silva", "Adeyemi", "Cohen", "Ortiz", "Larsson",
]

TITLES = {
    "Engineering": ["Software Engineer", "Senior Engineer", "Staff Engineer", "Eng Manager", "Platform Lead"],
    "Sales": ["Account Executive", "SDR", "Sales Manager", "Enterprise AE", "RevOps Lead"],
    "Marketing": ["Marketing Manager", "Content Lead", "Growth Marketer", "Brand Designer", "Demand Gen"],
    "Operations": ["Ops Analyst", "Ops Manager", "Logistics Lead", "Facilities Coordinator"],
    "Finance": ["Financial Analyst", "Controller", "FP&A Lead", "Accountant"],
    "Customer Success": ["CSM", "Senior CSM", "Support Lead", "Onboarding Specialist"],
    "Product": ["Product Manager", "Senior PM", "Product Designer", "UX Researcher"],
    "People Ops": ["Recruiter", "People Partner", "Talent Lead", "Office Manager"],
}

MONTHS = [
    {"label": "Apr 2025", "start": "2025-04-01", "days": 30},
    {"label": "May 2025", "start": "2025-05-01", "days": 31},
    {"label": "Jun 2025", "start": "2025-06-01", "days": 30},
    {"label": "Jul 2025", "start": "2025-07-01", "days": 31},
    {"label": "Aug 2025", "start": "2025-08-01", "days": 31},
    {"label": "Sep 2025", "start": "2025-09-01", "days": 30},
]


def make_employees() -> list[dict]:
    employees: list[dict] = []
    n = 0
    for dept in DEPARTMENTS:
        profile = DEPT_PROFILE[dept]
        for _ in range(profile["headcount"]):
            first = FIRST[n % len(FIRST)]
            last = pick(LAST)
            loc = pick(CITIES)
            title = pick(TITLES[dept]) if dept in TITLES else "Specialist"
            joined_year = 2019 + int(rng() * 6)
            joined_month = str(1 + int(rng() * 12)).zfill(2)
            employees.append(
                {
                    "id": f"E{1000 + n}",
                    "name": f"{first} {last}",
                    "department": dept,
                    "title": title,
                    "email": f"{first.lower()}.{last.lower()}@brimco.io",
                    "location": f"{loc['city'][0] + loc['city'][1:].lower()}, {loc['state']}",
                    "joinedDate": f"{joined_year}-{joined_month}-15",
                    "cardLast4": str(1000 + int(rng() * 9000)),
                    "monthlyLimit": round((profile["avgTicket"] * between(14, 28)) / 50) * 50,
                    "avatarHue": int(rng() * 360),
                }
            )
            n += 1
    return employees


def make_transactions(employees: list[dict]) -> list[dict]:
    txns: list[dict] = []
    counter = 0
    for emp in employees:
        profile = DEPT_PROFILE[emp["department"]]
        for month in MONTHS:
            base = 4 + int(rng() * 7)
            count = max(2, round(base * between(0.7, 1.4)))
            for _ in range(count):
                category = pick(profile["categories"])
                merchant = pick(MERCHANTS[category])
                loc = pick(CITIES)
                day = 1 + int(rng() * month["days"])
                date_str = f"{month['start'][:8]}{str(day).zfill(2)}"
                post_day = min(month["days"], day + int(rng() * 3))
                post_str = f"{month['start'][:8]}{str(post_day).zfill(2)}"
                amount = round2(between(merchant["min"], merchant["max"]))
                is_credit = rng() < 0.04
                counter += 1
                txns.append(
                    {
                        "id": f"T{100000 + counter}",
                        "transactionCode": "3001",
                        "transactionCategory": "0001",
                        "postingDate": post_str,
                        "transactionDate": date_str,
                        "merchantName": merchant["name"],
                        "amount": amount,
                        "debitOrCredit": "Credit" if is_credit else "Debit",
                        "merchantCategoryCode": merchant["mcc"],
                        "merchantCity": loc["city"],
                        "merchantCountry": loc["country"],
                        "merchantPostalCode": loc["postal"],
                        "merchantState": loc["state"],
                        "conversionRate": round2(loc["conv"]) if loc["country"] == "CAN" else 1,
                        "department": emp["department"],
                        "employeeId": emp["id"],
                        "employeeName": emp["name"],
                        "spendCategory": category,
                    }
                )
    return txns


def _load_env() -> dict[str, str]:
    """Read .env from the repo root (falling back to the process environment)."""
    import os

    env: dict[str, str] = {}
    env_file = Path(__file__).resolve().parents[1] / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            env[key.strip()] = value.strip()
    for key in ("MONGODB_URI", "MONGODB_DB"):
        if os.environ.get(key):
            env[key] = os.environ[key]
    return env


def main() -> None:
    env = _load_env()
    uri = env.get("MONGODB_URI", "")
    db_name = env.get("MONGODB_DB") or "brim"
    if not uri:
        raise SystemExit("MONGODB_URI is not set. Add it to your .env file first.")

    employees = make_employees()
    transactions = make_transactions(employees)

    client = MongoClient(uri, tlsCAFile=certifi.where())
    db = client[db_name]

    db.employees.delete_many({})
    db.transactions.delete_many({})
    db.employees.insert_many(employees)
    db.transactions.insert_many(transactions)

    db.employees.create_index([("id", ASCENDING)], unique=True)
    db.transactions.create_index([("employeeId", ASCENDING)])
    db.transactions.create_index([("department", ASCENDING), ("transactionDate", ASCENDING)])

    print(
        f"Seeded '{db_name}': "
        f"{len(employees)} employees, {len(transactions)} transactions."
    )
    client.close()


if __name__ == "__main__":
    main()
