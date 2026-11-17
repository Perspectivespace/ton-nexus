"""Ошибки клиента (Mini App): необработанные исключения и отклонённые промисы, сгруппированные по отпечатку.

Одна строка — одна «ошибка» (отпечаток: вид + сообщение + первая строка стека, после очистки).
Повторы увеличивают счётчик и время последнего случая. Персональных данных нет: сообщение и стек
очищаются от адресов, токенов, initData и чисел-сумм ещё на клиенте и повторно на сервере.
"""

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ClientError(Base):
    __tablename__ = "client_errors"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    fingerprint: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    # error · rejection · render
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    message: Mapped[str] = mapped_column(String(500), nullable=False)
    stack: Mapped[str | None] = mapped_column(Text, nullable=True)
    route: Mapped[str | None] = mapped_column(String(120), nullable=True)
    build: Mapped[str | None] = mapped_column(String(40), nullable=True)
    platform: Mapped[str | None] = mapped_column(String(120), nullable=True)
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    # сколько разных игроков столкнулось (точно до USERS_CAP, дальше — «не меньше»)
    users: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # внутренние id игроков через запятую, не больше USERS_CAP (для подсчёта разных; наружу не отдаются)
    user_ids: Mapped[str | None] = mapped_column(Text, nullable=True)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
