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

    # Shared secret required (via the X-API-Key header) to reach the write/paid
    # endpoints. Empty is allowed only in development; production fails closed.
    API_KEY: str = ""

    # MongoDB connection. Loaded from the environment so the credential never
    # lives in source control or reaches the browser.
    MONGODB_URI: str = ""
    MONGODB_DB: str = "brim"

    # Comma-separated list of allowed CORS origins. Empty means no cross-origin access.
    ALLOWED_ORIGINS: str = ""

    # Comma-separated allowed Host headers (e.g. api.example.com). Empty = allow any.
    ALLOWED_HOSTS: str = ""

    # Only trust X-Forwarded-For for the client IP when running behind a known,
    # trusted reverse proxy. Leaving this false prevents clients from spoofing
    # their source IP to evade rate limits.
    TRUST_PROXY_FORWARDED: bool = False

    # Hard ceiling on paid Gemini calls per UTC day across all clients (0 = no
    # cap). A backstop against runaway cost even if rate limits are bypassed.
    GEMINI_DAILY_LIMIT: int = 0

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
    def allowed_hosts_list(self) -> list[str]:
        return [host.strip() for host in self.ALLOWED_HOSTS.split(",") if host.strip()]

    @property
    def is_production(self) -> bool:
        return self.APP_ENV.lower() == "production"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
