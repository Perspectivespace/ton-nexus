"""Settings from environment."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "TON Nexus"
    debug: bool = False
    database_url: str = "postgresql+asyncpg://nexus:nexus@localhost:5432/ton_nexus"
    telegram_bot_token: str = ""
    telegram_owner_ids: str = ""  # comma-separated
    webapp_url: str = "https://example.com"


settings = Settings()
