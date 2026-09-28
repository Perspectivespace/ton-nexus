"""
Miner session — long cycles, capacity storage, claim anytime.

Lifecycle
---------
idle  → start → running (fills storage over time)
running → claim anytime (payout accrued; cycle continues if time left)
running → time ends → ready (storage full / frozen; no more farm)
ready → claim → idle (must start again to farm)

Upgrades
--------
power        → TON/hour rate
capacity     → max storage (TON) this cycle can hold
acceleration → LONGER cycle (hours), fewer check-ins
luck         → small ± on claim
stability    → used mainly in upgrade success; minor reliability
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import random

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
    storage_cap: Decimal
    cycle_hours: float
    accrued_now: Decimal


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


async def _get_miner(session: AsyncSession, user_id: int) -> Miner:
    miner = await session.scalar(select(Miner).where(Miner.user_id == user_id))
    if not miner:
        raise MinerError("miner not found")
    return miner


async def _rate_params(session: AsyncSession) -> tuple[Decimal, Decimal, Decimal]:
    rate = dec((await get_setting(session, "miner_base_rate"))["ton_per_hour"])
    p_mult = dec((await get_setting(session, "miner_power_mult"))["per_level"])
    c_mult = dec((await get_setting(session, "miner_capacity_mult"))["per_level"])
    return rate, p_mult, c_mult


def _ton_per_hour(miner: Miner, base_rate: Decimal, power_mult: Decimal) -> Decimal:
    factor = Decimal("1") + power_mult * Decimal(max(0, miner.power - 1))
    return (base_rate * factor).quantize(Decimal("0.0000000001"))


def _cycle_hours(miner: Miner, base_hours: float) -> float:
    """Acceleration INCREASES cycle length — fewer visits."""
    acc = max(1, miner.acceleration)
    return base_hours * (1.0 + 0.06 * (acc - 1))


def _storage_cap(
    miner: Miner,
    base_rate: Decimal,
    power_mult: Decimal,
    capacity_mult: Decimal,
    cycle_hours: float,
) -> Decimal:
    rate = _ton_per_hour(miner, base_rate, power_mult)
    full_cycle = rate * Decimal(str(cycle_hours))
    cap_factor = Decimal("1") + capacity_mult * Decimal(max(0, miner.capacity - 1))
    return (full_cycle * cap_factor).quantize(Decimal("0.00000001"))


def _accrued(
    miner: Miner,
    *,
    now: datetime,
    base_rate: Decimal,
    power_mult: Decimal,
    capacity_mult: Decimal,
    base_hours: float,
) -> Decimal:
    if miner.status not in ("running", "ready"):
        return Decimal("0")

    started = _aware(miner.session_started_at)
    ends = _aware(miner.session_ends_at)
    if not started:
        return Decimal(miner.pending_reward or 0)

    cycle_h = _cycle_hours(miner, base_hours)
    cap = _storage_cap(miner, base_rate, power_mult, capacity_mult, cycle_h)
    rate = _ton_per_hour(miner, base_rate, power_mult)

    if miner.status == "ready":
        frozen = Decimal(miner.pending_reward or 0)
        if frozen > 0:
            return min(cap, frozen)
        return min(cap, rate * Decimal(str(cycle_h)))

    effective_end = min(now, ends) if ends else now
    elapsed_h = max(0.0, (effective_end - started).total_seconds() / 3600.0)
    raw = rate * Decimal(str(elapsed_h))
    return min(cap, raw).quantize(Decimal("0.00000001"))


async def sync_status(session: AsyncSession, miner: Miner) -> Miner:
    """Cycle ended → ready, stop farming until claim + restart."""
    if miner.status != "running" or not miner.session_ends_at:
        return miner

    now = _utcnow()
    ends = _aware(miner.session_ends_at)
    if ends and now >= ends:
        base_hours = float((await get_setting(session, "miner_session_hours"))["hours"])
        rate, p_mult, c_mult = await _rate_params(session)
        accrued = _accrued(
            miner,
            now=ends,
            base_rate=rate,
            power_mult=p_mult,
            capacity_mult=c_mult,
            base_hours=base_hours,
        )
        cycle_h = _cycle_hours(miner, base_hours)
        cap = _storage_cap(miner, rate, p_mult, c_mult, cycle_h)
        miner.pending_reward = min(cap, accrued)
        miner.status = "ready"
        await session.flush()
    return miner


async def get_miner_view(session: AsyncSession, user_id: int) -> MinerView:
    miner = await _get_miner(session, user_id)
    await sync_status(session, miner)

    base_hours = float((await get_setting(session, "miner_session_hours"))["hours"])
    rate, p_mult, c_mult = await _rate_params(session)
    cycle_h = _cycle_hours(miner, base_hours)
    cap = _storage_cap(miner, rate, p_mult, c_mult, cycle_h)
    now = _utcnow()
    accrued = _accrued(
        miner,
        now=now,
        base_rate=rate,
        power_mult=p_mult,
        capacity_mult=c_mult,
        base_hours=base_hours,
    )
    if miner.status == "idle":
        accrued = Decimal("0")

    return MinerView(
        power=miner.power,
        capacity=miner.capacity,
        acceleration=miner.acceleration,
        luck=miner.luck,
        stability=miner.stability,
        status=miner.status,
        pending_reward=Decimal(miner.pending_reward or 0),
        session_started_at=miner.session_started_at,
        session_ends_at=miner.session_ends_at,
        estimated_reward=cap,
        storage_cap=cap,
        cycle_hours=cycle_h,
        accrued_now=accrued,
    )


async def start_session(session: AsyncSession, user_id: int) -> MinerView:
    miner = await _get_miner(session, user_id)
    await sync_status(session, miner)

    if miner.status == "running":
        raise MinerBusyError("session already running")
    if miner.status == "ready":
        raise MinerBusyError("storage full — claim before starting a new cycle")

    base_hours = float((await get_setting(session, "miner_session_hours"))["hours"])
    cycle_h = _cycle_hours(miner, base_hours)
    now = _utcnow()

    miner.status = "running"
    miner.session_started_at = now
    miner.session_ends_at = now + timedelta(hours=cycle_h)
    miner.pending_reward = Decimal("0")
    await session.flush()
    return await get_miner_view(session, user_id)


async def claim(session: AsyncSession, user_id: int) -> tuple[MinerView, Decimal]:
    """Claim while running (partial) or ready (frozen)."""
    miner = await _get_miner(session, user_id)
    await sync_status(session, miner)

    if miner.status not in ("running", "ready"):
        raise MinerNotReadyError(f"status is {miner.status}, nothing to claim")

    base_hours = float((await get_setting(session, "miner_session_hours"))["hours"])
    rate, p_mult, c_mult = await _rate_params(session)
    now = _utcnow()
    amount = _accrued(
        miner,
        now=now,
        base_rate=rate,
        power_mult=p_mult,
        capacity_mult=c_mult,
        base_hours=base_hours,
    )

    if amount > 0:
        luck_bp = min(500, (miner.luck - 1) * 20)
        if luck_bp:
            factor = Decimal("1") + Decimal(random.randint(-luck_bp, luck_bp)) / Decimal(10000)
            amount = (amount * factor).quantize(Decimal("0.00000001"))
            if amount < 0:
                amount = Decimal("0")

        if amount > 0:
            await balance_svc.credit(
                session,
                user_id=user_id,
                amount=amount,
                balance_type="miner",
                description="Сбор майнера",
                reference_type="miner",
                reference_id=miner.id,
            )

    if miner.status == "ready":
        miner.status = "idle"
        miner.pending_reward = Decimal("0")
        miner.session_started_at = None
        miner.session_ends_at = None
    else:
        miner.pending_reward = Decimal("0")
        miner.session_started_at = now

    await session.flush()
    view = await get_miner_view(session, user_id)
    return view, amount
