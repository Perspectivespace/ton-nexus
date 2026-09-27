"""Current user profile."""

from decimal import Decimal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.miner import Miner
from app.models.user import User

router = APIRouter(prefix="/me", tags=["me"])


class MinerOut(BaseModel):
    power: int
    capacity: int
    acceleration: int
    luck: int
    stability: int
    status: str
    pending_reward: Decimal

    model_config = {"from_attributes": True}


class MeOut(BaseModel):
    id: int
    telegram_id: int
    username: str | None
    first_name: str | None
    balance: Decimal
    xp: int
    level: int
    focus_tokens: int
    block_tokens: int
    success_boost_bp: int
    is_ambassador: bool
    miner: MinerOut | None

    model_config = {"from_attributes": True}


@router.get("", response_model=MeOut)
async def me(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    miner = await db.scalar(select(Miner).where(Miner.user_id == user.id))
    return MeOut(
        id=user.id,
        telegram_id=user.telegram_id,
        username=user.username,
        first_name=user.first_name,
        balance=user.balance,
        xp=user.xp,
        level=user.level,
        focus_tokens=user.focus_tokens,
        block_tokens=user.block_tokens,
        success_boost_bp=user.success_boost_bp,
        is_ambassador=user.is_ambassador,
        miner=MinerOut.model_validate(miner) if miner else None,
    )
