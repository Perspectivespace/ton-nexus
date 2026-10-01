"""Alembic environment — async SQLAlchemy."""

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config, create_async_engine

from app.db.base import Base
from app.models import *  # noqa: F401, F403 — register models

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def get_database_url() -> str:
    # Railway / Neon: must be set in service Variables
    url = os.environ.get("DATABASE_URL") or os.environ.get("database_url")
    if not url:
        # fallback local only
        from app.core.config import settings

        url = settings.database_url
    if not url or "localhost" in url or "127.0.0.1" in url:
        if not os.environ.get("DATABASE_URL"):
            raise RuntimeError(
                "DATABASE_URL is not set. In Railway → Variables add DATABASE_URL "
                "with Neon string: postgresql+asyncpg://USER:PASS@HOST/db?ssl=require"
            )
    # ConfigParser treats % as interpolation — escape for set_main_option
    return url


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
