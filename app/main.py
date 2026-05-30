from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

from app.config import get_settings
from app.models.schemas import HealthResponse

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


limiter = Limiter(key_func=get_remote_address, default_limits=[settings.RATE_LIMIT_DEFAULT])

app = FastAPI(
    title="Data Ingestion & Gemini Query Service",
    version="1.0.0",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

if settings.allowed_origins_list:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins_list,
        allow_credentials=True,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
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
from app.routers import ingest, query  # noqa: E402

app.include_router(ingest.router)
app.include_router(query.router)
