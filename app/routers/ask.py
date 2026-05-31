from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field
from pymongo.errors import PyMongoError

from app.config import get_settings
from app.db import get_db
from app.main import limiter
from app.services import gemini

logger = logging.getLogger("app")

router = APIRouter(prefix="/api", tags=["ask"])


class AskHistoryItem(BaseModel):
    role: str = Field(..., pattern="^(user|ai)$")
    content: str


class AskRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=4000)
    history: list[AskHistoryItem] = Field(default_factory=list)
    session_id: str = Field(default="")


class AskResponse(BaseModel):
    summary: str
    chartType: str = "none"
    chartData: Any = None
    followups: list[str] = Field(default_factory=list)
    model: str = gemini.MODEL_NAME


async def _load_dataset_summary() -> str:
    """Load the full transaction + employee dataset and compress it."""
    db = get_db()
    try:
        employees = await db.employees.find({}, {"_id": 0}).to_list(length=None)
        transactions = await db.transactions_clean.find({}).to_list(length=None)
    except PyMongoError:
        logger.exception("Failed to read dataset from MongoDB for AI query")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to reach the database.",
        )

    # Map raw Mongo field names to the summary builder's expected shape
    mapped_txns = []
    for doc in transactions:
        mapped_txns.append({
            "amount": float(doc.get("amount", 0)),
            "debitOrCredit": str(doc.get("debit_or_credit", "Debit")),
            "department": str(doc.get("department", "")),
            "spendCategory": _mcc_category(doc.get("merchant_category_code")),
            "merchantName": str(doc.get("merchant_name", "")),
            "employeeName": str(doc.get("employee_name", "")),
            "transactionDate": str(doc.get("transaction_date", "")),
            "merchantCity": str(doc.get("merchant_city", "")),
            "merchantCountry": str(doc.get("merchant_country", "")),
        })

    return gemini.build_dataset_summary(mapped_txns, employees)


def _mcc_category(mcc: Any) -> str:
    """Map a merchant category code to a human-friendly spend bucket (mirrors dashboard.py)."""
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


# Simple in-memory cache for the dataset summary (valid for 60 seconds)
_summary_cache: dict[str, Any] = {"summary": None, "ts": 0}

import time


async def _get_cached_summary() -> str:
    now = time.time()
    if _summary_cache["summary"] and (now - _summary_cache["ts"]) < 60:
        return _summary_cache["summary"]
    summary = await _load_dataset_summary()
    _summary_cache["summary"] = summary
    _summary_cache["ts"] = now
    return summary


@router.post("/ask", response_model=AskResponse, status_code=status.HTTP_200_OK)
@limiter.limit(get_settings().RATE_LIMIT_QUERY)
async def ask(request: Request, payload: AskRequest) -> AskResponse:
    """AI-powered conversational analytics over the expense dataset."""
    dataset_summary = await _get_cached_summary()

    # Convert frontend history format to Gemini chat format
    chat_history = []
    for item in payload.history:
        chat_history.append({
            "role": item.role,
            "content": item.content,
        })

    try:
        result = await gemini.ask_with_context(
            dataset_summary=dataset_summary,
            question=payload.question,
            history=chat_history if chat_history else None,
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        )
    except Exception:
        logger.exception("Gemini ask_with_context failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="AI query failed. Please try again.",
        )

    if result.get("error") == "parse_failed":
        return AskResponse(
            summary="I had trouble understanding the data for that question. Could you try rephrasing it?",
            chartType="none",
            followups=["Show me spend by department", "What are our top vendors?"],
        )

    return AskResponse(
        summary=result.get("summary", "No answer generated."),
        chartType=result.get("chartType", "none"),
        chartData=result.get("chartData"),
        followups=result.get("followups", []),
        model=gemini.MODEL_NAME,
    )
