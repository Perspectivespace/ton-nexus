"""Miner + upgrade HTTP API."""

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services import miner as miner_svc
from app.services import upgrade as upgrade_svc
from app.services.balance import InsufficientBalanceError
from app.services.miner import MinerBusyError, MinerError, MinerNotReadyError
from app.services.upgrade import SoftCapError, UpgradeError

router = APIRouter(prefix="/miner", tags=["miner"])


class MinerOut(BaseModel):
    power: int
    capacity: int
    acceleration: int
    luck: int
    stability: int
    status: str
    pending_reward: Decimal
    estimated_reward: Decimal
    session_started_at: str | None = None
    session_ends_at: str | None = None


class ClaimOut(BaseModel):
    miner: MinerOut
    claimed: Decimal


class UpgradeBody(BaseModel):
    use_focus_on: str | None = Field(default=None, description="power|capacity|...")
    block_type: str | None = Field(default=None, description="exclude type for this roll")


class UpgradeOut(BaseModel):
    upgrade_type: str
    cost: Decimal
    success_chance_bp: int
    success: bool
    new_level: int | None
    used_focus: bool
    used_block_type: str | None
    burned: bool


def _miner_out(v: miner_svc.MinerView) -> MinerOut:
    return MinerOut(
        power=v.power,
        capacity=v.capacity,
        acceleration=v.acceleration,
        luck=v.luck,
        stability=v.stability,
        status=v.status,
        pending_reward=v.pending_reward,
        estimated_reward=v.estimated_reward,
        session_started_at=v.session_started_at.isoformat() if v.session_started_at else None,
        session_ends_at=v.session_ends_at.isoformat() if v.session_ends_at else None,
    )


@router.get("", response_model=MinerOut)
async def get_miner(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    view = await miner_svc.get_miner_view(db, user.id)
    await db.commit()
    return _miner_out(view)


@router.post("/start", response_model=MinerOut)
async def start_miner(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        view = await miner_svc.start_session(db, user.id)
        await db.commit()
        return _miner_out(view)
    except MinerBusyError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except MinerError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/claim", response_model=ClaimOut)
async def claim_miner(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        view, amount = await miner_svc.claim(db, user.id)
        await db.commit()
        return ClaimOut(miner=_miner_out(view), claimed=amount)
    except MinerNotReadyError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except MinerError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/upgrade", response_model=UpgradeOut)
async def upgrade_miner(
    body: UpgradeBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await upgrade_svc.attempt_upgrade(
            db,
            user_id=user.id,
            use_focus_on=body.use_focus_on,
            block_type=body.block_type,
        )
        await db.commit()
        return UpgradeOut(
            upgrade_type=result.upgrade_type,
            cost=result.cost,
            success_chance_bp=result.success_chance_bp,
            success=result.success,
            new_level=result.new_level,
            used_focus=result.used_focus,
            used_block_type=result.used_block_type,
            burned=result.burned,
        )
    except InsufficientBalanceError as e:
        raise HTTPException(status_code=402, detail=str(e)) from e
    except SoftCapError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except MinerBusyError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except (UpgradeError, MinerError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
