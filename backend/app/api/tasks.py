"""Tasks HTTP API — roles owner/admin/ambassador."""

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services import tasks as tasks_svc
from app.services import task_tariff as tariff_svc
from app.services.economy import get_setting
from app.services.balance import InsufficientBalanceError
from app.services.roles import can_approve_ambassador_task, is_platform_owner
from app.services.tasks import TaskBudgetError, TaskError, TaskPermissionError, TaskStateError

router = APIRouter(prefix="/tasks", tags=["tasks"])


class TaskCreateBody(BaseModel):
    title: str = Field(min_length=3, max_length=255)
    description: str = Field(min_length=3)
    reward: Decimal | None = None  # для visit игнорируется — берётся из тарифа
    total_slots: int = Field(ge=1, le=10000)
    task_type: str = "manual_proof"
    target_url: str | None = None
    min_level: int = 1
    xp_reward: int | None = None  # для visit — из тарифа; для campaign — тариф по умолчанию
    publish: bool = False
    commission_bp: int | None = Field(default=None, ge=0, le=10000)  # campaign/partner (override)
    partner_telegram_id: int | None = None  # только partner: кто получает деньги с продаж


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
    commission_bp: int | None = None
    partner_user_id: int | None = None
    partner_name: str | None = None
    purchased: bool | None = None  # partner: купил ли текущий пользователь


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


def _task_out(v: tasks_svc.TaskView, **extra) -> TaskOut:
    return TaskOut(**extra,
        id=v.id, title=v.title, description=v.description, task_type=v.task_type,
        target_url=v.target_url, reward=v.reward, total_slots=v.total_slots,
        filled_slots=v.filled_slots, status=v.status, min_level=v.min_level,
        xp_reward=v.xp_reward, creator_id=v.creator_id,
        expires_at=v.expires_at.isoformat() if v.expires_at else None,
        commission_bp=v.commission_bp, partner_user_id=v.partner_user_id,
    )


async def _partner_extra(db: AsyncSession, v: tasks_svc.TaskView, user: User) -> dict:
    if v.task_type != tasks_svc.PARTNER:
        return {}
    name = None
    if v.partner_user_id:
        p = await db.get(User, v.partner_user_id)
        if p:
            name = (f"@{p.username}" if p.username else None) or p.first_name or f"#{p.id}"
    bought = await tasks_svc.has_purchased(db, task_id=v.id, user_id=user.id)
    return {"partner_name": name, "purchased": bought}


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
    except TaskBudgetError as e:
        raise HTTPException(status_code=402, detail=str(e)) from e
    except (TaskStateError, TaskError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/{task_id}", response_model=TaskOut)
async def get_task(task_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        t = await tasks_svc.get_task(db, task_id)
        extra = await _partner_extra(db, t, user)
        await db.commit()
        return _task_out(t, **extra)
    except TaskError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e



class QuoteBody(BaseModel):
    task_type: str = "visit"
    total_slots: int = Field(ge=1, le=10000)
    reward: Decimal | None = None  # campaign: награда; partner: цена для покупателя
    commission_bp: int | None = Field(default=None, ge=0, le=10000)  # campaign/partner override


class QuoteOut(BaseModel):
    task_type: str
    reward: Decimal
    xp: int
    payout: Decimal
    commission: Decimal
    total: Decimal
    commission_bp: int
    slots: int


@router.post("/quote", response_model=QuoteOut)
async def quote_task(
    body: QuoteBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Живая цена для формы создания: visit (тариф) или campaign (ручная награда, только владелец)."""
    if body.task_type not in ("visit", "campaign", "partner"):
        raise HTTPException(status_code=400, detail="quote только для visit, campaign и partner")
    if body.task_type in ("campaign", "partner") and not is_platform_owner(user):
        raise HTTPException(status_code=403, detail="этот тип только для владельца")
    raw = await get_setting(db, tariff_svc.KEY)
    tariff = raw if isinstance(raw, dict) else tariff_svc.DEFAULT
    try:
        if body.task_type == "partner":
            if body.reward is None:
                raise tariff_svc.TaskTariffError("цена: укажите сумму TON")
            pq = tariff_svc.quote_partner(tariff, amount=body.reward, fee_bp=body.commission_bp)
            await db.commit()
            # reward/total — цена для покупателя, payout — партнёру, commission — платформе
            return QuoteOut(
                task_type="partner", reward=Decimal(pq.amount), xp=pq.xp,
                payout=Decimal(pq.partner_gets), commission=Decimal(pq.fee),
                total=Decimal(pq.amount), commission_bp=pq.fee_bp, slots=body.total_slots,
            )
        if body.task_type == "campaign":
            if body.reward is None:
                raise tariff_svc.TaskTariffError("награда за выполнение: укажите сумму TON")
            q = tariff_svc.quote_campaign(
                tariff, reward=body.reward, slots=body.total_slots, commission_bp=body.commission_bp
            )
        else:
            q = tariff_svc.quote_visit(tariff, slots=body.total_slots)
    except tariff_svc.TaskTariffError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    await db.commit()
    return QuoteOut(
        task_type=body.task_type,
        reward=Decimal(q.reward),
        xp=q.xp,
        payout=Decimal(q.payout),
        commission=Decimal(q.commission),
        total=Decimal(q.total),
        commission_bp=q.commission_bp,
        slots=q.slots,
    )


@router.post("", response_model=TaskOut)
async def create_task(body: TaskCreateBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        t = await tasks_svc.create_task(
            db, creator=user, title=body.title, description=body.description, reward=body.reward,
            total_slots=body.total_slots, task_type=body.task_type, target_url=body.target_url,
            min_level=body.min_level, xp_reward=body.xp_reward, publish=body.publish,
            commission_bp=body.commission_bp, partner_telegram_id=body.partner_telegram_id)
        await db.commit()
        return _task_out(t)
    except TaskPermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except TaskBudgetError as e:
        raise HTTPException(status_code=402, detail=str(e)) from e
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
    except TaskBudgetError as e:
        raise HTTPException(status_code=402, detail=str(e)) from e
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
    except TaskBudgetError as e:
        raise HTTPException(status_code=402, detail=str(e)) from e
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
    except TaskBudgetError as e:
        raise HTTPException(status_code=402, detail=str(e)) from e
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
    except TaskBudgetError as e:
        raise HTTPException(status_code=402, detail=str(e)) from e
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
    except TaskBudgetError as e:
        raise HTTPException(status_code=402, detail=str(e)) from e
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
    except TaskBudgetError as e:
        raise HTTPException(status_code=402, detail=str(e)) from e
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


@router.post("/{task_id}/close", response_model=TaskOut)
async def close_task(task_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        t = await tasks_svc.close_task(db, task_id=task_id, actor=user)
        await db.commit()
        return _task_out(t)
    except TaskPermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except (TaskStateError, TaskError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


class PurchaseOut(BaseModel):
    purchase_id: int
    task_id: int
    already: bool
    amount: Decimal
    fee: Decimal
    partner_gets: Decimal
    xp: int
    balance: Decimal


@router.post("/{task_id}/buy", response_model=PurchaseOut)
async def buy_task(task_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Купить партнёрскую услугу с баланса. Повторный запрос возвращает ту же покупку (already=true)."""
    try:
        r = await tasks_svc.buy_partner(db, buyer=user, task_id=task_id)
        p = r.purchase
        out = PurchaseOut(
            purchase_id=p.id, task_id=p.task_id, already=r.already,
            amount=tasks_svc._ton_from_nano(p.amount_nano), fee=tasks_svc._ton_from_nano(p.fee_nano),
            partner_gets=tasks_svc._ton_from_nano(p.partner_nano), xp=p.xp,
            balance=Decimal((await db.get(User, user.id)).balance),
        )
        await db.commit()
        return out
    except TaskBudgetError as e:
        await db.rollback()
        raise HTTPException(status_code=402, detail=str(e)) from e
    except TaskPermissionError as e:
        await db.rollback()
        raise HTTPException(status_code=403, detail=str(e)) from e
    except (TaskStateError, TaskError) as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(e)) from e
