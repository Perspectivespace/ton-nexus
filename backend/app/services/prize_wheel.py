"""Prize roulette — free spins from economy prize_wheel config."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
import logging
import math
import random

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.balance import BalanceHistory
from app.models.user import User
from app.services import balance as balance_svc
from app.services.economy import dec, get_setting
from app.services.levels import add_xp
from app.services import gameday
from app.services.economy_seed import DEFAULTS

log = logging.getLogger(__name__)

DEFAULT_ITEMS: list[dict] = DEFAULTS["prize_wheel"][0]["items"]


class WheelError(Exception):
    pass


@dataclass
class SpinResult:
    item_id: str
    label: str
    reward_ton: Decimal
    reward_xp: int
    reward_focus: int
    reward_block: int
    success_boost_bp: int
    free_spins_left_today: int


async def _spins_today(session: AsyncSession, user_id: int) -> int:
    # считаем по моменту вращения от 00:00 МСК — при переходе с UTC-суток лишнего вращения не появляется
    start = gameday.day_start_of()
    cnt = await session.scalar(
        select(func.count())
        .select_from(BalanceHistory)
        .where(
            BalanceHistory.user_id == user_id,
            BalanceHistory.balance_type == "prize_wheel",
            BalanceHistory.created_at >= start,
        )
    )
    return int(cnt or 0)


def _weight(raw) -> float | None:
    """Вес сектора из настроек: конечное число ≥ 0. Некорректное (текст, bool, NaN, < 0) → None."""
    if isinstance(raw, bool):
        return None
    try:
        w = float(raw)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(w) or w < 0:
        return None
    return w


def effective_items(cfg: dict | None) -> tuple[list[tuple[dict, float]], str]:
    """Сектора с весами, по которым реально крутится колесо.

    Возвращает (список (сектор, вес), источник): "settings" — веса владельца,
    "default" — веса по умолчанию, если в настройках нет секторов или все веса 0/некорректны.
    Сектор без поля weight весит 1 (как и раньше); некорректный вес считается 0.
    Сектор с весом 0 остаётся в списке (его видно на колесе), но никогда не выпадает.
    """
    items = (cfg or {}).get("items")
    if isinstance(items, list):
        pairs: list[tuple[dict, float]] = []
        bad: list[str] = []
        for i in items:
            if not isinstance(i, dict):
                continue
            w = _weight(i.get("weight", 1))
            if w is None:
                bad.append(str(i.get("id")))
                w = 0.0
            pairs.append((i, w))
        if bad:
            log.warning("prize_wheel: некорректные веса считаются 0: %s", ", ".join(bad))
        if pairs and sum(w for _, w in pairs) > 0:
            return pairs, "settings"
    log.warning("prize_wheel: в настройках нет секторов с весом > 0 — колесо крутится по весам по умолчанию")
    return [(i, float(i["weight"])) for i in DEFAULT_ITEMS], "default"


def _weighted_pick(pairs: list[tuple[dict, float]], rng: random.Random | None = None) -> dict:
    """Выбор сектора по весам. Сектора с весом 0 не участвуют вовсе."""
    live = [(i, w) for i, w in pairs if w > 0]
    if not live:
        raise WheelError("prize wheel misconfigured")
    total = sum(w for _, w in live)
    r = (rng or random).random() * total  # [0, total)
    upto = 0.0
    for item, w in live:
        upto += w
        if r < upto:
            return item
    return live[-1][0]


def sectors_view(pairs: list[tuple[dict, float]]) -> list[dict]:
    """Сектора для экрана: id, название, вес и шанс в процентах (одна цифра после запятой)."""
    total = sum(w for _, w in pairs)
    return [
        {
            "id": str(i.get("id", "unknown")),
            "label": str(i.get("label", i.get("id", ""))),
            "weight": w,
            "chance_pct": round(w / total * 100, 1) if total > 0 else 0.0,
        }
        for i, w in pairs
    ]


async def spin(session: AsyncSession, *, user: User) -> SpinResult:
    cfg = await get_setting(session, "prize_wheel")
    free = int(cfg.get("free_spins_per_day", 1))
    used = await _spins_today(session, user.id)
    if used >= free:
        raise WheelError("no free spins left today")

    pairs, source = effective_items(cfg)
    item = _weighted_pick(pairs)
    total = sum(w for _, w in pairs)
    w = next(w for i, w in pairs if i is item)
    log.info(
        "prize_wheel spin: user=%s item=%s weight=%g/%g (%.1f%%) source=%s",
        user.id,
        item.get("id"),
        w,
        total,
        w / total * 100,
        source,
    )
    ton = dec(item.get("ton", "0"))
    xp = int(item.get("xp", 0))
    focus = int(item.get("focus", 0))
    block = int(item.get("block", 0))
    boost = int(item.get("success_boost_bp", 0))

    if ton > 0:
        await balance_svc.credit(
            session,
            user_id=user.id,
            amount=ton,
            balance_type="prize_wheel",
            description=f"Рулетка: {item.get('label', item.get('id'))}",
            reference_type="prize_wheel",
            reference_id=None,
        )
    else:
        session.add(
            BalanceHistory(
                user_id=user.id,
                operation_type="credit",
                amount=Decimal("0"),
                balance_type="prize_wheel",
                description=f"Рулетка: {item.get('label', item.get('id'))}",
                balance_after=user.balance,
            )
        )

    if xp > 0:
        # уровень растёт сразу, как и за ежедневку и задания
        await add_xp(session, user, xp)
    if focus > 0:
        user.focus_tokens = int(user.focus_tokens or 0) + focus
    if block > 0:
        user.block_tokens = int(user.block_tokens or 0) + block
    if boost > 0:
        user.success_boost_bp = int(user.success_boost_bp or 0) + boost

    await session.flush()
    left = max(0, free - used - 1)

    return SpinResult(
        item_id=str(item.get("id", "unknown")),
        label=str(item.get("label", item.get("id", ""))),
        reward_ton=ton,
        reward_xp=xp,
        reward_focus=focus,
        reward_block=block,
        success_boost_bp=boost,
        free_spins_left_today=left,
    )


async def wheel_status(session: AsyncSession, *, user_id: int) -> dict:
    cfg = await get_setting(session, "prize_wheel")
    free = int(cfg.get("free_spins_per_day", 1))
    used = await _spins_today(session, user_id)
    pairs, source = effective_items(cfg)
    return {
        "free_spins_per_day": free,
        "used_today": used,
        "left_today": max(0, free - used),
        # Бесплатные вращения считаются по игровому дню — следующие появятся в 00:00 МСК.
        "next_reset_at": gameday.next_reset().isoformat(),
        "sectors": sectors_view(pairs),
        "weights_source": source,
    }
