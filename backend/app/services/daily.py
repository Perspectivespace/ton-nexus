"""Daily check-in + streak."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.promo import DailyCheckIn
from app.models.user import User
from app.services import balance as balance_svc
from app.services import gameday
from app.services.economy import dec, get_setting
from app.services.economy_seed import DEFAULTS
from app.services.levels import add_xp

CYCLE_DAYS = 7


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


# Граница суток — игровой день (00:00 МСК), см. app.services.gameday.
# Имена next_reset_utc/reset_after оставлены для совместимости импорта; время отдаётся в UTC.
next_reset_utc = gameday.next_reset
reset_after = gameday.reset_after


def effective_day(row) -> date:
    """Игровой день, к которому относится отметка.

    До перехода на московские сутки check_date писался по UTC. Отметка, сделанная с 21:00 до 24:00 UTC,
    по Москве уже относится к следующему дню, а записана вчерашней датой. Берём позднюю из двух дат —
    записанной и московской даты created_at: так старая отметка не даёт отметиться второй раз в тот же
    московский день и не рвёт серию. Для новых записей обе даты совпадают.
    """
    d = row.check_date
    created = getattr(row, "created_at", None)
    if isinstance(created, datetime):
        d = max(d, gameday.game_day(created))
    return d


async def _last_checkin(session: AsyncSession, user_id: int):
    return await session.scalar(
        select(DailyCheckIn)
        .where(DailyCheckIn.user_id == user_id)
        .order_by(DailyCheckIn.check_date.desc(), DailyCheckIn.created_at.desc())
        .limit(1)
    )


def cycle_day(streak: int) -> int:
    """День 7-дневного круга для серии: 1..7, после 7-го снова 1 (серия при этом растёт дальше)."""
    return (max(1, streak) - 1) % CYCLE_DAYS + 1


def _reward_for_streak(cfg: dict, streak: int) -> dict:
    """Награда дня круга. Дня нет в настройках (старая запись без дней 4–6) — берём значение по умолчанию."""
    key = f"day_{cycle_day(streak)}"
    day = (cfg or {}).get(key)
    if isinstance(day, dict):
        return day
    return DEFAULTS["daily_rewards"][0][key]


def week_rewards(cfg: dict) -> list[dict]:
    """Все 7 дней круга — для полосы на экране."""
    out = []
    for d in range(1, CYCLE_DAYS + 1):
        r = _reward_for_streak(cfg, d)
        out.append({"day": d, "ton": str(dec(r.get("ton", "0"))), "xp": int(r.get("xp", 0)), "focus": int(r.get("focus", 0))})
    return out


async def claim_daily(session: AsyncSession, *, user: User, now: datetime | None = None) -> DailyResult:
    # Блокируем строку пользователя до проверки «уже отмечено»: второй параллельный запрос
    # дождётся первого и увидит его отметку.
    user = await balance_svc.get_user_for_update(session, user.id)
    today = gameday.game_day(now)
    prev = await _last_checkin(session, user.id)
    prev_day = effective_day(prev) if prev else None
    if prev and prev_day >= today:
        return DailyResult(
            already_claimed=True,
            streak=prev.streak,
            reward_ton=Decimal(prev.reward_ton),
            reward_xp=0,
            reward_focus=0,
            check_date=today,
        )

    streak = prev.streak + 1 if prev and prev_day == today - timedelta(days=1) else 1

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
        await add_xp(session, user, xp)
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


async def daily_status(session: AsyncSession, *, user_id: int, now: datetime | None = None) -> dict:
    now = now or gameday.now_utc()
    today = gameday.game_day(now)
    prev = await _last_checkin(session, user_id)
    prev_day = effective_day(prev) if prev else None
    claimed = prev is not None and prev_day >= today
    streak = 0
    if claimed or (prev and prev_day == today - timedelta(days=1)):
        streak = prev.streak
    # День круга, который показывается «сегодня»: уже полученный или тот, что даст следующая отметка.
    today_day = cycle_day(streak if claimed else streak + 1)
    cfg = await get_setting(session, "daily_rewards")
    return {
        "claimed_today": claimed,
        "streak": streak,
        "cycle_day": today_day,
        "rewards": week_rewards(cfg),
        "check_date": today.isoformat(),
        # Когда снова можно отметиться: null — можно сейчас. Правило то же, что в claim_daily (игровой день, 00:00 МСК).
        "next_claim_at": gameday.next_reset(now).isoformat() if claimed else None,
        "server_time": now.isoformat(),
    }
