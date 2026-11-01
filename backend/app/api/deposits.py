"""TON deposits API."""

import base64
import time
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import SessionLocal, get_db
from app.models.deposit import TonDeposit
from app.models.user import User
from app.services.economy import get_setting
from app.services.roles import is_admin, is_platform_owner
from app.services.ton_deposits import DepositError, assign_manual, ensure_memo, poll_if_due
from app.services.ton_wallet import WalletError, normalize_address
from pytoniq_core import begin_cell

router = APIRouter(prefix="/deposits", tags=["deposits"])


class AssignBody(BaseModel):
    telegram_id: int
    note: str | None = None


async def _network(db: AsyncSession) -> str:
    return (await get_setting(db, "ton_wallet") or {}).get("network", "mainnet")


def _friendly(address: str, network: str) -> str:
    if not address:
        return ""
    try:
        return normalize_address(address, testnet=network == "testnet")[1]
    except WalletError:
        return address


@router.get("/info")
async def info(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    cfg = await get_setting(db, "ton_deposits") or {}
    network = await _network(db)
    memo = await ensure_memo(db, user)
    await db.commit()
    return {
        "enabled": bool(cfg.get("enabled", False)) and bool(cfg.get("project_address")),
        "project_address": _friendly(cfg.get("project_address", ""), network),
        "memo": memo,
        "min_ton": str(cfg.get("min_ton", "0.1")),
        "network": network,
    }


@router.get("/tx-payload")
async def tx_payload(amount: str = "1", user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    cfg = await get_setting(db, "ton_deposits") or {}
    if not cfg.get("enabled") or not cfg.get("project_address"):
        raise HTTPException(status_code=400, detail="Пополнение временно недоступно")
    try:
        amt = Decimal(amount.strip().replace(",", "."))
    except (InvalidOperation, ValueError):
        raise HTTPException(status_code=400, detail="Неверная сумма") from None
    if not amt.is_finite() or amt <= 0:
        raise HTTPException(status_code=400, detail="Неверная сумма")
    if amt != amt.quantize(Decimal("0.000000001")):
        raise HTTPException(status_code=400, detail="Не больше 9 знаков после точки")
    min_ton = Decimal(str(cfg.get("min_ton", "0.1")))
    if amt < min_ton:
        raise HTTPException(status_code=400, detail=f"Минимум {min_ton} TON")
    if amt > Decimal("10000"):
        raise HTTPException(status_code=400, detail="Сумма слишком большая")
    network = await _network(db)
    memo = await ensure_memo(db, user)
    await db.commit()
    nano = int(amt * Decimal("1000000000"))
    cell = begin_cell().store_uint(0, 32).store_snake_string(memo).end_cell()
    return {
        "to": _friendly(cfg["project_address"], network),
        "amount_nano": str(nano),
        "payload": base64.b64encode(cell.to_boc()).decode(),
        "valid_until": int(time.time()) + 600,
        "network": network,
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
    """«Проверить пополнение»: внеочередной опрос toncenter (не чаще раза в 10 с на сервер) и свои пополнения."""
    await poll_if_due(SessionLocal)
    return await mine(user, db)


@router.get("")
async def list_deposits(
    status: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Касса → «Пополнения». По умолчанию — незачисленные (unmatched, below_min); status=all — все."""
    if not (is_platform_owner(user) or is_admin(user)):
        raise HTTPException(status_code=403, detail="admin only")
    q = select(TonDeposit).order_by(TonDeposit.created_at.desc(), TonDeposit.id.desc()).limit(50)
    if status is None:
        q = q.where(TonDeposit.status.in_(("unmatched", "below_min")))
    elif status != "all":
        q = q.where(TonDeposit.status == status)
    rows = (await db.scalars(q)).all()
    return [
        {
            "id": d.id,
            "tx_hash": d.tx_hash,
            "amount_ton": str(d.amount_ton),
            "status": d.status,
            "memo": d.memo,
            "comment": d.comment,
            "from_address": d.from_address,
            "user_id": d.user_id,
            "utime": d.utime,
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
