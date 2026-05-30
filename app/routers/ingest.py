from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, File, HTTPException, Request, UploadFile, status

from app.config import get_settings
from app.main import limiter, store_job
from app.models.schemas import IngestResponse
from app.services import parser

router = APIRouter(tags=["ingest"])

# 1 MiB read window for streaming uploads.
_READ_CHUNK = 1024 * 1024


async def _read_limited(file: UploadFile, max_bytes: int) -> bytes:
    """Read an upload incrementally, aborting before exceeding max_bytes."""
    buffer = bytearray()
    while True:
        block = await file.read(_READ_CHUNK)
        if not block:
            break
        buffer.extend(block)
        if len(buffer) > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File exceeds the maximum allowed size of {get_settings().MAX_FILE_SIZE_MB} MB.",
            )
    return bytes(buffer)


@router.post("/ingest", response_model=IngestResponse, status_code=status.HTTP_200_OK)
@limiter.limit(get_settings().RATE_LIMIT_INGEST)
async def ingest(request: Request, file: UploadFile = File(...)) -> IngestResponse:
    settings = get_settings()

    raw = await _read_limited(file, settings.max_file_size_bytes)

    text, rows, metadata = parser.parse_upload(raw, file.filename or "", file.content_type)
    chunks = parser.chunk_text(text)

    job_id = str(uuid.uuid4())

    store_job(
        job_id,
        {
            "data": text,
            "chunks": chunks,
            "metadata": {
                **metadata,
                "filename": file.filename,
                "content_type": file.content_type,
                "size_bytes": len(raw),
                "chunk_count": len(chunks),
                "estimated_tokens": parser.estimate_tokens(text),
            },
            "created_at": datetime.now(timezone.utc).isoformat(),
        },
    )

    return IngestResponse(job_id=job_id, status="ok", rows=rows)
