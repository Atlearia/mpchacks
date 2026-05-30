from __future__ import annotations

import uuid
from typing import Any

from pydantic import BaseModel, Field, field_validator

from app.config import get_settings


class IngestResponse(BaseModel):
    job_id: str
    status: str = "ok"
    rows: int = Field(..., ge=0)


class QueryRequest(BaseModel):
    job_id: str = Field(..., min_length=1)
    question: str = Field(..., min_length=1)

    @field_validator("job_id")
    @classmethod
    def _valid_uuid(cls, value: str) -> str:
        value = value.strip()
        try:
            uuid.UUID(value)
        except ValueError as exc:
            raise ValueError("job_id must be a valid UUID") from exc
        return value

    @field_validator("question")
    @classmethod
    def _bounded_question(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("question must not be blank")
        limit = get_settings().MAX_QUESTION_LENGTH
        if len(value) > limit:
            raise ValueError(f"question must be at most {limit} characters")
        return value


class QueryResponse(BaseModel):
    job_id: str
    answer: dict[str, Any]
    model: str


class HealthResponse(BaseModel):
    status: str = "ok"
    timestamp: str


class Employee(BaseModel):
    id: str
    name: str
    department: str
    title: str
    email: str
    location: str
    joinedDate: str
    cardLast4: str
    monthlyLimit: float
    avatarHue: int


class Transaction(BaseModel):
    id: str
    transactionCode: str
    transactionCategory: str
    postingDate: str
    transactionDate: str
    merchantName: str
    amount: float
    debitOrCredit: str
    merchantCategoryCode: str
    merchantCity: str
    merchantCountry: str
    merchantPostalCode: str
    merchantState: str
    conversionRate: float
    department: str
    employeeId: str
    employeeName: str
    spendCategory: str


class DatasetResponse(BaseModel):
    employees: list[Employee]
    transactions: list[Transaction]
