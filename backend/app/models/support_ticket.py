"""Обращения игроков в поддержку (services/support_tickets.py)."""

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# bug — ошибка; payment — пополнение или вывод; idea — предложение; other — другое
CATEGORIES = ("bug", "payment", "idea", "other")
# open — новое; answered — есть ответ поддержки; closed — закрыто в закрытом чате
STATUSES = ("open", "answered", "closed")


class SupportTicket(Base):
    __tablename__ = "support_tickets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(16), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    has_screenshot: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="open", server_default="open", nullable=False, index=True)
    # закрытый чат, куда ушла карточка тикета (для реплая бота)
    chat_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    chat_message_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    reply_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    replied_by_tg_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    replied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
