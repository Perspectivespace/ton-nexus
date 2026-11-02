"""TON payouts: the owner pays withdraw requests from the payout wallet via TON Connect.

Flow: GET /withdraw/{id}/tx-payload builds the transfer (destination = request wallet, amount in
nanotons, text comment «TN payout #<id>») and moves the request to `sending`. The wallet signs and
sends it. The server confirms on its own: it reads OUTGOING transactions of the payout wallet from
toncenter v2 (same client as deposits) and closes a request only when an out message has the exact
comment, destination and amount. Fallback: the owner pastes a transaction hash, the server finds it
in the payout wallet history and checks the same. A transaction hash closes at most one request.

While a payload is in flight (INFLIGHT) a second one is refused; the owner may override explicitly.
The wallet message itself expires after VALID_FOR (< INFLIGHT), so after INFLIGHT the first transfer
can no longer appear — but before re-issuing or rejecting we still look at the chain once more.
"""

from __future__ import annotations

import base64
import binascii
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from pytoniq_core import begin_cell
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.withdraw import OPEN_STATUSES, WithdrawRequest
from app.services import ton_deposits as td
from app.services import withdraw as withdraw_svc
from app.services.economy import get_setting
from app.services.roles import is_admin, is_platform_owner
from app.services.ton_wallet import WalletError, normalize_address

logger = logging.getLogger(__name__)

VALID_FOR = timedelta(minutes=5)  # TON Connect validUntil: after it the wallet will not send the message
INFLIGHT = timedelta(minutes=10)  # second payload for the same request is refused for this long
SCAN_MARGIN = timedelta(minutes=2)  # chain clocks / payload issued slightly before signing
MAX_PAGES = 20  # 2000 transactions of the payout wallet per scan at most
_COMMENT_RE = re.compile(r"^TN payout #(\d+)$")


def payout_comment(request_id: int) -> str:
    return f"TN payout #{request_id}"


class PayoutError(Exception):
    """User-facing error with an HTTP status for the API."""

    def __init__(self, message: str, status: int = 400):
        self.message = message
        self.status = status
        super().__init__(message)


@dataclass
class PayoutConfig:
    enabled: bool
    wallet_raw: str | None
    wallet: str  # friendly UQ…, for the network in ton_wallet.network
    network: str


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _now(now: datetime | None) -> datetime:
    return _aware(now) or datetime.now(timezone.utc)


def _nano(amount) -> int:
    return int(Decimal(amount) * td.NANO)


def _raw(addr: str) -> str | None:
    try:
        return normalize_address(addr)[0]
    except WalletError:
        return None


async def get_config(session: AsyncSession) -> PayoutConfig:
    cfg = await get_setting(session, "ton_payouts") or {}
    network = (await get_setting(session, "ton_wallet") or {}).get("network", "mainnet")
    addr = str(cfg.get("payout_wallet") or "")
    raw = friendly = None
    if addr:
        try:
            raw, friendly = normalize_address(addr, testnet=network == "testnet")
        except WalletError:
            logger.error("ton payouts: invalid payout wallet in settings")
    return PayoutConfig(enabled=bool(cfg.get("enabled")) and bool(raw), wallet_raw=raw, wallet=friendly or "", network=network)


def _require_staff(actor) -> None:
    if not (is_platform_owner(actor) or is_admin(actor)):
        raise PayoutError("Только владелец или администратор", 403)


async def _require_config(session: AsyncSession) -> PayoutConfig:
    cfg = await get_config(session)
    if not cfg.enabled:
        raise PayoutError("Выплаты TON выключены: укажите кошелёк выплат в настройках «Выплаты TON»", 400)
    return cfg


async def _lock_request(session: AsyncSession, request_id: int) -> WithdrawRequest:
    req = await session.scalar(
        select(WithdrawRequest)
        .where(WithdrawRequest.id == request_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if not req:
        raise PayoutError("Заявка не найдена", 404)
    return req


# ---------- chain ----------


def parse_outgoing(tx: dict) -> list[dict]:
    """Out messages of a payout wallet transaction: destination raw, value (nano), text comment."""
    out = []
    for m in tx.get("out_msgs") or []:
        data = m.get("msg_data") or {}
        comment = m.get("message") if data.get("@type", "msg.dataText") == "msg.dataText" else None
        out.append({
            "destination": _raw(m.get("destination") or ""),
            "value": int(m.get("value") or 0),
            "comment": (comment or "").strip(),
        })
    return out


async def _scan(cfg: PayoutConfig, since: datetime) -> list[dict]:
    """Payout wallet transactions newer than `since` (newest first). Raises td.ToncenterError."""
    out: list[dict] = []
    seen: set[tuple[int, str]] = set()
    lt = h = None
    floor = int((since - SCAN_MARGIN).timestamp())
    for _ in range(MAX_PAGES):
        page = await td._fetch_transactions(cfg.wallet_raw, cfg.network, lt=lt, tx_hash=h)
        fresh = 0
        for tx in page:
            tid = td._txid(tx)
            if tid in seen:
                continue
            if int(tx.get("utime") or 0) < floor:
                return out
            seen.add(tid)
            out.append(tx)
            fresh += 1
        if len(page) < td.PAGE_LIMIT or fresh == 0:
            return out
        lt, h = td._txid(page[-1])
    logger.error("ton payouts: scan stopped after %d pages", MAX_PAGES)
    return out


def _pays(msg: dict, req: WithdrawRequest) -> bool:
    return msg["destination"] is not None and msg["destination"] == _raw(req.wallet_address) and msg["value"] == _nano(req.amount)


async def _hash_used(session: AsyncSession, tx_hash: str, request_id: int) -> bool:
    other = await session.scalar(select(WithdrawRequest.id).where(WithdrawRequest.tx_hash == tx_hash, WithdrawRequest.id != request_id))
    return other is not None


def _mark_paid(req: WithdrawRequest, tx_hash: str, utime: int, now: datetime, note: str | None = None) -> None:
    req.status = "paid"
    req.tx_hash = tx_hash
    req.paid_at = datetime.fromtimestamp(utime, timezone.utc) if utime else now
    req.reviewed_at = now
    if note:
        req.admin_note = note


async def _apply(session: AsyncSession, txs: list[dict], reqs: dict[int, WithdrawRequest], now: datetime) -> list[int]:
    """Close requests whose comment, destination and amount match an out message. Idempotent."""
    paid: list[int] = []
    for tx in reversed(txs):  # oldest first: the first matching transfer wins
        h = td._hash_hex(td._txid(tx)[1])
        for msg in parse_outgoing(tx):
            m = _COMMENT_RE.match(msg["comment"])
            if not m:
                continue
            req = reqs.get(int(m.group(1)))
            if req is None or req.status not in OPEN_STATUSES:
                continue
            if not _pays(msg, req):
                logger.warning("ton payouts: tx %s comment #%s but destination/amount differ", h, req.id)
                continue
            if await _hash_used(session, h, req.id):
                continue
            _mark_paid(req, h, int(tx.get("utime") or 0), now)
            paid.append(req.id)
    if paid:
        await session.flush()
    return paid


async def check(session: AsyncSession, *, request_ids: list[int] | None = None, now: datetime | None = None) -> list[int]:
    """Look at the chain for open requests (default: those in `sending`). Raises td.ToncenterError.

    Returns ids marked paid. Caller commits.
    """
    now = _now(now)
    cfg = await get_config(session)
    if not cfg.wallet_raw:
        return []
    q = select(WithdrawRequest).with_for_update().execution_options(populate_existing=True)
    if request_ids is None:
        q = q.where(WithdrawRequest.status == "sending")
    else:
        q = q.where(WithdrawRequest.id.in_(request_ids), WithdrawRequest.status.in_(OPEN_STATUSES))
    reqs = {r.id: r for r in (await session.scalars(q)).all()}
    if not reqs:
        return []
    since = min(_aware(r.payout_started_at) or _aware(r.created_at) or now for r in reqs.values())
    txs = await _scan(cfg, since)
    return await _apply(session, txs, reqs, now)


async def poll_once(session_factory, *, now: datetime | None = None) -> int:
    """Background confirmation: one scan if anything is in `sending`."""
    async with session_factory() as session:
        try:
            paid = await check(session, now=now)
        except td.ToncenterError as e:
            logger.warning("ton payouts: %s", e)
            await session.rollback()
            return 0
        await session.commit()
        return len(paid)


# ---------- owner actions ----------


async def issue_payload(session: AsyncSession, *, actor, request_id: int, force: bool = False, now: datetime | None = None) -> dict:
    """Transfer for TON Connect; moves the request to `sending`. Caller commits."""
    _require_staff(actor)
    now = _now(now)
    cfg = await _require_config(session)
    req = await _lock_request(session, request_id)
    if req.status not in OPEN_STATUSES:
        raise PayoutError("Заявка уже закрыта", 409)
    if force and not is_platform_owner(actor):
        raise PayoutError("Повторную выплату подтверждает только владелец", 403)
    started = _aware(req.payout_started_at)
    if req.status == "sending" and started and not force:
        if now - started < INFLIGHT:
            raise PayoutError("Выплата уже отправлена — дождитесь подтверждения сети или нажмите «Проверить»", 409)
        # окно истекло: прежний перевод уже не появится, но мог пройти незамеченным — смотрим сеть
        try:
            paid = await _apply(session, await _scan(cfg, started), {req.id: req}, now)
        except td.ToncenterError as e:
            raise PayoutError("Не удалось проверить сеть — повторите позже", 503) from e
        if paid:
            raise PayoutError("Перевод уже найден в сети — заявка выплачена", 409)
    try:
        dest = normalize_address(req.wallet_address, testnet=cfg.network == "testnet")[1]
    except WalletError as e:
        raise PayoutError("Неверный адрес получателя в заявке", 400) from e
    comment = payout_comment(req.id)
    cell = begin_cell().store_uint(0, 32).store_snake_string(comment).end_cell()
    req.status = "sending"
    req.payout_started_at = now
    await session.flush()
    return {
        "id": req.id,
        "to": dest,
        "amount_nano": str(_nano(req.amount)),
        "payload": base64.b64encode(cell.to_boc()).decode(),
        "comment": comment,
        "valid_until": int((now + VALID_FOR).timestamp()),
        "network": cfg.network,
        "payout_wallet": cfg.wallet,
        "payout_wallet_raw": cfg.wallet_raw,
    }


def _parse_hash(value: str) -> str:
    v = (value or "").strip()
    m = re.search(r"([0-9a-fA-F]{64})", v)  # hex or a tonviewer link
    if m:
        return m.group(1).lower()
    for dec in (base64.b64decode, base64.urlsafe_b64decode):
        try:
            b = dec(v + "=" * (-len(v) % 4))
        except (binascii.Error, ValueError):
            continue
        if len(b) == 32:
            return b.hex()
    raise PayoutError("Хеш транзакции: 64 hex-символа или base64", 400)


async def verify_hash(session: AsyncSession, *, actor, request_id: int, tx_hash: str, now: datetime | None = None) -> WithdrawRequest:
    """Manual fallback: find the transaction in the payout wallet history and check it pays this request."""
    _require_staff(actor)
    now = _now(now)
    h = _parse_hash(tx_hash)
    cfg = await _require_config(session)
    req = await _lock_request(session, request_id)
    if req.status == "paid" and req.tx_hash == h:
        return req  # уже подтверждено этим же переводом
    if req.status not in OPEN_STATUSES:
        raise PayoutError("Заявка уже закрыта", 409)
    if await _hash_used(session, h, req.id):
        raise PayoutError("Этот перевод уже закрыл другую заявку", 409)
    try:
        txs = await _scan(cfg, _aware(req.created_at) or now)
    except td.ToncenterError as e:
        raise PayoutError("Не удалось проверить сеть — повторите позже", 503) from e
    tx = next((t for t in txs if td._hash_hex(td._txid(t)[1]) == h), None)
    if tx is None:
        raise PayoutError("Транзакция не найдена среди исходящих кошелька выплат после создания заявки", 400)
    msgs = parse_outgoing(tx)
    ok = [m for m in msgs if _pays(m, req)]
    if not ok:
        raise PayoutError("Перевод не совпадает с заявкой: другой адрес получателя или сумма", 400)
    for m in ok:
        other = _COMMENT_RE.match(m["comment"])
        if other and int(other.group(1)) != req.id:
            raise PayoutError(f"Перевод подписан для другой заявки (#{other.group(1)})", 400)
    _mark_paid(req, h, int(tx.get("utime") or 0), now, note="Подтверждено по хешу транзакции")
    req.reviewed_by_telegram_id = actor.telegram_id
    await session.flush()
    return req


async def reject(session: AsyncSession, *, actor, request_id: int, note: str | None, now: datetime | None = None):
    """Reject with refund. A `sending` request is rejected only after INFLIGHT and a clean chain check."""
    _require_staff(actor)
    now = _now(now)
    req = await _lock_request(session, request_id)
    if req.status == "sending":
        started = _aware(req.payout_started_at) or now
        if now - started < INFLIGHT:
            raise PayoutError("Выплата в процессе — отклонить можно через 10 минут после отправки", 409)
        cfg = await get_config(session)
        if cfg.wallet_raw:
            try:
                paid = await _apply(session, await _scan(cfg, started), {req.id: req}, now)
            except td.ToncenterError as e:
                raise PayoutError("Не удалось проверить сеть — повторите позже", 503) from e
            if paid:
                raise PayoutError("Перевод найден в сети — заявка выплачена, возврат не нужен", 409)
    return await withdraw_svc.review(session, actor=actor, request_id=request_id, approve=False, note=note, allow_sending=True)
