"""TON deposit polling and crediting via toncenter."""

from __future__ import annotations

import logging
import secrets
from datetime import datetime
from decimal import Decimal, ROUND_DOWN

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings as app_settings
from app.models.deposit import ChainCursor, TonDeposit
from app.models.user import User
from app.services.balance import credit, get_user_for_update
from app.services.economy import get_setting
from app.services.gameday import now_utc

logger = logging.getLogger(__name__)

NANO = Decimal("1000000000")
TONCENTER_MAINNET = "https://toncenter.com/api/v2"
TONCENTER_TESTNET = "https://testnet.toncenter.com/api/v2"


class DepositError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


def _generate_memo() -> str:
    """TN + base32 Crockford (no I, L, O, U)."""
    alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    return "TN" + "".join(secrets.choice(alphabet) for _ in range(6))


def _normalize_memo(raw: str | None) -> str | None:
    if not raw:
        return None
    s = raw.strip().upper().replace(" ", "").replace("\t", "")
    return s if s.startswith("TN") and len(s) >= 4 else None


async def ensure_memo(session: AsyncSession, user: User) -> str:
    if user.deposit_memo:
        return user.deposit_memo
    for _ in range(5):
        memo = _generate_memo()
        exists = await session.scalar(select(User).where(User.deposit_memo == memo))
        if not exists:
            user.deposit_memo = memo
            await session.flush()
            return memo
    raise DepositError("Не удалось создать мемо")


async def credit_deposit(
    session: AsyncSession,
    *,
    tx_hash: str,
    amount_nano: int,
    memo: str | None,
    from_address: str | None,
    lt: int | None = None,
    utime: int | None = None,
    comment: str | None = None,
    now: datetime | None = None,
) -> TonDeposit | None:
    now = now or now_utc()
    existing = await session.scalar(select(TonDeposit).where(TonDeposit.tx_hash == tx_hash))
    if existing:
        return existing

    amount = (Decimal(amount_nano) / NANO).quantize(Decimal("0.00000001"), rounding=ROUND_DOWN)
    cfg = await get_setting(session, "ton_deposits") or {}
    min_ton = Decimal(str(cfg.get("min_ton", "0.1")))
    memo_norm = _normalize_memo(memo)

    user = None
    status = "unmatched"
    if memo_norm:
        user = await session.scalar(select(User).where(User.deposit_memo == memo_norm))
        if user and amount >= min_ton:
            status = "credited"
        elif user:
            status = "below_min"

    dep = TonDeposit(
        tx_hash=tx_hash,
        user_id=user.id if user else None,
        amount_ton=amount,
        amount_nano=amount_nano,
        memo=memo_norm,
        comment=comment,
        status=status,
        from_address=from_address,
        lt=lt,
        utime=utime,
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


async def _fetch_transactions(address: str, lt: int, network: str) -> list[dict]:
    base = TONCENTER_TESTNET if network == "testnet" else TONCENTER_MAINNET
    key = app_settings.toncenter_api_key or ""
    params = {"address": address, "limit": 50, "archival": "true"}
    if lt:
        params["lt"] = lt
    if key:
        params["api_key"] = key
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(f"{base}/getTransactions", params=params)
            r.raise_for_status()
            data = r.json()
            return data.get("result", []) if data.get("ok") else []
    except Exception as e:
        logger.warning("toncenter fetch failed: %s", e)
        return []


async def poll_once(session_factory, *, now=None) -> int:
    """Poll toncenter for new transactions. Returns count of new deposits."""
    async with session_factory() as session:
        cfg = await get_setting(session, "ton_deposits") or {}
        if not cfg.get("enabled") or not cfg.get("project_address"):
            return 0
        address = cfg["project_address"]
        network = cfg.get("network", "mainnet")

        cursor = await session.scalar(select(ChainCursor).where(ChainCursor.key == address))
        last_lt = cursor.lt if cursor else 0

        txs = await _fetch_transactions(address, last_lt, network)
        count = 0
        max_lt = last_lt
        for tx in txs:
            tx_hash = tx.get("transaction_id", {}).get("hash", "")
            lt = int(tx.get("transaction_id", {}).get("lt", 0))
            if lt <= last_lt:
                continue
            in_msg = tx.get("in_msg", {})
            value = int(in_msg.get("value", 0))
            comment = in_msg.get("message", "")
            src = in_msg.get("source", "")
            if value > 0:
                await credit_deposit(
                    session,
                    tx_hash=tx_hash,
                    amount_nano=value,
                    memo=comment,
                    from_address=src,
                    lt=lt,
                    utime=int(tx.get("utime", 0)),
                    comment=comment,
                    now=now,
                )
                count += 1
            if lt > max_lt:
                max_lt = lt

        if cursor:
            cursor.lt = max_lt
        else:
            session.add(ChainCursor(key=address, lt=max_lt))
        await session.commit()
        return count
