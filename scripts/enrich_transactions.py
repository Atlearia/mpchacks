"""Enrich the real transactions with synthetic department + employee ownership.

The raw ``brim_hackathon.transactions_clean`` collection (4,235 real fleet-card
transactions) has no people dimension. This script assigns every transaction to
a synthetic employee who belongs to one of nine departments, where each employee
owns a random 5-20 transactions. It also (re)builds an ``employees`` collection
matching the dashboard's Employee shape so the UI can drill department -> person.

Usage (from the repo root, with .env containing MONGODB_URI / MONGODB_DB):

    python -m scripts.enrich_transactions

Re-running is safe and deterministic: the same seed reproduces the same
assignment, the employees collection is rebuilt, and the department/employee
fields on each transaction are overwritten.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import certifi
from pymongo import ASCENDING, MongoClient, UpdateOne

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# --------------------------------------------------------------------------- 
# Deterministic PRNG (mulberry32, same as the seed script) so a given run
# reproduces the same department/employee assignment.
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


rng = Rng(20260531)


def pick(arr: list):
    return arr[int(rng() * len(arr))]


def between(lo: float, hi: float) -> float:
    return lo + rng() * (hi - lo)


def randint(lo: int, hi: int) -> int:
    """Inclusive integer in [lo, hi]."""
    return lo + int(rng() * (hi - lo + 1))


# ---------------------------------------------------------------------------
# Reference data
# ---------------------------------------------------------------------------

DEPARTMENTS = [
    "HR",
    "Finance",
    "Engineering",
    "Marketing",
    "Sales",
    "Legal",
    "R&D",
    "Customer Service",
    "Supply Chain",
]

TITLES = {
    "HR": ["HR Generalist", "Recruiter", "People Partner", "HR Manager"],
    "Finance": ["Financial Analyst", "Controller", "FP&A Lead", "Accountant"],
    "Engineering": ["Software Engineer", "Senior Engineer", "Staff Engineer", "Eng Manager"],
    "Marketing": ["Marketing Manager", "Content Lead", "Growth Marketer", "Brand Designer"],
    "Sales": ["Account Executive", "SDR", "Sales Manager", "Enterprise AE"],
    "Legal": ["Counsel", "Paralegal", "Compliance Lead", "Contracts Manager"],
    "R&D": ["Research Scientist", "R&D Engineer", "Lab Lead", "Principal Researcher"],
    "Customer Service": ["Support Agent", "Support Lead", "CSM", "Onboarding Specialist"],
    "Supply Chain": ["Logistics Analyst", "Procurement Lead", "Ops Manager", "Fleet Coordinator"],
}

CITIES = [
    {"city": "TORONTO", "state": "ON"},
    {"city": "VANCOUVER", "state": "BC"},
    {"city": "CALGARY", "state": "AB"},
    {"city": "MONTREAL", "state": "QC"},
    {"city": "NEW YORK", "state": "NY"},
    {"city": "AUSTIN", "state": "TX"},
    {"city": "CHICAGO", "state": "IL"},
    {"city": "SEATTLE", "state": "WA"},
    {"city": "DENVER", "state": "CO"},
    {"city": "ATLANTA", "state": "GA"},
]

FIRST = [
    "Sarah", "James", "Priya", "Marcus", "Elena", "David", "Aisha", "Liam", "Nora", "Chen",
    "Olivia", "Noah", "Maya", "Ethan", "Sofia", "Lucas", "Hana", "Diego", "Zoe", "Omar",
    "Grace", "Felix", "Amara", "Ryan", "Yuki", "Carlos", "Leah", "Ivan", "Mira", "Theo",
    "Nadia", "Jonah", "Bianca", "Sam", "Priti", "Kwame", "Tara", "Victor", "Lena", "Hugo",
    "Anika", "Mateo", "Iris", "Paolo", "Reem", "Caleb", "Yara", "Niko", "Dana", "Tariq",
    "Mila", "Owen", "Farah", "Jasper", "Lina", "Andre", "Saanvi", "Cole", "Freya", "Rohan",
]
LAST = [
    "Chen", "Okafor", "Nguyen", "Patel", "Rossi", "Kim", "Brooks", "Garcia", "Singh", "Mueller",
    "Haddad", "Lopez", "Walsh", "Ivanov", "Tanaka", "Costa", "Reyes", "Dubois", "Novak", "Khan",
    "Sato", "Romano", "Bauer", "Mensah", "Park", "Silva", "Adeyemi", "Cohen", "Ortiz", "Larsson",
    "Wright", "Flores", "Bianchi", "Hassan", "Murphy", "Vargas", "Schmidt", "Ali", "Becker", "Mori",
]

MIN_TXNS = 5
MAX_TXNS = 20


def _load_env() -> dict[str, str]:
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


def make_employee(index: int) -> dict:
    """Build one synthetic employee record (dashboard Employee shape)."""
    first = pick(FIRST)
    last = pick(LAST)
    dept = pick(DEPARTMENTS)
    loc = pick(CITIES)
    title = pick(TITLES[dept])
    joined_year = 2019 + int(rng() * 6)
    joined_month = str(1 + int(rng() * 12)).zfill(2)
    return {
        "id": f"E{1000 + index}",
        "name": f"{first} {last}",
        "department": dept,
        "title": title,
        "email": f"{first.lower()}.{last.lower()}{index}@brimco.io",
        "location": f"{loc['city'][0] + loc['city'][1:].lower()}, {loc['state']}",
        "joinedDate": f"{joined_year}-{joined_month}-15",
        "cardLast4": str(1000 + int(rng() * 9000)),
        "monthlyLimit": round(between(8, 40)) * 500,
        "avatarHue": int(rng() * 360),
    }


def main() -> None:
    env = _load_env()
    uri = env.get("MONGODB_URI", "")
    db_name = env.get("MONGODB_DB") or "brim_hackathon"
    if not uri:
        raise SystemExit("MONGODB_URI is not set. Add it to your .env file first.")

    client = MongoClient(uri, tlsCAFile=certifi.where())
    db = client[db_name]
    txns = db.transactions_clean

    # Stable ordering so the deterministic chunking is reproducible.
    ids = [
        doc["_id"]
        for doc in txns.find({}, {"_id": 1}).sort(
            [("transaction_date", ASCENDING), ("raw_row_number", ASCENDING), ("_id", ASCENDING)]
        )
    ]
    total = len(ids)
    if total == 0:
        raise SystemExit(f"No documents found in {db_name}.transactions_clean.")

    # Shuffle (Fisher-Yates with the seeded RNG) so an employee's transactions
    # are spread across merchants/months rather than being one contiguous block.
    for i in range(total - 1, 0, -1):
        j = int(rng() * (i + 1))
        ids[i], ids[j] = ids[j], ids[i]

    employees: list[dict] = []
    ops: list[UpdateOne] = []
    cursor = 0
    emp_index = 0

    while cursor < total:
        remaining = total - cursor
        size = randint(MIN_TXNS, MAX_TXNS)
        # Avoid orphaning a sub-minimum tail: fold it into the current employee.
        if remaining - size < MIN_TXNS:
            size = remaining
        emp = make_employee(emp_index)
        employees.append(emp)
        for _id in ids[cursor : cursor + size]:
            ops.append(
                UpdateOne(
                    {"_id": _id},
                    {
                        "$set": {
                            "department": emp["department"],
                            "employee_id": emp["id"],
                            "employee_name": emp["name"],
                        }
                    },
                )
            )
        cursor += size
        emp_index += 1

    # Apply transaction updates in batches.
    BATCH = 1000
    modified = 0
    for start in range(0, len(ops), BATCH):
        result = txns.bulk_write(ops[start : start + BATCH], ordered=False)
        modified += result.modified_count

    # Rebuild the employees collection.
    db.employees.delete_many({})
    db.employees.insert_many(employees)
    db.employees.create_index([("id", ASCENDING)], unique=True)
    db.transactions_clean.create_index([("employee_id", ASCENDING)])
    db.transactions_clean.create_index([("department", ASCENDING)])

    counts: dict[str, int] = {}
    for emp in employees:
        counts[emp["department"]] = counts.get(emp["department"], 0) + 1

    print(f"Enriched {modified}/{total} transactions in '{db_name}'.")
    print(f"Created {len(employees)} employees across {len(DEPARTMENTS)} departments:")
    for dept in DEPARTMENTS:
        print(f"  {dept:<18} {counts.get(dept, 0)} employees")
    client.close()


if __name__ == "__main__":
    main()
