"""User, XP, tokens for upgrade strategy."""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import BigInteger, Boolean, DateTime, Integer, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True, nullable=False)
    username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    first_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    language_code: Mapped[str | None] = mapped_column(String(16), nullable=True)

    balance: Mapped[Decimal] = mapped_column(Numeric(18, 8), default=Decimal("0"), nullable=False)

    xp: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    level: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    focus_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    block_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    success_boost_bp: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    referred_by_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    is_banned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_ambassador: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    miner = relationship("Miner", back_populates="user", uselist=False)
    balance_history = relationship("BalanceHistory", back_populates="user")
