"""Task marketplace: ambassadors create, users complete."""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, false, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    creator_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    task_type: Mapped[str] = mapped_column(String(32), default="manual_proof", nullable=False)
    target_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    reward: Mapped[Decimal] = mapped_column(Numeric(18, 8), nullable=False)
    total_slots: Mapped[int] = mapped_column(Integer, nullable=False)
    filled_slots: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    status: Mapped[str] = mapped_column(String(16), default="draft", nullable=False, index=True)
    budget_locked: Mapped[Decimal] = mapped_column(Numeric(18, 8), default=Decimal("0"), nullable=False)

    min_level: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    xp_reward: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
    # снимок bp комиссии при создании (visit); None — старые задания → task_platform_commission_bp
    commission_bp: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # исполнитель обязан приложить скриншот (новые типы; старый manual_proof переносится с True)
    proof_required: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false(), nullable=False)
    # исходный тип до переноса старых типов (manual_proof / link) — для отката миграции 017
    legacy_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Учёт бюджета в нанотонах (с PR «управление заданиями»). NULL — старое задание, разбивка
    # оценивается из budget_locked при первом действии владельца (services/task_owner.ensure_accounting).
    creator_payout_nano: Mapped[int | None] = mapped_column(BigInteger, nullable=True)  # выплаты, оплаченные создателем
    creator_commission_nano: Mapped[int | None] = mapped_column(BigInteger, nullable=True)  # комиссия, оплаченная создателем
    platform_payout_nano: Mapped[int | None] = mapped_column(BigInteger, nullable=True)  # выплаты за счёт платформы
    # «Партнёрская услуга»: кто получает деньги с продаж (reward = цена для покупателя, commission_bp = комиссия)
    partner_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    submissions = relationship("TaskSubmission", back_populates="task")


class TaskSubmission(Base):
    __tablename__ = "task_submissions"
    # топ исполнителей: принятые за месяц (status, reviewed_at)
    __table_args__ = (Index("ix_task_submissions_status_reviewed", "status", "reviewed_at"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    proof_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    proof_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False, index=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    task = relationship("Task", back_populates="submissions")


class TaskPurchase(Base):
    """Покупка партнёрской услуги. Одна на покупателя и задание (повторный клик — та же покупка).

    Суммы в нанотонах: amount_nano = partner_nano + fee_nano. fee_nano — доход платформы
    (как arena_rooms.commission_nano), отдельной проводки на счёт платформы нет.
    """

    __tablename__ = "task_purchases"
    __table_args__ = (UniqueConstraint("task_id", "buyer_id", name="uq_task_purchases_task_buyer"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    buyer_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    partner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    amount_nano: Mapped[int] = mapped_column(BigInteger, nullable=False)
    fee_nano: Mapped[int] = mapped_column(BigInteger, nullable=False)
    partner_nano: Mapped[int] = mapped_column(BigInteger, nullable=False)
    fee_bp: Mapped[int] = mapped_column(Integer, nullable=False)
    xp: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class TaskOwnerAction(Base):
    """Журнал действий владельца с заданиями: кто, что, когда и сколько денег сдвинулось.

    creator_delta_nano: + списано с создателя, − возвращено создателю.
    platform_delta_nano: + платформа добавила в бюджет, − платформа оставила себе (доход).
    """

    __tablename__ = "task_owner_actions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    mode: Mapped[str | None] = mapped_column(String(16), nullable=True)
    creator_delta_nano: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    platform_delta_nano: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class TaskProof(Base):
    """Скриншот-подтверждение: в БД только метаданные, сам файл — на диске вне web root.

    Очередь удаления — поле delete_after: после проверки заявки файл удаляется не позже чем через 24 ч,
    непривязанные и непроверенные — по своим срокам (services/task_proofs). deleted_at ставится один раз.
    """

    __tablename__ = "task_proofs"
    __table_args__ = (Index("ix_task_proofs_due", "deleted_at", "delete_after"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    submission_id: Mapped[int | None] = mapped_column(
        ForeignKey("task_submissions.id", ondelete="SET NULL"), nullable=True, index=True
    )
    filename: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    mime: Mapped[str] = mapped_column(String(32), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    delete_after: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    delete_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
