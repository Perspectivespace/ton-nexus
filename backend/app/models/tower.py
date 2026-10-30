"""«Башня»: забеги, дневные попытки, лучший счёт месяца."""

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
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


class TowerMonth(Base):
    """Закрытый месяц топа: итоги заморожены, призы посчитаны по настройкам на момент закрытия.

    Одна строка на месяц (unique month) — повторное или параллельное закрытие упирается в неё.
    status: "no_prizes" — призов нет (reason: disabled / few_participants / no_budget / no_players);
            "payout" — есть призы, ждущие выплаты или проверки; "settled" — все призы выплачены или аннулированы.
    """

    __tablename__ = "tower_months"
    __table_args__ = (UniqueConstraint("month", name="uq_tower_months_month"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    month: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False)
    reason: Mapped[str | None] = mapped_column(String(24), nullable=True)
    # копия tower_prizes на момент закрытия: потом настройки можно менять, прошлые призы не поедут
    prize_cfg: Mapped[dict] = mapped_column(JSON, nullable=False)
    total_players: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    participants: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    places: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    budget_ton: Mapped[Decimal] = mapped_column(Numeric(18, 8), nullable=False, default=Decimal(0), server_default="0")
    # сумма призов по плану (≤ бюджета) и сколько уже выплачено (≤ плана)
    planned_ton: Mapped[Decimal] = mapped_column(Numeric(18, 8), nullable=False, default=Decimal(0), server_default="0")
    paid_ton: Mapped[Decimal] = mapped_column(Numeric(18, 8), nullable=False, default=Decimal(0), server_default="0")
    closed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # кто закрыл: null — само при первом запросе после конца месяца
    closed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


class TowerMonthResult(Base):
    """Итоговое место игрока в закрытом месяце (призовые места и остальной видимый топ).

    status: "pending" — приз ждёт выплаты; "paid" — выплачен (balance_history_id);
            "flagged" — лучший забег не прошёл повторную проверку, платить нельзя до решения владельца;
            "voided" — аннулирован (бан, решение владельца); "none" — место без приза.
    Места не сдвигаются: аннулированный приз никому не переходит, его деньги остаются в бюджете.
    """

    __tablename__ = "tower_month_results"
    __table_args__ = (
        UniqueConstraint("tower_month_id", "place", name="uq_tower_result_month_place"),
        UniqueConstraint("tower_month_id", "user_id", name="uq_tower_result_month_user"),
        UniqueConstraint("balance_history_id", name="uq_tower_result_history"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tower_month_id: Mapped[int] = mapped_column(ForeignKey("tower_months.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    place: Mapped[int] = mapped_column(Integer, nullable=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    game_id: Mapped[int | None] = mapped_column(ForeignKey("tower_games.id", ondelete="SET NULL"), nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 8), nullable=False, default=Decimal(0), server_default="0")
    status: Mapped[str] = mapped_column(String(10), nullable=False)
    # почему flagged / voided (код): replay_mismatch, no_game, banned, owner …
    note: Mapped[str | None] = mapped_column(String(32), nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    paid_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    balance_history_id: Mapped[int | None] = mapped_column(
        ForeignKey("balance_history.id", ondelete="SET NULL"), nullable=True
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
