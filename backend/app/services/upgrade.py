"""Double-wheel upgrade: type → success; fail = 100% burn."""

from __future__ import annotations

import json
import random
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.miner import Miner, MinerUpgradeLog
from app.models.user import User
from app.services import balance as balance_svc
from app.services.economy import get_setting
from app.services.miner import UPGRADE_TYPES, MinerBusyError, MinerError, sync_status
from app.services.upgrade_cost import upgrade_cost

STAT_ATTR = {
    "power": "power",
    "capacity": "capacity",
    "acceleration": "acceleration",
    "luck": "luck",
    "stability": "stability",
}


class UpgradeError(MinerError):
    pass


class SoftCapError(UpgradeError):
    pass


@dataclass
class UpgradeResult:
    upgrade_type: str
    cost: Decimal
    success_chance_bp: int
    success: bool
    new_level: int | None
    used_focus: bool
    used_block_type: str | None
    burned: bool


def _weighted_choice(weights: dict[str, float]) -> str:
    items = [(k, max(0.0, float(v))) for k, v in weights.items() if v > 0]
    if not items:
        raise UpgradeError("no upgrade types available")
    total = sum(w for _, w in items)
    r = random.uniform(0, total)
    upto = 0.0
    for key, w in items:
        upto += w
        if r <= upto:
            return key
    return items[-1][0]


async def preview_success_bp(
    session: AsyncSession, miner: Miner, upgrade_type: str, user: User
) -> int:
    conf = await get_setting(session, "upgrade_success_base_bp")
    base = int(conf["base"])
    floor = int(conf["min"])
    decay = int((await get_setting(session, "upgrade_success_decay_per_level_bp"))["decay"])
    level = getattr(miner, STAT_ATTR[upgrade_type])
    stability_relief = min(decay // 2, (miner.stability - 1) * 10)
    effective_decay = max(0, decay - stability_relief)
    bp = base - effective_decay * (level - 1) + int(user.success_boost_bp or 0)
    return max(floor, min(9500, bp))


async def attempt_upgrade(
    session: AsyncSession,
    *,
    user_id: int,
    use_focus_on: str | None = None,
    block_type: str | None = None,
) -> UpgradeResult:
    user = await balance_svc.get_user_for_update(session, user_id)
    miner = await session.scalar(select(Miner).where(Miner.user_id == user_id))
    if not miner:
        raise MinerError("miner not found")
    await sync_status(session, miner)

    if miner.status == "running":
        raise MinerBusyError("cannot upgrade during active session")

    cost = await upgrade_cost(session, miner)

    used_focus = False
    used_block = None

    weights = dict((await get_setting(session, "upgrade_type_weights")))
    weights = {k: float(v) for k, v in weights.items() if k in UPGRADE_TYPES}

    if block_type:
        if block_type not in UPGRADE_TYPES:
            raise UpgradeError("invalid block_type")
        if user.block_tokens < 1:
            raise UpgradeError("no block tokens")
        weights.pop(block_type, None)
        user.block_tokens -= 1
        used_block = block_type

    if use_focus_on:
        if use_focus_on not in UPGRADE_TYPES:
            raise UpgradeError("invalid focus type")
        if user.focus_tokens < 1:
            raise UpgradeError("no focus tokens")
        mult = float((await get_setting(session, "focus_weight_bonus"))["multiplier"])
        if use_focus_on in weights:
            weights[use_focus_on] = weights[use_focus_on] * mult
        user.focus_tokens -= 1
        used_focus = True

    caps = await get_setting(session, "soft_caps")
    for t in list(weights.keys()):
        level = getattr(miner, STAT_ATTR[t])
        cap = int(caps.get(t, 99))
        if level >= cap:
            weights[t] = 0

    if sum(weights.values()) <= 0:
        raise SoftCapError("all stats at soft-cap")

    await balance_svc.debit(
        session,
        user_id=user_id,
        amount=cost,
        balance_type="upgrade_burn",
        description="Попытка усиления майнера",
        reference_type="miner",
        reference_id=miner.id,
    )

    upgrade_type = _weighted_choice(weights)
    chance_bp = await preview_success_bp(session, miner, upgrade_type, user)
    used_boost_bp = int(user.success_boost_bp or 0)
    # Бонус с колеса — на одну попытку: тратится целиком при успехе и при неудаче.
    user.success_boost_bp = 0
    roll = random.randint(1, 10000)
    success = roll <= chance_bp

    new_level = None
    if success:
        attr = STAT_ATTR[upgrade_type]
        setattr(miner, attr, getattr(miner, attr) + 1)
        new_level = getattr(miner, attr)

    session.add(
        MinerUpgradeLog(
            miner_id=miner.id,
            user_id=user_id,
            cost=cost,
            upgrade_type=upgrade_type,
            success_chance_bp=chance_bp,
            rolled_success=success,
            used_focus=used_focus,
            used_block_type=used_block,
            meta=json.dumps({"roll": roll, "boost_bp": used_boost_bp}, ensure_ascii=False),
        )
    )
    await session.flush()

    return UpgradeResult(
        upgrade_type=upgrade_type,
        cost=cost,
        success_chance_bp=chance_bp,
        success=success,
        new_level=new_level,
        used_focus=used_focus,
        used_block_type=used_block,
        burned=not success,
    )
