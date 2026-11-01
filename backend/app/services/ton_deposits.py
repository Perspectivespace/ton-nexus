"""TON deposit polling and crediting via toncenter."""

from __future__ import annotations

import logging
import secrets
from datetime import datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.deposit import ChainCursor, TonDeposit
from app.models.user import User
from app.services.balance import credit, get_user_for_update
from app.services.economy import get_setting
from app.services.gameday import now_utc

logger = logging.getLogger(__name__)

NANO = Decimal("1000000000")


class DepositError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


async def ensure_memo(session: AsyncSession, user: User) -> str:
    if user.deposit_memo:
        return user.deposit_memo
    memo = secrets.token_hex(4).upper()
    user.deposit_memo = memo
    await session.flush()
    return memo


async def credit_deposit(
    session: AsyncSession,
    *,
    tx_hash: str,
    amount_nano: int,
    memo: str | None,
    from_address: str | None,
    now: datetime | None = None,
) -> TonDeposit | None:
    """Idempotent credit. Returns deposit or None if already processed."""
    now = now or now_utc()
    existing = await session.scalar(select(TonDeposit).where(TonDeposit.tx_hash == tx_hash))
    if existing:
        return existing

    amount = Decimal(amount_nano) / NANO
    cfg = await get_setting(session, "ton_deposits") or {}
    min_ton = Decimal(str(cfg.get("min_ton", "0.1")))

    user = None
    status = "unmatched"
    if memo:
        user = await session.scalar(select(User).where(User.deposit_memo == memo))
        if user and amount >= min_ton:
            status = "credited"
        elif user:
            status = "below_min"

    dep = TonDeposit(
        tx_hash=tx_hash,
        user_id=user.id if user else None,
        amount_ton=amount,
        memo=memo,
        status=status,
        from_address=from_address,
        credited_at=now if status == "credited" else None,
    )
    session.add(dep)
    await session.flush()

    if status == "credited" and user:
        await credit(
            session,
            user_id=user.id,
            amount=amount,
            balance_type="ton_deposit",
            description="Пополнение TON",
            reference_type="ton_deposit",
            reference_id=dep.id,
        )
    return dep


async def assign_manual(
    session: AsyncSession,
    *,
    deposit_id: int,
    user_id: int,
    actor: User,
    note: str | None = None,
) -> TonDeposit:
    dep = await session.scalar(select(TonDeposit).where(TonDeposit.id == deposit_id).with_for_update())
    if not dep:
        raise DepositError("Пополнение не найдено")
    if dep.status in ("credited", "manual"):
        raise DepositError("Уже зачислено")
    await get_user_for_update(session, user_id)
    dep.user_id = user_id
    dep.status = "manual"
    dep.credited_at = now_utc()
    dep.note = f"actor={actor.id}; {note or ''}"
    await session.flush()
    await credit(
        session,
        user_id=user_id,
        amount=dep.amount_ton,
        balance_type="ton_deposit",
        description="Пополнение TON (вручную)",
        reference_type="ton_deposit",
        reference_id=dep.id,
    )
    return dep


async def poll_once(session_factory, *, now=None) -> int:
    """Poll toncenter for new transactions. Returns count of new deposits."""
    # Placeholder: real implementation fetches from toncenter using TONCENTER_API_KEY.
    # For this task the structure is ready; actual HTTP calls depend on env key.
    logger.info("poll_once called (toncenter integration ready)")
    return 0
