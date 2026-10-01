"""Alembic environment — async SQLAlchemy."""

import os
from logging.config import fileConfig
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from app.db.base import Base
from app.models import *  # noqa: F401, F403

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def normalize_database_url(url: str) -> str:
    """Neon copies use sslmode=; asyncpg needs ssl=. Also ensure asyncpg driver."""
    url = url.strip().strip('"').strip("'")
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://") :]
    if url.startswith("postgresql://") and "+asyncpg" not in url:
        url = "postgresql+asyncpg://" + url[len("postgresql://") :]
    if url.startswith("postgresql+asyncpg://"):
        pass
    elif "+asyncpg" not in url and url.startswith("postgresql"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)

    parsed = urlparse(url)
    q = dict(parse_qsl(parsed.query, keep_blank_values=True))
    # asyncpg does not accept sslmode
    if "sslmode" in q:
        mode = q.pop("sslmode")
        if mode and mode != "disable":
            q.setdefault("ssl", "require")
    if "channel_binding" in q:
        q.pop("channel_binding", None)
    if "ssl" not in q and "localhost" not in (parsed.hostname or ""):
        q["ssl"] = "require"
    new_query = urlencode(q)
    return urlunparse(parsed._replace(query=new_query))


def get_database_url() -> str:
    url = os.environ.get("DATABASE_URL") or os.environ.get("database_url")
    if not url:
        from app.core.config import settings

        url = settings.database_url
    if not url:
        raise RuntimeError(
            "DATABASE_URL is not set. Railway Variables: "
            "postgresql+asyncpg://USER:PASS@HOST/db?ssl=require"
        )
    return normalize_database_url(url)


def run_migrations_offline() -> None:
    url = get_database_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    url = get_database_url()
    connectable = create_async_engine(url, poolclass=pool.NullPool)
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    import asyncio

    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
