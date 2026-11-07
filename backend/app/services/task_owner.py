"""Управление любыми заданиями владельцем: отмена с возвратом, добавление выполнений, смена цены.

Только владелец платформы (is_platform_owner). Всё в одной транзакции вызывающего (он делает commit,
при ошибке — rollback), каждое действие пишется в task_owner_actions (кто, что, когда, суммы).

Учёт бюджета — целые нанотоны, кратные кванту баланса (10 нанотон):
- creator_payout_nano — выплаты исполнителям, оплаченные создателем;
- creator_commission_nano — комиссия, оплаченная создателем;
- platform_payout_nano — выплаты, которые взяла на себя платформа (бесплатные выполнения, «за счёт платформы»).
Пул выплат = creator_payout + platform_payout. Выплаты исполнителям тратят деньги создателя первыми,
поэтому деньги платформы никогда не возвращаются создателю.

Комиссия = floor(выплаты × bp / 10000) вниз до кванта (как в тарифе). Возврат комиссии считается так же
от возвращаемых выплат и не больше оплаченной комиссии. Итоговый возврат никогда не больше того, что
создатель реально заплатил за задание по журналу баланса (списания минус уже сделанные возвраты).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.balance import BalanceHistory
from app.models.task import Task, TaskOwnerAction, TaskSubmission
from app.models.user import User
from app.services import balance as balance_svc
from app.services import task_tariff as tariff_svc
from app.services.roles import is_platform_owner
from app.services.tasks import (
    MAX_SLOTS,
    PARTNER,
    TaskBudgetError,
    TaskError,
    TaskPermissionError,
    TaskStateError,
    TaskView,
    _lock_task,
    _platform_commission_bp,
    _view,
    paid_out,
)

NANO = tariff_svc.NANO_PER_TON
QUANT = tariff_svc.LEDGER_QUANTUM_NANO
UNPUBLISHED = ("draft", "pending_approval", "rejected")
FINAL = ("cancelled", "closed")
CHARGE_MODES = ("charge", "free")
PRICE_MODES = ("creator", "absorb")


def to_nano(v) -> int:
    n = int((Decimal(str(v)) * NANO).to_integral_value())
    return n - n % QUANT


def from_nano(n: int) -> Decimal:
    return (Decimal(int(n)) / Decimal(NANO)).quantize(Decimal("0.00000001"))


def ton_str(n: int) -> str:
    return tariff_svc.nano_to_ton(abs(int(n)))


def commission_nano(payout_nano: int, bp: int) -> int:
    return tariff_svc._commission_nano(max(0, int(payout_nano)), int(bp))


@dataclass
class ManageResult:
    task: TaskView
    already: bool = False
    creator_delta_nano: int = 0  # + списано с создателя, − возвращено
    platform_delta_nano: int = 0  # + платформа добавила, − платформа оставила себе
    note: str | None = None


def _require_owner(actor: User) -> None:
    if not is_platform_owner(actor):
        raise TaskPermissionError("Управлять заданиями может только владелец")


async def _locked(session: AsyncSession, task_id: int) -> Task:
    task = await _lock_task(session, task_id)
    if not task:
        raise TaskError("task not found")
    return task


async def effective_bp(session: AsyncSession, task: Task) -> int:
    """Снимок комиссии на задании; у старых (NULL) — task_platform_commission_bp."""
    if task.commission_bp is not None:
        return int(task.commission_bp)
    return await _platform_commission_bp(session)


async def ledger_net_charged_nano(session: AsyncSession, task: Task) -> int:
    """Сколько создатель реально заплатил за задание: списания (tasks) минус возвраты (task_refund)."""
    base = select(func.coalesce(func.sum(BalanceHistory.amount), 0)).where(
        BalanceHistory.user_id == task.creator_id,
        BalanceHistory.reference_type == "task",
        BalanceHistory.reference_id == task.id,
    )
    debits = await session.scalar(
        base.where(BalanceHistory.operation_type == "debit", BalanceHistory.balance_type == "tasks")
    )
    refunds = await session.scalar(
        base.where(BalanceHistory.operation_type == "credit", BalanceHistory.balance_type == "task_refund")
    )
    return max(0, to_nano(debits or 0) - to_nano(refunds or 0))


async def estimate_accounting(session: AsyncSession, task: Task) -> tuple[int, int, int]:
    """(creator_payout, creator_commission, platform_payout) без записи в задание.

    Старое задание без разбивки: оцениваем её из budget_locked (= выплаты + комиссия):
    payout = ceil(B × 10000 / (10000 + bp)) вверх до кванта, commission = B − payout. Ошибка оценки
    не опасна: итоговый возврат всё равно ограничен реально оплаченным по журналу.
    """
    if task.creator_payout_nano is not None:
        return (
            int(task.creator_payout_nano),
            int(task.creator_commission_nano or 0),
            int(task.platform_payout_nano or 0),
        )
    b = to_nano(task.budget_locked or 0)
    if b <= 0:
        return 0, 0, 0
    bp = await effective_bp(session, task)
    p = -(-b * 10_000 // (10_000 + bp))
    p = min(b, p + (-p % QUANT))
    return p, b - p, 0


async def ensure_accounting(session: AsyncSession, task: Task) -> None:
    cp, cc, pp = await estimate_accounting(session, task)
    task.creator_payout_nano, task.creator_commission_nano, task.platform_payout_nano = cp, cc, pp


async def pending_count(session: AsyncSession, task_id: int) -> int:
    return int(
        await session.scalar(
            select(func.count(TaskSubmission.id)).where(
                TaskSubmission.task_id == task_id, TaskSubmission.status == "pending"
            )
        )
        or 0
    )


async def _log(
    session: AsyncSession,
    task: Task,
    actor: User | None,
    action: str,
    *,
    mode: str | None = None,
    creator_delta: int = 0,
    platform_delta: int = 0,
    **details,
) -> None:
    session.add(
        TaskOwnerAction(
            task_id=task.id,
            actor_id=actor.id if actor else None,
            action=action,
            mode=mode,
            creator_delta_nano=int(creator_delta),
            platform_delta_nano=int(platform_delta),
            details=json.dumps(details, ensure_ascii=False, default=str) if details else None,
        )
    )
    await session.flush()


async def _refund_creator(session: AsyncSession, task: Task, payout: int, comm: int, label: str) -> tuple[int, int]:
    """Вернуть создателю payout+comm (с потолком по журналу). Возвращает (выплаты, комиссия) возврата."""
    payout = max(0, min(payout, task.creator_payout_nano or 0))
    comm = max(0, min(comm, task.creator_commission_nano or 0))
    cap = await ledger_net_charged_nano(session, task)
    total = payout + comm
    if total > cap:
        comm = min(comm, cap)
        payout = cap - comm
        total = cap
    if total <= 0:
        return 0, 0
    await balance_svc.credit(
        session,
        user_id=task.creator_id,
        amount=from_nano(total),
        balance_type="task_refund",
        description=label,
        reference_type="task",
        reference_id=task.id,
    )
    task.creator_payout_nano -= payout
    task.creator_commission_nano -= comm
    task.budget_locked = from_nano(max(0, to_nano(task.budget_locked or 0) - total))
    return payout, comm


async def _charge_creator(session: AsyncSession, task: Task, payout: int, comm: int, label: str) -> int:
    total = payout + comm
    if total <= 0:
        return 0
    try:
        await balance_svc.debit(
            session,
            user_id=task.creator_id,
            amount=from_nano(total),
            balance_type="tasks",
            description=label,
            reference_type="task",
            reference_id=task.id,
        )
    except balance_svc.InsufficientBalanceError as e:
        raise TaskBudgetError(
            f"Недостаточно TON у создателя задания: нужно {ton_str(total)} TON. "
            "Выберите «за счёт платформы» или пусть создатель пополнит баланс."
        ) from e
    task.creator_payout_nano += payout
    task.creator_commission_nano += comm
    task.budget_locked = from_nano(to_nano(task.budget_locked or 0) + total)
    return total


async def refund_free(session: AsyncSession, task: Task, *, label: str) -> int:
    """Вернуть создателю его деньги за свободные места (не выплаченные и не зарезервированные под заявки).

    Выплаты тратят деньги создателя первыми, резерв под заявки на проверке — тоже из них.
    Повторный вызов ничего не вернёт, если свободных денег создателя не осталось.
    """
    await ensure_accounting(session, task)
    paid = to_nano(await paid_out(session, task.id))
    reserve = await pending_count(session, task.id) * to_nano(task.reward)
    free_payout = max(0, (task.creator_payout_nano or 0) - paid - reserve)
    if free_payout <= 0:
        return 0
    bp = await effective_bp(session, task)
    p, c = await _refund_creator(session, task, free_payout, commission_nano(free_payout, bp), label)
    return p + c


# ── Действия владельца ────────────────────────────────────────────────────────


async def cancel_task(session: AsyncSession, *, task_id: int, actor: User) -> ManageResult:
    """Отменить задание. Свободные деньги создателя — назад на баланс; заявки на проверке остаются,
    их можно одобрить (выплата из резерва) или отклонить (тогда резерв тоже вернётся создателю)."""
    _require_owner(actor)
    task = await _locked(session, task_id)
    if task.task_type == PARTNER:
        if task.status in FINAL:
            return ManageResult(_view(task), already=True)
        prev = task.status
        task.status = "closed"
        await _log(session, task, actor, "cancel", prev_status=prev, note="продажи закрыты, бюджета нет")
        return ManageResult(_view(task), note="Продажи закрыты. Бюджета нет, возвращать нечего.")
    if task.status in FINAL:
        return ManageResult(_view(task), already=True)

    prev = task.status
    pending = await pending_count(session, task.id)
    task.status = "cancelled"
    refunded = await refund_free(
        session, task, label=f"Возврат: задание #{task.id} отменено владельцем"
    )
    await _log(
        session, task, actor, "cancel",
        creator_delta=-refunded, prev_status=prev, pending=pending,
        filled=task.filled_slots, total_slots=task.total_slots,
    )
    note = f"Возвращено создателю {ton_str(refunded)} TON." if refunded else "Возвращать нечего."
    if pending:
        note += f" Заявок на проверке: {pending}, их можно одобрить или отклонить."
    await session.flush()
    return ManageResult(_view(task), creator_delta_nano=-refunded, note=note)


async def add_slots(
    session: AsyncSession, *, task_id: int, actor: User, count: int, mode: str = "charge"
) -> ManageResult:
    """Добавить выполнения. charge — создатель платит выплаты + комиссию; free — за счёт платформы."""
    _require_owner(actor)
    if mode not in CHARGE_MODES:
        raise TaskError("режим: charge или free")
    if isinstance(count, bool) or not isinstance(count, int) or count < 1:
        raise TaskError("сколько добавить: целое число от 1")
    task = await _locked(session, task_id)
    if task.status in FINAL:
        raise TaskStateError("Задание отменено или закрыто.")
    if task.total_slots + count > MAX_SLOTS:
        raise TaskError(f"всего выполнений не больше {MAX_SLOTS}")

    creator_delta = platform_delta = 0
    if task.task_type == PARTNER:
        task.total_slots += count
        note = f"Добавлено продаж: {count}."
    elif task.status in UNPUBLISHED:
        if mode == "free":
            raise TaskStateError("Бесплатно добавить можно только опубликованному заданию.")
        task.total_slots += count
        note = f"Добавлено выполнений: {count}. Создатель оплатит их при публикации."
    else:
        await ensure_accounting(session, task)
        payout = to_nano(task.reward) * count
        if mode == "charge":
            comm = commission_nano(payout, await effective_bp(session, task))
            creator_delta = await _charge_creator(
                session, task, payout, comm,
                f"Доплата: +{count} выполнений, задание #{task.id} (владелец)",
            )
            note = f"Списано с создателя {ton_str(creator_delta)} TON."
        else:
            task.platform_payout_nano += payout
            platform_delta = payout
            note = f"За счёт платформы: {ton_str(payout)} TON."
        task.total_slots += count
    if task.status == "completed" and task.filled_slots < task.total_slots:
        task.status = "active"
    await _log(
        session, task, actor, "add_slots", mode=mode,
        creator_delta=creator_delta, platform_delta=platform_delta,
        count=count, total_slots=task.total_slots,
    )
    return ManageResult(_view(task), creator_delta_nano=creator_delta, platform_delta_nano=platform_delta, note=note)


async def set_price(
    session: AsyncSession, *, task_id: int, actor: User, reward, mode: str = "creator"
) -> ManageResult:
    """Новая награда за выполнение — для выплат после изменения (включая заявки на проверке).

    Разница бюджета = (новая − старая) × оставшиеся места (всего − выполнено).
    creator — создатель доплачивает (с комиссией) или получает возврат (с комиссией);
    absorb — разницу берёт на себя платформа (рост) или оставляет себе (снижение).
    """
    _require_owner(actor)
    if mode not in PRICE_MODES:
        raise TaskError("режим: creator или absorb")
    task = await _locked(session, task_id)
    if task.status in FINAL:
        raise TaskStateError("Задание отменено или закрыто.")
    try:
        new_nano = tariff_svc.ton_to_nano(Decimal(str(reward)), name="цена")
    except (tariff_svc.TaskTariffError, ArithmeticError, ValueError) as e:
        raise TaskError(str(e)) from e
    if new_nano > tariff_svc.MAX_REWARD_NANO:
        raise TaskError("цена: не больше 100 TON")
    old_nano = to_nano(task.reward)
    if new_nano == old_nano:
        return ManageResult(_view(task), already=True, note="Цена не изменилась.")

    creator_delta = platform_delta = 0
    published = task.task_type != PARTNER and task.status not in UNPUBLISHED
    if published:
        await ensure_accounting(session, task)
        left = max(0, task.total_slots - task.filled_slots)
        delta = (new_nano - old_nano) * left
        bp = await effective_bp(session, task)
        if delta > 0:
            if mode == "creator":
                creator_delta = await _charge_creator(
                    session, task, delta, commission_nano(delta, bp),
                    f"Доплата: новая цена {ton_str(new_nano)} TON, задание #{task.id} (владелец)",
                )
            else:
                task.platform_payout_nano += delta
                platform_delta = delta
        elif delta < 0:
            d = -delta
            # Освобождаем сначала оставшиеся деньги платформы (выплаты тратят деньги создателя первыми),
            # затем свободные деньги создателя (его выплаты минус уже выплаченное).
            from_platform = min(d, task.platform_payout_nano or 0)
            task.platform_payout_nano -= from_platform
            platform_delta -= from_platform
            paid = to_nano(await paid_out(session, task.id))
            from_creator = min(d - from_platform, max(0, (task.creator_payout_nano or 0) - paid))
            if from_creator > 0:
                refunded_payout = 0
                if mode == "creator":
                    rp, rc = await _refund_creator(
                        session, task, from_creator, commission_nano(from_creator, bp),
                        f"Возврат: цена снижена до {ton_str(new_nano)} TON, задание #{task.id}",
                    )
                    creator_delta = -(rp + rc)
                    refunded_payout = rp
                # absorb (или срезанный потолком возврат): эти выплаты остаются платформе как доход
                kept = from_creator - refunded_payout
                if kept > 0:
                    task.creator_payout_nano -= kept
                    platform_delta -= kept
    task.reward = from_nano(new_nano)
    await _log(
        session, task, actor, "set_price", mode=mode if published else None,
        creator_delta=creator_delta, platform_delta=platform_delta,
        old=ton_str(old_nano), new=ton_str(new_nano),
    )
    if creator_delta > 0:
        note = f"Списано с создателя {ton_str(creator_delta)} TON."
    elif creator_delta < 0:
        note = f"Возвращено создателю {ton_str(creator_delta)} TON."
    elif platform_delta > 0:
        note = f"Платформа добавила {ton_str(platform_delta)} TON."
    elif platform_delta < 0:
        note = f"Платформа оставила себе {ton_str(platform_delta)} TON."
    else:
        note = "Цена изменена."
    return ManageResult(_view(task), creator_delta_nano=creator_delta, platform_delta_nano=platform_delta, note=note)


@dataclass
class OwnerSummary:
    task: TaskView
    pending: int
    paid_out_nano: int
    creator_payout_nano: int
    creator_commission_nano: int
    platform_payout_nano: int
    charged_nano: int
    refundable_nano: int
    commission_bp: int
    log: list[TaskOwnerAction]


async def summary(session: AsyncSession, *, task_id: int, actor: User) -> OwnerSummary:
    """Сводка для панели «Управление» (без изменений в БД: оценка старых заданий не сохраняется)."""
    _require_owner(actor)
    task = await session.get(Task, task_id)
    if not task:
        raise TaskError("task not found")
    cp, cc, pp = await estimate_accounting(session, task)
    paid = to_nano(await paid_out(session, task.id))
    pending = await pending_count(session, task.id)
    bp = await effective_bp(session, task)
    charged = await ledger_net_charged_nano(session, task)
    free = max(0, (cp or 0) - paid - pending * to_nano(task.reward))
    refundable = 0 if task.task_type == PARTNER or task.status in FINAL else min(
        charged, free + min(commission_nano(free, bp), cc or 0)
    )
    log = (
        await session.execute(
            select(TaskOwnerAction)
            .where(TaskOwnerAction.task_id == task.id)
            .order_by(TaskOwnerAction.id.desc())
            .limit(20)
        )
    ).scalars().all()
    return OwnerSummary(
        task=_view(task), pending=pending, paid_out_nano=paid,
        creator_payout_nano=cp or 0, creator_commission_nano=cc or 0, platform_payout_nano=pp or 0,
        charged_nano=charged, refundable_nano=refundable, commission_bp=bp, log=list(log),
    )


async def list_all(session: AsyncSession, *, actor: User, status: str | None = None, limit: int = 50, offset: int = 0) -> list[TaskView]:
    _require_owner(actor)
    q = select(Task).order_by(Task.id.desc()).limit(min(limit, 100)).offset(max(0, offset))
    if status:
        q = q.where(Task.status == status)
    return [_view(t) for t in (await session.execute(q)).scalars().all()]
