"""Settings from environment."""

from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def normalize_database_url(url: str) -> str:
    url = (url or "").strip().strip('"').strip("'")
    if not url:
        return url
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://") :]
    if url.startswith("postgresql://") and "+asyncpg" not in url:
        url = "postgresql+asyncpg://" + url[len("postgresql://") :]
    parsed = urlparse(url)
    q = dict(parse_qsl(parsed.query, keep_blank_values=True))
    if "sslmode" in q:
        mode = q.pop("sslmode")
        if mode and mode != "disable":
            q.setdefault("ssl", "require")
    q.pop("channel_binding", None)
    if "ssl" not in q and "localhost" not in (parsed.hostname or ""):
        q["ssl"] = "require"
    return urlunparse(parsed._replace(query=urlencode(q)))


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "TON Nexus"
    debug: bool = False
    database_url: str = "postgresql+asyncpg://nexus:nexus@localhost:5432/ton_nexus"
    telegram_bot_token: str = ""
    telegram_owner_ids: str = ""
    webapp_url: str = "https://example.com"
    dev_telegram_id: int = 1

    @field_validator("database_url", mode="before")
    @classmethod
    def _fix_db_url(cls, v: object) -> object:
        if isinstance(v, str):
            return normalize_database_url(v)
        return v


settings = Settings()
