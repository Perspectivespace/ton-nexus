"""Prize roulette — free spins from economy prize_wheel config."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
import random

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.balance import BalanceHistory
from app.models.user import User
from app.services import balance as balance_svc
from app.services.economy import dec, get_setting


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
    today = datetime.now(timezone.utc).date()
    start = datetime(today.year, today.month, today.day, tzinfo=timezone.utc)
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


def _weighted_pick(items: list[dict]) -> dict:
    weights = [max(0, int(i.get("weight", 1))) for i in items]
    total = sum(weights)
    if total <= 0:
        raise WheelError("prize wheel misconfigured")
    r = random.uniform(0, total)
    upto = 0.0
    for item, w in zip(items, weights):
        upto += w
        if r <= upto:
            return item
    return items[-1]


async def spin(session: AsyncSession, *, user: User) -> SpinResult:
    cfg = await get_setting(session, "prize_wheel")
    free = int(cfg.get("free_spins_per_day", 1))
    used = await _spins_today(session, user.id)
    if used >= free:
        raise WheelError("no free spins left today")

    items = cfg.get("items") or []
    if not items:
        raise WheelError("empty prize table")

    item = _weighted_pick(items)
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
        user.xp = int(user.xp or 0) + xp
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
    return {
        "free_spins_per_day": free,
        "used_today": used,
        "left_today": max(0, free - used),
    }
