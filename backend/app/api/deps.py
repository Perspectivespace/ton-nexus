"""FastAPI dependencies."""

from __future__ import annotations

from fastapi import Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.telegram_auth import TelegramAuthError, validate_init_data
from app.db.session import get_db
from app.models.user import User
from app.services.users import get_or_create_user


async def get_current_user(
    x_telegram_init_data: str | None = Header(default=None, alias="X-Telegram-Init-Data"),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not x_telegram_init_data:
        raise HTTPException(status_code=401, detail="Missing X-Telegram-Init-Data")
    try:
        data = validate_init_data(x_telegram_init_data)
    except TelegramAuthError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e

    tg = data["user"]
    user = await get_or_create_user(
        db,
        telegram_id=int(tg["id"]),
        username=tg.get("username"),
        first_name=tg.get("first_name"),
        last_name=tg.get("last_name"),
        language_code=tg.get("language_code"),
    )
    if user.is_banned:
        raise HTTPException(status_code=403, detail="Banned")
    await db.commit()
    await db.refresh(user)
    return user
