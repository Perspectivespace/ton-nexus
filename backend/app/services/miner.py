"""Miner session: start / sync status / claim."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.miner import Miner
from app.services import balance as balance_svc
from app.services.economy import dec, get_setting

UPGRADE_TYPES = ("power", "capacity", "acceleration", "luck", "stability")


class MinerError(Exception):
    pass


class MinerBusyError(MinerError):
    pass


class MinerNotReadyError(MinerError):
    pass


@dataclass
class MinerView:
    power: int
    capacity: int
    acceleration: int
    luck: int
    stability: int
    status: str
    pending_reward: Decimal
    session_started_at: datetime | None
    session_ends_at: datetime | None
    estimated_reward: Decimal


async def _get_miner(session: AsyncSession, user_id: int) -> Miner:
    miner = await session.scalar(select(Miner).where(Miner.user_id == user_id))
    if not miner:
        raise MinerError("miner not found")
    return miner


def _session_hours(miner: Miner, base_hours: float) -> float:
    """Acceleration shortens session: hours / (1 + 0.04*(acc-1))."""
    acc = max(1, miner.acceleration)
    return base_hours / (1.0 + 0.04 * (acc - 1))


def _estimate_reward(
    miner: Miner,
    *,
    ton_per_hour: Decimal,
    hours: float,
    power_mult: Decimal,
    capacity_mult: Decimal,
) -> Decimal:
    power_factor = Decimal("1") + power_mult * Decimal(miner.power - 1)
    capacity_factor = Decimal("1") + capacity_mult * Decimal(miner.capacity - 1)
    raw = ton_per_hour * Decimal(str(hours)) * power_factor * capacity_factor
    return raw.quantize(Decimal("0.00000001"))


async def sync_status(session: AsyncSession, miner: Miner) -> Miner:
    if miner.status == "running" and miner.session_ends_at:
        now = datetime.now(timezone.utc)
        ends = miner.session_ends_at
        if ends.tzinfo is None:
            ends = ends.replace(tzinfo=timezone.utc)
        if now >= ends:
            miner.status = "ready"
            await session.flush()
    return miner


async def get_miner_view(session: AsyncSession, user_id: int) -> MinerView:
    miner = await _get_miner(session, user_id)
    await sync_status(session, miner)

    base_hours = float((await get_setting(session, "miner_session_hours"))["hours"])
    rate = dec((await get_setting(session, "miner_base_rate"))["ton_per_hour"])
    p_mult = dec((await get_setting(session, "miner_power_mult"))["per_level"])
    c_mult = dec((await get_setting(session, "miner_capacity_mult"))["per_level"])
    hours = _session_hours(miner, base_hours)
    estimate = _estimate_reward(
        miner, ton_per_hour=rate, hours=hours, power_mult=p_mult, capacity_mult=c_mult
    )

    return MinerView(
        power=miner.power,
        capacity=miner.capacity,
        acceleration=miner.acceleration,
        luck=miner.luck,
        stability=miner.stability,
        status=miner.status,
        pending_reward=Decimal(miner.pending_reward),
        session_started_at=miner.session_started_at,
        session_ends_at=miner.session_ends_at,
        estimated_reward=estimate
        if miner.status == "idle"
        else (Decimal(miner.pending_reward) if miner.status == "ready" else estimate),
    )


async def start_session(session: AsyncSession, user_id: int) -> MinerView:
    miner = await _get_miner(session, user_id)
    await sync_status(session, miner)

    if miner.status == "running":
        raise MinerBusyError("session already running")
    if miner.status == "ready":
        raise MinerBusyError("claim reward before starting a new session")

    base_hours = float((await get_setting(session, "miner_session_hours"))["hours"])
    rate = dec((await get_setting(session, "miner_base_rate"))["ton_per_hour"])
    p_mult = dec((await get_setting(session, "miner_power_mult"))["per_level"])
    c_mult = dec((await get_setting(session, "miner_capacity_mult"))["per_level"])
    hours = _session_hours(miner, base_hours)
    reward = _estimate_reward(
        miner, ton_per_hour=rate, hours=hours, power_mult=p_mult, capacity_mult=c_mult
    )

    now = datetime.now(timezone.utc)
    miner.status = "running"
    miner.session_started_at = now
    miner.session_ends_at = now + timedelta(hours=hours)
    miner.pending_reward = reward
    await session.flush()
    return await get_miner_view(session, user_id)


async def claim(session: AsyncSession, user_id: int) -> tuple[MinerView, Decimal]:
    miner = await _get_miner(session, user_id)
    await sync_status(session, miner)

    if miner.status != "ready":
        raise MinerNotReadyError(f"status is {miner.status}, need ready")

    amount = Decimal(miner.pending_reward)
    if amount > 0:
        luck_bp = min(500, (miner.luck - 1) * 20)
        if luck_bp:
            import random

            factor = Decimal("1") + Decimal(random.randint(-luck_bp, luck_bp)) / Decimal(10000)
            amount = (amount * factor).quantize(Decimal("0.00000001"))

        await balance_svc.credit(
            session,
            user_id=user_id,
            amount=amount,
            balance_type="miner",
            description="Сбор майнера",
            reference_type="miner",
            reference_id=miner.id,
        )

    miner.status = "idle"
    miner.pending_reward = Decimal("0")
    miner.session_started_at = None
    miner.session_ends_at = None
    await session.flush()

    view = await get_miner_view(session, user_id)
    return view, amount
