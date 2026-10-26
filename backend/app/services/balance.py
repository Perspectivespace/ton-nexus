"""Balance ledger — every credit/debit goes through here."""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.balance import BalanceHistory
from app.models.user import User


class InsufficientBalanceError(Exception):
    pass


class UserNotFoundError(Exception):
    pass


async def get_user_for_update(session: AsyncSession, user_id: int) -> User:
    """Строка пользователя под блокировкой (FOR UPDATE) со свежими значениями из БД.

    Сначала сбрасываем несохранённые изменения сессии (autoflush выключен), затем перечитываем
    строку: без populate_existing объект из сессии остался бы со старым балансом, прочитанным
    до блокировки, и параллельное начисление затёрлось бы.
    """
    await session.flush()
    result = await session.execute(
        select(User)
        .where(User.id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise UserNotFoundError(f"user {user_id}")
    return user


async def credit(
    session: AsyncSession,
    *,
    user_id: int,
    amount: Decimal,
    balance_type: str,
    description: str | None = None,
    reference_type: str | None = None,
    reference_id: int | None = None,
) -> User:
    if amount <= 0:
        raise ValueError("credit amount must be positive")
    user = await get_user_for_update(session, user_id)
    user.balance = Decimal(user.balance) + amount
    session.add(
        BalanceHistory(
            user_id=user.id,
            operation_type="credit",
            amount=amount,
            balance_type=balance_type,
            description=description,
            reference_type=reference_type,
            reference_id=reference_id,
            balance_after=user.balance,
        )
    )
    await session.flush()
    return user


async def debit(
    session: AsyncSession,
    *,
    user_id: int,
    amount: Decimal,
    balance_type: str,
    description: str | None = None,
    reference_type: str | None = None,
    reference_id: int | None = None,
) -> User:
    if amount <= 0:
        raise ValueError("debit amount must be positive")
    user = await get_user_for_update(session, user_id)
    if Decimal(user.balance) < amount:
        raise InsufficientBalanceError(f"need {amount}, have {user.balance}")
    user.balance = Decimal(user.balance) - amount
    session.add(
        BalanceHistory(
            user_id=user.id,
            operation_type="debit",
            amount=amount,
            balance_type=balance_type,
            description=description,
            reference_type=reference_type,
            reference_id=reference_id,
            balance_after=user.balance,
        )
    )
    await session.flush()
    return user
