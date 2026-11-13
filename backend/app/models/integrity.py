"""«Честность» (репутация) — журнал событий, из которого считается счёт пользователя.

Только добавление: строки не удаляются и не меняются, кроме статуса и полей аннулирования.
Теневой режим (R1): счёт копится, но ни на что не влияет и игрокам не показывается.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class IntegrityEvent(Base):
    __tablename__ = "integrity_events"
    __table_args__ = (
        UniqueConstraint("user_id", "event_type", "source_type", "source_id", name="uq_integrity_event_source"),
        Index("ix_integrity_events_user_created", "user_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    # уже с учётом лимитов (может быть 0)
    delta: Mapped[int] = mapped_column(Integer, nullable=False)
    # NULL — не затухает
    half_life_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # submission · task · manual
    source_type: Mapped[str | None] = mapped_column(String(24), nullable=True)
    source_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    # applied · pending_review · voided
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="applied", server_default="applied", index=True)
    voided_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    void_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
