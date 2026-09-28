"""Tasks HTTP API — roles owner/admin/ambassador."""

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services import tasks as tasks_svc
from app.services.balance import InsufficientBalanceError
from app.services.roles import can_approve_ambassador_task
from app.services.tasks import TaskError, TaskPermissionError, TaskStateError

router = APIRouter(prefix="/tasks", tags=["tasks"])


class TaskCreateBody(BaseModel):
    title: str = Field(min_length=3, max_length=255)
    description: str = Field(min_length=3)
    reward: Decimal
    total_slots: int = Field(ge=1, le=10000)
    task_type: str = "manual_proof"
    target_url: str | None = None
    min_level: int = 1
    xp_reward: int = 10
    publish: bool = False


class TaskUpdateBody(BaseModel):
    title: str | None = None
    description: str | None = None
    reward: Decimal | None = None
    total_slots: int | None = Field(default=None, ge=1, le=10000)
    task_type: str | None = None
    target_url: str | None = None
    min_level: int | None = None
    xp_reward: int | None = None


class TaskOut(BaseModel):
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
    expires_at: str | None = None


class SubmitBody(BaseModel):
    proof_text: str | None = None
    proof_url: str | None = None


class ReviewBody(BaseModel):
    approve: bool
    note: str | None = None


class SubmissionOut(BaseModel):
    id: int
    task_id: int
    user_id: int
    status: str
    proof_text: str | None
    proof_url: str | None
    review_note: str | None


def _task_out(v: tasks_svc.TaskView) -> TaskOut:
    return TaskOut(
        id=v.id, title=v.title, description=v.description, task_type=v.task_type,
        target_url=v.target_url, reward=v.reward, total_slots=v.total_slots,
        filled_slots=v.filled_slots, status=v.status, min_level=v.min_level,
        xp_reward=v.xp_reward, creator_id=v.creator_id,
        expires_at=v.expires_at.isoformat() if v.expires_at else None,
    )


@router.get("", response_model=list[TaskOut])
async def list_tasks(limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0),
                     user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    items = await tasks_svc.list_active(db, limit=limit, offset=offset)
    await db.commit()
    return [_task_out(t) for t in items]


@router.get("/approval/pending", response_model=list[TaskOut])
async def list_tasks_pending_approval(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not can_approve_ambassador_task(user):
        raise HTTPException(status_code=403, detail="admin or owner required")
    items = await tasks_svc.list_pending_approval(db)
    await db.commit()
    return [_task_out(t) for t in items]


@router.get("/inbox/pending", response_model=list[SubmissionOut])
async def pending_submissions(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    items = await tasks_svc.list_pending_for_creator(db, creator=user)
    await db.commit()
    return [SubmissionOut(id=s.id, task_id=s.task_id, user_id=s.user_id, status=s.status,
                          proof_text=s.proof_text, proof_url=s.proof_url, review_note=s.review_note) for s in items]


@router.post("/submissions/{submission_id}/review", response_model=SubmissionOut)
async def review_submission(submission_id: int, body: ReviewBody,
                            user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        sub = await tasks_svc.review_submission(db, actor=user, submission_id=submission_id,
                                                 approve=body.approve, note=body.note)
        await db.commit()
        return SubmissionOut(id=sub.id, task_id=sub.task_id, user_id=sub.user_id, status=sub.status,
                             proof_text=sub.proof_text, proof_url=sub.proof_url, review_note=sub.review_note)
    except TaskPermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except (TaskStateError, TaskError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/{task_id}", response_model=TaskOut)
async def get_task(task_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        t = await tasks_svc.get_task(db, task_id)
        await db.commit()
        return _task_out(t)
    except TaskError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@router.post("", response_model=TaskOut)
async def create_task(body: TaskCreateBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        t = await tasks_svc.create_task(
            db, creator=user, title=body.title, description=body.description, reward=body.reward,
            total_slots=body.total_slots, task_type=body.task_type, target_url=body.target_url,
            min_level=body.min_level, xp_reward=body.xp_reward, publish=body.publish)
        await db.commit()
        return _task_out(t)
    except TaskPermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except InsufficientBalanceError as e:
        raise HTTPException(status_code=402, detail=str(e)) from e
    except TaskError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.patch("/{task_id}", response_model=TaskOut)
async def update_task(task_id: int, body: TaskUpdateBody,
                      user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        t = await tasks_svc.update_task(
            db, task_id=task_id, actor=user, title=body.title, description=body.description,
            reward=body.reward, total_slots=body.total_slots, task_type=body.task_type,
            target_url=body.target_url, min_level=body.min_level, xp_reward=body.xp_reward)
        await db.commit()
        return _task_out(t)
    except TaskPermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except (TaskStateError, TaskError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/{task_id}/submit-approval", response_model=TaskOut)
async def submit_approval(task_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        t = await tasks_svc.submit_for_approval(db, task_id=task_id, actor=user)
        await db.commit()
        return _task_out(t)
    except TaskPermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except (TaskStateError, TaskError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/{task_id}/approve", response_model=TaskOut)
async def approve_task(task_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        t = await tasks_svc.approve_task(db, task_id=task_id, actor=user)
        await db.commit()
        return _task_out(t)
    except TaskPermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except (TaskStateError, TaskError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/{task_id}/reject", response_model=TaskOut)
async def reject_task(task_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        t = await tasks_svc.reject_task(db, task_id=task_id, actor=user)
        await db.commit()
        return _task_out(t)
    except TaskPermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except (TaskStateError, TaskError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/{task_id}/publish", response_model=TaskOut)
async def publish_task(task_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        t = await tasks_svc.publish_task(db, task_id=task_id, actor=user)
        await db.commit()
        return _task_out(t)
    except TaskPermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except InsufficientBalanceError as e:
        raise HTTPException(status_code=402, detail=str(e)) from e
    except (TaskStateError, TaskError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/{task_id}/pause", response_model=TaskOut)
async def pause_task(task_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        t = await tasks_svc.pause_task(db, task_id=task_id, actor=user)
        await db.commit()
        return _task_out(t)
    except TaskPermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except (TaskStateError, TaskError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/{task_id}/submit", response_model=SubmissionOut)
async def submit_task(task_id: int, body: SubmitBody,
                      user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        sub = await tasks_svc.submit(db, user=user, task_id=task_id,
                                     proof_text=body.proof_text, proof_url=body.proof_url)
        await db.commit()
        return SubmissionOut(id=sub.id, task_id=sub.task_id, user_id=sub.user_id, status=sub.status,
                             proof_text=sub.proof_text, proof_url=sub.proof_url, review_note=sub.review_note)
    except (TaskStateError, TaskError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
