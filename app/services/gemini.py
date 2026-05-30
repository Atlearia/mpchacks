from __future__ import annotations

import json
from typing import Any

import google.generativeai as genai
from google.api_core import exceptions as google_exceptions
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.config import get_settings

MODEL_NAME: str = "gemini-1.5-pro"

SYSTEM_PROMPT: str = (
    "You are a data analyst. Respond ONLY with valid JSON. No markdown, no explanation, "
    "no code blocks. Your entire response must be parseable by json.loads()."
)

# 429 rate limit and 503 unavailable are the transient cases worth retrying.
_RETRYABLE_EXCEPTIONS = (
    google_exceptions.ResourceExhausted,
    google_exceptions.ServiceUnavailable,
)

_settings = get_settings()
if _settings.GEMINI_API_KEY:
    genai.configure(api_key=_settings.GEMINI_API_KEY)


def build_user_prompt(chunk: str, question: str) -> str:
    return f"Data:\n{chunk}\n\nQuestion: {question}\n\nRespond with JSON only."


def _build_model() -> genai.GenerativeModel:
    generation_config = genai.GenerationConfig(
        response_mime_type="application/json",
        temperature=0.1,
    )
    return genai.GenerativeModel(
        model_name=MODEL_NAME,
        system_instruction=SYSTEM_PROMPT,
        generation_config=generation_config,
    )


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception_type(_RETRYABLE_EXCEPTIONS),
)
async def _generate(model: genai.GenerativeModel, prompt: str) -> str:
    response = await model.generate_content_async(prompt)
    return response.text or ""


async def query_gemini(chunk: str, question: str) -> dict[str, Any]:
    if not get_settings().GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not configured.")

    model = _build_model()
    prompt = build_user_prompt(chunk, question)

    raw = await _generate(model, prompt)

    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {"error": "parse_failed", "raw": raw}

    if isinstance(parsed, dict):
        return parsed
    return {"result": parsed}
