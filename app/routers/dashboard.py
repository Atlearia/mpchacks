from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request, status
from pymongo.errors import PyMongoError

from app.config import get_settings
from app.db import get_db
from app.main import limiter
from app.models.schemas import DatasetResponse, Employee, Transaction

logger = logging.getLogger("app")

router = APIRouter(prefix="/api", tags=["dashboard"])

# Drop Mongo's internal _id so responses match the frontend's flat shape.
_PROJECTION = {"_id": 0}


@router.get("/dataset", response_model=DatasetResponse, status_code=status.HTTP_200_OK)
@limiter.limit(get_settings().RATE_LIMIT_DEFAULT)
async def dataset(request: Request) -> DatasetResponse:
    """Serve the full expense dataset (employees + transactions) from MongoDB.

    The dashboard performs its own client-side aggregation, so we hand back the
    raw collections rather than pre-aggregating here.
    """
    db = get_db()
    try:
        employees = await db.employees.find({}, _PROJECTION).to_list(length=None)
        transactions = await db.transactions.find({}, _PROJECTION).to_list(length=None)
    except PyMongoError:
        logger.exception("Failed to read dashboard dataset from MongoDB")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to reach the database. Check the MongoDB connection.",
        )

    return DatasetResponse(
        employees=[Employee(**doc) for doc in employees],
        transactions=[Transaction(**doc) for doc in transactions],
    )
