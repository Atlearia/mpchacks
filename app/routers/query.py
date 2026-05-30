from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.config import get_settings
from app.main import job_store, limiter
from app.models.schemas import QueryRequest, QueryResponse
from app.security import require_api_key
from app.services import gemini

router = APIRouter(tags=["query"])


@router.post("/query", response_model=QueryResponse, status_code=status.HTTP_200_OK)
@limiter.limit(get_settings().RATE_LIMIT_QUERY)
async def query(
    request: Request,
    payload: QueryRequest,
    caller: str = Depends(require_api_key),
) -> QueryResponse:
    job = job_store.get(payload.job_id)
    # Return 404 (not 403) for jobs the caller does not own so existence of
    # another caller's job is not revealed.
    if job is None or job.get("owner") != caller:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No job found for job_id '{payload.job_id}'.",
        )

    # Backstop against runaway paid-API spend even if rate limits are evaded.
    gemini.enforce_daily_budget()

    chunks: list[str] = job.get("chunks") or [job.get("data", "")]
    chunk = chunks[0] if chunks else ""

    answer = await gemini.query_gemini(chunk=chunk, question=payload.question)

    return QueryResponse(job_id=payload.job_id, answer=answer, model=gemini.MODEL_NAME)
