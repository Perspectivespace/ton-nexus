"""Task marketplace — roles: owner > admin > ambassador."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.balance import BalanceHistory
from app.models.task import Task, TaskPurchase, TaskSubmission
from app.models.user import User
from app.services import balance as balance_svc
from app.services.economy import get_setting
from app.services import task_tariff as tariff_svc
from app.services.levels import add_xp
from app.services.roles import (
    can_approve_ambassador_task,
    can_create_task,
    can_manage_any_task,
    can_publish_directly,
    is_platform_owner,
)


class TaskError(Exception):
    pass


class TaskPermissionError(TaskError):
    pass


class TaskStateError(TaskError):
    pass


class TaskBudgetError(TaskError):
    """Не хватает денег на изменение бюджета или бюджет задания исчерпан."""


# ── Бюджет задания ────────────────────────────────────────────────────────────
# budget_locked — всё, что списано с создателя за задание (выплаты + комиссия), только растёт.
# После публикации награду и число мест можно лишь повышать, и только с доплатой разницы;
# выплата исполнителю не может вывести сумму выплат за пределы budget_locked.

MAX_SLOTS = 10_000


def _q(v: Decimal) -> Decimal:
    return Decimal(v).quantize(Decimal("0.00000001"))


def _ton(v: Decimal) -> str:
    return format(_q(v).normalize(), "f")


async def _platform_commission_bp(session: AsyncSession) -> int:
    return int((await get_setting(session, "task_platform_commission_bp"))["bp"])


def _commission_from_bp(payout: Decimal, bp: int) -> Decimal:
    """Комиссия от payout в TON (8 знаков) — как nanoton-математика тарифа."""
    payout_nano = int(payout * tariff_svc.NANO_PER_TON)
    if payout_nano % tariff_svc.LEDGER_QUANTUM_NANO:
        # payout уже с 8 знаками — должно быть кратно; иначе вниз до кванта
        payout_nano -= payout_nano % tariff_svc.LEDGER_QUANTUM_NANO
    raw = payout_nano * int(bp) // 10_000
    commission_nano = raw - (raw % tariff_svc.LEDGER_QUANTUM_NANO)
    return _q(Decimal(commission_nano) / Decimal(tariff_svc.NANO_PER_TON))


async def _commission(session: AsyncSession, payout: Decimal, *, bp: int | None = None) -> Decimal:
    """Комиссия: явный bp (снимок на задании) или запасной task_platform_commission_bp."""
    if bp is None:
        bp = await _platform_commission_bp(session)
    return _commission_from_bp(payout, bp)


VISIT = "visit"
CAMPAIGN = "campaign"
PARTNER = "partner"
# типы, которые создаёт и меняет только владелец; сменить тип с них или на них нельзя
OWNER_ONLY_TYPES = {CAMPAIGN: "Кампания", PARTNER: "Партнёрская услуга"}


def _validate_optional_url(url: str | None) -> str | None:
    if url is None or not str(url).strip():
        return None
    return _validate_visit_url(url)


def _validate_visit_url(url: str | None) -> str:
    if not url or not str(url).strip():
        raise TaskError("для «Перехода» нужна ссылка на ресурс")
    u = str(url).strip()
    low = u.lower()
    if low.startswith("t.me/"):
        u = "https://" + u
        low = u.lower()
    if not (low.startswith("https://") or low.startswith("http://")):
        raise TaskError("ссылка: http(s)://… или t.me/…")
    if len(u) > 1024:
        raise TaskError("ссылка слишком длинная")
    return u


async def _lock_task(session: AsyncSession, task_id: int) -> Task | None:
    """Строка задания под блокировкой (FOR UPDATE) со свежими значениями из БД."""
    return await session.scalar(
        select(Task)
        .where(Task.id == task_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


async def paid_out(session: AsyncSession, task_id: int) -> Decimal:
    """Сколько TON уже выплачено исполнителям по этому заданию (по журналу баланса)."""
    sub_ids = select(TaskSubmission.id).where(TaskSubmission.task_id == task_id)
    total = await session.scalar(
        select(func.coalesce(func.sum(BalanceHistory.amount), 0)).where(
            BalanceHistory.operation_type == "credit",
            BalanceHistory.reference_type == "task_submission",
            BalanceHistory.reference_id.in_(sub_ids),
        )
    )
    return _q(Decimal(str(total or 0)))


async def _charge_creator(session: AsyncSession, task: Task, amount: Decimal, description: str) -> None:
    try:
        await balance_svc.debit(
            session,
            user_id=task.creator_id,
            amount=amount,
            balance_type="tasks",
            description=description,
            reference_type="task",
            reference_id=task.id,
        )
    except balance_svc.InsufficientBalanceError as e:
        raise TaskBudgetError(
            f"Недостаточно TON на балансе создателя задания: нужно {_ton(amount)} TON."
        ) from e


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
    partner_user_id: int | None = None
    commission_bp: int | None = None


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
        partner_user_id=t.partner_user_id,
        commission_bp=t.commission_bp,
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
    reward: Decimal | None,
    total_slots: int,
    task_type: str = "manual_proof",
    target_url: str | None = None,
    min_level: int = 1,
    xp_reward: int | None = None,
    publish: bool = False,
    commission_bp: int | None = None,
    partner_telegram_id: int | None = None,
) -> TaskView:
    task_type = (task_type or "manual_proof").strip()
    if task_type == VISIT:
        # переход: любой авторизованный; цена/XP/комиссия — только из тарифа
        pass
    elif task_type in OWNER_ONLY_TYPES:
        # кампания и партнёрская услуга: только владелец платформы (админы и амбассадоры — нет)
        if not is_platform_owner(creator):
            raise TaskPermissionError(f"«{OWNER_ONLY_TYPES[task_type]}» создаёт только владелец")
    elif not can_create_task(creator):
        raise TaskPermissionError("need ambassador, admin or owner role")

    if not title.strip() or not description.strip():
        raise TaskError("title and description required")

    override_bp = commission_bp
    commission_bp = None
    partner_user_id: int | None = None
    if task_type == PARTNER:
        partner = await _partner_by_tg(session, partner_telegram_id)
        partner_user_id = partner.id
        raw = await get_setting(session, tariff_svc.KEY)
        tariff = raw if isinstance(raw, dict) else tariff_svc.DEFAULT
        if reward is None:
            raise TaskError("цена: укажите сумму TON")
        try:
            pq = tariff_svc.quote_partner(tariff, amount=Decimal(reward), fee_bp=override_bp)
        except tariff_svc.TaskTariffError as e:
            raise TaskError(str(e)) from e
        if isinstance(total_slots, bool) or not 1 <= int(total_slots) <= MAX_SLOTS:
            raise TaskError(f"число продаж: от 1 до {MAX_SLOTS}")
        reward = Decimal(pq.amount)
        commission_bp = int(pq.fee_bp)
        if xp_reward is None:
            xp_reward = int(pq.xp)
        elif isinstance(xp_reward, bool) or not 0 <= int(xp_reward) <= tariff_svc.MAX_XP:
            raise TaskError(f"XP: от 0 до {tariff_svc.MAX_XP}")
        target_url = _validate_optional_url(target_url)
    elif task_type == CAMPAIGN:
        raw = await get_setting(session, tariff_svc.KEY)
        tariff = raw if isinstance(raw, dict) else tariff_svc.DEFAULT
        if reward is None:
            raise TaskError("награда за выполнение: укажите сумму TON")
        try:
            q = tariff_svc.quote_campaign(
                tariff, reward=Decimal(reward), slots=total_slots, commission_bp=override_bp
            )
        except tariff_svc.TaskTariffError as e:
            raise TaskError(str(e)) from e
        reward = Decimal(q.reward)
        commission_bp = int(q.commission_bp)
        if xp_reward is None:
            xp_reward = int(q.xp)
        elif isinstance(xp_reward, bool) or not 0 <= int(xp_reward) <= tariff_svc.MAX_XP:
            raise TaskError(f"XP: от 0 до {tariff_svc.MAX_XP}")
        target_url = _validate_optional_url(target_url)
    elif task_type == VISIT:
        raw = await get_setting(session, tariff_svc.KEY)
        try:
            q = tariff_svc.quote_visit(raw if isinstance(raw, dict) else tariff_svc.DEFAULT, slots=total_slots)
        except tariff_svc.TaskTariffError as e:
            raise TaskError(str(e)) from e
        # клиентские reward/xp для visit игнорируем (снимок с тарифа)
        reward = Decimal(q.reward)
        xp_reward = int(q.xp)
        commission_bp = int(q.commission_bp)
        target_url = _validate_visit_url(target_url)
    else:
        if reward is None or reward <= 0:
            raise TaskError("reward must be positive")
        if total_slots < 1 or total_slots > MAX_SLOTS:
            raise TaskError("invalid slots")
        if xp_reward is None:
            xp_reward = 10

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
        xp_reward=max(0, int(xp_reward or 0)),
        commission_bp=commission_bp,
        partner_user_id=partner_user_id,
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
    task = await _lock_task(session, task_id)
    if not task:
        raise TaskError("task not found")
    if not _can_edit_task(actor, task):
        raise TaskPermissionError("cannot edit this task")
    if task.status == "completed" and task.task_type != PARTNER:
        raise TaskStateError("completed task is frozen")

    if task_type is not None and task_type != task.task_type:
        for t in (task.task_type, task_type):
            if t in OWNER_ONLY_TYPES:
                raise TaskStateError(f"Тип «{OWNER_ONLY_TYPES[t]}» нельзя сменить.")
    if task.task_type in OWNER_ONLY_TYPES and not is_platform_owner(actor):
        raise TaskPermissionError(f"«{OWNER_ONLY_TYPES[task.task_type]}» меняет только владелец")
    if task.task_type == PARTNER:
        # бюджета нет: цена и число продаж действуют на следующие покупки, прошлые не трогаем
        if reward is not None:
            raw = await get_setting(session, tariff_svc.KEY)
            try:
                pq = tariff_svc.quote_partner(
                    raw if isinstance(raw, dict) else tariff_svc.DEFAULT,
                    amount=Decimal(reward),
                    fee_bp=task.commission_bp,
                )
            except tariff_svc.TaskTariffError as e:
                raise TaskError(str(e)) from e
            task.reward = Decimal(pq.amount)
        if total_slots is not None:
            if not max(1, task.filled_slots) <= total_slots <= MAX_SLOTS:
                raise TaskError(f"число продаж: от {max(1, task.filled_slots)} до {MAX_SLOTS}")
            task.total_slots = total_slots
            if task.status == "completed" and task.filled_slots < total_slots:
                task.status = "paused"
        if xp_reward is not None and not 0 <= int(xp_reward) <= tariff_svc.MAX_XP:
            raise TaskError(f"XP: от 0 до {tariff_svc.MAX_XP}")
        if target_url is not None:
            task.target_url = _validate_optional_url(target_url)  # "" — убрать ссылку
        if title is not None:
            task.title = title.strip()[:255]
        if description is not None:
            task.description = description.strip()
        if min_level is not None:
            task.min_level = max(1, min_level)
        if xp_reward is not None:
            task.xp_reward = int(xp_reward)
        await session.flush()
        return _view(task)
    if task.task_type == CAMPAIGN:
        if reward is not None:
            try:
                reward = Decimal(tariff_svc.nano_to_ton(tariff_svc.ton_to_nano(Decimal(reward), name="награда")))
            except tariff_svc.TaskTariffError as e:
                raise TaskError(str(e)) from e
            if reward * tariff_svc.NANO_PER_TON > tariff_svc.MAX_REWARD_NANO:
                raise TaskError("награда за выполнение: не больше 100 TON")
        if target_url is not None:
            target_url = _validate_optional_url(target_url)

    if task.task_type == VISIT:
        if reward is not None and Decimal(reward) != Decimal(task.reward):
            raise TaskStateError("Награда «Перехода» задаётся тарифом и не меняется.")
        if xp_reward is not None and int(xp_reward) != int(task.xp_reward):
            raise TaskStateError("XP «Перехода» задаётся тарифом и не меняется.")
        if task_type is not None and task_type != VISIT:
            raise TaskStateError("Тип «Переход» нельзя сменить.")
        if target_url is not None:
            target_url = _validate_visit_url(target_url)
        if total_slots is not None and not (task.budget_locked and task.budget_locked > 0):
            raw = await get_setting(session, tariff_svc.KEY)
            cfg = tariff_svc.normalize(raw if isinstance(raw, dict) else tariff_svc.DEFAULT)["visit"]
            if not cfg["min_slots"] <= total_slots <= cfg["max_slots"]:
                raise TaskError(f"число выполнений: от {cfg['min_slots']} до {cfg['max_slots']}")

    if task.budget_locked and task.budget_locked > 0:
        # Опубликованное задание (активное или на паузе): деньги уже списаны.
        old_reward = Decimal(task.reward)
        new_reward = Decimal(reward) if reward is not None else old_reward
        new_slots = total_slots if total_slots is not None else task.total_slots
        if new_reward < old_reward:
            raise TaskStateError("После публикации награду можно только повысить.")
        if new_slots < task.total_slots:
            raise TaskStateError("После публикации число мест можно только увеличить.")
        if new_slots > MAX_SLOTS:
            raise TaskError("invalid total_slots")
        # Доплата: новые обязательства по незанятым местам минус старые, плюс комиссия на разницу.
        left_old = task.total_slots - task.filled_slots
        left_new = new_slots - task.filled_slots
        extra = _q(new_reward * left_new - old_reward * left_old)
        if extra > 0:
            from app.services import task_owner as owner_svc

            await owner_svc.ensure_accounting(session, task)
            total = extra + await _commission(session, extra, bp=task.commission_bp)
            await _charge_creator(session, task, total, f"Доплата бюджета задания #{task.id}")
            task.budget_locked = _q(Decimal(task.budget_locked) + total)
            task.creator_payout_nano += int(extra * tariff_svc.NANO_PER_TON)
            task.creator_commission_nano += int((total - extra) * tariff_svc.NANO_PER_TON)
        task.reward = new_reward
        task.total_slots = new_slots
    else:
        if reward is not None and task.status in ("draft", "pending_approval", "paused", "rejected"):
            if reward <= 0:
                raise TaskError("reward must be positive")
            task.reward = reward
        if total_slots is not None:
            if total_slots < max(1, task.filled_slots) or total_slots > MAX_SLOTS:
                raise TaskError("invalid total_slots")
            task.total_slots = total_slots

    if title is not None:
        task.title = title.strip()[:255]
    if description is not None:
        task.description = description.strip()
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
    task = await _lock_task(session, task_id)
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

    if task.task_type == PARTNER:
        # партнёрская услуга без бюджета: деньги идут от покупателя к партнёру в момент покупки
        if not is_platform_owner(actor):
            raise TaskPermissionError("«Партнёрскую услугу» публикует только владелец")
        if task.filled_slots >= task.total_slots:
            raise TaskStateError("продажи закончились — увеличьте число продаж")
        task.status = "active"
        await session.flush()
        return _view(task)

    if task.budget_locked and task.budget_locked > 0 and task.status == "paused":
        # Возобновление без нового списания — только если оставшиеся места покрыты оплаченным бюджетом.
        need = _q(Decimal(task.reward) * (task.total_slots - task.filled_slots))
        if await paid_out(session, task.id) + need > Decimal(task.budget_locked):
            raise TaskBudgetError(
                "Бюджет задания не покрывает оставшиеся места — возобновить нельзя. Обратитесь к администратору."
            )
        task.status = "active"
        await session.flush()
        return _view(task)

    payout = _q(Decimal(task.reward) * task.total_slots)
    total = payout + await _commission(session, payout, bp=task.commission_bp)

    await _charge_creator(session, task, total, f"Бюджет задания #{task.id}")
    task.budget_locked = total
    # учёт в нанотонах (services/task_owner): выплаты и комиссия создателя
    task.creator_payout_nano = int(payout * tariff_svc.NANO_PER_TON)
    task.creator_commission_nano = int((total - payout) * tariff_svc.NANO_PER_TON)
    task.platform_payout_nano = task.platform_payout_nano or 0
    task.status = "active"
    await session.flush()
    return _view(task)


async def pause_task(session: AsyncSession, *, task_id: int, actor: User) -> TaskView:
    task = await session.get(Task, task_id)
    if not task:
        raise TaskError("task not found")
    if not _can_edit_task(actor, task) and not can_manage_any_task(actor):
        raise TaskPermissionError("not allowed")
    if task.task_type in OWNER_ONLY_TYPES and not is_platform_owner(actor):
        raise TaskPermissionError(f"«{OWNER_ONLY_TYPES[task.task_type]}» ставит на паузу только владелец")
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
    if task and task.task_type == PARTNER:
        raise TaskError("Это покупка: нажмите «Купить».")
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

    # Блокируем задание и перечитываем заявку: проверки бюджета и мест идут уже под блокировкой.
    task = await _lock_task(session, sub.task_id)
    if not task:
        raise TaskError("task not found")
    await session.refresh(sub)
    if sub.status != "pending":
        raise TaskStateError("submission not pending")

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
        reward = Decimal(task.reward)
        if task.creator_payout_nano is not None:
            # пул выплат: деньги создателя + платформы (без комиссии)
            pool = Decimal(int(task.creator_payout_nano) + int(task.platform_payout_nano or 0)) / tariff_svc.NANO_PER_TON
        else:
            pool = Decimal(task.budget_locked or 0)
        if await paid_out(session, task.id) + reward > pool:
            raise TaskBudgetError(
                "Бюджет задания исчерпан: эта выплата превысила бы оплаченный бюджет. Заявка осталась на проверке."
            )
        sub.status = "approved"
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
            await add_xp(session, worker, int(task.xp_reward), "task")

        task.filled_slots += 1
        if task.filled_slots >= task.total_slots and task.status != "cancelled":
            task.status = "completed"
    else:
        sub.status = "rejected"
        if task.status == "cancelled":
            # задание отменено: резерв под эту заявку освободился — вернуть создателю
            from app.services import task_owner as owner_svc

            await session.flush()
            await owner_svc.refund_free(
                session, task, label=f"Возврат: заявка отклонена, задание #{task.id} отменено"
            )

    await session.flush()
    return sub


# ── Партнёрская услуга ────────────────────────────────────────────────────────


async def _partner_by_tg(session: AsyncSession, telegram_id: int | None) -> User:
    if telegram_id is None or isinstance(telegram_id, bool):
        raise TaskError("партнёр: укажите Telegram ID пользователя приложения")
    partner = await session.scalar(select(User).where(User.telegram_id == int(telegram_id)))
    if not partner:
        raise TaskError("партнёр: такого пользователя нет в приложении (пусть сначала откроет бота)")
    if getattr(partner, "is_banned", False):
        raise TaskError("партнёр заблокирован")
    return partner


async def close_task(session: AsyncSession, *, task_id: int, actor: User) -> TaskView:
    """Владелец закрывает партнёрскую услугу: новые покупки невозможны, прошлые не трогаем."""
    task = await _lock_task(session, task_id)
    if not task:
        raise TaskError("task not found")
    if task.task_type != PARTNER:
        raise TaskStateError("закрыть так можно только партнёрскую услугу")
    if not is_platform_owner(actor):
        raise TaskPermissionError("«Партнёрскую услугу» закрывает только владелец")
    task.status = "closed"
    await session.flush()
    return _view(task)


class PurchaseError(TaskError):
    pass


class PurchaseInsufficientError(TaskBudgetError):
    pass


@dataclass
class PurchaseResult:
    purchase: TaskPurchase
    already: bool


def _ton_from_nano(nano: int) -> Decimal:
    return _q(Decimal(int(nano)) / Decimal(tariff_svc.NANO_PER_TON))


async def has_purchased(session: AsyncSession, *, task_id: int, user_id: int) -> bool:
    return bool(
        await session.scalar(
            select(TaskPurchase.id).where(TaskPurchase.task_id == task_id, TaskPurchase.buyer_id == user_id)
        )
    )


async def buy_partner(session: AsyncSession, *, buyer: User, task_id: int) -> PurchaseResult:
    """Покупка партнёрской услуги одной транзакцией.

    Порядок блокировок: задание → пользователи по возрастанию id. Повторный вызов (двойной клик,
    повтор запроса) возвращает ту же покупку без нового списания: проверка под блокировкой задания
    и уникальный ключ (task_id, buyer_id) на случай гонки.
    Деньги: покупатель −amount, партнёр +(amount − fee), fee — доход платформы в task_purchases.fee_nano.
    Вызывающий делает commit; при ошибке — rollback, ничего не списано.
    """
    task = await _lock_task(session, task_id)
    if not task or task.task_type != PARTNER:
        raise TaskError("task not found")

    existing = await session.scalar(
        select(TaskPurchase).where(TaskPurchase.task_id == task.id, TaskPurchase.buyer_id == buyer.id)
    )
    if existing:
        return PurchaseResult(existing, True)

    if task.status != "active":
        raise TaskStateError("Услуга сейчас недоступна.")
    if task.filled_slots >= task.total_slots:
        raise TaskStateError("Продажи закончились.")
    if buyer.level < task.min_level:
        raise TaskError(f"Нужен уровень {task.min_level}.")
    if task.partner_user_id is None:
        raise TaskStateError("У услуги нет партнёра — покупка недоступна.")
    if task.partner_user_id == buyer.id:
        raise TaskError("Нельзя купить свою услугу.")

    bp = int(task.commission_bp if task.commission_bp is not None else 0)
    amount_nano = tariff_svc.ton_to_nano(Decimal(task.reward), name="цена")
    fee_nano = tariff_svc._commission_nano(amount_nano, bp)
    partner_nano = amount_nano - fee_nano
    amount = _ton_from_nano(amount_nano)

    # блокируем обоих по возрастанию id (без взаимных блокировок при встречных покупках)
    for uid in sorted({buyer.id, task.partner_user_id}):
        await balance_svc.get_user_for_update(session, uid)
    fresh_buyer = await session.get(User, buyer.id)
    if Decimal(fresh_buyer.balance) < amount:
        raise PurchaseInsufficientError(
            f"Недостаточно TON: нужно {_ton(amount)} TON, на балансе {_ton(Decimal(fresh_buyer.balance))} TON."
        )

    purchase = TaskPurchase(
        task_id=task.id,
        buyer_id=buyer.id,
        partner_id=task.partner_user_id,
        amount_nano=amount_nano,
        fee_nano=fee_nano,
        partner_nano=partner_nano,
        fee_bp=bp,
        xp=int(task.xp_reward or 0),
    )
    session.add(purchase)
    try:
        async with session.begin_nested():
            await session.flush()
    except IntegrityError:
        # параллельный запрос того же покупателя успел первым
        existing = await session.scalar(
            select(TaskPurchase).where(TaskPurchase.task_id == task.id, TaskPurchase.buyer_id == buyer.id)
        )
        if existing:
            return PurchaseResult(existing, True)
        raise

    title = task.title.strip()
    await balance_svc.debit(
        session,
        user_id=buyer.id,
        amount=amount,
        balance_type="partner",
        description=f"Покупка «{title}» (задание #{task.id})",
        reference_type="task_purchase",
        reference_id=purchase.id,
    )
    if partner_nano > 0:
        await balance_svc.credit(
            session,
            user_id=task.partner_user_id,
            amount=_ton_from_nano(partner_nano),
            balance_type="partner",
            description=(
                f"Продажа «{title}» (задание #{task.id}): {_ton(amount)} TON "
                f"− комиссия платформы {_ton(_ton_from_nano(fee_nano))} TON"
            ),
            reference_type="task_purchase",
            reference_id=purchase.id,
        )
    if purchase.xp:
        await add_xp(session, fresh_buyer, int(purchase.xp), "task")

    task.filled_slots += 1
    if task.filled_slots >= task.total_slots:
        task.status = "completed"
    await session.flush()
    return PurchaseResult(purchase, False)


async def partner_revenue_nano(session: AsyncSession, *, since: datetime | None = None) -> int:
    """Доход платформы с партнёрских продаж (сумма fee_nano) — для «Кассы»."""
    q = select(func.coalesce(func.sum(TaskPurchase.fee_nano), 0))
    if since is not None:
        q = q.where(TaskPurchase.created_at >= since)
    return int(await session.scalar(q) or 0)
