"""Опыт и уровень аккаунта: одно место для начисления XP с повышением уровня.

Используется ежедневной наградой, заданиями, промокодами и колесом удачи,
чтобы уровень рос сразу, откуда бы ни пришёл опыт.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.xp_event import XpEvent
from app.services.economy import get_setting


def xp_needed(curve: dict, level: int) -> int:
    """Сколько XP нужно, чтобы перейти с уровня `level` на следующий."""
    return int(float(curve["base"]) * (float(curve["growth"]) ** (level - 1)))


async def add_xp(
    session: AsyncSession, user: Any, xp: int, source: str = "other", now: datetime | None = None
) -> int:
    """Начисляет XP и сразу повышает уровень, пока хватает опыта.

    Каждое начисление пишется в журнал `xp_events` (источник: daily · task · promo · wheel) —
    из него считается «Опыт за месяц» для месячного топа по уровню. `users.xp` — опыт внутри
    уровня (сбрасывается при повышении), поэтому сумму за период по нему не посчитать.

    Возвращает, на сколько уровней вырос пользователь.
    """
    xp = int(xp or 0)
    if xp <= 0:
        return 0
    if session is not None and getattr(user, "id", None) is not None:
        ev = XpEvent(user_id=user.id, amount=xp, source=source[:16])
        if now is not None:
            ev.created_at = now
        session.add(ev)
    user.xp = int(user.xp or 0) + xp
    curve = await get_setting(session, "xp_per_level")
    gained = 0
    while True:
        need = xp_needed(curve, int(user.level or 1))
        if need <= 0 or user.xp < need:
            break
        user.xp -= need
        user.level = int(user.level or 1) + 1
        gained += 1
    return gained
