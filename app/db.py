from __future__ import annotations

import certifi
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.config import get_settings

_client: AsyncIOMotorClient | None = None


def get_client() -> AsyncIOMotorClient:
    """Return a lazily-created, process-wide Mongo client.

    Motor clients are async and own a connection pool, so a single shared
    instance is reused across requests rather than reconnecting per call.
    """
    global _client
    if _client is None:
        settings = get_settings()
        if not settings.MONGODB_URI:
            raise RuntimeError(
                "MONGODB_URI is not configured. Set it in your .env file."
            )
        _client = AsyncIOMotorClient(
            settings.MONGODB_URI,
            tlsCAFile=certifi.where(),
            serverSelectionTimeoutMS=8000,
            appname="brim-expense-intelligence",
        )
    return _client


def get_db() -> AsyncIOMotorDatabase:
    return get_client()[get_settings().MONGODB_DB]


async def close_client() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None
