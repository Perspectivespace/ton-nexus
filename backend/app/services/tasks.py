"""Task marketplace — roles: owner > admin > ambassador."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.task import Task, TaskSubmission
from app.models.user import User
from app.services import balance as balance_svc
from app.services.economy import get_setting
from app.services.roles import (
    can_approve_ambassador_task,
    can_create_task,
    can_manage_any_task,
    can_publish_directly,
)


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


def _can_edit_task(actor: User, task: Task) -> bool:
    if can_manage_any_task(actor):
        return True
    return task.creator_id == actor.id and task.status in (
        "draft",
        "pending_approval",
        "paused",
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
    if not can_create_task(creator):
        raise TaskPermissionError("need ambassador, admin or owner role")
    if reward <= 0:
        raise TaskError("reward must be positive")
    if total_slots < 1 or total_slots > 10_000:
        raise TaskError("invalid slots")
    if not title.strip() or not description.strip():
        raise TaskError("title and description required")

    if can_publish_directly(creator):
        initial = "draft"
    else:
        initial = "pending_approval"
        publish = False

    task = Task(
        creator_id=creator.id,
        title=title.strip()[:255],
        description=description.strip(),
        task_type=task_type,
        target_url=target_url,
        reward=reward,
        total_slots=total_slots,
        filled_slots=0,
        status=initial,
        budget_locked=Decimal("0"),
        min_level=max(1, min_level),
        xp_reward=max(0, xp_reward),
    )
    session.add(task)
    await session.flush()

    if publish and can_publish_directly(creator):
        return await publish_task(session, task_id=task.id, actor=creator)
    return _view(task)


async def update_task(
    session: AsyncSession,
    *,
    task_id: int,
    actor: User,
    title: str | None = None,
    description: str | None = None,
    reward: Decimal | None = None,
    total_slots: int | None = None,
    task_type: str | None = None,
    target_url: str | None = None,
    min_level: int | None = None,
    xp_reward: int | None = None,
) -> TaskView:
    task = await session.get(Task, task_id)
    if not task:
        raise TaskError("task not found")
    if not _can_edit_task(actor, task):
        raise TaskPermissionError("cannot edit this task")
    if task.status == "completed":
        raise TaskStateError("completed task is frozen")

    if task.status == "active" and task.budget_locked and task.budget_locked > 0:
        if reward is not None and reward != task.reward:
            raise TaskStateError("cannot change reward after publish")
        if total_slots is not None and total_slots < task.filled_slots:
            raise TaskError("total_slots < filled_slots")

    if title is not None:
        task.title = title.strip()[:255]
    if description is not None:
        task.description = description.strip()
    if reward is not None and task.status in ("draft", "pending_approval", "paused", "rejected"):
        if reward <= 0:
            raise TaskError("reward must be positive")
        task.reward = reward
    if total_slots is not None:
        if total_slots < max(1, task.filled_slots):
            raise TaskError("invalid total_slots")
        task.total_slots = total_slots
    if task_type is not None:
        task.task_type = task_type
    if target_url is not None:
        task.target_url = target_url or None
    if min_level is not None:
        task.min_level = max(1, min_level)
    if xp_reward is not None:
        task.xp_reward = max(0, xp_reward)

    await session.flush()
    return _view(task)


async def submit_for_approval(session: AsyncSession, *, task_id: int, actor: User) -> TaskView:
    task = await session.get(Task, task_id)
    if not task:
        raise TaskError("task not found")
    if task.creator_id != actor.id and not can_manage_any_task(actor):
        raise TaskPermissionError("not your task")
    if task.status not in ("draft", "rejected"):
        raise TaskStateError(f"cannot submit from {task.status}")
    task.status = "pending_approval"
    await session.flush()
    return _view(task)


async def approve_task(session: AsyncSession, *, task_id: int, actor: User) -> TaskView:
    if not can_approve_ambassador_task(actor):
        raise TaskPermissionError("admin or owner required")
    task = await session.get(Task, task_id)
    if not task:
        raise TaskError("task not found")
    if task.status != "pending_approval":
        raise TaskStateError("not pending approval")
    task.status = "draft"
    await session.flush()
    return _view(task)


async def reject_task(
    session: AsyncSession, *, task_id: int, actor: User, note: str | None = None
) -> TaskView:
    if not can_approve_ambassador_task(actor):
        raise TaskPermissionError("admin or owner required")
    task = await session.get(Task, task_id)
    if not task:
        raise TaskError("task not found")
    if task.status != "pending_approval":
        raise TaskStateError("not pending approval")
    task.status = "rejected"
    await session.flush()
    return _view(task)


async def publish_task(session: AsyncSession, *, task_id: int, actor: User) -> TaskView:
    task = await session.get(Task, task_id)
    if not task:
        raise TaskError("task not found")
    if not _can_edit_task(actor, task) and not can_manage_any_task(actor):
        raise TaskPermissionError("not allowed")

    if not can_publish_directly(actor):
        if task.status != "draft":
            raise TaskStateError("wait for admin approval first")
        if task.creator_id != actor.id:
            raise TaskPermissionError("not your task")
    else:
        if task.status not in ("draft", "paused"):
            raise TaskStateError(f"cannot publish from {task.status}")

    if task.budget_locked and task.budget_locked > 0 and task.status == "paused":
        task.status = "active"
        await session.flush()
        return _view(task)

    payout = Decimal(task.reward) * task.total_slots
    bp = int((await get_setting(session, "task_platform_commission_bp"))["bp"])
    commission = (payout * Decimal(bp) / Decimal(10000)).quantize(Decimal("0.00000001"))
    total = payout + commission

    await balance_svc.debit(
        session,
        user_id=task.creator_id,
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
    if not _can_edit_task(actor, task) and not can_manage_any_task(actor):
        raise TaskPermissionError("not allowed")
    if task.status != "active":
        raise TaskStateError("only active tasks can be paused")
    task.status = "paused"
    await session.flush()
    return _view(task)


async def list_active(
    session: AsyncSession, *, limit: int = 50, offset: int = 0
) -> list[TaskView]:
    result = await session.execute(
        select(Task)
        .where(Task.status == "active")
        .order_by(Task.created_at.desc())
        .limit(min(limit, 100))
        .offset(max(0, offset))
    )
    return [_view(t) for t in result.scalars().all()]


async def list_pending_approval(session: AsyncSession, *, limit: int = 50) -> list[TaskView]:
    result = await session.execute(
        select(Task)
        .where(Task.status == "pending_approval")
        .order_by(Task.created_at.asc())
        .limit(min(limit, 100))
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
    q = (
        select(TaskSubmission)
        .join(Task, Task.id == TaskSubmission.task_id)
        .where(TaskSubmission.status == "pending")
        .order_by(TaskSubmission.created_at.asc())
        .limit(min(limit, 100))
    )
    if not can_manage_any_task(creator):
        q = q.where(Task.creator_id == creator.id)
    result = await session.execute(q)
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

    allowed = can_manage_any_task(actor) or task.creator_id == actor.id
    if not allowed:
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
