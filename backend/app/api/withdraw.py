"""Withdraw HTTP API."""

from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services import ton_deposits as td
from app.services import ton_payouts as payouts
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
    note: str | None = Field(default=None, max_length=500)
    # approve=True закрывает заявку без доказательства перевода: только владелец, явно и с заметкой
    unverified: bool = False


class VerifyHashBody(BaseModel):
    tx_hash: str = Field(min_length=10, max_length=200)


class WithdrawOut(BaseModel):
    id: int
    user_id: int
    amount: Decimal
    wallet_address: str
    status: str
    admin_note: str | None
    created_at: datetime
    reviewed_at: datetime | None
    payout_started_at: datetime | None = None
    tx_hash: str | None = None
    paid_at: datetime | None = None
    user_telegram_id: int | None = None
    username: str | None = None
    first_name: str | None = None


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
        payout_started_at=v.payout_started_at,
        tx_hash=v.tx_hash,
        paid_at=v.paid_at,
        user_telegram_id=v.user_telegram_id,
        username=v.username,
        first_name=v.first_name,
    )


def _staff(user: User) -> None:
    if not is_platform_owner(user) and not is_admin(user):
        raise HTTPException(status_code=403, detail="owner or admin required")


def _payout_http(e: payouts.PayoutError) -> HTTPException:
    return HTTPException(status_code=e.status, detail=e.message)


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


@router.get("/payout-config")
async def payout_config(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Кошелёк выплат для Кассы: подключённый в TON Connect кошелёк сверяется с ним до отправки."""
    _staff(user)
    cfg = await payouts.get_config(db)
    return {
        "enabled": cfg.enabled,
        "payout_wallet": cfg.wallet,
        "payout_wallet_raw": cfg.wallet_raw,
        "network": cfg.network,
        "is_owner": is_platform_owner(user),
    }


@router.get("/{request_id}/tx-payload")
async def payout_tx_payload(
    request_id: int,
    force: bool = False,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Перевод для TON Connect; заявка переходит в «отправляется». Второй — только с force (владелец)."""
    try:
        out = await payouts.issue_payload(db, actor=user, request_id=request_id, force=force)
    except payouts.PayoutError as e:
        await db.commit()  # проверка сети могла закрыть заявку
        raise _payout_http(e) from e
    await db.commit()
    return out


@router.post("/{request_id}/check", response_model=WithdrawOut)
async def payout_check(request_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """«Проверить»: найти перевод этой заявки среди исходящих кошелька выплат."""
    _staff(user)
    try:
        await payouts.check(db, request_ids=[request_id])
    except td.ToncenterError as e:
        raise HTTPException(status_code=503, detail="Не удалось проверить сеть — повторите позже") from e
    await db.commit()
    v = await w_svc.get_view(db, request_id)
    if v is None:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    return _out(v)


@router.post("/{request_id}/verify-hash", response_model=WithdrawOut)
async def payout_verify_hash(
    request_id: int,
    body: VerifyHashBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Запасной путь: владелец вставляет хеш перевода, сервер проверяет его через toncenter."""
    try:
        await payouts.verify_hash(db, actor=user, request_id=request_id, tx_hash=body.tx_hash)
    except payouts.PayoutError as e:
        raise _payout_http(e) from e
    await db.commit()
    return _out(await w_svc.get_view(db, request_id))


@router.post("/{request_id}/review", response_model=WithdrawOut)
async def review_withdraw(
    request_id: int,
    body: ReviewBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.approve and not body.unverified:
        raise HTTPException(
            status_code=400,
            detail="Выплата подтверждается переводом из Кассы или по хешу; без проверки — только явно (unverified)",
        )
    try:
        if body.approve:
            v = await w_svc.review(db, actor=user, request_id=request_id, approve=True, note=body.note)
        else:
            await payouts.reject(db, actor=user, request_id=request_id, note=body.note)
            v = await w_svc.get_view(db, request_id)
        await db.commit()
        return _out(v)
    except payouts.PayoutError as e:
        await db.commit()  # проверка сети могла закрыть заявку как выплаченную
        raise _payout_http(e) from e
    except WithdrawPermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except WithdrawStateError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    except WithdrawError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
