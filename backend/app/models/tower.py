"""«Башня»: забеги, дневные попытки, лучший счёт месяца."""

from datetime import date, datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class TowerGame(Base):
    """Один забег. Попытка списывается при старте; счёт появляется только после проверки журнала тапов."""

    __tablename__ = "tower_games"
    __table_args__ = (Index("ix_tower_games_user_day", "user_id", "game_day"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    # seed (uint32), который выдал сервер; клиент его не выбирает
    seed: Mapped[int] = mapped_column(BigInteger, nullable=False)
    # бустер забега: "slow" | "aim" | NULL (выдаются со следующего этапа)
    booster: Mapped[str | None] = mapped_column(String(8), nullable=True)
    # игровой день (дата по Москве), в котором списана попытка
    game_day: Mapped[date] = mapped_column(Date, nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # started — идёт/брошен; finished — проверен; rejected — присланный итог не принят (счёт 0)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="started", server_default="started")
    reject_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    score: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    height: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    perfects: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    best_combo: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    over: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    # журнал тапов (мс от начала) — хранится для повторной проверки и разбора споров
    taps: Mapped[list | None] = mapped_column(JSON, nullable=True)


class TowerDailyAttempts(Base):
    """Сколько попыток игрок потратил в игровой день (00:00 МСК). Одна строка на игрока и день."""

    __tablename__ = "tower_daily_attempts"
    __table_args__ = (UniqueConstraint("user_id", "game_day", name="uq_tower_attempts_user_day"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    game_day: Mapped[date] = mapped_column(Date, nullable=False)
    used: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")


class TowerMonthlyBest(Base):
    """Лучший проверенный счёт игрока за месяц (по Москве). В топ идёт он, а не сумма."""

    __tablename__ = "tower_monthly_best"
    __table_args__ = (
        UniqueConstraint("user_id", "month", name="uq_tower_best_user_month"),
        Index("ix_tower_best_month_score", "month", "best_score"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    # первое число месяца
    month: Mapped[date] = mapped_column(Date, nullable=False)
    best_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    best_game_id: Mapped[int | None] = mapped_column(
        ForeignKey("tower_games.id", ondelete="SET NULL"), nullable=True
    )
    # когда этот счёт набран: при равных очках выше тот, кто набрал раньше
    achieved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
