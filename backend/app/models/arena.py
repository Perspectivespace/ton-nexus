"""«Арена»: комнаты и места игроков со ставкой в холде (эскроу).

Суммы — в нанотонах (целые, BigInteger): 1 TON = 10^9. Баланс пользователя хранится в TON с 8 знаками,
поэтому все суммы, которые проходят через balance.credit/debit, кратны 10 нанотонам (см. services/arena_escrow).
Журнал ходов и сам бой — в следующих PR (движок, цикл ходов).
"""

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# waiting — набор игроков; running — бой идёт, ставки заморожены; finished — призы выплачены;
# refunded — не набралась за время набора, ставки возвращены; cancelled — отменена, ставки возвращены
ROOM_STATUSES = ("waiting", "running", "finished", "refunded", "cancelled")
# held — ставка в холде; paid — получил приз; lost — без приза; refunded — ставка возвращена
ENTRY_STATUSES = ("held", "paid", "lost", "refunded")


class ArenaRoom(Base):
    __tablename__ = "arena_rooms"
    __table_args__ = (Index("ix_arena_rooms_type_status", "room_type", "status"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    # тип комнаты из services/arena_config.ARENA_ROOMS: "a4" | "a8"
    room_type: Mapped[str] = mapped_column(String(8), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="waiting", server_default="waiting")
    seats: Mapped[int] = mapped_column(Integer, nullable=False)
    # условия фиксируются при создании комнаты: смена настроек не меняет уже открытые комнаты
    stake_nano: Mapped[int] = mapped_column(BigInteger, nullable=False)
    commission_bps: Mapped[int] = mapped_column(Integer, nullable=False)
    # seed карты (uint32, как у движка) и commit–reveal: seed_hash = sha256("<salt>:<seed>") показывается до боя,
    # seed и соль раскрываются после. Соль нужна, иначе 2^32 вариантов seed перебираются по хэшу за секунды.
    seed: Mapped[int] = mapped_column(BigInteger, nullable=False)
    seed_salt: Mapped[str] = mapped_column(String(32), nullable=False)
    seed_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    # доход платформы с комнаты (комиссия + остатки округления); заполняется при расчёте
    commission_nano: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    fill_deadline: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ArenaEntry(Base):
    """Место игрока в комнате. Одна строка на (комната, игрок): выход до старта освобождает место
    (seat = NULL, статус refunded), повторный вход переиспользует строку."""

    __tablename__ = "arena_entries"
    __table_args__ = (
        UniqueConstraint("room_id", "user_id", name="uq_arena_entries_room_user"),
        UniqueConstraint("room_id", "seat", name="uq_arena_entries_room_seat"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("arena_rooms.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    # номер места 0…seats-1 (порядок входа); NULL — место освобождено
    seat: Mapped[int | None] = mapped_column(Integer, nullable=True)
    held_nano: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="held", server_default="held")
    place: Mapped[int | None] = mapped_column(Integer, nullable=True)
    prize_nano: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ArenaMatch(Base):
    """Бой набранной комнаты: текущее состояние движка (services/arena_engine, JSON). Одна строка на комнату.

    Создаётся в момент старта комнаты (состояние перед 1-м ходом). Журнал ходов и цикл ходов — PR 4.
    """

    __tablename__ = "arena_matches"
    __table_args__ = (UniqueConstraint("room_id", name="uq_arena_matches_room_id"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("arena_rooms.id", ondelete="CASCADE"), nullable=False)
    turn: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    state_json: Mapped[str] = mapped_column(Text, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
