"""TON deposits: memo per user, toncenter v2 polling, crediting through services/balance.credit.

toncenter v2 `getTransactions` returns transactions of an account newest first.
`lt` + `hash` (always together) mean "start from this transaction and go back", the start
transaction included, so the next page repeats the last item of the previous one.
We walk pages back until we reach the stored cursor, then process oldest -> newest,
each transaction in its own savepoint. The cursor moves only to the last processed one.
"""

from __future__ import annotations

import base64
import binascii
import logging
import re
import secrets
import time
from datetime import datetime
from decimal import ROUND_DOWN, Decimal

import httpx
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings as app_settings
from app.models.deposit import ChainCursor, TonDeposit
from app.models.user import User
from app.services.balance import credit, get_user_for_update
from app.services.economy import get_setting
from app.services.gameday import now_utc
from app.services.ton_wallet import WalletError, normalize_address

logger = logging.getLogger(__name__)

NANO = Decimal("1000000000")
TONCENTER_MAINNET = "https://toncenter.com/api/v2"
TONCENTER_TESTNET = "https://testnet.toncenter.com/api/v2"
PAGE_LIMIT = 100  # toncenter v2 maximum
MAX_PAGES = 50  # 5000 transactions per poll at most
MEMO_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"  # base32 Crockford: no I, L, O, U
MEMO_LEN = 6
_MEMO_RE = re.compile(r"(?<![0-9A-Z])TN[0-9A-Z]{%d}(?![0-9A-Z])" % MEMO_LEN)
_CONFUSABLE = str.maketrans({"O": "0", "I": "1", "L": "1"})
_PG_LOCK_ID = 7_770_202  # pg advisory lock: one poller at a time


class DepositError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class ToncenterError(Exception):
    """Network / API failure. Never treated as an empty result."""


def _generate_memo() -> str:
    return "TN" + "".join(secrets.choice(MEMO_ALPHABET) for _ in range(MEMO_LEN))


def _normalize_memo(raw: str | None) -> str | None:
    """Find exactly TN + 6 chars as a separate word; O->0, I/L->1.

    "TNABC234 спасибо" -> TNABC234; "tn abc 234" (whole comment) -> TNABC234;
    "TNABC2345" or "XTNABC234" -> None.
    """
    if not raw:
        return None
    s = raw.upper()
    for cand in _MEMO_RE.finditer(s.translate(_CONFUSABLE)):
        return cand.group(0)
    compact = re.sub(r"[\s\-_]", "", s).translate(_CONFUSABLE)
    if _MEMO_RE.fullmatch(compact):
        return compact
    return None


async def ensure_memo(session: AsyncSession, user: User) -> str:
    if user.deposit_memo:
        return user.deposit_memo
    for _ in range(5):
        memo = _generate_memo()
        exists = await session.scalar(select(User.id).where(User.deposit_memo == memo))
        if not exists:
            user.deposit_memo = memo
            await session.flush()
            return memo
    raise DepositError("Не удалось создать мемо")


def _hash_hex(h: str) -> str:
    """toncenter v2 gives base64 hashes; store hex (64 chars) so it fits and links to explorers."""
    try:
        b = base64.b64decode(h, validate=True)
        if len(b) == 32:
            return b.hex()
    except (binascii.Error, ValueError):
        pass
    return h.lower()[:64]


def _raw_or_none(addr: str | None) -> str | None:
    if not addr:
        return None
    try:
        return normalize_address(addr)[0]
    except WalletError:
        return addr[:66]


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
    status: str | None = None,
    now: datetime | None = None,
) -> tuple[TonDeposit, bool]:
    """Record one incoming transfer, credit when matched. Idempotent by tx hash.

    Returns (deposit, created). `status` forces a non-credit status (e.g. "ignored").
    """
    now = now or now_utc()
    existing = await session.scalar(select(TonDeposit).where(TonDeposit.tx_hash == tx_hash))
    if existing:
        return existing, False

    amount = (Decimal(int(amount_nano)) / NANO).quantize(Decimal("0.00000001"), rounding=ROUND_DOWN)
    cfg = await get_setting(session, "ton_deposits") or {}
    min_ton = Decimal(str(cfg.get("min_ton", "0.1")))
    memo_norm = _normalize_memo(memo)

    user = None
    if status is None:
        status = "unmatched"
        if memo_norm:
            user = await session.scalar(select(User).where(User.deposit_memo == memo_norm))
            if user:
                status = "credited" if amount >= min_ton else "below_min"

    dep = TonDeposit(
        tx_hash=tx_hash,
        user_id=user.id if user else None,
        amount_ton=amount,
        amount_nano=int(amount_nano),
        memo=memo_norm,
        comment=(comment or None) and comment[:255],
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
    return dep, True


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
    if dep.status not in ("unmatched", "below_min"):
        raise DepositError("Этот перевод нельзя зачислить")
    await get_user_for_update(session, user_id)
    dep.user_id = user_id
    dep.status = "manual"
    dep.credited_at = now_utc()
    dep.note = (f"actor={actor.id}; {note or ''}")[:255]
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


async def _fetch_transactions(
    address: str, network: str, *, limit: int = PAGE_LIMIT, lt: int | None = None, tx_hash: str | None = None
) -> list[dict]:
    """One toncenter v2 getTransactions page (newest first). Raises ToncenterError on any failure."""
    base = TONCENTER_TESTNET if network == "testnet" else TONCENTER_MAINNET
    params: dict[str, str | int] = {"address": address, "limit": limit, "archival": "true"}
    if lt is not None and tx_hash:
        params["lt"] = lt
        params["hash"] = tx_hash
    headers = {"X-API-Key": app_settings.toncenter_api_key} if app_settings.toncenter_api_key else {}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(f"{base}/getTransactions", params=params, headers=headers)
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        raise ToncenterError(f"toncenter request failed: {type(e).__name__}") from e
    if not isinstance(data, dict) or not data.get("ok") or not isinstance(data.get("result"), list):
        raise ToncenterError(f"toncenter error: {str(data.get('error') if isinstance(data, dict) else data)[:200]}")
    return data["result"]


def _txid(tx: dict) -> tuple[int, str]:
    tid = tx.get("transaction_id") or {}
    return int(tid.get("lt") or 0), str(tid.get("hash") or "")


async def _collect_new(address: str, network: str, cursor_lt: int, cursor_hash: str | None) -> list[dict]:
    """All transactions newer than the cursor, newest first (walks lt+hash pages back)."""
    out: list[dict] = []
    seen: set[tuple[int, str]] = set()
    lt = h = None
    for _ in range(MAX_PAGES):
        page = await _fetch_transactions(address, network, lt=lt, tx_hash=h)
        reached = False
        fresh = 0
        for tx in page:
            tid = _txid(tx)
            if tid in seen:
                continue  # page start repeats the previous page's last item
            if tid[0] <= cursor_lt:  # lt is unique per account: lt == cursor means the cursor transaction
                if tid[0] == cursor_lt and cursor_hash and _hash_hex(tid[1]) != cursor_hash:
                    logger.warning("ton deposits: cursor hash mismatch at lt=%s", cursor_lt)
                reached = True
                break
            seen.add(tid)
            out.append(tx)
            fresh += 1
        if reached or len(page) < PAGE_LIMIT or fresh == 0:
            return out
        lt, h = _txid(page[-1])
    logger.error("ton deposits: cursor not reached after %d pages, older transactions skipped", MAX_PAGES)
    return out


def _parse_incoming(tx: dict) -> dict | None:
    """Incoming internal transfer worth recording, or None. Adds `ignore` for bounced/aborted ones."""
    in_msg = tx.get("in_msg") or {}
    src = in_msg.get("source") or ""
    value = int(in_msg.get("value") or 0)
    if not src or value <= 0:
        return None  # external message (our own outgoing) or zero value
    data = in_msg.get("msg_data") or {}
    comment = in_msg.get("message") if data.get("@type", "msg.dataText") == "msg.dataText" else None
    ignore = bool(in_msg.get("bounced")) or bool(tx.get("out_msgs"))  # wallet answers an internal msg only by bounce
    return {"value": value, "source": src, "comment": comment or None, "ignore": ignore}


async def _try_lock(session: AsyncSession) -> bool:
    if session.bind.dialect.name != "postgresql":
        return True
    return bool(await session.scalar(text("SELECT pg_try_advisory_xact_lock(:k)"), {"k": _PG_LOCK_ID}))


async def poll_once(session_factory, *, now: datetime | None = None) -> int:
    """Poll toncenter once. Returns the number of new deposit rows.

    First run (no cursor): remember the newest transaction (lt=0 for an empty wallet) and
    credit nothing from older history. A toncenter error leaves everything untouched.
    """
    async with session_factory() as session:
        cfg = await get_setting(session, "ton_deposits") or {}
        if not cfg.get("enabled") or not cfg.get("project_address"):
            return 0
        wallet_cfg = await get_setting(session, "ton_wallet") or {}
        network = wallet_cfg.get("network", "mainnet")
        try:
            raw_addr, _ = normalize_address(cfg["project_address"])
        except WalletError:
            logger.error("ton deposits: invalid project address in settings")
            return 0
        if not await _try_lock(session):
            return 0

        cursor = await session.scalar(select(ChainCursor).where(ChainCursor.key == raw_addr).with_for_update())
        try:
            if cursor is None:
                page = await _fetch_transactions(raw_addr, network, limit=1)
                lt, h = _txid(page[0]) if page else (0, "")
                session.add(ChainCursor(key=raw_addr, lt=lt, last_hash=_hash_hex(h) if h else None))
                await session.commit()
                return 0
            txs = await _collect_new(raw_addr, network, int(cursor.lt or 0), cursor.last_hash)
        except ToncenterError as e:
            logger.warning("ton deposits: %s", e)
            await session.rollback()
            return 0

        count = 0
        for tx in reversed(txs):  # oldest first
            lt, h = _txid(tx)
            try:
                async with session.begin_nested():
                    parsed = _parse_incoming(tx)
                    if parsed:
                        _, created = await credit_deposit(
                            session,
                            tx_hash=_hash_hex(h),
                            amount_nano=parsed["value"],
                            memo=parsed["comment"],
                            from_address=_raw_or_none(parsed["source"]),
                            lt=lt,
                            utime=int(tx.get("utime") or 0),
                            comment=parsed["comment"],
                            status="ignored" if parsed["ignore"] else None,
                            now=now,
                        )
                        count += int(created)
            except IntegrityError:
                logger.info("ton deposits: tx %s already recorded", h)
            except Exception:
                logger.exception("ton deposits: tx lt=%s failed, will retry on next poll", lt)
                break
            cursor.lt = lt
            cursor.last_hash = _hash_hex(h)
        await session.commit()
        return count


_last_manual_poll = 0.0
MANUAL_POLL_INTERVAL = 10.0


async def poll_if_due(session_factory) -> bool:
    """Poll on a user's «Проверить» tap, not more often than every MANUAL_POLL_INTERVAL seconds."""
    global _last_manual_poll
    t = time.monotonic()
    if t - _last_manual_poll < MANUAL_POLL_INTERVAL:
        return False
    _last_manual_poll = t
    try:
        await poll_once(session_factory)
    except Exception:
        logger.exception("ton deposits: manual poll failed")
    return True
