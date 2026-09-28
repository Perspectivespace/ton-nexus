"""Daily check-in + streak."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.promo import DailyCheckIn
from app.models.user import User
from app.services import balance as balance_svc
from app.services.economy import dec, get_setting


class DailyError(Exception):
    pass


@dataclass
class DailyResult:
    already_claimed: bool
    streak: int
    reward_ton: Decimal
    reward_xp: int
    reward_focus: int
    check_date: date


def _today_utc() -> date:
    return datetime.now(timezone.utc).date()


def _reward_for_streak(cfg: dict, streak: int) -> dict:
    key = f"day_{streak}"
    if key in cfg:
        return cfg[key]
    if streak >= 7 and "day_7" in cfg:
        return cfg["day_7"]
    if streak >= 3 and "day_3" in cfg:
        return cfg["day_3"]
    if streak >= 2 and "day_2" in cfg:
        return cfg["day_2"]
    return cfg.get("day_1", {"ton": "0.001", "xp": 5})


async def claim_daily(session: AsyncSession, *, user: User) -> DailyResult:
    today = _today_utc()
    existing = await session.scalar(
        select(DailyCheckIn).where(
            DailyCheckIn.user_id == user.id,
            DailyCheckIn.check_date == today,
        )
    )
    if existing:
        return DailyResult(
            already_claimed=True,
            streak=existing.streak,
            reward_ton=Decimal(existing.reward_ton),
            reward_xp=0,
            reward_focus=0,
            check_date=today,
        )

    yesterday = today - timedelta(days=1)
    prev = await session.scalar(
        select(DailyCheckIn)
        .where(DailyCheckIn.user_id == user.id)
        .order_by(DailyCheckIn.check_date.desc())
        .limit(1)
    )
    streak = prev.streak + 1 if prev and prev.check_date == yesterday else 1

    cfg = await get_setting(session, "daily_rewards")
    reward = _reward_for_streak(cfg, streak)
    ton = dec(reward.get("ton", "0"))
    xp = int(reward.get("xp", 0))
    focus = int(reward.get("focus", 0))

    if ton > 0:
        await balance_svc.credit(
            session,
            user_id=user.id,
            amount=ton,
            balance_type="daily",
            description=f"Daily day {streak}",
            reference_type="daily",
            reference_id=None,
        )
    if xp > 0:
        user.xp = int(user.xp or 0) + xp
        while True:
            curve = await get_setting(session, "xp_per_level")
            need = int(float(curve["base"]) * (float(curve["growth"]) ** (user.level - 1)))
            if user.xp < need:
                break
            user.xp -= need
            user.level += 1
    if focus > 0:
        user.focus_tokens = int(user.focus_tokens or 0) + focus

    session.add(
        DailyCheckIn(user_id=user.id, check_date=today, streak=streak, reward_ton=ton)
    )
    await session.flush()

    return DailyResult(
        already_claimed=False,
        streak=streak,
        reward_ton=ton,
        reward_xp=xp,
        reward_focus=focus,
        check_date=today,
    )


async def daily_status(session: AsyncSession, *, user_id: int) -> dict:
    today = _today_utc()
    existing = await session.scalar(
        select(DailyCheckIn).where(
            DailyCheckIn.user_id == user_id,
            DailyCheckIn.check_date == today,
        )
    )
    prev = await session.scalar(
        select(DailyCheckIn)
        .where(DailyCheckIn.user_id == user_id)
        .order_by(DailyCheckIn.check_date.desc())
        .limit(1)
    )
    streak = 0
    if existing:
        streak = existing.streak
    elif prev and prev.check_date == today - timedelta(days=1):
        streak = prev.streak
    return {
        "claimed_today": existing is not None,
        "streak": streak,
        "check_date": today.isoformat(),
    }
