from __future__ import annotations

import io
import json
from typing import Any

import pandas as pd
from fastapi import HTTPException, status
from pdfminer.high_level import extract_text

CHARS_PER_TOKEN: int = 4
MAX_CHUNK_TOKENS: int = 200_000
MAX_CHUNK_CHARS: int = MAX_CHUNK_TOKENS * CHARS_PER_TOKEN


def _unprocessable(field: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=[{"loc": ["body", field], "msg": message, "type": "value_error"}],
    )


def parse_csv(raw: bytes) -> tuple[str, int, dict[str, Any]]:
    try:
        decoded = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise _unprocessable("file", "CSV is not valid UTF-8.")

    try:
        frame = pd.read_csv(io.StringIO(decoded))
    except Exception:
        raise _unprocessable("file", "Could not parse file as CSV.")

    if frame.empty or frame.shape[0] < 1:
        raise _unprocessable("file", "CSV must contain at least one data row.")

    frame = frame.infer_objects()

    text = frame.to_csv(index=False)
    metadata: dict[str, Any] = {
        "kind": "csv",
        "rows": int(frame.shape[0]),
        "columns": [str(col) for col in frame.columns],
        "dtypes": {str(col): str(dtype) for col, dtype in frame.dtypes.items()},
    }
    return text, int(frame.shape[0]), metadata


def parse_json(raw: bytes) -> tuple[str, int, dict[str, Any]]:
    try:
        decoded = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise _unprocessable("file", "JSON is not valid UTF-8.")

    try:
        payload = json.loads(decoded)
    except json.JSONDecodeError as exc:
        raise _unprocessable("file", f"Invalid JSON at line {exc.lineno}, column {exc.colno}.")

    if isinstance(payload, list):
        if len(payload) < 1:
            raise _unprocessable("file", "JSON array must contain at least one element.")
        rows = len(payload)
        json_kind = "array"
    elif isinstance(payload, dict):
        if len(payload) < 1:
            raise _unprocessable("file", "JSON object must contain at least one key.")
        rows = len(payload)
        json_kind = "object"
    else:
        raise _unprocessable("file", "JSON root must be a list or object.")

    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    metadata: dict[str, Any] = {"kind": "json", "json_kind": json_kind, "rows": rows}
    return text, rows, metadata


def parse_pdf(raw: bytes) -> tuple[str, int, dict[str, Any]]:
    try:
        text = extract_text(io.BytesIO(raw))
    except Exception:
        raise _unprocessable("file", "Could not extract text from PDF.")

    if not text or not text.strip():
        raise _unprocessable("file", "PDF contains no extractable text.")

    metadata: dict[str, Any] = {"kind": "pdf", "characters": len(text), "rows": 1}
    return text, 1, metadata


def parse_upload(raw: bytes, filename: str, content_type: str | None) -> tuple[str, int, dict[str, Any]]:
    if not raw:
        raise _unprocessable("file", "Uploaded file is empty.")

    name = (filename or "").lower()
    ctype = (content_type or "").lower()

    if name.endswith(".csv") or "csv" in ctype:
        return parse_csv(raw)
    if name.endswith(".json") or "json" in ctype:
        return parse_json(raw)
    if name.endswith(".pdf") or "pdf" in ctype:
        return parse_pdf(raw)

    raise _unprocessable("file", "Unsupported file type. Supported types: CSV, JSON, PDF.")


def estimate_tokens(text: str) -> int:
    return len(text) // CHARS_PER_TOKEN


def chunk_text(text: str) -> list[str]:
    if estimate_tokens(text) <= MAX_CHUNK_TOKENS:
        return [text]
    return [text[i : i + MAX_CHUNK_CHARS] for i in range(0, len(text), MAX_CHUNK_CHARS)]
