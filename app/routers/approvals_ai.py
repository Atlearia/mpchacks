from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.config import get_settings
from app.main import limiter
from app.routers.ask import _get_cached_summary
from app.services import gemini

logger = logging.getLogger("app")

router = APIRouter(prefix="/api/approvals", tags=["approvals-ai"])


class ApprovalRecommendRequest(BaseModel):
    employeeName: str
    department: str
    title: str
    amount: float
    category: str
    merchant: str
    budgetRemaining: float
    priorSimilar: int
    history: list[dict[str, Any]] = Field(default_factory=list)


class ApprovalRecommendResponse(BaseModel):
    recommendation: str = "review"
    confidence: int = 75
    reasoning: list[str] = Field(default_factory=list)
    riskFlags: list[str] = Field(default_factory=list)
    suggestedConditions: str = ""
    model: str = gemini.MODEL_NAME


@router.post("/recommend", response_model=ApprovalRecommendResponse, status_code=status.HTTP_200_OK)
@limiter.limit(get_settings().RATE_LIMIT_QUERY)
async def recommend_approval(request: Request, payload: ApprovalRecommendRequest) -> ApprovalRecommendResponse:
    """AI-powered approval recommendation with contextual reasoning."""
    dataset_summary = await _get_cached_summary()

    request_details = json.dumps({
        "employeeName": payload.employeeName,
        "department": payload.department,
        "requestTitle": payload.title,
        "amount": payload.amount,
        "category": payload.category,
        "merchant": payload.merchant,
        "budgetRemaining": payload.budgetRemaining,
    }, separators=(",", ":"))

    employee_history = json.dumps({
        "priorSimilarCharges": payload.priorSimilar,
        "monthlySpendHistory": payload.history,
    }, separators=(",", ":"))

    try:
        result = await gemini.recommend_approval(
            request_details=request_details,
            employee_history=employee_history,
            dataset_summary=dataset_summary,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except Exception:
        logger.exception("Gemini approval recommendation failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="AI recommendation failed.")

    return ApprovalRecommendResponse(
        recommendation=result.get("recommendation", "review"),
        confidence=result.get("confidence", 75),
        reasoning=result.get("reasoning", []),
        riskFlags=result.get("riskFlags", []),
        suggestedConditions=result.get("suggestedConditions", ""),
        model=gemini.MODEL_NAME,
    )
