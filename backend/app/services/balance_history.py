"""История баланса пользователя для экрана «Кошелёк».

Читает неизменяемый журнал `balance_history` (его пишут только balance.credit/debit) и переводит
balance_type/operation_type в стабильный `kind` и русскую подпись. К выводам подмешивается статус
заявки, к первой странице — пополнения, которые сеть уже видела, но не зачислила (меньше минимума).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import and_, not_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.balance import BalanceHistory
from app.models.deposit import TonDeposit
from app.models.withdraw import WithdrawRequest

PAGE_SIZE = 30
MAX_PAGE_SIZE = 100
FILTERS = ("all", "deposits", "withdrawals", "earnings", "spending")
PENDING_DEPOSIT_DAYS = 30

# balance_type → (kind при начислении, kind при списании)
_KINDS: dict[str, tuple[str, str]] = {
    "ton_deposit": ("deposit", "deposit"),
    "withdraw": ("withdraw_refund", "withdraw"),
    "tasks": ("task_reward", "task_budget"),
    "daily": ("daily", "daily"),
    "miner": ("miner", "miner"),
    "upgrade_burn": ("upgrade", "upgrade"),
    "prize_wheel": ("wheel", "wheel"),
    "promo": ("promo", "promo"),
    "tower_prize": ("tower_prize", "tower_prize"),
}

LABELS: dict[str, str] = {
    "deposit": "Пополнение TON",
    "withdraw": "Вывод TON",
    "withdraw_refund": "Возврат вывода",
    "task_reward": "Награда за задание",
    "task_budget": "Бюджет задания",
    "daily": "Ежедневный бонус",
    "miner": "Сбор майнера",
    "upgrade": "Усиление майнера",
    "wheel": "Рулетка",
    "promo": "Промокод",
    "tower_prize": "Приз «Башни»",
    "credit": "Начисление",
    "debit": "Списание",
}

WITHDRAW_STATUS_RU = {"pending": "в обработке", "paid": "выплачено", "rejected": "отклонено"}

# у каких видов в подписи полезно описание из журнала (номер задания, приз рулетки, месяц «Башни»)
_DETAIL_KINDS = {"task_reward", "task_budget", "wheel", "tower_prize", "promo"}


def kind_of(operation_type: str, balance_type: str | None) -> str:
    pair = _KINDS.get(balance_type or "")
    if pair:
        return pair[0] if operation_type == "credit" else pair[1]
    return "credit" if operation_type == "credit" else "debit"


def group_of(kind: str, operation_type: str) -> str:
    if kind == "deposit":
        return "deposits"
    if kind in ("withdraw", "withdraw_refund"):
        return "withdrawals"
    return "earnings" if operation_type == "credit" else "spending"


def _filter_clause(flt: str):
    bt = BalanceHistory.balance_type
    if flt == "deposits":
        return bt == "ton_deposit"
    if flt == "withdrawals":
        return bt == "withdraw"
    if flt == "earnings":
        return and_(BalanceHistory.operation_type == "credit", not_(bt.in_(("ton_deposit", "withdraw"))))
    if flt == "spending":
        return and_(BalanceHistory.operation_type == "debit", not_(bt.in_(("ton_deposit", "withdraw"))))
    return None


def _aware(dt: datetime | None) -> datetime | None:
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _ton(v) -> str:
    d = Decimal(str(v)).quantize(Decimal("0.00000001"))
    s = format(d.normalize(), "f")
    return s


@dataclass
class HistoryPage:
    items: list[dict]
    next_cursor: int | None
    pending: list[dict]


async def _withdraw_statuses(session: AsyncSession, user_id: int, rows: list[BalanceHistory]) -> dict[int, WithdrawRequest]:
    """id строки журнала → заявка на вывод.

    Новые строки ссылаются на заявку через reference_id. У старых холдов reference_id пустой —
    сопоставляем с заявкой той же суммы, созданной в пределах минуты (одна заявка — одна строка).
    """
    wd = [r for r in rows if r.balance_type == "withdraw"]
    if not wd:
        return {}
    times = [_aware(r.created_at) for r in wd]
    lo, hi = min(times) - timedelta(minutes=1), max(times) + timedelta(minutes=1)
    ids = {r.reference_id for r in wd if r.reference_id}
    q = select(WithdrawRequest).where(WithdrawRequest.user_id == user_id)
    reqs = (await session.scalars(q.where((WithdrawRequest.id.in_(ids)) | (WithdrawRequest.created_at.between(lo, hi))))).all()
    by_id = {r.id: r for r in reqs}
    out: dict[int, WithdrawRequest] = {}
    used: set[int] = set()
    for r in wd:
        if r.reference_id and r.reference_id in by_id:
            out[r.id] = by_id[r.reference_id]
            used.add(r.reference_id)
    for r in wd:
        if r.reference_id or r.operation_type != "debit":
            continue
        t = _aware(r.created_at)
        best = None
        for q_ in reqs:
            if q_.id in used or Decimal(q_.amount) != Decimal(r.amount):
                continue
            dt = abs((_aware(q_.created_at) - t).total_seconds())
            if dt <= 60 and (best is None or dt < best[0]):
                best = (dt, q_)
        if best:
            out[r.id] = best[1]
            used.add(best[1].id)
    return out


def _item(r: BalanceHistory, req: WithdrawRequest | None) -> dict:
    kind = kind_of(r.operation_type, r.balance_type)
    sign = "" if r.operation_type == "credit" else "-"
    item = {
        "id": r.id,
        "kind": kind,
        "group": group_of(kind, r.operation_type),
        "label": LABELS[kind],
        "detail": r.description if kind in _DETAIL_KINDS else None,
        "amount": sign + _ton(r.amount),
        "balance_after": _ton(r.balance_after),
        "created_at": _aware(r.created_at).isoformat(),
        "status": None,
        "status_label": None,
    }
    if kind == "deposit" and r.description and "вручную" in r.description:
        item["detail"] = "Зачислено вручную"
    if req is not None and kind == "withdraw":
        item["status"] = req.status
        item["status_label"] = WITHDRAW_STATUS_RU.get(req.status, req.status)
        item["detail"] = f"Заявка #{req.id}"
    elif req is not None and kind == "withdraw_refund":
        item["detail"] = f"Заявка #{req.id} отклонена"
    return item


async def _pending_deposits(session: AsyncSession, user_id: int) -> list[dict]:
    since = datetime.now(timezone.utc) - timedelta(days=PENDING_DEPOSIT_DAYS)
    rows = (
        await session.scalars(
            select(TonDeposit)
            .where(TonDeposit.user_id == user_id, TonDeposit.status == "below_min", TonDeposit.created_at >= since)
            .order_by(TonDeposit.id.desc())
            .limit(10)
        )
    ).all()
    return [
        {
            "id": f"dep-{d.id}",
            "kind": "deposit_pending",
            "group": "deposits",
            "label": "Пополнение TON",
            "detail": "Меньше минимума — зачислим после проверки",
            "amount": _ton(d.amount_ton),
            "balance_after": None,
            "created_at": (
                datetime.fromtimestamp(d.utime, timezone.utc) if d.utime else _aware(d.created_at)
            ).isoformat(),
            "status": "review",
            "status_label": "на проверке",
        }
        for d in rows
    ]


async def history(
    session: AsyncSession,
    *,
    user_id: int,
    flt: str = "all",
    cursor: int | None = None,
    limit: int = PAGE_SIZE,
) -> HistoryPage:
    if flt not in FILTERS:
        raise ValueError("unknown filter")
    limit = max(1, min(int(limit), MAX_PAGE_SIZE))
    q = select(BalanceHistory).where(BalanceHistory.user_id == user_id)
    clause = _filter_clause(flt)
    if clause is not None:
        q = q.where(clause)
    if cursor is not None:
        q = q.where(BalanceHistory.id < cursor)
    rows = list((await session.scalars(q.order_by(BalanceHistory.id.desc()).limit(limit + 1))).all())
    more = len(rows) > limit
    rows = rows[:limit]
    reqs = await _withdraw_statuses(session, user_id, rows)
    items = [_item(r, reqs.get(r.id)) for r in rows]
    pending = []
    if cursor is None and flt in ("all", "deposits"):
        pending = await _pending_deposits(session, user_id)
    return HistoryPage(items=items, next_cursor=rows[-1].id if more and rows else None, pending=pending)
