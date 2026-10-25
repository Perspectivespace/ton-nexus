"""Withdraw HTTP API."""

from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services import withdraw as w_svc
from app.services.balance import InsufficientBalanceError
from app.services.roles import is_admin, is_platform_owner
from app.services.withdraw import (
    WithdrawError,
    WithdrawPermissionError,
    WithdrawStateError,
)

router = APIRouter(prefix="/withdraw", tags=["withdraw"])


class CreateBody(BaseModel):
    amount: Decimal = Field(gt=0)
    wallet_address: str = Field(min_length=10, max_length=128)


class ReviewBody(BaseModel):
    approve: bool
    note: str | None = None


class WithdrawOut(BaseModel):
    id: int
    user_id: int
    amount: Decimal
    wallet_address: str
    status: str
    admin_note: str | None
    created_at: datetime
    reviewed_at: datetime | None


def _out(v: w_svc.WithdrawView) -> WithdrawOut:
    return WithdrawOut(
        id=v.id,
        user_id=v.user_id,
        amount=v.amount,
        wallet_address=v.wallet_address,
        status=v.status,
        admin_note=v.admin_note,
        created_at=v.created_at,
        reviewed_at=v.reviewed_at,
    )


@router.post("", response_model=WithdrawOut)
async def create_withdraw(
    body: CreateBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        v = await w_svc.create_request(
            db, user=user, amount=body.amount, wallet_address=body.wallet_address
        )
        await db.commit()
        return _out(v)
    except InsufficientBalanceError as e:
        raise HTTPException(status_code=402, detail=str(e)) from e
    except WithdrawStateError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except WithdrawError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


class LimitsOut(BaseModel):
    min_ton: Decimal


@router.get("/limits", response_model=LimitsOut)
async def withdraw_limits(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Условия вывода для формы: кнопка неактивна, пока сумма ниже минимума."""
    return LimitsOut(min_ton=await w_svc.min_withdraw(db))


@router.get("/mine", response_model=list[WithdrawOut])
async def my_withdrawals(
    limit: int = Query(50, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    items = await w_svc.list_mine(db, user_id=user.id, limit=limit)
    await db.commit()
    return [_out(i) for i in items]


@router.get("/pending", response_model=list[WithdrawOut])
async def pending_withdrawals(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not is_platform_owner(user) and not is_admin(user):
        raise HTTPException(status_code=403, detail="owner or admin required")
    items = await w_svc.list_pending(db)
    await db.commit()
    return [_out(i) for i in items]


@router.post("/{request_id}/review", response_model=WithdrawOut)
async def review_withdraw(
    request_id: int,
    body: ReviewBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        v = await w_svc.review(
            db, actor=user, request_id=request_id, approve=body.approve, note=body.note
        )
        await db.commit()
        return _out(v)
    except WithdrawPermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except WithdrawStateError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except WithdrawError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
