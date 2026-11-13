"""«Честность» (репутация) — ядро в теневом режиме (R1, docs/tasks/05-integrity-core-shadow.md).

Журнал integrity_events (только добавление) → счёт пользователя 0–1000 (старт 500) с затуханием по
полураспаду и тир «как в WoW». Теневой режим: счёт копится, но ни на что не влияет и игрокам не
показывается (эндпоинты /integrity/* — только владелец, /me счёт не отдаёт).

- record_event — идемпотентно по (пользователь, тип, источник); суточный лимит принятых заявок,
  недельный лимит «медленной проверки»; крупные падения → pending_review (ждут владельца).
- recompute — score = start + floor(Σ delta × 0.5^(возраст / полураспад)) по applied-событиям, в 0…1000.
- confirm_event / void_event — решения владельца; adjust — ручная корректировка и fraud.
Затухание ленивое: пересчёт при новом событии и при чтении владельцем. Коммитит вызывающий.
"""

from __future__ import annotations

import logging
import math
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integrity import IntegrityEvent
from app.models.task import Task, TaskSubmission
from app.models.user import User
from app.services import gameday
from app.services import integrity_rules as rules_mod
from app.services.economy import get_setting

log = logging.getLogger(__name__)

MANUAL = ("manual_adjust", "fraud")


class IntegrityActionError(Exception):
    """Ошибка действия владельца (400)."""


class IntegrityNotFound(IntegrityActionError):
    pass


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


async def load_rules(session: AsyncSession) -> dict[str, Any]:
    return rules_mod.merged(await get_setting(session, rules_mod.KEY))


async def _sum_delta(session: AsyncSession, user_id: int, event_type: str, since: datetime) -> int:
    q = select(func.coalesce(func.sum(IntegrityEvent.delta), 0)).where(
        IntegrityEvent.user_id == user_id,
        IntegrityEvent.event_type == event_type,
        IntegrityEvent.status != "voided",
        IntegrityEvent.created_at >= since,
    )
    return int((await session.execute(q)).scalar_one())


async def _day_negative(session: AsyncSession, user_id: int, since: datetime) -> int:
    q = select(func.coalesce(func.sum(IntegrityEvent.delta), 0)).where(
        IntegrityEvent.user_id == user_id,
        IntegrityEvent.status == "applied",
        IntegrityEvent.delta < 0,
        IntegrityEvent.created_at >= since,
    )
    return int((await session.execute(q)).scalar_one())


async def _existing(session, user_id, event_type, source_type, source_id) -> IntegrityEvent | None:
    return await session.scalar(
        select(IntegrityEvent).where(
            IntegrityEvent.user_id == user_id,
            IntegrityEvent.event_type == event_type,
            IntegrityEvent.source_type == source_type,
            IntegrityEvent.source_id == source_id,
        )
    )


async def record_event(
    session: AsyncSession,
    *,
    user_id: int,
    event_type: str,
    source_type: str | None = None,
    source_id: int | None = None,
    actor_id: int | None = None,
    reason: str | None = None,
    delta: int | None = None,
    half_life_days: int | None | str = "rules",
    now: datetime | None = None,
    rules: dict[str, Any] | None = None,
) -> IntegrityEvent | None:
    """Записать событие и пересчитать счёт. Выключено (enabled=false) — None. Повтор с тем же источником —
    уже записанное событие, второй раз не пишется."""
    rules = rules or await load_rules(session)
    if not rules["enabled"]:
        return None
    now = _aware(now) or gameday.now_utc()
    if source_id is not None:
        old = await _existing(session, user_id, event_type, source_type, source_id)
        if old is not None:
            return old
    w = rules["weights"].get(event_type)
    if delta is None:
        if w is None:
            raise IntegrityActionError(f"unknown event type: {event_type}")
        delta = int(w["delta"])
    if half_life_days == "rules":
        hl = int(w["half_life_days"]) if w else 0
        half_life_days = hl or None
    elif half_life_days == 0:
        half_life_days = None

    caps = rules["caps"]
    if event_type == "submission_accepted":
        got = await _sum_delta(session, user_id, event_type, gameday.day_start_of(now))
        delta = max(0, min(delta, caps["accepted_per_day"] - got))
    elif event_type == "author_review_slow":
        got = await _sum_delta(session, user_id, event_type, now - timedelta(days=7))
        delta = min(0, max(delta, caps["review_slow_per_week"] - got))

    status = "applied"
    if event_type not in MANUAL and delta < 0:
        th = rules["review_thresholds"]
        day_neg = await _day_negative(session, user_id, gameday.day_start_of(now))
        if event_type == "submission_rejected_forged" or delta <= th["event"] or day_neg + delta <= th["day"]:
            status = "pending_review"

    ev = IntegrityEvent(
        user_id=user_id,
        event_type=event_type,
        delta=int(delta),
        half_life_days=half_life_days,
        reason=reason,
        source_type=source_type,
        source_id=source_id,
        actor_id=actor_id,
        status=status,
        created_at=now,
    )
    try:
        async with session.begin_nested():
            session.add(ev)
            await session.flush()
    except IntegrityError:
        # параллельная запись того же источника успела раньше — вернуть её
        return await _existing(session, user_id, event_type, source_type, source_id)
    await recompute(session, user_id, now=now, rules=rules)
    return ev


async def safe_record(session: AsyncSession, **kw) -> IntegrityEvent | None:
    """Для денежных путей: событие «Честности» никогда не ломает выплату/отказ (ошибка — только в лог)."""
    try:
        return await record_event(session, **kw)
    except Exception:  # noqa: BLE001 — теневой режим не должен мешать основному действию
        log.exception("[integrity] record_event failed: %s", kw.get("event_type"))
        return None


def score_of(events: list[IntegrityEvent], start: int, now: datetime) -> int:
    total = 0.0
    for e in events:
        if e.status != "applied" or not e.delta:
            continue
        mult = 1.0
        if e.half_life_days:
            age = max(0.0, (now - _aware(e.created_at)).total_seconds() / 86400)
            mult = 0.5 ** (age / e.half_life_days)
        total += e.delta * mult
    score = start + math.floor(round(total, 6))  # округление гасит микросекундный дрейф затухания
    return max(rules_mod.SCORE_MIN, min(rules_mod.SCORE_MAX, score))


async def recompute(
    session: AsyncSession, user_id: int, now: datetime | None = None, rules: dict[str, Any] | None = None
) -> tuple[int, str]:
    rules = rules or await load_rules(session)
    now = _aware(now) or gameday.now_utc()
    events = list(
        (
            await session.scalars(
                select(IntegrityEvent).where(IntegrityEvent.user_id == user_id, IntegrityEvent.status == "applied")
            )
        ).all()
    )
    score = score_of(events, rules["start"], now)
    tier = rules_mod.tier_for(score, rules["tiers"])
    user = await session.get(User, user_id)
    if user is not None:
        user.integrity = score
        user.integrity_tier = tier
        user.integrity_updated_at = now
        await session.flush()
    return score, tier


async def _event(session: AsyncSession, event_id: int) -> IntegrityEvent:
    ev = await session.get(IntegrityEvent, event_id)
    if ev is None:
        raise IntegrityNotFound("event not found")
    return ev


async def confirm_event(session: AsyncSession, *, event_id: int, actor: User, now: datetime | None = None) -> IntegrityEvent:
    ev = await _event(session, event_id)
    if ev.status != "pending_review":
        raise IntegrityActionError("event is not pending review")
    ev.status = "applied"
    ev.actor_id = ev.actor_id or actor.id
    await session.flush()
    await recompute(session, ev.user_id, now=now)
    return ev


async def void_event(
    session: AsyncSession, *, event_id: int, actor: User, reason: str, now: datetime | None = None
) -> IntegrityEvent:
    ev = await _event(session, event_id)
    if ev.status not in ("applied", "pending_review"):
        raise IntegrityActionError("event already voided")
    ev.status = "voided"
    ev.voided_by_id = actor.id
    ev.voided_at = _aware(now) or gameday.now_utc()
    ev.void_reason = reason
    await session.flush()
    await recompute(session, ev.user_id, now=now)
    return ev


async def adjust(
    session: AsyncSession,
    *,
    user_id: int,
    actor: User,
    reason: str,
    delta: int = 0,
    half_life_days: int | None = None,
    fraud: bool = False,
    now: datetime | None = None,
) -> IntegrityEvent:
    """Ручная корректировка владельцем (manual_adjust, ±N) или fraud (Δ из настроек, не затухает)."""
    if await session.get(User, user_id) is None:
        raise IntegrityNotFound("user not found")
    rules = await load_rules(session)
    if not rules["enabled"]:
        raise IntegrityActionError("integrity is disabled")
    if fraud:
        ev = await record_event(
            session, user_id=user_id, event_type="fraud", source_type="manual", actor_id=actor.id,
            reason=reason, now=now, rules=rules, half_life_days=None,
        )
    else:
        if delta == 0 or abs(delta) > 1000:
            raise IntegrityActionError("delta must be non-zero, |delta| ≤ 1000")
        if half_life_days is not None and not 1 <= half_life_days <= 3650:
            raise IntegrityActionError("half_life_days: 1–3650 or null")
        ev = await record_event(
            session, user_id=user_id, event_type="manual_adjust", source_type="manual", actor_id=actor.id,
            reason=reason, delta=delta, half_life_days=half_life_days, now=now, rules=rules,
        )
    assert ev is not None
    return ev


# ───────── хуки из заданий (вызываются после денежной части, в той же транзакции) ─────────


async def on_submission_reviewed(
    session: AsyncSession, *, sub: TaskSubmission, task: Task, approved: bool, reason_code: str | None, actor_id: int,
    now: datetime, task_completed: bool,
) -> None:
    rules = await load_rules(session)
    if not rules["enabled"]:
        return
    common = {"rules": rules, "now": now, "actor_id": actor_id}
    if approved:
        await safe_record(session, user_id=sub.user_id, event_type="submission_accepted",
                          source_type="submission", source_id=sub.id, **common)
        if await _accepted_streak(session, sub.user_id) % 10 == 0:
            await safe_record(session, user_id=sub.user_id, event_type="submission_streak_10",
                              source_type="submission", source_id=sub.id, **common)
    elif reason_code and reason_code != "other":
        await safe_record(session, user_id=sub.user_id, event_type=f"submission_rejected_{reason_code}",
                          source_type="submission", source_id=sub.id, **common)
    created = _aware(sub.created_at)
    if created and now - created > timedelta(hours=rules["caps"]["review_slow_hours"]) and task.creator_id != sub.user_id:
        await safe_record(session, user_id=task.creator_id, event_type="author_review_slow",
                          source_type="submission", source_id=sub.id, **common)
    if task_completed:
        await on_task_completed(session, task=task, now=now, rules=rules)


async def on_task_completed(session: AsyncSession, *, task: Task, now: datetime, rules: dict | None = None) -> None:
    await safe_record(session, user_id=task.creator_id, event_type="author_task_completed",
                      source_type="task", source_id=task.id, now=now, rules=rules)


async def _accepted_streak(session: AsyncSession, user_id: int) -> int:
    """Принятые заявки пользователя после его последнего отказа (по reviewed_at), включая текущую."""
    last_rej = await session.scalar(
        select(func.max(TaskSubmission.reviewed_at)).where(
            TaskSubmission.user_id == user_id, TaskSubmission.status == "rejected"
        )
    )
    q = select(func.count(TaskSubmission.id)).where(
        TaskSubmission.user_id == user_id, TaskSubmission.status == "approved"
    )
    if last_rej is not None:
        q = q.where(TaskSubmission.reviewed_at > last_rej)
    return int((await session.execute(q)).scalar_one())


# ───────── чтение для владельца ─────────


def event_out(e: IntegrityEvent) -> dict[str, Any]:
    return {
        "id": e.id,
        "user_id": e.user_id,
        "event_type": e.event_type,
        "delta": e.delta,
        "half_life_days": e.half_life_days,
        "reason": e.reason,
        "source_type": e.source_type,
        "source_id": e.source_id,
        "actor_id": e.actor_id,
        "status": e.status,
        "void_reason": e.void_reason,
        "created_at": _aware(e.created_at).isoformat() if e.created_at else None,
    }


async def user_view(session: AsyncSession, user_id: int, now: datetime | None = None) -> dict[str, Any]:
    user = await session.get(User, user_id)
    if user is None:
        raise IntegrityNotFound("user not found")
    score, tier = await recompute(session, user_id, now=now)
    events = (
        await session.scalars(
            select(IntegrityEvent)
            .where(IntegrityEvent.user_id == user_id)
            .order_by(IntegrityEvent.created_at.desc(), IntegrityEvent.id.desc())
            .limit(50)
        )
    ).all()
    return {"user_id": user_id, "integrity": score, "tier": tier, "events": [event_out(e) for e in events]}


async def review_queue(session: AsyncSession) -> list[dict[str, Any]]:
    rows = (
        await session.scalars(
            select(IntegrityEvent)
            .where(IntegrityEvent.status == "pending_review")
            .order_by(IntegrityEvent.created_at.asc(), IntegrityEvent.id.asc())
            .limit(100)
        )
    ).all()
    return [event_out(e) for e in rows]


async def summary(session: AsyncSession, now: datetime | None = None) -> dict[str, Any]:
    rules = await load_rules(session)
    now = _aware(now) or gameday.now_utc()
    tiers = dict((await session.execute(select(User.integrity_tier, func.count(User.id)).group_by(User.integrity_tier))).all())
    pending = int(
        (await session.execute(select(func.count(IntegrityEvent.id)).where(IntegrityEvent.status == "pending_review"))).scalar_one()
    )
    week = Counter(
        dict(
            (
                await session.execute(
                    select(IntegrityEvent.event_type, func.count(IntegrityEvent.id))
                    .where(IntegrityEvent.created_at >= now - timedelta(days=7))
                    .group_by(IntegrityEvent.event_type)
                )
            ).all()
        )
    )
    return {
        "enabled": rules["enabled"],
        "shadow_mode": rules["shadow_mode"],
        "tiers": {k: int(tiers.get(k, 0)) for k in rules_mod.TIER_KEYS},
        "pending_review": pending,
        "events_7d": dict(sorted(week.items())),
    }
