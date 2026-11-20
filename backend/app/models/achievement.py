"""Достижения игрока: полученные ступени веток (services/achievements.py)."""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Numeric, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# paid — получено (TON и XP начислены, если были); pending — ждёт подтверждения владельца (крупная награда);
# rejected — владелец отклонил награду (ступень остаётся пройденной); baseline — пройдено до «старта с нуля», без награды
AWARD_STATUSES = ("paid", "pending", "rejected", "baseline")


class AchievementAward(Base):
    __tablename__ = "achievement_awards"
    __table_args__ = (
        UniqueConstraint("user_id", "branch", "tier", name="uq_achievement_awards_user_branch_tier"),
        Index("ix_achievement_awards_branch_tier", "branch", "tier"),
        Index("ix_achievement_awards_status", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    branch: Mapped[str] = mapped_column(String(16), nullable=False)
    # порог ступени (at) на момент получения: 10 заданий, 25-й уровень майнера…
    tier: Mapped[int] = mapped_column(Integer, nullable=False)
    ton: Mapped[Decimal] = mapped_column(Numeric(18, 8), nullable=False, default=Decimal("0"), server_default="0")
    xp: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="paid", server_default="paid")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    # сообщение в боте отправлено (или не нужно); пусто — ждёт рассылки
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # праздничное окно в приложении показано; пусто — покажем при следующем входе
    seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
