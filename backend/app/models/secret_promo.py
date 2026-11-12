"""Секретный промокод в «Прогулке» (пасхалка): кампания, заранее разыгранные появления, активации, неудачные попытки.

Кампания опирается на обычный промокод (promo_codes): код, награда TON и лимит активаций — там же, ввод — в обычном
разделе «Промокод». Расписание появлений (secret_promo_appearances) никогда не уходит клиентам и не показывается
даже владельцу — в админке только счётчики.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SecretPromoCampaign(Base):
    __tablename__ = "secret_promo_campaigns"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    promo_id: Mapped[int] = mapped_column(ForeignKey("promo_codes.id", ondelete="CASCADE"), unique=True, nullable=False)
    days: Mapped[int] = mapped_column(Integer, nullable=False)
    per_day: Mapped[int] = mapped_column(Integer, nullable=False)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class SecretPromoAppearance(Base):
    __tablename__ = "secret_promo_appearances"
    __table_args__ = (Index("ix_secret_promo_appearances_time", "starts_at", "ends_at"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("secret_promo_campaigns.id", ondelete="CASCADE"), index=True, nullable=False)
    district: Mapped[str] = mapped_column(String(16), nullable=False)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class SecretPromoClaim(Base):
    """Одна активация на игрока в кампании: уникальность — страховка от двойного начисления при гонке."""

    __tablename__ = "secret_promo_claims"
    __table_args__ = (UniqueConstraint("campaign_id", "user_id", name="uq_secret_promo_claims_campaign_user"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("secret_promo_campaigns.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class PromoFailedAttempt(Base):
    """Неверный ввод промокода — для ограничения перебора (любые коды, не только секретные)."""

    __tablename__ = "promo_failed_attempts"
    __table_args__ = (Index("ix_promo_failed_attempts_user_time", "user_id", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
