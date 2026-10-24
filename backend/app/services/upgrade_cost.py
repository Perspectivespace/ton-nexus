"""Стоимость прогона усиления — одна формула для прогона и для показа цены."""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.miner import Miner
from app.services.economy import dec, get_setting

COST_QUANT = Decimal("0.00000001")


def total_levels(miner: Miner) -> int:
    return miner.power + miner.capacity + miner.acceleration + miner.luck + miner.stability


def compute_upgrade_cost(base: Decimal, scale: Decimal, levels: int) -> Decimal:
    """База + надбавка за каждый уровень сверх стартовых пяти."""
    extra = max(0, levels - 5)
    return (base + scale * Decimal(extra)).quantize(COST_QUANT)


async def upgrade_cost(session: AsyncSession, miner: Miner) -> Decimal:
    base = dec((await get_setting(session, "upgrade_base_cost"))["ton"])
    scale = dec((await get_setting(session, "upgrade_cost_scale"))["per_total_levels"])
    return compute_upgrade_cost(base, scale, total_levels(miner))
