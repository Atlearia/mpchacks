from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

import google.generativeai as genai
from fastapi import HTTPException, status
from google.api_core import exceptions as google_exceptions
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.config import get_settings

logger = logging.getLogger("app")

MODEL_NAME: str = "gemini-2.5-flash"


def _configure_genai() -> None:
    """Configure the Gemini SDK using service account (ADC) or API key.

    Priority:
    1. GOOGLE_APPLICATION_CREDENTIALS_JSON — full service account JSON as a
       string env var (works on Vercel / any platform with no filesystem).
    2. GOOGLE_APPLICATION_CREDENTIALS — path to a local service account file
       (works locally).
    3. GEMINI_API_KEY — plain API key fallback.
    """
    # --- Option 1: JSON string in env var (Vercel-friendly) ---
    sa_json_str = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON", "").strip()
    if sa_json_str:
        try:
            from google.oauth2 import service_account as _sa

            sa_info = json.loads(sa_json_str)
            credentials = _sa.Credentials.from_service_account_info(
                sa_info,
                scopes=["https://www.googleapis.com/auth/generative-language"],
            )
            genai.configure(credentials=credentials)
            logger.info("[Gemini] Authenticated via service account JSON env var.")
            return
        except Exception as exc:
            logger.warning(
                "[Gemini] GOOGLE_APPLICATION_CREDENTIALS_JSON parse failed (%s); trying file path.", exc
            )

    # --- Option 2: Local file path (local dev) ---
    sa_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")
    if sa_path and os.path.isfile(sa_path):
        try:
            from google.oauth2 import service_account as _sa

            credentials = _sa.Credentials.from_service_account_file(
                sa_path,
                scopes=["https://www.googleapis.com/auth/generative-language"],
            )
            genai.configure(credentials=credentials)
            logger.info("[Gemini] Authenticated via service account file: %s", os.path.basename(sa_path))
            return
        except Exception as exc:
            logger.warning(
                "[Gemini] Service account file auth failed (%s); falling back to API key.", exc
            )

    # --- Option 3: Plain API key ---
    api_key = get_settings().GEMINI_API_KEY
    if api_key:
        genai.configure(api_key=api_key)
        logger.info("[Gemini] Authenticated via API key.")
    else:
        logger.warning("[Gemini] No Gemini credentials configured — AI calls will fail.")


_configure_genai()



# ---------------------------------------------------------------------------
# System prompts for each AI capability
# ---------------------------------------------------------------------------

ASK_SYSTEM_PROMPT: str = """You are Brim AI, an expert CFO assistant for a mid-size company.
You answer questions about the company's expense data with precision and insight.

You MUST respond with valid JSON matching this schema:
{
  "summary": "A 2-3 sentence natural-language answer. Be specific with dollar amounts and percentages.",
  "chartType": "bars" | "donut" | "table" | "stat" | "none",
  "chartData": <depends on chartType — see below>,
  "followups": ["suggested follow-up question 1", "question 2", "question 3"]
}

Chart data schemas by type:
- "bars": [{"label": "...", "value": <number>}, ...]
- "donut": [{"label": "...", "value": <number>}, ...]
- "table": {"columns": ["col1", "col2"], "rows": [["val1", "val2"], ...]}
- "stat": [{"label": "...", "value": "formatted string"}, ...]
- "none": null

Rules:
- Always ground answers in the provided data. Never fabricate numbers.
- Format currency as whole dollars (no cents) in summaries.
- When comparing departments or categories, use a bar chart.
- When showing composition/breakdown, use a donut chart.
- When showing detailed records, use a table.
- When showing a single KPI or a few key metrics, use stat.
- Follow-up suggestions should be contextually relevant and build on the current question.
- If the user asks something unrelated to expenses, politely redirect.
- Remember conversation history for follow-up questions (e.g., "How does that compare to engineering?" refers to the prior department).
"""

POLICY_SYSTEM_PROMPT: str = """You are Brim AI, the company's expense policy compliance analyst.
Analyze the provided policy violations and produce an executive brief.

Respond with valid JSON:
{
  "headline": "One-sentence executive summary of the compliance situation",
  "riskLevel": "critical" | "elevated" | "moderate" | "healthy",
  "topActions": [
    {"priority": 1, "action": "...", "impact": "..."},
    {"priority": 2, "action": "...", "impact": "..."},
    {"priority": 3, "action": "...", "impact": "..."}
  ],
  "narrative": "A 3-5 sentence analysis with specific names, amounts, and patterns. Be direct and actionable.",
  "trendInsight": "One sentence about whether violations are getting better or worse and why."
}
"""

APPROVAL_SYSTEM_PROMPT: str = """You are Brim AI, the company's expense approval advisor.
Given an employee's spend request and their history, provide a recommendation.

Respond with valid JSON:
{
  "recommendation": "approve" | "deny" | "review",
  "confidence": <number 0-100>,
  "reasoning": [
    "Reason 1 with specific data points",
    "Reason 2 with context",
    "Reason 3 with comparison or trend"
  ],
  "riskFlags": ["flag1", "flag2"] or [],
  "suggestedConditions": "Any conditions for approval, or empty string"
}
"""

# Legacy system prompt for backward compatibility with /query endpoint
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

# Process-wide daily usage counter (UTC). A simple in-memory backstop; replace
# with a shared store (e.g. Redis) if running multiple workers.
_usage: dict[str, Any] = {"day": "", "count": 0}


def enforce_daily_budget() -> None:
    """Reject the call once the configured per-day Gemini budget is reached."""
    limit = get_settings().GEMINI_DAILY_LIMIT
    if limit <= 0:
        return  # No cap configured.

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if _usage["day"] != today:
        _usage["day"] = today
        _usage["count"] = 0

    if _usage["count"] >= limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Daily query budget exhausted. Try again tomorrow.",
        )
    _usage["count"] += 1


# ---------------------------------------------------------------------------
# Dataset summarisation — compresses thousands of transactions into a compact
# JSON context that fits comfortably in a single Gemini prompt (~3-8 KB).
# ---------------------------------------------------------------------------

def build_dataset_summary(
    transactions: list[dict[str, Any]],
    employees: list[dict[str, Any]],
) -> str:
    """Build a compact JSON summary of the full transaction dataset."""

    debits = [t for t in transactions if t.get("debitOrCredit", t.get("debit_or_credit")) != "Credit"]

    def _amount(t: dict) -> float:
        return float(t.get("amount", 0))

    def _dept(t: dict) -> str:
        return t.get("department", "Unknown")

    def _cat(t: dict) -> str:
        return t.get("spendCategory", t.get("spend_category", "Other"))

    def _merchant(t: dict) -> str:
        return t.get("merchantName", t.get("merchant_name", "Unknown"))

    def _emp(t: dict) -> str:
        return t.get("employeeName", t.get("employee_name", "Unknown"))

    def _date(t: dict) -> str:
        return t.get("transactionDate", t.get("transaction_date", ""))

    def _month(date: str) -> str:
        return date[:7] if len(date) >= 7 else "Unknown"

    total_spend = sum(_amount(t) for t in debits)
    txn_count = len(debits)

    # By department
    dept_spend: dict[str, float] = {}
    for t in debits:
        d = _dept(t)
        dept_spend[d] = dept_spend.get(d, 0) + _amount(t)

    # By category
    cat_spend: dict[str, float] = {}
    for t in debits:
        c = _cat(t)
        cat_spend[c] = cat_spend.get(c, 0) + _amount(t)

    # By month
    month_spend: dict[str, float] = {}
    for t in debits:
        m = _month(_date(t))
        month_spend[m] = month_spend.get(m, 0) + _amount(t)

    # By merchant (top 15)
    merchant_spend: dict[str, dict] = {}
    for t in debits:
        m = _merchant(t)
        if m not in merchant_spend:
            merchant_spend[m] = {"spend": 0, "count": 0}
        merchant_spend[m]["spend"] += _amount(t)
        merchant_spend[m]["count"] += 1
    top_merchants = sorted(merchant_spend.items(), key=lambda x: x[1]["spend"], reverse=True)[:15]

    # Dept x Category matrix
    dept_cat: dict[str, dict[str, float]] = {}
    for t in debits:
        d = _dept(t)
        c = _cat(t)
        if d not in dept_cat:
            dept_cat[d] = {}
        dept_cat[d][c] = dept_cat[d].get(c, 0) + _amount(t)

    # Dept x Month matrix
    dept_month: dict[str, dict[str, float]] = {}
    for t in debits:
        d = _dept(t)
        m = _month(_date(t))
        if d not in dept_month:
            dept_month[d] = {}
        dept_month[d][m] = dept_month[d].get(m, 0) + _amount(t)

    # Top spenders
    emp_spend: dict[str, dict] = {}
    for t in debits:
        e = _emp(t)
        if e not in emp_spend:
            emp_spend[e] = {"spend": 0, "count": 0, "department": _dept(t)}
        emp_spend[e]["spend"] += _amount(t)
        emp_spend[e]["count"] += 1
    top_spenders = sorted(emp_spend.items(), key=lambda x: x[1]["spend"], reverse=True)[:20]

    summary = {
        "overview": {
            "totalSpend": round(total_spend),
            "transactionCount": txn_count,
            "employeeCount": len(employees),
            "departmentCount": len(dept_spend),
            "dateRange": {
                "earliest": min((_date(t) for t in debits), default=""),
                "latest": max((_date(t) for t in debits), default=""),
            },
        },
        "byDepartment": {k: round(v) for k, v in sorted(dept_spend.items(), key=lambda x: x[1], reverse=True)},
        "byCategory": {k: round(v) for k, v in sorted(cat_spend.items(), key=lambda x: x[1], reverse=True)},
        "byMonth": {k: round(v) for k, v in sorted(month_spend.items())},
        "topMerchants": [
            {"name": name, "spend": round(data["spend"]), "txns": data["count"]}
            for name, data in top_merchants
        ],
        "topSpenders": [
            {"name": name, "spend": round(data["spend"]), "txns": data["count"], "dept": data["department"]}
            for name, data in top_spenders
        ],
        "deptByCategory": {
            dept: {cat: round(val) for cat, val in sorted(cats.items(), key=lambda x: x[1], reverse=True)}
            for dept, cats in dept_cat.items()
        },
        "deptByMonth": {
            dept: {month: round(val) for month, val in sorted(months.items())}
            for dept, months in dept_month.items()
        },
    }

    return json.dumps(summary, separators=(",", ":"))


# ---------------------------------------------------------------------------
# Model builders
# ---------------------------------------------------------------------------

def _build_model(system_prompt: str = SYSTEM_PROMPT) -> genai.GenerativeModel:
    generation_config = genai.GenerationConfig(
        response_mime_type="application/json",
        temperature=0.2,
    )
    return genai.GenerativeModel(
        model_name=MODEL_NAME,
        system_instruction=system_prompt,
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


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    retry=retry_if_exception_type(_RETRYABLE_EXCEPTIONS),
)
async def _generate_chat(
    model: genai.GenerativeModel,
    history: list[dict[str, str]],
    message: str,
) -> str:
    """Multi-turn chat generation using Gemini's chat interface."""
    chat = model.start_chat(history=history)
    response = await chat.send_message_async(message)
    return response.text or ""


def _parse_json(raw: str, context: str = "Gemini") -> dict[str, Any]:
    """Parse JSON from model output, with logging on failure."""
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
        return {"result": parsed}
    except (json.JSONDecodeError, TypeError):
        logger.warning("%s returned non-JSON output (%d chars)", context, len(raw))
        return {"error": "parse_failed", "raw_length": len(raw)}


# ---------------------------------------------------------------------------
# High-level AI functions
# ---------------------------------------------------------------------------

async def ask_with_context(
    dataset_summary: str,
    question: str,
    history: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Answer an expense question using the full dataset context + conversation history."""
    if not get_settings().GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not configured.")

    enforce_daily_budget()

    model = _build_model(ASK_SYSTEM_PROMPT)

    # Build the initial context message
    context_message = f"Here is the company's complete expense data summary:\n\n{dataset_summary}"

    # Build chat history: context first, then prior turns
    chat_history = [
        {"role": "user", "parts": [context_message]},
        {"role": "model", "parts": ['{"summary": "I have the expense data loaded. What would you like to know?", "chartType": "none", "chartData": null, "followups": ["Show me spend by department", "What are our top vendors?", "Monthly spending trend"]}']},
    ]

    if history:
        for msg in history:
            role = "user" if msg.get("role") == "user" else "model"
            chat_history.append({"role": role, "parts": [msg.get("content", "")]})

    raw = await _generate_chat(model, chat_history, question)
    return _parse_json(raw, "AskAI")


async def analyze_policy(
    violations_summary: str,
    dataset_summary: str,
) -> dict[str, Any]:
    """Generate an executive brief on policy violations."""
    if not get_settings().GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not configured.")

    enforce_daily_budget()

    model = _build_model(POLICY_SYSTEM_PROMPT)
    prompt = (
        f"Company expense data summary:\n{dataset_summary}\n\n"
        f"Policy violations detected:\n{violations_summary}\n\n"
        "Analyze these violations and produce your executive brief."
    )

    raw = await _generate(model, prompt)
    return _parse_json(raw, "PolicyAI")


async def recommend_approval(
    request_details: str,
    employee_history: str,
    dataset_summary: str,
) -> dict[str, Any]:
    """Generate an AI-powered approval recommendation."""
    if not get_settings().GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not configured.")

    enforce_daily_budget()

    model = _build_model(APPROVAL_SYSTEM_PROMPT)
    prompt = (
        f"Company expense data summary:\n{dataset_summary}\n\n"
        f"Approval request:\n{request_details}\n\n"
        f"Employee history:\n{employee_history}\n\n"
        "Provide your recommendation."
    )

    raw = await _generate(model, prompt)
    return _parse_json(raw, "ApprovalAI")


# ---------------------------------------------------------------------------
# Legacy /query endpoint support
# ---------------------------------------------------------------------------

def build_user_prompt(chunk: str, question: str) -> str:
    return f"Data:\n{chunk}\n\nQuestion: {question}\n\nRespond with JSON only."


async def query_gemini(chunk: str, question: str) -> dict[str, Any]:
    if not get_settings().GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not configured.")

    model = _build_model()
    prompt = build_user_prompt(chunk, question)

    raw = await _generate(model, prompt)
    return _parse_json(raw)
