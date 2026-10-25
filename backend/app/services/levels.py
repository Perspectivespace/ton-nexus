"""Опыт и уровень аккаунта: одно место для начисления XP с повышением уровня.

Используется ежедневной наградой, заданиями, промокодами и колесом удачи,
чтобы уровень рос сразу, откуда бы ни пришёл опыт.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.economy import get_setting


def xp_needed(curve: dict, level: int) -> int:
    """Сколько XP нужно, чтобы перейти с уровня `level` на следующий."""
    return int(float(curve["base"]) * (float(curve["growth"]) ** (level - 1)))


async def add_xp(session: AsyncSession, user: Any, xp: int) -> int:
    """Начисляет XP и сразу повышает уровень, пока хватает опыта.

    Возвращает, на сколько уровней вырос пользователь.
    """
    xp = int(xp or 0)
    if xp <= 0:
        return 0
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
