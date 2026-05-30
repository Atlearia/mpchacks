from __future__ import annotations

from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    GEMINI_API_KEY: str = ""
    APP_ENV: str = "development"
    MAX_FILE_SIZE_MB: int = 50

    # Comma-separated list of allowed CORS origins. Empty means no cross-origin access.
    ALLOWED_ORIGINS: str = ""

    # Per-client request budgets (slowapi syntax).
    RATE_LIMIT_INGEST: str = "10/minute"
    RATE_LIMIT_QUERY: str = "30/minute"
    RATE_LIMIT_DEFAULT: str = "120/minute"

    # Cap on stored jobs to keep the in-memory store from growing without bound.
    MAX_JOBS: int = 1000

    # Upper bound on a question length to limit prompt-injection surface and cost.
    MAX_QUESTION_LENGTH: int = 4000

    @field_validator("MAX_FILE_SIZE_MB", "MAX_JOBS", "MAX_QUESTION_LENGTH")
    @classmethod
    def _positive(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("must be a positive integer")
        return value

    @property
    def max_file_size_bytes(self) -> int:
        return self.MAX_FILE_SIZE_MB * 1024 * 1024

    @property
    def allowed_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",") if origin.strip()]

    @property
    def is_production(self) -> bool:
        return self.APP_ENV.lower() == "production"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
