"""Single-slot miner + upgrade audit."""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Miner(Base):
    """One miner per user (MVP: single slot)."""

    __tablename__ = "miners"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True
    )

    power: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    acceleration: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    luck: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    stability: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    status: Mapped[str] = mapped_column(String(16), default="idle", nullable=False)
    session_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    session_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    pending_reward: Mapped[Decimal] = mapped_column(
        Numeric(18, 8), default=Decimal("0"), nullable=False
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    user = relationship("User", back_populates="miner")
    upgrades = relationship("MinerUpgradeLog", back_populates="miner")


class MinerUpgradeLog(Base):
    """Audit: type wheel → success wheel, burn on fail."""

    __tablename__ = "miner_upgrade_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    miner_id: Mapped[int] = mapped_column(ForeignKey("miners.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    cost: Mapped[Decimal] = mapped_column(Numeric(18, 8), nullable=False)
    upgrade_type: Mapped[str] = mapped_column(String(32), nullable=False)
    success_chance_bp: Mapped[int] = mapped_column(Integer, nullable=False)
    rolled_success: Mapped[bool] = mapped_column(Boolean, nullable=False)
    used_focus: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    used_block_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    meta: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    miner = relationship("Miner", back_populates="upgrades")
