from __future__ import annotations

import hashlib
import secrets

from fastapi import HTTPException, Request, status
from slowapi.util import get_remote_address

from app.config import get_settings

_API_KEY_HEADER = "x-api-key"


def _client_ip(request: Request) -> str:
    """Resolve the client IP, only trusting X-Forwarded-For behind a known proxy.

    Trusting the header unconditionally would let any caller spoof their source
    IP and slip past per-IP rate limits, so it is opt-in via TRUST_PROXY_FORWARDED.
    """
    if get_settings().TRUST_PROXY_FORWARDED:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return get_remote_address(request)


def caller_identity(request: Request) -> str:
    """Stable, non-sensitive identifier for a caller.

    Prefers the (hashed) API key so limits and ownership are scoped per
    credential rather than per shared NAT/proxy IP. Falls back to client IP.
    The raw key is never used directly as an identifier.
    """
    api_key = request.headers.get(_API_KEY_HEADER)
    if api_key:
        digest = hashlib.sha256(api_key.encode("utf-8")).hexdigest()[:16]
        return f"key:{digest}"
    return f"ip:{_client_ip(request)}"


def rate_limit_key(request: Request) -> str:
    return caller_identity(request)


async def require_api_key(request: Request) -> str:
    """Enforce the shared-secret API key on protected endpoints.

    Returns the caller identity for downstream ownership checks. Uses a
    constant-time comparison to avoid leaking the key via timing.
    """
    settings = get_settings()
    configured = settings.API_KEY

    if not configured:
        # Fail closed in production: refuse to expose write/paid endpoints
        # without an access credential configured.
        if settings.is_production:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Service is not configured for authenticated access.",
            )
        return caller_identity(request)

    provided = request.headers.get(_API_KEY_HEADER, "")
    if not provided or not secrets.compare_digest(provided, configured):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key.",
            headers={"WWW-Authenticate": _API_KEY_HEADER},
        )
    return caller_identity(request)
