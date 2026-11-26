"""Сводка для экрана «Помощь»: числа, которые игрок видит в текстах.

Только то, что уже проверяют пополнение, вывод, реклама, арена и тариф «Перехода».
Адресов кошельков, мемо и чужих id здесь нет — их нельзя подмешать в ответ.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.arena_config import FILL_TIMEOUT_S, stake_nano
from app.services.arena_rooms import commission_bps
from app.services.city_ads import load_config
from app.services.economy import get_setting
from app.services.task_tariff import DEFAULT as TARIFF_DEFAULT
from app.services.task_tariff import KEY as TARIFF_KEY
from app.services.task_tariff import TaskTariffError, nano_to_ton, normalize
from app.services.ton_deposits import MAX_DEPOSIT_TON, deposits_enabled
from app.services.withdraw import min_withdraw


def commission_percent(bp: int) -> str:
    """Целые bp → проценты строкой: 1000 → «10», 1050 → «10.5»."""
    whole, frac = divmod(int(bp), 100)
    if frac == 0:
        return str(whole)
    return f"{whole}.{frac:02d}".rstrip("0")


def _ton(value: Decimal) -> str:
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


async def _visit(session: AsyncSession) -> dict[str, Any]:
    raw = await get_setting(session, TARIFF_KEY)
    try:
        visit = normalize(raw if isinstance(raw, dict) else TARIFF_DEFAULT)["visit"]
    except TaskTariffError:
        visit = normalize(TARIFF_DEFAULT)["visit"]
    bp = int(visit["commission_bp"])
    return {
        "reward_ton": str(visit["reward"]),
        "commission_bp": bp,
        "commission_percent": commission_percent(bp),
    }


async def facts(session: AsyncSession) -> dict[str, Any]:
    """Числа для «Помощи». Настройки владельца читаются так же, как экраны, которые их применяют."""
    deposits = await get_setting(session, "ton_deposits") or {}
    ads = await load_config(session)
    bp = await commission_bps(session)
    return {
        "deposit": {
            "enabled": deposits_enabled(deposits),
            "min_ton": str(deposits.get("min_ton", "0.1")) if isinstance(deposits, dict) else "0.1",
            "max_ton": _ton(MAX_DEPOSIT_TON),
        },
        "withdraw": {"min_ton": _ton(await min_withdraw(session))},
        "ads": {
            "min_level": int(ads["min_level"]),
            "min_days": int(ads["min_days"]),
            "max_days": int(ads["max_days"]),
            "price_per_day": {fmt: str(row["price_day"]) for fmt, row in ads["prices"].items()},
        },
        "arena": {
            "commission_bp": bp,
            "commission_percent": commission_percent(bp),
            "stake_ton": nano_to_ton(stake_nano()),
            "fill_timeout_s": FILL_TIMEOUT_S,
        },
        "visit": await _visit(session),
    }
