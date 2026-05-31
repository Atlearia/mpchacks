from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from pymongo.errors import PyMongoError

from app.config import get_settings
from app.db import get_db
from app.main import limiter
from app.models.schemas import DatasetResponse, Employee, Transaction

logger = logging.getLogger("app")

router = APIRouter(prefix="/api", tags=["dashboard"])

# Employees already match the dashboard's flat shape; just hide Mongo's _id.
_EMPLOYEE_PROJECTION = {"_id": 0}


def _mcc_category(mcc: Any) -> str:
    """Map a merchant category code to a human-friendly spend bucket.

    The real fleet dataset has no `spendCategory`, so we derive one from the
    MCC. Unknown codes fall back to "Other" so the breakdown view never breaks.
    """
    try:
        code = int(float(mcc))
    except (TypeError, ValueError):
        return "Other"

    if code in (5541, 5542, 5983):
        return "Fuel & Service Stations"
    if code in (5511, 5531, 5532, 5533, 7531, 7538, 7542, 7549) or code == 5571:
        return "Automotive & Repair"
    if code in (9211, 9222, 9311, 9399, 9402):
        return "Government & Permits"
    if 3000 <= code <= 3999 or code in (4111, 4112, 4121, 4131, 4411, 4511, 4722, 7011, 7512, 7513, 7519):
        return "Travel & Transport"
    if code in (4214, 4215, 4225):
        return "Shipping & Logistics"
    if code in (5039, 5046, 5047, 5072, 5085, 5251, 5261):
        return "Industrial Supplies"
    if code in (4816, 4899, 5045, 5732, 5734, 7372, 7379):
        return "Technology"
    if code in (4812, 4814, 4821, 4900):
        return "Utilities & Telecom"
    if code in (5811, 5812, 5813, 5814):
        return "Meals & Entertainment"
    if code in (5111, 5300, 5310, 5311, 5331, 5943):
        return "Office & Retail"
    if code in (7311, 7392, 7399, 8111, 8911, 8931, 8999):
        return "Professional Services"
    return "Other"


def _as_str(value: Any, default: str = "") -> str:
    if value is None:
        return default
    return str(value)


def _map_transaction(doc: dict[str, Any]) -> Transaction:
    """Translate a raw `transactions_clean` document into the frontend shape."""
    return Transaction(
        id=_as_str(doc.get("_id")),
        transactionCode=_as_str(doc.get("transaction_code")),
        transactionCategory=_as_str(doc.get("transaction_category")),
        postingDate=_as_str(doc.get("posting_date")),
        transactionDate=_as_str(doc.get("transaction_date")),
        merchantName=_as_str(doc.get("merchant_name")),
        amount=float(doc.get("amount") or 0),
        debitOrCredit=_as_str(doc.get("debit_or_credit"), "Debit"),
        merchantCategoryCode=_as_str(doc.get("merchant_category_code")),
        merchantCity=_as_str(doc.get("merchant_city")),
        merchantCountry=_as_str(doc.get("merchant_country")),
        merchantPostalCode=_as_str(doc.get("merchant_postal_code")),
        merchantState=_as_str(doc.get("merchant_state_province")),
        conversionRate=float(doc.get("conversion_rate") or 0),
        department=_as_str(doc.get("department")),
        employeeId=_as_str(doc.get("employee_id")),
        employeeName=_as_str(doc.get("employee_name")),
        spendCategory=_mcc_category(doc.get("merchant_category_code")),
    )


@router.get("/dataset", response_model=DatasetResponse, status_code=status.HTTP_200_OK)
@limiter.limit(get_settings().RATE_LIMIT_DEFAULT)
async def dataset(request: Request) -> DatasetResponse:
    """Serve the full expense dataset (employees + transactions) from MongoDB.

    Transactions come from the real `transactions_clean` collection and are
    reshaped to the flat camelCase contract the dashboard expects. The dashboard
    performs its own client-side aggregation, so we hand back the raw rows.
    """
    db = get_db()
    try:
        employees = await db.employees.find({}, _EMPLOYEE_PROJECTION).to_list(length=None)
        transactions = await db.transactions_clean.find({}).to_list(length=None)
    except PyMongoError:
        logger.exception("Failed to read dashboard dataset from MongoDB")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to reach the database. Check the MongoDB connection.",
        )

    return DatasetResponse(
        employees=[Employee(**doc) for doc in employees],
        transactions=[_map_transaction(doc) for doc in transactions],
    )
