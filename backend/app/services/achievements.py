"""Достижения: прогресс по веткам, выдача ступеней, ручное подтверждение крупных наград, рассылка в боте.

Прогресс считается из уже существующих данных (принятые заявки, параметры майнера, сыгранные игры,
уровень аккаунта, размещённые задания), поэтому отдельных счётчиков нет и пропустить событие нельзя:
`check` сравнивает текущие значения с порогами и выдаёт недостающие ступени. Вызывается после
событий (заявка принята, усиление, игра, колесо, ежедневка) и при входе игрока (GET /achievements/fresh).

Награда: TON на баланс (balance_type «achievement») и XP. Сумма от порога `manual_from_ton` (и, если включено,
награды игрокам с низкой «Честностью») ждут владельца: status=pending, TON и XP — после подтверждения.
Каждая ступень выдаётся один раз (уникальный ключ игрок + ветка + порог). Коммитит вызывающий.

«Старт с нуля» (retroactive = false): заявки, игры и размещения считаются только с start_at; ступени
уровня майнера и аккаунта, пройденные к этому моменту, записываются как baseline — без награды.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.i18n import user_lang
from app.models.achievement import AchievementAward
from app.models.arena import ArenaEntry
from app.models.balance import BalanceHistory
from app.models.miner import Miner
from app.models.task import Task, TaskSubmission
from app.models.tower import TowerGame
from app.models.user import User
from app.services import achievement_rules as rules_mod
from app.services.economy import get_setting

log = logging.getLogger(__name__)

LEVEL_BRANCHES = ("miner", "level")  # «уровни», а не счётчики: при старте с нуля — baseline
PLACED = ("active", "paused", "completed", "closed")  # задание опубликовано с оплаченным бюджетом
DONE = ("paid", "pending", "rejected", "baseline")  # ступень пройдена (для экрана)
NOTIFY_MAX_AGE = timedelta(days=3)  # старше — в бот не шлём (после долгого простоя рассылки)
BALANCE_TYPE = "achievement"


def ton_str(v) -> str:
    """TON строкой без экспоненты: 10 → "10", 0.03 → "0.03" (Decimal.normalize дал бы "1E+1")."""
    d = Decimal(str(v or 0)).quantize(Decimal("0.00000001")).normalize()
    return format(d, "f") if d else "0"


class AchievementError(Exception):
    pass


class AchievementNotFound(AchievementError):
    pass


async def load_rules(session: AsyncSession) -> dict[str, Any]:
    return rules_mod.merged(await get_setting(session, rules_mod.KEY))


def _start(cfg: dict[str, Any]) -> datetime | None:
    if cfg.get("retroactive", True) or not cfg.get("start_at"):
        return None
    dt = datetime.fromisoformat(str(cfg["start_at"]))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


async def miner_level(session: AsyncSession, user_id: int) -> int:
    m = await session.scalar(select(Miner).where(Miner.user_id == user_id))
    if not m:
        return 0
    return int(m.power or 0) + int(m.capacity or 0) + int(m.acceleration or 0) + int(m.luck or 0) + int(m.stability or 0)


async def games_played(session: AsyncSession, user_id: int, since: datetime | None = None) -> int:
    """Сыгранные игры: бои арены, дошедшие до итога (выход до старта — возврат, не считается); забеги башни,
    прошедшие проверку и со счётом больше нуля (брошенные, непринятые и «сразу мимо» — нет); вращения колеса удачи."""
    arena = select(func.count(ArenaEntry.id)).where(ArenaEntry.user_id == user_id, ArenaEntry.status.in_(("paid", "lost")))
    tower = select(func.count(TowerGame.id)).where(
        TowerGame.user_id == user_id, TowerGame.status == "finished", TowerGame.score > 0
    )
    wheel = select(func.count(BalanceHistory.id)).where(
        BalanceHistory.user_id == user_id, BalanceHistory.balance_type == "prize_wheel", BalanceHistory.operation_type == "credit"
    )
    if since is not None:
        arena = arena.where(ArenaEntry.created_at >= since)
        tower = tower.where(TowerGame.finished_at >= since)
        wheel = wheel.where(BalanceHistory.created_at >= since)
    return sum([int(await session.scalar(q) or 0) for q in (arena, tower, wheel)])


async def tasks_done(session: AsyncSession, user_id: int, since: datetime | None = None) -> int:
    q = select(func.count(TaskSubmission.id)).where(TaskSubmission.user_id == user_id, TaskSubmission.status == "approved")
    if since is not None:
        q = q.where(TaskSubmission.reviewed_at >= since)
    return int(await session.scalar(q) or 0)


async def tasks_placed(session: AsyncSession, user_id: int, since: datetime | None = None) -> int:
    """Размещённые задания: опубликованы с оплаченным бюджетом (не черновик, не отклонено, не отменено)."""
    q = select(func.count(Task.id)).where(
        Task.creator_id == user_id, Task.status.in_(PLACED), Task.task_type != "partner", Task.budget_locked > 0
    )
    if since is not None:
        q = q.where(Task.created_at >= since)
    return int(await session.scalar(q) or 0)


async def progress(session: AsyncSession, user: User, cfg: dict[str, Any] | None = None) -> dict[str, int]:
    cfg = cfg or await load_rules(session)
    since = _start(cfg)
    return {
        "tasks": await tasks_done(session, user.id, since),
        "miner": await miner_level(session, user.id),
        "games": await games_played(session, user.id, since),
        "level": int(user.level or 1),
        "ambassador": await tasks_placed(session, user.id, since),
    }


def _needs_owner(cfg: dict[str, Any], user: User, ton: Decimal) -> bool:
    if ton <= 0:
        return False
    if ton >= Decimal(str(cfg.get("manual_from_ton", "10"))):
        return True
    return bool(cfg.get("manual_low_integrity")) and getattr(user, "integrity_tier", None) in rules_mod.LOW_INTEGRITY


async def _pay(session: AsyncSession, user: User, award: AchievementAward) -> User:
    """TON и XP награды. Возвращает свежий объект игрока (баланс перечитан под блокировкой)."""
    from app.services import balance as balance_svc
    from app.services.levels import add_xp

    if award.ton and Decimal(award.ton) > 0:
        user = await balance_svc.credit(
            session,
            user_id=user.id,
            amount=Decimal(award.ton),
            balance_type=BALANCE_TYPE,
            description=f"Достижение: {rules_mod.BRANCH_NAMES[award.branch][0]} · {award.tier}",
            reference_type="achievement",
            reference_id=award.id,
        )
    if award.xp:
        await add_xp(session, user, int(award.xp), "achievement")
    return user


async def check(session: AsyncSession, user: User, now: datetime | None = None) -> list[AchievementAward]:
    """Выдать все пройденные, но ещё не полученные ступени. Возвращает новые награды."""
    cfg = await load_rules(session)
    if not cfg["enabled"] or getattr(user, "is_banned", False):
        return []
    from app.services import balance as balance_svc

    now = now or datetime.now(timezone.utc)
    user = await balance_svc.get_user_for_update(session, user.id)  # параллельный check ждёт и видит выданное
    have = {
        (b, t)
        for b, t in (await session.execute(
            select(AchievementAward.branch, AchievementAward.tier).where(AchievementAward.user_id == user.id)
        )).all()
    }
    new: list[AchievementAward] = []
    for _ in range(5):  # XP награды может поднять уровень → ещё ступени ветки «уровень аккаунта»
        values = await progress(session, user, cfg)
        added = 0
        for branch in rules_mod.BRANCHES:
            b = cfg["branches"][branch]
            if not b["enabled"]:
                continue
            for t in b["tiers"]:
                if not t["enabled"] or values[branch] < t["at"] or (branch, t["at"]) in have:
                    continue
                ton = Decimal(t["ton"])
                award = AchievementAward(
                    user_id=user.id, branch=branch, tier=t["at"], ton=ton, xp=int(t["xp"]),
                    status="pending" if _needs_owner(cfg, user, ton) else "paid", created_at=now,
                )
                session.add(award)
                await session.flush()
                if award.status == "paid":
                    user = await _pay(session, user, award)
                have.add((branch, t["at"]))
                new.append(award)
                added += 1
        if not added:
            break
    if new:
        await session.flush()
    return new


async def safe_check(session: AsyncSession, user_id: int | None, now: datetime | None = None) -> list[AchievementAward]:
    """Проверка из чужого сценария (заявка, усиление, игра): ошибка достижений не ломает основное действие."""
    if not user_id:
        return []
    try:
        async with session.begin_nested():
            user = await session.get(User, user_id)
            if not user:
                return []
            return await check(session, user, now=now)
    except Exception:  # noqa: BLE001
        log.exception("[achievements] check failed for user %s", user_id)
        return []


async def snapshot_baseline(session: AsyncSession, now: datetime | None = None) -> int:
    """«Старт с нуля»: ступени уровня майнера и аккаунта, уже пройденные всеми игроками, — baseline без награды."""
    cfg = await load_rules(session)
    now = now or datetime.now(timezone.utc)
    have = {
        (u, b, t)
        for u, b, t in (await session.execute(
            select(AchievementAward.user_id, AchievementAward.branch, AchievementAward.tier)
            .where(AchievementAward.branch.in_(LEVEL_BRANCHES))
        )).all()
    }
    miners = {
        uid: int(p or 0) + int(c or 0) + int(a or 0) + int(lk or 0) + int(s or 0)
        for uid, p, c, a, lk, s in (await session.execute(
            select(Miner.user_id, Miner.power, Miner.capacity, Miner.acceleration, Miner.luck, Miner.stability)
        )).all()
    }
    n = 0
    for uid, level in (await session.execute(select(User.id, User.level))).all():
        values = {"miner": miners.get(uid, 0), "level": int(level or 1)}
        for branch in LEVEL_BRANCHES:
            for t in cfg["branches"][branch]["tiers"]:
                if values[branch] >= t["at"] and (uid, branch, t["at"]) not in have:
                    session.add(AchievementAward(
                        user_id=uid, branch=branch, tier=t["at"], ton=Decimal("0"), xp=0, status="baseline",
                        created_at=now, notified_at=now, seen_at=now,
                    ))
                    n += 1
    await session.flush()
    return n


# ── игрок ─────────────────────────────────────────────────────────────────────


def award_out(a: AchievementAward, cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    out = {
        "id": a.id, "branch": a.branch, "tier": a.tier, "ton": ton_str(a.ton),
        "xp": int(a.xp or 0), "status": a.status, "created_at": a.created_at.isoformat() if a.created_at else None,
    }
    if cfg is not None:
        out.update(badge(cfg, a.branch, a.tier))
    return out


def badge(cfg: dict[str, Any], branch: str, tier: int) -> dict[str, Any]:
    """Металл и номер ступени для значка. Порог, убранный из настройки, — по месту среди текущих порогов."""
    ats = [t["at"] for t in cfg["branches"].get(branch, {"tiers": []})["tiers"]]
    if tier not in ats:
        ats = sorted(ats + [tier])
    i = ats.index(tier)
    return {"metal": rules_mod.metal(i, len(ats)), "index": i + 1, "of": len(ats)}


async def player_view(session: AsyncSession, user: User) -> dict[str, Any]:
    cfg = await load_rules(session)
    values = await progress(session, user, cfg)
    awards = {
        (a.branch, a.tier): a
        for a in (await session.scalars(select(AchievementAward).where(AchievementAward.user_id == user.id))).all()
    }
    branches = []
    for key in rules_mod.BRANCHES:
        b = cfg["branches"][key]
        has_any = any(k[0] == key for k in awards)
        if key == "ambassador" and not (user.is_ambassador or values[key] > 0 or has_any):
            continue
        if not b["enabled"] and not has_any:
            continue
        tiers = []
        for i, t in enumerate(b["tiers"]):
            a = awards.get((key, t["at"]))
            if not t["enabled"] and not a:
                continue
            tiers.append({
                "at": t["at"], "ton": t["ton"], "xp": t["xp"], "metal": rules_mod.metal(i, len(b["tiers"])), "index": i + 1,
                "done": bool(a and a.status in DONE), "status": a.status if a else None,
                "awarded_at": a.created_at.isoformat() if a and a.created_at else None,
            })
        nxt = next((t for t in tiers if not t["done"]), None)
        branches.append({
            "key": key, "value": values[key], "tiers": tiers,
            "next": {"at": nxt["at"], "left": max(0, nxt["at"] - values[key])} if nxt else None,
        })
    earned = sum((Decimal(a.ton or 0) for a in awards.values() if a.status == "paid"), Decimal("0"))
    return {
        "enabled": cfg["enabled"], "branches": branches, "pin": pin_view(cfg, user, awards),
        "earned_ton": ton_str(earned),
        "done": sum(1 for a in awards.values() if a.status in DONE),
        "total": sum(len([t for t in cfg["branches"][k]["tiers"] if t["enabled"]]) for k in rules_mod.BRANCHES if cfg["branches"][k]["enabled"]),
    }


def pin_view(cfg: dict[str, Any], user: User, awards: dict | None = None) -> dict[str, Any] | None:
    if not user.ach_pin or ":" not in user.ach_pin:
        return None
    branch, _, tier_s = user.ach_pin.partition(":")
    if branch not in rules_mod.BRANCHES or not tier_s.isdigit():
        return None
    tier = int(tier_s)
    if awards is not None and (branch, tier) not in awards:
        return None
    return {"branch": branch, "tier": tier, **badge(cfg, branch, tier)}


async def set_pin(session: AsyncSession, user: User, branch: str | None, tier: int | None) -> dict[str, Any] | None:
    if branch is None:
        user.ach_pin = None
        await session.flush()
        return None
    a = await session.scalar(select(AchievementAward).where(
        AchievementAward.user_id == user.id, AchievementAward.branch == branch, AchievementAward.tier == tier
    ))
    if not a or a.status not in DONE:
        raise AchievementNotFound("achievement not earned")
    user.ach_pin = f"{branch}:{tier}"
    await session.flush()
    return pin_view(await load_rules(session), user)


async def fresh(session: AsyncSession, user: User, limit: int = 10) -> list[dict[str, Any]]:
    """Новые награды для праздничного окна (ещё не показанные)."""
    cfg = await load_rules(session)
    rows = (await session.scalars(
        select(AchievementAward)
        .where(AchievementAward.user_id == user.id, AchievementAward.seen_at.is_(None), AchievementAward.status.in_(("paid", "pending")))
        .order_by(AchievementAward.created_at, AchievementAward.id).limit(limit)
    )).all()
    return [award_out(a, cfg) for a in rows]


async def mark_seen(session: AsyncSession, user: User, ids: list[int], now: datetime | None = None) -> int:
    if not ids:
        return 0
    now = now or datetime.now(timezone.utc)
    rows = (await session.scalars(
        select(AchievementAward).where(AchievementAward.user_id == user.id, AchievementAward.id.in_(ids[:50]))
    )).all()
    for a in rows:
        a.seen_at = a.seen_at or now
    await session.flush()
    return len(rows)


async def badges_for(session: AsyncSession, user_ids: list[int], branch: str = "ambassador") -> dict[int, dict[str, Any]]:
    """Высшая ступень ветки у каждого из игроков (значок амбассадора на карточках заданий)."""
    ids = sorted({int(u) for u in user_ids if u})
    if not ids:
        return {}
    cfg = await load_rules(session)
    rows = (await session.execute(
        select(AchievementAward.user_id, func.max(AchievementAward.tier))
        .where(AchievementAward.user_id.in_(ids), AchievementAward.branch == branch, AchievementAward.status.in_(DONE))
        .group_by(AchievementAward.user_id)
    )).all()
    return {uid: {"branch": branch, "tier": int(t), **badge(cfg, branch, int(t))} for uid, t in rows}


# ── владелец ──────────────────────────────────────────────────────────────────


async def _award(session: AsyncSession, award_id: int) -> AchievementAward:
    a = await session.get(AchievementAward, award_id, with_for_update=True)
    if not a:
        raise AchievementNotFound("award not found")
    return a


async def approve(session: AsyncSession, *, award_id: int, actor: User, now: datetime | None = None) -> AchievementAward:
    a = await _award(session, award_id)
    if a.status != "pending":
        raise AchievementError("награда уже решена")
    user = await session.get(User, a.user_id)
    if not user:
        raise AchievementNotFound("player not found")
    a.status = "paid"
    a.decided_at = now or datetime.now(timezone.utc)
    a.decided_by_id = actor.id
    a.notified_at = None  # бот сообщит, что награда зачислена
    await session.flush()
    await _pay(session, user, a)
    await session.flush()
    return a


async def reject(session: AsyncSession, *, award_id: int, actor: User, now: datetime | None = None) -> AchievementAward:
    a = await _award(session, award_id)
    if a.status != "pending":
        raise AchievementError("награда уже решена")
    a.status = "rejected"
    a.decided_at = now or datetime.now(timezone.utc)
    a.decided_by_id = actor.id
    a.notified_at = a.notified_at or a.decided_at
    await session.flush()
    return a


def _name(u: User | None) -> str:
    if not u:
        return "—"
    if u.username:
        return f"@{u.username}"
    return (u.first_name or "").strip() or f"#{u.id}"


async def owner_summary(session: AsyncSession) -> dict[str, Any]:
    cfg = await load_rules(session)
    paid = await session.scalar(select(func.coalesce(func.sum(AchievementAward.ton), 0)).where(AchievementAward.status == "paid"))
    counts = dict((await session.execute(
        select(AchievementAward.status, func.count(AchievementAward.id)).group_by(AchievementAward.status)
    )).all())
    pending_ton = await session.scalar(
        select(func.coalesce(func.sum(AchievementAward.ton), 0)).where(AchievementAward.status == "pending")
    )
    rows = (await session.scalars(
        select(AchievementAward).where(AchievementAward.status == "pending").order_by(AchievementAward.created_at).limit(100)
    )).all()
    users = {u.id: u for u in (await session.scalars(select(User).where(User.id.in_({a.user_id for a in rows} or {0})))).all()}
    holders = dict(
        ((b, t), n) for b, t, n in (await session.execute(
            select(AchievementAward.branch, AchievementAward.tier, func.count(AchievementAward.id))
            .where(AchievementAward.status.in_(DONE)).group_by(AchievementAward.branch, AchievementAward.tier)
        )).all()
    )
    return {
        "paid_ton": ton_str(paid),
        "pending_ton": ton_str(pending_ton),
        "counts": {s: int(counts.get(s, 0)) for s in ("paid", "pending", "rejected", "baseline")},
        "pending": [
            {**award_out(a, cfg), "user_id": a.user_id, "user": _name(users.get(a.user_id)),
             "telegram_id": users[a.user_id].telegram_id if a.user_id in users else None,
             "integrity_tier": getattr(users.get(a.user_id), "integrity_tier", None)}
            for a in rows
        ],
        "holders": [{"branch": b, "tier": t, "count": int(n)} for (b, t), n in sorted(holders.items())],
    }


# ── бот ───────────────────────────────────────────────────────────────────────

TEXT = {
    "ru": {
        "head": "🏆 Новое достижение в Neon Nexus!",
        "head_many": "🏆 Новые достижения в Neon Nexus!",
        "paid": "+{ton} TON на баланс",
        "xp": "+{xp} XP",
        "pending": "награда {ton} TON ждёт подтверждения",
        "approved": "награда зачислена: +{ton} TON",
        "tail": "Все достижения — в Профиле.",
    },
    "en": {
        "head": "🏆 New achievement in Neon Nexus!",
        "head_many": "🏆 New achievements in Neon Nexus!",
        "paid": "+{ton} TON to your balance",
        "xp": "+{xp} XP",
        "pending": "the {ton} TON reward is awaiting approval",
        "approved": "reward credited: +{ton} TON",
        "tail": "See all your achievements in Profile.",
    },
}


def _label(cfg: dict[str, Any], branch: str, tier: int, lang: str) -> str:
    i = 0 if lang == "ru" else 1
    if branch == "ambassador":
        ats = [t["at"] for t in cfg["branches"]["ambassador"]["tiers"]]
        k = ats.index(tier) if tier in ats else 0
        return rules_mod.AMBASSADOR_TITLES[min(k, len(rules_mod.AMBASSADOR_TITLES) - 1)][i]
    return f"{rules_mod.BRANCH_NAMES[branch][i]}: {tier}"


def message(cfg: dict[str, Any], lang: str, awards: list[AchievementAward]) -> str:
    tx = TEXT["ru" if lang == "ru" else "en"]
    lines = [tx["head_many"] if len(awards) > 1 else tx["head"], ""]
    for a in awards:
        ton = ton_str(a.ton)
        parts = []
        if a.status == "pending":
            parts.append(tx["pending"].format(ton=ton))
        elif a.decided_at and Decimal(a.ton or 0) > 0:
            parts.append(tx["approved"].format(ton=ton))
        elif Decimal(a.ton or 0) > 0:
            parts.append(tx["paid"].format(ton=ton))
        if a.xp and a.status == "paid":
            parts.append(tx["xp"].format(xp=a.xp))
        lines.append(f"• {_label(cfg, a.branch, a.tier, lang)}" + (f" — {', '.join(parts)}" if parts else ""))
    lines += ["", tx["tail"]]
    return "\n".join(lines)


async def notify_once(session_factory, send=None, now: datetime | None = None, limit: int = 200) -> int:
    """Рассылка в бот: новые и подтверждённые награды, одно сообщение на игрока. Возвращает число сообщений."""
    from app.services import tg_notify

    send = send or tg_notify.send_message
    now = now or datetime.now(timezone.utc)
    async with session_factory() as session:
        rows = (await session.scalars(
            select(AchievementAward)
            .where(AchievementAward.notified_at.is_(None), AchievementAward.status.in_(("paid", "pending")))
            .order_by(AchievementAward.user_id, AchievementAward.id).limit(limit)
        )).all()
        if not rows:
            return 0
        cfg = await load_rules(session)
        by_user: dict[int, list[AchievementAward]] = {}
        for a in rows:
            a.notified_at = now
            created = a.decided_at or a.created_at
            if created is not None and created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            if created is None or now - created <= NOTIFY_MAX_AGE:
                by_user.setdefault(a.user_id, []).append(a)
        users = {u.id: u for u in (await session.scalars(select(User).where(User.id.in_(set(by_user) or {0})))).all()}
        await session.commit()  # отмечаем до отправки: сбой сети не приведёт к повторным сообщениям
    sent = 0
    for uid, awards in by_user.items():
        u = users.get(uid)
        if not u or getattr(u, "is_banned", False):
            continue
        try:
            if await send(u.telegram_id, message(cfg, user_lang(u), awards)):
                sent += 1
        except Exception:  # noqa: BLE001
            log.exception("[achievements] notify failed for user %s", uid)
    return sent
