"""TON wallet linking via TON Connect ton_proof.

Verification follows docs.ton.org and ton-connect/demo-dapp-backend (proof.go, state_init.go):
- message = "ton-proof-item-v2/" + workchain(int32 BE) + address_hash(32) + domain_len(uint32 LE) + domain + timestamp(uint64 LE) + payload
- signed = sha256(b"\\xff\\xff" + b"ton-connect" + sha256(message))
- Ed25519 verify with public key extracted from StateInit data (known wallet code hashes).

Code hashes from tonkeeper/tongo wallet package (via demo-dapp-backend state_init.go).
"""

from __future__ import annotations

import base64
import hashlib
import logging
import secrets
from datetime import datetime, timedelta

import nacl.signing
from pytoniq_core import Address, Cell
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings as app_settings
from app.models.user import User
from app.models.wallet import TonProofNonce, UserWallet
from app.models.withdraw import WithdrawRequest
from app.services.balance import get_user_for_update
from app.services.economy import get_setting
from app.services.gameday import now_utc

logger = logging.getLogger(__name__)

# Code hashes of known wallet versions (hex).
# Source: tonkeeper/tongo wallet.GetCodeHashByVer and ton-connect/demo-dapp-backend state_init.go.
# v3r1/v3r2/v4r2 data layout: seqno:32 subwallet:32 pubkey:256
# v5r1 data layout: is_signature_allowed:1 seqno:32 wallet_id:32 pubkey:256
# Source: tonkeeper/tongo wallet.GetCodeHashByVer / ton-connect demo-dapp-backend.
# Verified by computing Cell.hash of the official wallet code BOCs.
KNOWN_CODE_HASHES = {
    "b61041a58a7980b946e8fb9e198e3c904d24799ffa36574ea4251c41a566f581": "v3r1",
    "84dafa449f98a6987789ba232358072bc0f76dc4524002a5d0918b9a75d2d599": "v3r2",
    "feb5ff6820e2ff0d9483e7e0d62c817d846789fb4ae580c878866d959dabd5c0": "v4r2",
    "20834b7b72b112147e1b2fb457b84e74d1a30f04f737d4f62a668e9552d2b72f": "v5r1",
}


class WalletError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


def _domain_from_webapp() -> str:
    url = (app_settings.webapp_url or "").rstrip("/")
    if "://" in url:
        url = url.split("://", 1)[1]
    return url.split("/")[0]


async def create_proof_payload(session: AsyncSession, *, user: User, now: datetime | None = None) -> dict:
    now = now or now_utc()
    cfg = await get_setting(session, "ton_wallet") or {}
    ttl = int(cfg.get("proof_ttl_minutes", 15))
    payload = secrets.token_hex(32)
    expires = now + timedelta(minutes=ttl)
    row = TonProofNonce(user_id=user.id, payload=payload, expires_at=expires)
    session.add(row)
    await session.flush()
    return {"payload": payload, "expires_at": expires.isoformat()}


async def active_wallet(session: AsyncSession, user_id: int) -> UserWallet | None:
    return await session.scalar(
        select(UserWallet).where(UserWallet.user_id == user_id, UserWallet.unlinked_at.is_(None))
    )


async def unlink_wallet(session: AsyncSession, *, user: User, now: datetime | None = None) -> None:
    now = now or now_utc()
    pending = await session.scalar(
        select(WithdrawRequest).where(
            WithdrawRequest.user_id == user.id,
            WithdrawRequest.status == "pending",
        )
    )
    if pending:
        raise WalletError("Нельзя отвязать кошелёк, пока заявка на вывод на проверке")
    wallet = await active_wallet(session, user.id)
    if not wallet:
        raise WalletError("Кошелёк не привязан")
    wallet.unlinked_at = now
    await session.flush()


def _extract_pubkey_from_stateinit(state_init_b64: str, expected_address_raw: str) -> str:
    """Parse StateInit, verify its hash matches the address, extract pubkey from data.
    Returns pubkey hex. Raises WalletError.
    """
    try:
        cell = Cell.one_from_boc(state_init_b64)
    except Exception as e:
        raise WalletError("Этот кошелёк пока не поддерживается") from e

    state_hash = cell.hash.hex()
    addr_hash = expected_address_raw.split(":")[1] if ":" in expected_address_raw else expected_address_raw
    if state_hash != addr_hash:
        raise WalletError("Адрес не совпадает с данными кошелька")

    # Get code hash from first ref (code cell)
    code_hash = None
    if cell.refs and len(cell.refs) >= 1:
        code_hash = cell.refs[0].hash.hex()

    version = KNOWN_CODE_HASHES.get(code_hash or "")
    if not version:
        # Unknown code — would call get_public_key via toncenter here (task 02 adds API key).
        # For now reject.
        raise WalletError("Этот кошелёк пока не поддерживается")

    try:
        if cell.refs and len(cell.refs) >= 2:
            data_cell = cell.refs[1]
            ds = data_cell.begin_parse()
            if version in ("v3r1", "v3r2", "v4r2"):
                # seqno:32 subwallet:32 pubkey:256
                ds.skip_bits(64)
                pubkey = ds.load_bytes(32)
            elif version == "v5r1":
                # is_signature_allowed:1 seqno:32 wallet_id:32 pubkey:256
                ds.skip_bits(1 + 32 + 32)
                pubkey = ds.load_bytes(32)
            else:
                raise WalletError("Этот кошелёк пока не поддерживается")
            return pubkey.hex()
    except WalletError:
        raise
    except Exception as e:
        logger.warning("StateInit data parse failed: %s", e)

    raise WalletError("Этот кошелёк пока не поддерживается")


def _verify_ton_proof(account: dict, proof: dict, expected_domain: str, ttl_minutes: int, now: datetime, expected_network: str) -> tuple[str, str, str]:
    """Returns (address_raw, address_uq, public_key_hex). Raises WalletError."""
    # Timestamp
    ts = int(proof.get("timestamp", 0))
    now_ts = int(now.timestamp())
    if ts > now_ts + 60:
        raise WalletError("Время подтверждения из будущего")
    if now_ts - ts > ttl_minutes * 60:
        raise WalletError("Время подтверждения истекло")

    # Domain
    domain = proof.get("domain", {})
    domain_value = domain.get("value", "")
    domain_len = domain.get("lengthBytes", 0)
    if domain_value != expected_domain or domain_len != len(domain_value.encode("utf-8")):
        raise WalletError("Домен подтверждения не совпадает")

    # Network strict
    net = str(account.get("network", ""))
    if expected_network == "mainnet" and net != "-239":
        raise WalletError("Сеть кошелька не совпадает с настройками")
    if expected_network == "testnet" and net != "-3":
        raise WalletError("Сеть кошелька не совпадает с настройками")

    # Address
    raw = account.get("address", "")
    if not raw or ":" not in raw:
        raise WalletError("Некорректный адрес")
    try:
        addr = Address(raw)
        address_raw = addr.to_str(is_user_friendly=False)
        address_uq = addr.to_str(is_user_friendly=True, is_bounceable=False)
    except Exception as e:
        raise WalletError("Некорректный адрес") from e

    # StateInit required
    state_init_b64 = account.get("walletStateInit")
    if not state_init_b64:
        raise WalletError("Этот кошелёк пока не поддерживается")

    pubkey_hex = _extract_pubkey_from_stateinit(state_init_b64, address_raw)

    # If account.publicKey provided, it must match
    provided_pk = account.get("publicKey") or ""
    if provided_pk and provided_pk.lower() != pubkey_hex.lower():
        raise WalletError("Публичный ключ не совпадает")

    # Signature
    try:
        workchain = int(raw.split(":")[0])
        addr_hash = bytes.fromhex(raw.split(":")[1])
        domain_bytes = domain_value.encode("utf-8")
        message = (
            b"ton-proof-item-v2/"
            + workchain.to_bytes(4, "big", signed=True)
            + addr_hash
            + len(domain_bytes).to_bytes(4, "little")
            + domain_bytes
            + ts.to_bytes(8, "little")
            + proof["payload"].encode("utf-8")
        )
        signed = hashlib.sha256(b"\xff\xff" + b"ton-connect" + hashlib.sha256(message).digest()).digest()
        sig = proof["signature"]
        if isinstance(sig, str):
            try:
                sig = base64.b64decode(sig)
            except Exception:
                sig = bytes.fromhex(sig)
        pk = bytes.fromhex(pubkey_hex)
        nacl.signing.VerifyKey(pk).verify(signed, sig)
    except WalletError:
        raise
    except Exception as e:
        logger.warning("ton_proof verify failed: %s", e)
        raise WalletError("Подпись не прошла проверку") from e

    return address_raw, address_uq, pubkey_hex


async def link_wallet(
    session: AsyncSession,
    *,
    user: User,
    account: dict,
    proof: dict,
    wallet_app: str | None = None,
    now: datetime | None = None,
) -> UserWallet:
    now = now or now_utc()
    await get_user_for_update(session, user.id)

    cfg = await get_setting(session, "ton_wallet") or {}
    if not cfg.get("enabled", True):
        raise WalletError("Привязка кошелька временно отключена")

    ttl = int(cfg.get("proof_ttl_minutes", 15))
    expected_domain = _domain_from_webapp()
    expected_network = cfg.get("network", "mainnet")

    payload_str = proof.get("payload")
    if not payload_str:
        raise WalletError("Неверные данные подтверждения")
    nonce = await session.scalar(select(TonProofNonce).where(TonProofNonce.payload == payload_str))
    if not nonce or nonce.user_id != user.id:
        raise WalletError("Неверные данные подтверждения")
    if nonce.used_at is not None:
        raise WalletError("Подтверждение уже использовано")
    if nonce.expires_at < now:
        raise WalletError("Время подтверждения истекло")

    result = await session.execute(
        update(TonProofNonce)
        .where(TonProofNonce.id == nonce.id, TonProofNonce.used_at.is_(None))
        .values(used_at=now)
    )
    if result.rowcount == 0:
        raise WalletError("Подтверждение уже использовано")

    address_raw, address_uq, pubkey = _verify_ton_proof(account, proof, expected_domain, ttl, now, expected_network)

    if cfg.get("unique_address", True):
        other = await session.scalar(
            select(UserWallet).where(
                UserWallet.address_raw == address_raw,
                UserWallet.unlinked_at.is_(None),
                UserWallet.user_id != user.id,
            )
        )
        if other:
            raise WalletError("Этот кошелёк уже привязан к другому аккаунту")

    existing = await active_wallet(session, user.id)
    if existing and existing.address_raw == address_raw:
        return existing
    if existing:
        existing.unlinked_at = now

    new = UserWallet(
        user_id=user.id,
        address_raw=address_raw,
        address=address_uq,
        network=expected_network,
        wallet_app=wallet_app,
        public_key=pubkey,
        linked_at=now,
        proof_nonce_id=nonce.id,
    )
    session.add(new)
    await session.flush()
    return new
