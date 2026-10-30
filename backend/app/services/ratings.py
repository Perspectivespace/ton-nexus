"""Рейтинги: топ по уровню, топ исполнителей (задания), топ друзей («скоро») и сводка «Мои места».

- Уровень — за всё время: уровень ↓, опыт внутри уровня ↓, кто раньше зарегистрировался (id ↑).
  Месячный вариант (для призов) — «Опыт за месяц»: сумма `xp_events` за месяц по Москве.
- Задания — принятые заявки (`task_submissions.status = 'approved'`) по `reviewed_at`:
  за месяц по Москве или за всё время. При равенстве выше тот, кто набрал раньше (последнее принятие ↑).
- Друзья — приглашения ещё не записываются (`referred_by_id` всегда пуст), поэтому топ «скоро».
  Условие, при котором друг засчитывается, задаёт владелец: настройка `friend_rule`.
- Призы — та же модель, что у «Башни» (`tower_prizes`), свой бюджет на каждый топ:
  `level_prizes`, `tasks_prizes`, `friends_prizes`; по умолчанию выключены. Здесь только расчёт
  по текущему числу участников; закрытие месяца и выплаты — отдельным шагом.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.task import TaskSubmission
from app.models.tower import TowerMonthlyBest
from app.models.user import User
from app.models.xp_event import XpEvent
from app.services import gameday, tower_prizes
from app.services import tower as tower_svc
from app.services.economy import get_setting
from app.services.levels import xp_needed

KINDS = ("level", "tasks", "friends")
PERIODS = ("month", "all")
BOARD_MAX = 100
PRIZE_KEYS = {"level": "level_prizes", "tasks": "tasks_prizes", "friends": "friends_prizes"}
PRIZE_DEFAULT: dict[str, Any] = dict(tower_prizes.DEFAULT)

# ───────── условие «друг засчитывается» ─────────

FRIEND_KEY = "friend_rule"
FRIEND_DEFAULT: dict[str, Any] = {"min_level": 3, "min_tasks": 20, "need_both": False}
LEVEL_CAP = 1000
TASKS_CAP = 100000


class RatingError(ValueError):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def normalize_friend_rule(value: Any) -> dict[str, Any]:
    """Проверить `friend_rule`. 0 — условие выключено; need_both — нужны оба (иначе любое из включённых)."""
    if not isinstance(value, dict):
        raise RatingError("bad_rule", "friend_rule: нужен объект")
    extra = set(value) - set(FRIEND_DEFAULT)
    if extra:
        raise RatingError("bad_rule", f"friend_rule: лишние поля {sorted(extra)}")
    out = {**FRIEND_DEFAULT, **value}
    for k, hi in (("min_level", LEVEL_CAP), ("min_tasks", TASKS_CAP)):
        v = out[k]
        if isinstance(v, bool) or not isinstance(v, int) or not 0 <= v <= hi:
            raise RatingError("bad_rule", f"{k}: целое от 0 до {hi} (0 — условие выключено)")
    if not isinstance(out["need_both"], bool):
        raise RatingError("bad_rule", "need_both: true или false")
    # уровень 1 есть у всех — это то же, что «условие выключено»
    if out["min_level"] == 1:
        out["min_level"] = 0
    return {"min_level": out["min_level"], "min_tasks": out["min_tasks"], "need_both": out["need_both"]}


def safe_friend_rule(value: Any) -> dict[str, Any]:
    try:
        return normalize_friend_rule(value)
    except RatingError:
        return dict(FRIEND_DEFAULT)


def friend_qualifies(rule: dict[str, Any], *, level: int, approved_tasks: int) -> bool:
    """Засчитывается ли приглашённый друг. Оба условия выключены — засчитывается сразу."""
    checks = []
    if rule["min_level"]:
        checks.append(level >= rule["min_level"])
    if rule["min_tasks"]:
        checks.append(approved_tasks >= rule["min_tasks"])
    if not checks:
        return True
    return all(checks) if rule["need_both"] else any(checks)


def normalize_prizes(key: str, value: Any) -> dict[str, Any]:
    try:
        return tower_prizes.normalize(value, key)
    except tower_prizes.PrizeConfigError as e:
        raise RatingError("bad_prizes", str(e)) from e


async def prize_cfg(session: AsyncSession, kind: str) -> dict[str, Any]:
    return tower_prizes.safe(await get_setting(session, PRIZE_KEYS[kind]))


async def friend_rule(session: AsyncSession) -> dict[str, Any]:
    return safe_friend_rule(await get_setting(session, FRIEND_KEY))


# ───────── общий ранжировщик ─────────


def _name(u: User) -> str:
    return tower_svc._display_name(u)


async def _rank_board(
    session: AsyncSession,
    agg,
    *,
    user_id: int,
    limit: int,
    min_score: int = 1,
) -> dict[str, Any]:
    """agg — подзапрос (user_id, value, last_at). Порядок: value ↓, last_at ↑, user_id ↑; забаненных нет."""
    active = and_(User.is_banned.is_(False), agg.c.value >= 1)
    order = (agg.c.value.desc(), agg.c.last_at.asc(), agg.c.user_id.asc())
    rows = (
        await session.execute(
            select(agg.c.user_id, agg.c.value, User).join(User, User.id == agg.c.user_id).where(active).order_by(*order).limit(limit)
        )
    ).all()
    entries = [
        {"rank": i, "name": _name(u), "value": int(v), "is_me": uid == user_id}
        for i, (uid, v, u) in enumerate(rows, start=1)
    ]
    total = int(await session.scalar(select(func.count()).select_from(agg).join(User, User.id == agg.c.user_id).where(active)) or 0)
    participants = total
    if min_score > 1:
        participants = int(
            await session.scalar(
                select(func.count()).select_from(agg).join(User, User.id == agg.c.user_id).where(active, agg.c.value >= min_score)
            )
            or 0
        )
    mine = (
        await session.execute(
            select(agg.c.value, agg.c.last_at).join(User, User.id == agg.c.user_id).where(active, agg.c.user_id == user_id)
        )
    ).first()
    me = None
    if mine is not None:
        val, last = int(mine[0]), mine[1]
        ahead = await session.scalar(
            select(func.count())
            .select_from(agg)
            .join(User, User.id == agg.c.user_id)
            .where(
                active,
                or_(
                    agg.c.value > val,
                    and_(agg.c.value == val, agg.c.last_at < last),
                    and_(agg.c.value == val, agg.c.last_at == last, agg.c.user_id < user_id),
                ),
            )
        )
        rank = int(ahead or 0) + 1
        me = {"rank": rank, "value": val}
        if rank > 1:
            above = await session.scalar(
                select(agg.c.value).join(User, User.id == agg.c.user_id).where(active).order_by(*order).offset(rank - 2).limit(1)
            )
            if above is not None:
                # обогнать соседа сверху: при равенстве он выше (набрал раньше), значит нужно на 1 больше
                me["next_rank"] = rank - 1
                me["need"] = int(above) - val + 1
    return {"entries": entries, "total_players": total, "participants": participants, "me": me, "order": order, "active": active}


async def _cutoff(session: AsyncSession, agg, board: dict, places: int) -> int | None:
    if places <= 0:
        return None
    v = await session.scalar(
        select(agg.c.value).join(User, User.id == agg.c.user_id).where(board["active"]).order_by(*board["order"]).offset(places - 1).limit(1)
    )
    return int(v) if v is not None else None


def _month_bounds(month: date) -> tuple[datetime, datetime]:
    return gameday.day_start(month), tower_svc.month_end(month)


def _tasks_agg(month: date | None):
    q = select(
        TaskSubmission.user_id.label("user_id"),
        func.count(TaskSubmission.id).label("value"),
        func.max(TaskSubmission.reviewed_at).label("last_at"),
    ).where(TaskSubmission.status == "approved", TaskSubmission.reviewed_at.is_not(None))
    if month is not None:
        a, b = _month_bounds(month)
        q = q.where(TaskSubmission.reviewed_at >= a, TaskSubmission.reviewed_at < b)
    return q.group_by(TaskSubmission.user_id).subquery()


def _xp_month_agg(month: date):
    a, b = _month_bounds(month)
    return (
        select(
            XpEvent.user_id.label("user_id"),
            func.sum(XpEvent.amount).label("value"),
            func.max(XpEvent.created_at).label("last_at"),
        )
        .where(XpEvent.created_at >= a, XpEvent.created_at < b)
        .group_by(XpEvent.user_id)
        .subquery()
    )


def _prize_out(cfg: dict[str, Any], participants: int, cutoff: int | None, plan: dict | None) -> dict[str, Any] | None:
    if plan is None:
        return None
    return {
        "budget_ton": plan["budget_ton"],
        "places": plan["places"],
        "prizes": plan["prizes"],
        "total_ton": plan["total_ton"],
        "next_place_at": plan["next_place_at"],
        "limited_by": plan["limited_by"],
        "min_participants": cfg["min_participants"],
        "min_score": cfg["min_score"],
        "min_prize_ton": cfg["min_prize_ton"],
        "participants": participants,
        "cutoff_value": cutoff,
    }


def _base(kind: str, period: str, periods: list[str], month: date, now: datetime) -> dict[str, Any]:
    return {
        "kind": kind,
        "period": period,
        "periods": periods,
        "month": month.strftime("%Y-%m"),
        "month_ends_at": tower_svc.month_end(month).isoformat(),
        "server_time": now.isoformat(),
        "soon": False,
        "rule": None,
        "prize": None,
    }


async def board(
    session: AsyncSession,
    *,
    kind: str,
    period: str | None,
    user_id: int,
    limit: int = 50,
    now: datetime | None = None,
) -> dict[str, Any]:
    if kind not in KINDS:
        raise RatingError("bad_kind", "Такого рейтинга нет", 404)
    if period is not None and period not in PERIODS:
        raise RatingError("bad_period", "Период: month или all")
    now = now or gameday.now_utc()
    month = tower_svc.month_of(now)
    limit = max(1, min(int(limit), BOARD_MAX))
    cfg = await prize_cfg(session, kind)

    if kind == "friends":
        out = _base(kind, period or "month", ["month", "all"], month, now)
        out.update({"soon": True, "rule": await friend_rule(session), "entries": [], "total_players": 0, "me": None})
        return out

    if kind == "level":
        # месяц («Опыт за месяц») — только когда у топа по уровню включены призы
        periods = ["all", "month"] if cfg["enabled"] else ["all"]
        period = period if period in periods else "all"
        out = _base(kind, period, periods, month, now)
        if period == "all":
            out.update(await _level_all(session, user_id=user_id, limit=limit))
            return out
        agg = _xp_month_agg(month)
    else:
        periods = ["month", "all"]
        period = period or "month"
        out = _base(kind, period, periods, month, now)
        agg = _tasks_agg(month if period == "month" else None)

    b = await _rank_board(session, agg, user_id=user_id, limit=limit, min_score=cfg["min_score"])
    plan = tower_prizes.plan(cfg, b["participants"]) if cfg["enabled"] and period == "month" else None
    cutoff = await _cutoff(session, agg, b, plan["places"]) if plan else None
    out.update(
        {
            "entries": b["entries"],
            "total_players": b["total_players"],
            "me": b["me"],
            "prize": _prize_out(cfg, b["participants"], cutoff, plan),
        }
    )
    return out


async def _level_all(session: AsyncSession, *, user_id: int, limit: int) -> dict[str, Any]:
    ok = User.is_banned.is_(False)
    rows = (
        await session.scalars(select(User).where(ok).order_by(User.level.desc(), User.xp.desc(), User.id.asc()).limit(limit))
    ).all()
    entries = [
        {"rank": i, "name": _name(u), "value": int(u.level or 1), "xp": int(u.xp or 0), "is_me": u.id == user_id}
        for i, u in enumerate(rows, start=1)
    ]
    total = int(await session.scalar(select(func.count()).select_from(User).where(ok)) or 0)
    me_u = await session.get(User, user_id)
    me = None
    if me_u is not None and not me_u.is_banned:
        lv, xp = int(me_u.level or 1), int(me_u.xp or 0)
        ahead = await session.scalar(
            select(func.count())
            .select_from(User)
            .where(
                ok,
                or_(
                    User.level > lv,
                    and_(User.level == lv, User.xp > xp),
                    and_(User.level == lv, User.xp == xp, User.id < me_u.id),
                ),
            )
        )
        curve = await get_setting(session, "xp_per_level")
        me = {"rank": int(ahead or 0) + 1, "value": lv, "xp": xp, "xp_to_next": max(0, xp_needed(curve, lv) - xp)}
    return {"entries": entries, "total_players": total, "me": me}


# ───────── сводка «Мои места» ─────────


async def summary(session: AsyncSession, *, user_id: int, now: datetime | None = None) -> dict[str, Any]:
    now = now or gameday.now_utc()
    month = tower_svc.month_of(now)
    lv = await _level_all(session, user_id=user_id, limit=1)
    tasks = await _rank_board(session, _tasks_agg(month), user_id=user_id, limit=1)
    t_score, t_rank = await tower_svc.month_standing(session, user_id, month)
    t_total = await session.scalar(
        select(func.count())
        .select_from(TowerMonthlyBest)
        .join(User, User.id == TowerMonthlyBest.user_id)
        .where(TowerMonthlyBest.month == month, TowerMonthlyBest.best_score > 0, User.is_banned.is_(False))
    )
    prizes = {k: (await prize_cfg(session, k))["enabled"] for k in KINDS}
    prizes["tower"] = tower_prizes.safe(await get_setting(session, tower_prizes.KEY))["enabled"]

    def cell(me: dict | None, total: int) -> dict[str, Any]:
        return {"rank": me["rank"] if me else None, "value": me["value"] if me else None, "total": total}

    return {
        "month": month.strftime("%Y-%m"),
        "level": cell(lv["me"], lv["total_players"]),
        "tasks": cell(tasks["me"], tasks["total_players"]),
        "tower": {"rank": t_rank, "value": t_score, "total": int(t_total or 0)},
        "friends": {"soon": True, "rank": None, "value": None, "total": 0},
        "friend_rule": await friend_rule(session),
        "prizes": prizes,
    }
