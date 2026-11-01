"""TON deposits API."""

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.deposit import TonDeposit
from app.models.user import User
from app.services.economy import get_setting
from app.services.roles import is_admin, is_platform_owner
from app.services.ton_deposits import DepositError, assign_manual, ensure_memo

router = APIRouter(prefix="/deposits", tags=["deposits"])


class AssignBody(BaseModel):
    telegram_id: int
    note: str | None = None


@router.get("/info")
async def info(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    cfg = await get_setting(db, "ton_deposits") or {}
    memo = await ensure_memo(db, user)
    await db.commit()
    return {
        "enabled": cfg.get("enabled", False),
        "project_address": cfg.get("project_address", ""),
        "memo": memo,
        "min_ton": str(cfg.get("min_ton", "0.1")),
        "network": cfg.get("network", "mainnet"),
    }


@router.get("/mine")
async def mine(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.scalars(
        select(TonDeposit).where(TonDeposit.user_id == user.id).order_by(TonDeposit.created_at.desc()).limit(20)
    )).all()
    return [
        {
            "id": d.id,
            "amount_ton": str(d.amount_ton),
            "status": d.status,
            "memo": d.memo,
            "created_at": d.created_at.isoformat(),
        }
        for d in rows
    ]


@router.post("/check")
async def check(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # Lazy poll (rate-limited in service); for now just return mine
    return await mine(user, db)


@router.get("")
async def list_deposits(
    status: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not (is_platform_owner(user) or is_admin(user)):
        raise HTTPException(status_code=403, detail="admin only")
    q = select(TonDeposit).order_by(TonDeposit.created_at.desc()).limit(50)
    if status:
        q = q.where(TonDeposit.status == status)
    rows = (await db.scalars(q)).all()
    return [
        {
            "id": d.id,
            "tx_hash": d.tx_hash,
            "amount_ton": str(d.amount_ton),
            "status": d.status,
            "memo": d.memo,
            "from_address": d.from_address,
            "created_at": d.created_at.isoformat(),
        }
        for d in rows
    ]


@router.post("/{deposit_id}/assign")
async def assign(
    deposit_id: int,
    body: AssignBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not is_platform_owner(user):
        raise HTTPException(status_code=403, detail="owner only")
    target = await db.scalar(select(User).where(User.telegram_id == body.telegram_id))
    if not target:
        raise HTTPException(status_code=404, detail="user not found")
    try:
        dep = await assign_manual(db, deposit_id=deposit_id, user_id=target.id, actor=user, note=body.note)
        await db.commit()
        return {"id": dep.id, "status": dep.status, "amount_ton": str(dep.amount_ton)}
    except DepositError as e:
        raise HTTPException(status_code=400, detail=e.message) from e
