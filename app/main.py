from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.config import get_settings
from app.models.schemas import HealthResponse
from app.security import rate_limit_key

logger = logging.getLogger("app")

settings = get_settings()

# In-memory job storage keyed by job_id:
#   {"data": str, "chunks": list[str], "metadata": dict, "created_at": str}
# TODO: replace with Redis or PostgreSQL for production
job_store: dict[str, dict[str, Any]] = {}


def store_job(job_id: str, entry: dict[str, Any]) -> None:
    """Insert a job, evicting the oldest entries once MAX_JOBS is exceeded."""
    job_store[job_id] = entry
    while len(job_store) > settings.MAX_JOBS:
        oldest = next(iter(job_store))
        job_store.pop(oldest, None)


# Rate limit per credential (hashed API key) when present, otherwise per client
# IP — so a single shared proxy IP does not collapse everyone into one bucket.
limiter = Limiter(key_func=rate_limit_key, default_limits=[settings.RATE_LIMIT_DEFAULT])

app = FastAPI(
    title="Data Ingestion & Gemini Query Service",
    version="1.0.0",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# Reject requests with an unexpected Host header when an allowlist is configured.
if settings.allowed_hosts_list:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts_list)

if settings.allowed_origins_list:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins_list,
        # No cookie/credentialed auth is used (the API key travels in a header),
        # so credentials stay off to keep the cross-origin blast radius minimal.
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-API-Key"],
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Return an opaque 500 so internal errors never leak stack traces to clients."""
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error."},
    )


@app.get("/health", response_model=HealthResponse, tags=["system"])
async def health() -> HealthResponse:
    return HealthResponse(status="ok", timestamp=datetime.now(timezone.utc).isoformat())


# Imported after job_store/limiter exist to avoid circular imports.
from app.routers import dashboard, ingest, query  # noqa: E402
from app.routers import ask as ask_router  # noqa: E402
from app.routers import policy_ai, approvals_ai  # noqa: E402

app.include_router(ingest.router)
app.include_router(query.router)
app.include_router(dashboard.router)
app.include_router(ask_router.router)
app.include_router(policy_ai.router)
app.include_router(approvals_ai.router)


@app.on_event("shutdown")
async def _shutdown() -> None:
    from app.db import close_client

    await close_client()
