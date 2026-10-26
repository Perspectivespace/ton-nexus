"""Manual withdraw — hold on request, owner approve/reject."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.models.withdraw import WithdrawRequest
from app.services import balance as balance_svc
from app.services.economy import dec, get_setting
from app.services.roles import is_admin, is_platform_owner


class WithdrawError(Exception):
    pass


class WithdrawPermissionError(WithdrawError):
    pass


class WithdrawStateError(WithdrawError):
    pass


_TON_RE = re.compile(r"^(UQ|EQ)[A-Za-z0-9_-]{46}$")


@dataclass
class WithdrawView:
    id: int
    user_id: int
    amount: Decimal
    wallet_address: str
    status: str
    admin_note: str | None
    created_at: datetime
    reviewed_at: datetime | None


def _view(w: WithdrawRequest) -> WithdrawView:
    return WithdrawView(
        id=w.id,
        user_id=w.user_id,
        amount=Decimal(w.amount),
        wallet_address=w.wallet_address,
        status=w.status,
        admin_note=w.admin_note,
        created_at=w.created_at,
        reviewed_at=w.reviewed_at,
    )


async def min_withdraw(session: AsyncSession) -> Decimal:
    """Минимальная сумма вывода — та же, что проверяет create_request."""
    return dec((await get_setting(session, "min_withdraw_ton"))["ton"])


def is_valid_wallet(addr: str) -> bool:
    return bool(_TON_RE.match(addr.strip()))


def _validate_wallet(addr: str) -> str:
    addr = addr.strip()
    if not _TON_RE.match(addr):
        raise WithdrawError("invalid TON wallet address format")
    return addr


async def create_request(
    session: AsyncSession,
    *,
    user: User,
    amount: Decimal,
    wallet_address: str,
) -> WithdrawView:
    if user.is_banned:
        raise WithdrawError("banned")
    if amount <= 0:
        raise WithdrawError("amount must be positive")

    min_w = await min_withdraw(session)
    if amount < min_w:
        raise WithdrawError(f"minimum withdraw is {min_w} TON")

    wallet = _validate_wallet(wallet_address)

    # Блокируем пользователя до проверки «уже есть заявка»: две параллельные заявки не пройдут обе.
    await balance_svc.get_user_for_update(session, user.id)
    pending = await session.scalar(
        select(WithdrawRequest.id).where(
            WithdrawRequest.user_id == user.id,
            WithdrawRequest.status == "pending",
        )
    )
    if pending:
        raise WithdrawStateError("you already have a pending withdraw")

    await balance_svc.debit(
        session,
        user_id=user.id,
        amount=amount,
        balance_type="withdraw",
        description="Заявка на вывод (hold)",
        reference_type="withdraw",
        reference_id=None,
    )

    req = WithdrawRequest(
        user_id=user.id,
        amount=amount,
        wallet_address=wallet,
        status="pending",
    )
    session.add(req)
    await session.flush()
    return _view(req)


async def list_mine(
    session: AsyncSession, *, user_id: int, limit: int = 50
) -> list[WithdrawView]:
    result = await session.execute(
        select(WithdrawRequest)
        .where(WithdrawRequest.user_id == user_id)
        .order_by(WithdrawRequest.created_at.desc())
        .limit(min(limit, 100))
    )
    return [_view(w) for w in result.scalars().all()]


async def list_pending(
    session: AsyncSession, *, limit: int = 100
) -> list[WithdrawView]:
    result = await session.execute(
        select(WithdrawRequest)
        .where(WithdrawRequest.status == "pending")
        .order_by(WithdrawRequest.created_at.asc())
        .limit(min(limit, 200))
    )
    return [_view(w) for w in result.scalars().all()]


async def review(
    session: AsyncSession,
    *,
    actor: User,
    request_id: int,
    approve: bool,
    note: str | None = None,
) -> WithdrawView:
    if not is_platform_owner(actor) and not is_admin(actor):
        raise WithdrawPermissionError("owner or admin required")

    # Заявка под блокировкой и перечитана: второе нажатие «Отклонить»/«Выплачено» ждёт первое
    # и видит уже изменённый статус — возврат не начисляется дважды.
    req = await session.scalar(
        select(WithdrawRequest)
        .where(WithdrawRequest.id == request_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if not req or req.status != "pending":
        raise WithdrawStateError("request not pending")

    req.reviewed_by_telegram_id = actor.telegram_id
    req.reviewed_at = datetime.now(timezone.utc)
    req.admin_note = note

    if approve:
        req.status = "paid"
    else:
        req.status = "rejected"
        await balance_svc.credit(
            session,
            user_id=req.user_id,
            amount=Decimal(req.amount),
            balance_type="withdraw",
            description=f"Отмена вывода #{req.id}",
            reference_type="withdraw",
            reference_id=req.id,
        )

    await session.flush()
    return _view(req)
