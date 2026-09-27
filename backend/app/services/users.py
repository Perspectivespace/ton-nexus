"""User upsert from Telegram + ensure miner slot."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.miner import Miner
from app.models.user import User


async def get_or_create_user(
    session: AsyncSession,
    *,
    telegram_id: int,
    username: str | None = None,
    first_name: str | None = None,
    last_name: str | None = None,
    language_code: str | None = None,
    referred_by_telegram_id: int | None = None,
) -> User:
    result = await session.execute(select(User).where(User.telegram_id == telegram_id))
    user = result.scalar_one_or_none()
    now = datetime.now(timezone.utc)

    if user:
        user.username = username
        user.first_name = first_name
        user.last_name = last_name
        if language_code:
            user.language_code = language_code
        user.last_seen_at = now
        await session.flush()
        return user

    referred_by_id = None
    if referred_by_telegram_id and referred_by_telegram_id != telegram_id:
        ref = await session.scalar(
            select(User.id).where(User.telegram_id == referred_by_telegram_id)
        )
        referred_by_id = ref

    user = User(
        telegram_id=telegram_id,
        username=username,
        first_name=first_name,
        last_name=last_name,
        language_code=language_code,
        referred_by_id=referred_by_id,
        last_seen_at=now,
    )
    session.add(user)
    await session.flush()

    session.add(Miner(user_id=user.id))
    await session.flush()
    return user
