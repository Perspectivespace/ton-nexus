"""«Башня»: закрытие месяца топа и выплата призов (PR 3б).

Как устроено:
  — месяц закрывается сам при первом запросе к «Башне» после 00:00 МСК 1-го числа (или кнопкой владельца);
    закрытие идемпотентно: одна строка tower_months на месяц (unique), вставка — INSERT … ON CONFLICT DO NOTHING,
    поэтому два параллельных закрытия дают одни итоги;
  — призы считаются моделью tower_prizes.plan по настройкам, замороженным в момент закрытия;
    призы выключены, участников меньше минимума или бюджета не хватает — месяц закрывается без призов;
  — забеги с бустерами идут в зачёт (решение владельца: бустеры повышают шансы);
  — лучший забег каждого призёра проверяется заново (проигрывание журнала тапов); не прошёл — приз «flagged»,
    выплатить его нельзя, пока владелец не решит (одобрить или аннулировать);
  — бан до выплаты аннулирует приз; места не сдвигаются, деньги аннулированного приза не тратятся;
  — выплата — balance.credit(balance_type="tower_prize") ровно один раз на строку: строка месяца и строка
    приза под блокировкой, статус проверяется, итог выплат никогда не больше замороженного бюджета.
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.balance import BalanceHistory
from app.models.tower import TowerGame, TowerMonth, TowerMonthlyBest, TowerMonthResult
from app.models.user import User
from app.services import balance as balance_svc
from app.services import gameday
from app.services import tower as tw
from app.services import tower_engine as engine
from app.services import tower_prizes
from app.services.economy import get_setting

log = logging.getLogger(__name__)

BALANCE_TYPE = "tower_prize"
REF_TYPE = "tower_month_result"
# сколько мест хранить в итогах сверх призовых — столько показывает топ
STORED_PLACES = tw.LEADERBOARD_MAX
PRIZE_STATUSES = ("pending", "paid", "flagged", "voided")

# все месяцы раньше этого уже проверены на закрытие (в этом процессе) — лишний запрос не нужен
_checked_before: date | None = None


def reset_cache() -> None:
    global _checked_before
    _checked_before = None


def _month_key(m: date) -> str:
    return m.strftime("%Y-%m")


# ───────── проверка забега ─────────


def verify_best_game(game: TowerGame | None, *, user_id: int, score: int, month: date) -> str | None:
    """Повторная проверка лучшего забега призёра. None — всё сходится, иначе код причины."""
    if game is None:
        return "no_game"
    if game.user_id != user_id or game.status != "finished":
        return "bad_game"
    if game.finished_at is None or tw.month_of(game.finished_at) != month:
        return "wrong_month"
    taps = game.taps
    if not isinstance(taps, list) or not taps or not all(isinstance(t, int) and not isinstance(t, bool) for t in taps):
        return "no_taps"
    elapsed_ms = int((gameday._aware(game.finished_at) - gameday._aware(game.started_at)).total_seconds() * 1000)
    try:
        tw._check_taps(taps, elapsed_ms)
    except tw.RejectedError as e:
        return e.code[:32]
    res = engine.replay(game.seed, taps, game.booster)
    if res.accepted != len(taps) or res.score != score or res.score != game.score:
        return "replay_mismatch"
    return None


# ───────── закрытие ─────────


async def _insert_month(session: AsyncSession, values: dict) -> int | None:
    """INSERT … ON CONFLICT (month) DO NOTHING → id новой строки или None, если месяц уже закрыт кем-то."""
    dialect = session.get_bind().dialect.name
    ins = (postgresql.insert if dialect == "postgresql" else sqlite.insert)(TowerMonth).values(**values)
    ins = ins.on_conflict_do_nothing(index_elements=["month"]).returning(TowerMonth.id)
    return await session.scalar(ins)


async def _get_month(session: AsyncSession, month: date, *, lock: bool = False) -> TowerMonth | None:
    q = select(TowerMonth).where(TowerMonth.month == month).execution_options(populate_existing=True)
    if lock:
        q = q.with_for_update()
    return await session.scalar(q)


async def close_month(
    session: AsyncSession, month: date, *, now: datetime | None = None, by: int | None = None
) -> tuple[TowerMonth, bool]:
    """Закрыть месяц (если ещё не закрыт). (строка месяца, закрыли ли сейчас). Коммит — за вызывающим."""
    now = now or gameday.now_utc()
    month = tw.month_start(month)
    if month >= tw.month_of(now):
        raise tw.TowerError("month_open", "Месяц ещё идёт — закрыть можно после 00:00 МСК 1-го числа", 409)
    existing = await _get_month(session, month)
    if existing is not None:
        return existing, False

    cfg = tower_prizes.safe(await get_setting(session, tower_prizes.KEY))
    await session.flush()
    month_id = await _insert_month(
        session,
        {
            "month": month,
            "status": "no_prizes",
            "reason": None,
            "prize_cfg": {"settings": cfg, "plan": None},
            "closed_at": now,
            "closed_by": by,
        },
    )
    if month_id is None:  # параллельное закрытие успело первым
        tm = await _get_month(session, month)
        assert tm is not None
        return tm, False
    tm = await session.get(TowerMonth, month_id, populate_existing=True)

    ranked = (
        await session.execute(
            select(TowerMonthlyBest)
            .join(User, User.id == TowerMonthlyBest.user_id)
            .where(TowerMonthlyBest.month == month, TowerMonthlyBest.best_score > 0, User.is_banned.is_(False))
            .order_by(TowerMonthlyBest.best_score.desc(), TowerMonthlyBest.achieved_at.asc(), TowerMonthlyBest.user_id.asc())
        )
    ).scalars().all()
    total = len(ranked)
    participants = sum(1 for b in ranked if b.best_score >= cfg["min_score"])

    plan = None
    reason = None
    if total == 0:
        reason = "no_players"
    elif not cfg["enabled"]:
        reason = "disabled"
    elif participants < cfg["min_participants"]:
        reason = "few_participants"
    else:
        plan = tower_prizes.plan(cfg, participants)
        if not plan["places"]:
            reason = "no_budget"
            plan = None

    places = plan["places"] if plan else 0
    amount_of: dict[int, Decimal] = {}
    if plan:
        for g in plan["prizes"]:
            for p in range(g["from_place"], g["to_place"] + 1):
                amount_of[p] = Decimal(g["ton"])

    keep = max(places, STORED_PLACES)
    games: dict[int, TowerGame] = {}
    prize_ids = [b.best_game_id for b in ranked[:places] if b.best_game_id]
    if prize_ids:
        games = {g.id: g for g in (await session.scalars(select(TowerGame).where(TowerGame.id.in_(prize_ids)))).all()}

    planned = Decimal(0)
    for place, b in enumerate(ranked[:keep], start=1):
        amt = amount_of.get(place, Decimal(0))
        if amt > 0 and b.best_score < cfg["min_score"]:
            amt = Decimal(0)
        status, note = "none", None
        if amt > 0:
            planned += amt
            note = verify_best_game(games.get(b.best_game_id or -1), user_id=b.user_id, score=b.best_score, month=month)
            status = "flagged" if note else "pending"
        session.add(
            TowerMonthResult(
                tower_month_id=tm.id,
                user_id=b.user_id,
                place=place,
                score=b.best_score,
                game_id=b.best_game_id,
                amount=amt,
                status=status,
                note=note,
            )
        )

    budget = Decimal(cfg["budget_ton"]) if plan else Decimal(0)
    assert planned <= budget
    tm.status = "payout" if planned > 0 else "no_prizes"
    tm.reason = reason
    tm.prize_cfg = {"settings": cfg, "plan": plan}
    tm.total_players = total
    tm.participants = participants
    tm.places = places
    tm.budget_ton = budget
    tm.planned_ton = planned
    tm.paid_ton = Decimal(0)
    await session.flush()
    log.info("tower month %s closed: players=%s places=%s planned=%s", _month_key(month), total, places, planned)
    return tm, True


async def unclosed_months(session: AsyncSession, now: datetime | None = None) -> list[date]:
    """Прошедшие месяцы, где кто-то играл, но итогов ещё нет."""
    cur = tw.month_of(now)
    rows = await session.scalars(
        select(TowerMonthlyBest.month)
        .where(TowerMonthlyBest.month < cur, ~TowerMonthlyBest.month.in_(select(TowerMonth.month)))
        .group_by(TowerMonthlyBest.month)
        .order_by(TowerMonthlyBest.month)
    )
    return list(rows.all())


async def ensure_closed(session: AsyncSession, now: datetime | None = None) -> list[date]:
    """Лениво закрыть все прошедшие месяцы. Вызывается из запросов «Башни»; сам коммитит."""
    global _checked_before
    now = now or gameday.now_utc()
    cur = tw.month_of(now)
    if _checked_before == cur:
        return []
    done: list[date] = []
    try:
        for m in await unclosed_months(session, now):
            _, fresh = await close_month(session, m, now=now)
            if fresh:
                done.append(m)
        await session.commit()
        _checked_before = cur
    except Exception:  # закрытие не должно ронять топ — попробуем на следующем запросе
        log.exception("tower month close failed")
        await session.rollback()
    return done


# ───────── выплаты ─────────


async def _lock_result(session: AsyncSession, result_id: int) -> tuple[TowerMonth, TowerMonthResult]:
    """Блокировки всегда в одном порядке: строка месяца, потом строка приза."""
    await session.flush()
    month_id = await session.scalar(select(TowerMonthResult.tower_month_id).where(TowerMonthResult.id == result_id))
    if month_id is None:
        raise tw.TowerError("result_not_found", "Приз не найден", 404)
    tm = await session.scalar(
        select(TowerMonth).where(TowerMonth.id == month_id).with_for_update().execution_options(populate_existing=True)
    )
    r = await session.scalar(
        select(TowerMonthResult)
        .where(TowerMonthResult.id == result_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    assert tm is not None and r is not None
    return tm, r


async def _refresh_status(session: AsyncSession, tm: TowerMonth) -> None:
    if tm.planned_ton <= 0:
        return
    await session.flush()
    open_n = await session.scalar(
        select(func.count())
        .select_from(TowerMonthResult)
        .where(TowerMonthResult.tower_month_id == tm.id, TowerMonthResult.status.in_(("pending", "flagged")))
    )
    tm.status = "payout" if open_n else "settled"


async def _is_banned(session: AsyncSession, user_id: int) -> bool:
    return bool(
        await session.scalar(
            select(User.is_banned).where(User.id == user_id).execution_options(populate_existing=True)
        )
    )


def _decide(r: TowerMonthResult, status: str, note: str | None, by: int | None, now: datetime) -> None:
    r.status = status
    r.note = note
    r.decided_at = now
    r.decided_by = by


async def _pay_locked(
    session: AsyncSession, tm: TowerMonth, r: TowerMonthResult, *, by: int, now: datetime
) -> str:
    """Выплатить строку под блокировкой. → "paid" | "already" | "voided" (бан). Ошибка — TowerError."""
    if r.status == "paid":
        return "already"
    if r.status == "flagged":
        raise tw.TowerError("flagged", "Забег не прошёл проверку — сначала решите: одобрить или аннулировать", 409)
    if r.status != "pending":
        raise tw.TowerError("not_payable", "Этот приз не выплачивается", 409)
    if await _is_banned(session, r.user_id):
        _decide(r, "voided", "banned", None, now)
        return "voided"
    amount = Decimal(r.amount)
    if amount <= 0:
        raise tw.TowerError("not_payable", "Этот приз не выплачивается", 409)
    # страховка «ровно один раз»: если начисление по этой строке уже есть — только отмечаем
    prior = await session.scalar(
        select(BalanceHistory.id)
        .where(BalanceHistory.reference_type == REF_TYPE, BalanceHistory.reference_id == r.id)
        .order_by(BalanceHistory.id)
        .limit(1)
    )
    if prior is None:
        if Decimal(tm.paid_ton) + amount > Decimal(tm.budget_ton):
            raise tw.TowerError("over_budget", "Выплата превысила бы бюджет месяца", 409)
        await balance_svc.credit(
            session,
            user_id=r.user_id,
            amount=amount,
            balance_type=BALANCE_TYPE,
            description=f"Приз «Башни» · {_month_key(tm.month)} · {r.place} место",
            reference_type=REF_TYPE,
            reference_id=r.id,
        )
        prior = await session.scalar(
            select(BalanceHistory.id)
            .where(BalanceHistory.reference_type == REF_TYPE, BalanceHistory.reference_id == r.id)
            .order_by(BalanceHistory.id)
            .limit(1)
        )
    r.status = "paid"
    r.paid_at = now
    r.paid_by = by
    r.balance_history_id = prior
    tm.paid_ton = Decimal(tm.paid_ton) + amount
    return "paid"


async def pay_result(session: AsyncSession, *, result_id: int, by: int, now: datetime | None = None) -> str:
    now = now or gameday.now_utc()
    tm, r = await _lock_result(session, result_id)
    out = await _pay_locked(session, tm, r, by=by, now=now)
    await _refresh_status(session, tm)
    await session.flush()
    return out


async def pay_all(session: AsyncSession, *, month_id: int, by: int, now: datetime | None = None) -> dict:
    """Выплатить все ждущие призы месяца. Проблемные (flagged) не трогаем."""
    now = now or gameday.now_utc()
    await session.flush()
    tm = await session.scalar(
        select(TowerMonth).where(TowerMonth.id == month_id).with_for_update().execution_options(populate_existing=True)
    )
    if tm is None:
        raise tw.TowerError("month_not_found", "Месяц не найден", 404)
    rows = (
        await session.scalars(
            select(TowerMonthResult)
            .where(TowerMonthResult.tower_month_id == tm.id, TowerMonthResult.status == "pending")
            .order_by(TowerMonthResult.place)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).all()
    out = {"paid": 0, "voided": 0, "already": 0}
    for r in rows:
        out[await _pay_locked(session, tm, r, by=by, now=now)] += 1
    await _refresh_status(session, tm)
    await session.flush()
    return out


async def void_result(session: AsyncSession, *, result_id: int, by: int, now: datetime | None = None) -> None:
    now = now or gameday.now_utc()
    tm, r = await _lock_result(session, result_id)
    if r.status == "voided":
        return
    if r.status not in ("pending", "flagged"):
        raise tw.TowerError("not_voidable", "Выплаченный приз аннулировать нельзя", 409)
    _decide(r, "voided", "owner", by, now)
    await _refresh_status(session, tm)
    await session.flush()


async def approve_result(session: AsyncSession, *, result_id: int, by: int, now: datetime | None = None) -> None:
    """Владелец проверил забег и разрешил выплату: flagged → pending."""
    now = now or gameday.now_utc()
    tm, r = await _lock_result(session, result_id)
    if r.status == "pending":
        return
    if r.status != "flagged":
        raise tw.TowerError("not_flagged", "Приз не на проверке", 409)
    _decide(r, "pending", f"approved:{(r.note or '')[:23]}", by, now)
    await _refresh_status(session, tm)
    await session.flush()


async def void_banned(session: AsyncSession, now: datetime | None = None) -> int:
    """Бан до выплаты аннулирует приз: пройтись по невыплаченным призам забаненных."""
    now = now or gameday.now_utc()
    ids = (
        await session.scalars(
            select(TowerMonthResult.id)
            .join(User, User.id == TowerMonthResult.user_id)
            .where(TowerMonthResult.status.in_(("pending", "flagged")), User.is_banned.is_(True))
        )
    ).all()
    for rid in ids:
        tm, r = await _lock_result(session, rid)
        if r.status in ("pending", "flagged") and await _is_banned(session, r.user_id):
            _decide(r, "voided", "banned", None, now)
            await _refresh_status(session, tm)
    await session.flush()
    return len(ids)


# ───────── чтение ─────────


def _name(u: User | None) -> str:
    return tw._display_name(u) if u else "Игрок"


async def admin_overview(session: AsyncSession, *, now: datetime | None = None, months: int = 12) -> dict:
    now = now or gameday.now_utc()
    tms = (await session.scalars(select(TowerMonth).order_by(TowerMonth.month.desc()).limit(months))).all()
    out = []
    for tm in tms:
        rows = (
            await session.execute(
                select(TowerMonthResult, User, TowerGame.booster)
                .join(User, User.id == TowerMonthResult.user_id)
                .outerjoin(TowerGame, TowerGame.id == TowerMonthResult.game_id)
                .where(TowerMonthResult.tower_month_id == tm.id, TowerMonthResult.status != "none")
                .order_by(TowerMonthResult.place)
            )
        ).all()
        counts = {s: 0 for s in PRIZE_STATUSES}
        pending_ton = Decimal(0)
        results = []
        for r, u, booster in rows:
            counts[r.status] = counts.get(r.status, 0) + 1
            if r.status in ("pending", "flagged"):
                pending_ton += Decimal(r.amount)
            results.append(
                {
                    "id": r.id,
                    "place": r.place,
                    "user_id": r.user_id,
                    "name": _name(u),
                    "username": u.username,
                    "score": r.score,
                    "game_id": r.game_id,
                    "booster": booster,
                    "amount_ton": tower_prizes.ton_str(Decimal(r.amount)),
                    "status": r.status,
                    "note": r.note,
                    "paid_at": gameday._aware(r.paid_at).isoformat() if r.paid_at else None,
                    "banned": bool(u.is_banned),
                }
            )
        out.append(
            {
                "id": tm.id,
                "month": _month_key(tm.month),
                "status": tm.status,
                "reason": tm.reason,
                "total_players": tm.total_players,
                "participants": tm.participants,
                "min_participants": (tm.prize_cfg or {}).get("settings", {}).get("min_participants"),
                "places": tm.places,
                "budget_ton": tower_prizes.ton_str(Decimal(tm.budget_ton)),
                "planned_ton": tower_prizes.ton_str(Decimal(tm.planned_ton)),
                "paid_ton": tower_prizes.ton_str(Decimal(tm.paid_ton)),
                "pending_ton": tower_prizes.ton_str(pending_ton),
                "closed_at": gameday._aware(tm.closed_at).isoformat(),
                "closed_auto": tm.closed_by is None,
                "counts": counts,
                "results": results,
            }
        )
    return {
        "months": out,
        "unclosed": [_month_key(m) for m in await unclosed_months(session, now)],
        "server_time": now.isoformat(),
    }


PUBLIC_STATUS = {"paid": "paid", "pending": "awaiting", "flagged": "awaiting", "voided": "voided"}


async def closed_board(
    session: AsyncSession, tm: TowerMonth, *, user_id: int, limit: int, now: datetime
) -> dict:
    """Топ закрытого месяца из сохранённых итогов: места не меняются, у призов — статус выплаты."""
    rows = (
        await session.execute(
            select(TowerMonthResult, User)
            .join(User, User.id == TowerMonthResult.user_id)
            .where(TowerMonthResult.tower_month_id == tm.id)
            .order_by(TowerMonthResult.place)
            .limit(limit)
        )
    ).all()
    entries = []
    for r, u in rows:
        e = {"rank": r.place, "name": _name(u), "score": r.score, "is_me": r.user_id == user_id}
        if r.status != "none":
            e["prize_ton"] = tower_prizes.ton_str(Decimal(r.amount))
            e["prize_status"] = PUBLIC_STATUS.get(r.status, "awaiting")
        entries.append(e)
    mine = await session.scalar(
        select(TowerMonthResult).where(TowerMonthResult.tower_month_id == tm.id, TowerMonthResult.user_id == user_id)
    )
    me = None
    if mine is not None:
        me = {"rank": mine.place, "score": mine.score}
        if mine.status != "none":
            me["prize_ton"] = tower_prizes.ton_str(Decimal(mine.amount))
            me["prize_status"] = PUBLIC_STATUS.get(mine.status, "awaiting")
    cfg = (tm.prize_cfg or {}).get("settings") or {}
    plan = (tm.prize_cfg or {}).get("plan")
    return {
        "month": _month_key(tm.month),
        "entries": entries,
        "total_players": tm.total_players,
        "me": me,
        "month_ends_at": tw.month_end(tm.month).isoformat(),
        "server_time": now.isoformat(),
        "min_participants": int(cfg.get("min_participants", tower_prizes.DEFAULT["min_participants"])),
        "min_score": int(cfg.get("min_score", 1)),
        "participants": tm.participants,
        "prize_budget_ton": tower_prizes.ton_str(Decimal(tm.budget_ton)) if plan else None,
        "prize_places": tm.places,
        "next_place_at": None,
        "max_places": int(cfg.get("max_places", tower_prizes.DEFAULT["max_places"])),
        "prize_limited_by": plan["limited_by"] if plan else None,
        "min_prize_ton": cfg.get("min_prize_ton") if plan else None,
        "prize_total_ton": tower_prizes.ton_str(Decimal(tm.planned_ton)) if plan else None,
        "prize_cutoff_score": None,
        "prizes": plan["prizes"] if plan else None,
        "closed": True,
        "close_reason": tm.reason,
        "prize_paid_ton": tower_prizes.ton_str(Decimal(tm.paid_ton)),
    }
