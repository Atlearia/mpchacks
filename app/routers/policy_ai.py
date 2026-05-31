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
from app.routers.ask import _get_cached_summary, _mcc_category
from app.services import gemini

logger = logging.getLogger("app")

router = APIRouter(prefix="/api/policy", tags=["policy-ai"])


class ViolationSummaryItem(BaseModel):
    type: str
    severity: str
    employeeName: str
    department: str
    amount: float
    merchantName: str
    title: str
    detail: str


class PolicyAnalyzeRequest(BaseModel):
    violations: list[ViolationSummaryItem] = Field(..., max_length=50)


class PolicyAnalyzeResponse(BaseModel):
    headline: str = ""
    riskLevel: str = "moderate"
    topActions: list[dict[str, Any]] = Field(default_factory=list)
    narrative: str = ""
    trendInsight: str = ""
    model: str = gemini.MODEL_NAME


@router.post("/analyze", response_model=PolicyAnalyzeResponse, status_code=status.HTTP_200_OK)
@limiter.limit(get_settings().RATE_LIMIT_QUERY)
async def analyze_policy(request: Request, payload: PolicyAnalyzeRequest) -> PolicyAnalyzeResponse:
    """AI-powered executive brief on policy violations."""
    dataset_summary = await _get_cached_summary()

    violations_json = json.dumps(
        [v.model_dump() for v in payload.violations[:30]],
        separators=(",", ":"),
    )

    try:
        result = await gemini.analyze_policy(
            violations_summary=violations_json,
            dataset_summary=dataset_summary,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except Exception:
        logger.exception("Gemini policy analysis failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="AI analysis failed.")

    return PolicyAnalyzeResponse(
        headline=result.get("headline", "Policy analysis complete."),
        riskLevel=result.get("riskLevel", "moderate"),
        topActions=result.get("topActions", []),
        narrative=result.get("narrative", ""),
        trendInsight=result.get("trendInsight", ""),
        model=gemini.MODEL_NAME,
    )
