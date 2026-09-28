"""Task marketplace service."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.telegram_auth import is_owner
from app.models.task import Task, TaskSubmission
from app.models.user import User
from app.services import balance as balance_svc
from app.services.economy import get_setting


class TaskError(Exception):
    pass


class TaskPermissionError(TaskError):
    pass


class TaskStateError(TaskError):
    pass


@dataclass
class TaskView:
    id: int
    title: str
    description: str
    task_type: str
    target_url: str | None
    reward: Decimal
    total_slots: int
    filled_slots: int
    status: str
    min_level: int
    xp_reward: int
    creator_id: int
    expires_at: datetime | None


def _view(t: Task) -> TaskView:
    return TaskView(
        id=t.id,
        title=t.title,
        description=t.description,
        task_type=t.task_type,
        target_url=t.target_url,
        reward=Decimal(t.reward),
        total_slots=t.total_slots,
        filled_slots=t.filled_slots,
        status=t.status,
        min_level=t.min_level,
        xp_reward=t.xp_reward,
        creator_id=t.creator_id,
        expires_at=t.expires_at,
    )


async def create_task(
    session: AsyncSession,
    *,
    creator: User,
    title: str,
    description: str,
    reward: Decimal,
    total_slots: int,
    task_type: str = "manual_proof",
    target_url: str | None = None,
    min_level: int = 1,
    xp_reward: int = 10,
    publish: bool = False,
) -> TaskView:
    if not creator.is_ambassador and not is_owner(creator.telegram_id):
        raise TaskPermissionError("only ambassadors can create tasks")
    if reward <= 0:
        raise TaskError("reward must be positive")
    if total_slots < 1 or total_slots > 10_000:
        raise TaskError("invalid slots")
    if not title.strip() or not description.strip():
        raise TaskError("title and description required")

    task = Task(
        creator_id=creator.id,
        title=title.strip()[:255],
        description=description.strip(),
        task_type=task_type,
        target_url=target_url,
        reward=reward,
        total_slots=total_slots,
        filled_slots=0,
        status="draft",
        budget_locked=Decimal("0"),
        min_level=max(1, min_level),
        xp_reward=max(0, xp_reward),
    )
    session.add(task)
    await session.flush()

    if publish:
        return await publish_task(session, task_id=task.id, actor=creator)
    return _view(task)


async def publish_task(session: AsyncSession, *, task_id: int, actor: User) -> TaskView:
    task = await session.get(Task, task_id)
    if not task:
        raise TaskError("task not found")
    if task.creator_id != actor.id and not is_owner(actor.telegram_id):
        raise TaskPermissionError("not your task")
    if task.status not in ("draft", "paused"):
        raise TaskStateError(f"cannot publish from {task.status}")

    payout = Decimal(task.reward) * task.total_slots
    bp = int((await get_setting(session, "task_platform_commission_bp"))["bp"])
    commission = (payout * Decimal(bp) / Decimal(10000)).quantize(Decimal("0.00000001"))
    total = payout + commission

    await balance_svc.debit(
        session,
        user_id=actor.id,
        amount=total,
        balance_type="tasks",
        description=f"Бюджет задания #{task.id}",
        reference_type="task",
        reference_id=task.id,
    )
    task.budget_locked = total
    task.status = "active"
    await session.flush()
    return _view(task)


async def pause_task(session: AsyncSession, *, task_id: int, actor: User) -> TaskView:
    task = await session.get(Task, task_id)
    if not task:
        raise TaskError("task not found")
    if task.creator_id != actor.id and not is_owner(actor.telegram_id):
        raise TaskPermissionError("not your task")
    if task.status != "active":
        raise TaskStateError("only active tasks can be paused")
    task.status = "paused"
    await session.flush()
    return _view(task)


async def list_active(
    session: AsyncSession,
    *,
    limit: int = 50,
    offset: int = 0,
) -> list[TaskView]:
    result = await session.execute(
        select(Task)
        .where(Task.status == "active")
        .order_by(Task.created_at.desc())
        .limit(min(limit, 100))
        .offset(max(0, offset))
    )
    return [_view(t) for t in result.scalars().all()]


async def get_task(session: AsyncSession, task_id: int) -> TaskView:
    task = await session.get(Task, task_id)
    if not task:
        raise TaskError("task not found")
    return _view(task)


async def submit(
    session: AsyncSession,
    *,
    user: User,
    task_id: int,
    proof_text: str | None = None,
    proof_url: str | None = None,
) -> TaskSubmission:
    task = await session.get(Task, task_id)
    if not task or task.status != "active":
        raise TaskStateError("task not available")
    if user.level < task.min_level:
        raise TaskError(f"need level {task.min_level}")
    if task.filled_slots >= task.total_slots:
        raise TaskStateError("no slots left")
    if task.creator_id == user.id:
        raise TaskError("cannot submit own task")

    existing = await session.scalar(
        select(TaskSubmission).where(
            and_(
                TaskSubmission.task_id == task_id,
                TaskSubmission.user_id == user.id,
                TaskSubmission.status.in_(("pending", "approved")),
            )
        )
    )
    if existing:
        raise TaskStateError("already submitted")

    if not (proof_text or proof_url):
        raise TaskError("proof required")

    sub = TaskSubmission(
        task_id=task_id,
        user_id=user.id,
        proof_text=proof_text,
        proof_url=proof_url,
        status="pending",
    )
    session.add(sub)
    await session.flush()
    return sub


async def list_pending_for_creator(
    session: AsyncSession, *, creator: User, limit: int = 50
) -> list[TaskSubmission]:
    result = await session.execute(
        select(TaskSubmission)
        .join(Task, Task.id == TaskSubmission.task_id)
        .where(
            Task.creator_id == creator.id,
            TaskSubmission.status == "pending",
        )
        .order_by(TaskSubmission.created_at.asc())
        .limit(min(limit, 100))
    )
    return list(result.scalars().all())


async def review_submission(
    session: AsyncSession,
    *,
    actor: User,
    submission_id: int,
    approve: bool,
    note: str | None = None,
) -> TaskSubmission:
    sub = await session.get(TaskSubmission, submission_id)
    if not sub or sub.status != "pending":
        raise TaskStateError("submission not pending")

    task = await session.get(Task, sub.task_id)
    if not task:
        raise TaskError("task not found")
    if task.creator_id != actor.id and not is_owner(actor.telegram_id):
        raise TaskPermissionError("not allowed to review")

    now = datetime.now(timezone.utc)
    sub.reviewed_by_id = actor.id
    sub.reviewed_at = now
    sub.review_note = note

    if approve:
        if task.filled_slots >= task.total_slots:
            raise TaskStateError("no slots left")
        sub.status = "approved"
        reward = Decimal(task.reward)
        await balance_svc.credit(
            session,
            user_id=sub.user_id,
            amount=reward,
            balance_type="tasks",
            description=f"Задание #{task.id}",
            reference_type="task_submission",
            reference_id=sub.id,
        )
        worker = await session.get(User, sub.user_id)
        if worker and task.xp_reward:
            worker.xp = int(worker.xp or 0) + int(task.xp_reward)
            while True:
                curve = await get_setting(session, "xp_per_level")
                need = int(float(curve["base"]) * (float(curve["growth"]) ** (worker.level - 1)))
                if worker.xp < need:
                    break
                worker.xp -= need
                worker.level += 1

        task.filled_slots += 1
        if task.filled_slots >= task.total_slots:
            task.status = "completed"
    else:
        sub.status = "rejected"

    await session.flush()
    return sub
