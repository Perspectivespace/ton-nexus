"""User TON wallet bindings (TON Connect + ton_proof)."""

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class UserWallet(Base):
    __tablename__ = "user_wallets"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    address_raw: Mapped[str] = mapped_column(String(66), nullable=False, index=True)  # 0:hex
    address: Mapped[str] = mapped_column(String(48), nullable=False)  # UQ… non-bounceable
    network: Mapped[str] = mapped_column(String(16), nullable=False)  # mainnet / testnet
    wallet_app: Mapped[str | None] = mapped_column(String(64), nullable=True)
    public_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    linked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    unlinked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    proof_nonce_id: Mapped[int | None] = mapped_column(Integer, nullable=True)


class TonProofNonce(Base):
    __tablename__ = "ton_proof_nonces"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    payload: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
