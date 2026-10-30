"""«Башня»: попытки, старт, проверка забега, лучший счёт месяца, топ.

Правила (решил владелец):
  — 3 бесплатные попытки в игровой день (сброс в 00:00 МСК, как у колеса и ежедневки); попытка списывается при старте;
  — очки считает движок (tower_engine, порт JS-движка): обычный блок 1, идеальный 2…6;
  — в топ месяца идёт лучший счёт игрока, а не сумма;
  — платной «второй жизни» нет; бустеры и платные попытки — следующий этап (старт с бустером пока отклоняется).

Защита от накрутки: seed выдаёт сервер; финиш — один на игру; счёт берётся из проигрывания журнала тапов,
присланный счёт должен с ним совпасть; журнал проверяется на невозможную скорость и на время (игровые часы
не могут уйти вперёд настенных).
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tower import TowerDailyAttempts, TowerGame, TowerMonthlyBest
from app.models.user import User
from app.services import balance as balance_svc
from app.services import gameday
from app.services import tower_engine as engine
from app.services import tower_prizes
from app.services.economy import get_setting

FREE_ATTEMPTS_PER_DAY = 3

# Пределы журнала тапов. Первые два совпадают с LIMITS в frontend/src/lib/tower/engine.ts (сверяет тест).
MIN_FIRST_TAP_MS = 100
MIN_TAP_GAP_MS = 70
MAX_TAPS = 3000
# игровые часы клиента не обгоняют настенные; запас на задержки сети и округления
DURATION_SLACK_MS = 3000
# забег, не завершённый за это время, закрывается без счёта
MAX_GAME_SECONDS = 2 * 3600

LEADERBOARD_MAX = 100


class TowerError(Exception):
    """Ошибка правил игры: код для клиента, сообщение, HTTP-статус."""

    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


class NoAttemptsError(TowerError):
    def __init__(self, next_reset: datetime):
        super().__init__("no_attempts", "Попытки на сегодня закончились", 409)
        self.next_reset = next_reset


class RejectedError(TowerError):
    """Забег отклонён и закрыт (счёт 0). Роутер сохраняет закрытие и отвечает 422."""

    def __init__(self, reason: str, message: str):
        super().__init__(reason, message, 422)


def month_start(day: date) -> date:
    return day.replace(day=1)


def month_of(now: datetime | None = None) -> date:
    """Месяц (первое число) по Москве для момента `now`."""
    return month_start(gameday.game_day(now))


def month_end(month: date) -> datetime:
    """Конец месяца топа: 00:00 МСК 1-го числа следующего месяца (UTC)."""
    nxt = date(month.year + (month.month == 12), month.month % 12 + 1, 1)
    return gameday.day_start(nxt)


def parse_month(raw: str) -> date:
    try:
        y, m = raw.split("-")
        return date(int(y), int(m), 1)
    except (ValueError, AttributeError) as e:
        raise TowerError("bad_month", "Месяц в формате ГГГГ-ММ", 400) from e


def _display_name(u: User) -> str:
    name = (u.first_name or u.username or "Игрок").strip() or "Игрок"
    return name[:24]


# ───────── попытки ─────────


async def _attempts_row(session: AsyncSession, user_id: int, day: date) -> TowerDailyAttempts | None:
    return await session.scalar(
        select(TowerDailyAttempts).where(TowerDailyAttempts.user_id == user_id, TowerDailyAttempts.game_day == day)
    )


async def used_today(session: AsyncSession, user_id: int, now: datetime | None = None) -> int:
    row = await _attempts_row(session, user_id, gameday.game_day(now))
    return int(row.used) if row else 0


async def month_standing(
    session: AsyncSession, user_id: int, month: date
) -> tuple[int | None, int | None]:
    """(лучший счёт игрока за месяц, его место в топе) — или (None, None), если счёта нет."""
    mine = await session.scalar(
        select(TowerMonthlyBest).where(TowerMonthlyBest.user_id == user_id, TowerMonthlyBest.month == month)
    )
    if mine is None or mine.best_score <= 0:
        return None, None
    ahead = await session.scalar(
        select(func.count())
        .select_from(TowerMonthlyBest)
        .join(User, User.id == TowerMonthlyBest.user_id)
        .where(
            TowerMonthlyBest.month == month,
            User.is_banned.is_(False),
            or_(
                TowerMonthlyBest.best_score > mine.best_score,
                and_(TowerMonthlyBest.best_score == mine.best_score, TowerMonthlyBest.achieved_at < mine.achieved_at),
                and_(
                    TowerMonthlyBest.best_score == mine.best_score,
                    TowerMonthlyBest.achieved_at == mine.achieved_at,
                    TowerMonthlyBest.user_id < mine.user_id,
                ),
            ),
        )
    )
    return int(mine.best_score), int(ahead or 0) + 1


async def my_status(session: AsyncSession, *, user_id: int, now: datetime | None = None) -> dict:
    now = now or gameday.now_utc()
    used = await used_today(session, user_id, now)
    month = month_of(now)
    best, rank = await month_standing(session, user_id, month)
    return {
        "free_per_day": FREE_ATTEMPTS_PER_DAY,
        "used_today": min(used, FREE_ATTEMPTS_PER_DAY),
        "left_today": max(0, FREE_ATTEMPTS_PER_DAY - used),
        "next_reset_at": gameday.next_reset(now).isoformat(),
        "month": month.strftime("%Y-%m"),
        "best_month": best,
        "rank": rank,
    }


# ───────── старт ─────────


async def start_game(
    session: AsyncSession, *, user: User, booster: str | None = None, now: datetime | None = None
) -> TowerGame:
    """Списать попытку и выдать забег с seed от сервера."""
    now = now or gameday.now_utc()
    if booster is not None:
        # бустеры появятся вместе с их покупкой; движок и проверка забега флаг уже поддерживают
        raise TowerError("booster_unavailable", "Бустеры пока недоступны", 400)
    # блокировка игрока: два быстрых старта подряд не обойдут лимит
    await balance_svc.get_user_for_update(session, user.id)
    day = gameday.game_day(now)
    row = await _attempts_row(session, user.id, day)
    if row is None:
        row = TowerDailyAttempts(user_id=user.id, game_day=day, used=0)
        session.add(row)
    if row.used >= FREE_ATTEMPTS_PER_DAY:
        raise NoAttemptsError(gameday.next_reset(now))
    row.used += 1
    game = TowerGame(
        user_id=user.id,
        seed=secrets.randbits(32),
        booster=booster,
        game_day=day,
        started_at=now,
        status="started",
    )
    session.add(game)
    await session.flush()
    return game


# ───────── финиш ─────────


@dataclass
class FinishResult:
    game: TowerGame
    result: engine.ReplayResult
    new_best: bool
    best_month: int
    rank: int | None


def _check_taps(taps: list[int], elapsed_ms: int) -> None:
    if len(taps) > MAX_TAPS:
        raise RejectedError("too_many_taps", "Слишком длинный журнал тапов")
    if any(t < 0 for t in taps):
        raise RejectedError("bad_taps", "Некорректный журнал тапов")
    if taps:
        if taps[0] < MIN_FIRST_TAP_MS:
            raise RejectedError("taps_too_fast", "Первый тап слишком быстрый")
        for a, b in zip(taps, taps[1:]):
            if b - a < MIN_TAP_GAP_MS:
                raise RejectedError("taps_too_fast", "Тапы идут быстрее, чем может человек")
        if taps[-1] > elapsed_ms + DURATION_SLACK_MS:
            raise RejectedError("bad_duration", "Игра длилась меньше, чем записано в журнале")


async def finish_game(
    session: AsyncSession,
    *,
    user: User,
    game_id: int,
    taps: list[int],
    claimed_score: int,
    now: datetime | None = None,
) -> FinishResult:
    """Проверить забег по журналу тапов и записать счёт. Один финиш на игру; отклонённый забег тоже закрывается."""
    now = now or gameday.now_utc()
    await balance_svc.get_user_for_update(session, user.id)
    game = await session.scalar(
        select(TowerGame)
        .where(TowerGame.id == game_id, TowerGame.user_id == user.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if game is None:
        raise TowerError("game_not_found", "Игра не найдена", 404)
    if game.status != "started":
        raise TowerError("already_finished", "Результат этой игры уже принят", 409)

    def reject(e: RejectedError):
        game.status = "rejected"
        game.reject_reason = e.code
        game.finished_at = now
        game.taps = taps if len(taps) <= MAX_TAPS else None
        return e

    elapsed_ms = int((now - gameday._aware(game.started_at)).total_seconds() * 1000)
    if elapsed_ms > MAX_GAME_SECONDS * 1000:
        raise reject(RejectedError("expired", "Игра закрыта по времени"))
    try:
        _check_taps(taps, elapsed_ms)
    except RejectedError as e:
        raise reject(e) from None

    res = engine.replay(game.seed, taps, game.booster)
    if res.accepted != len(taps):
        raise reject(RejectedError("bad_taps", "В журнале есть тапы, которых в этой игре быть не могло")) from None
    if res.score != claimed_score:
        raise reject(RejectedError("replay_mismatch", "Результат не совпал с проверкой")) from None

    game.status = "finished"
    game.finished_at = now
    game.taps = taps
    game.score = res.score
    game.height = res.height
    game.perfects = res.perfects
    game.best_combo = res.best_combo
    game.over = res.over

    # месяц — по моменту завершения: закрытый месяц уже не меняется (на нём будут призы)
    month = month_of(now)
    best_row = await session.scalar(
        select(TowerMonthlyBest).where(TowerMonthlyBest.user_id == user.id, TowerMonthlyBest.month == month)
    )
    new_best = False
    if res.score > 0:
        if best_row is None:
            best_row = TowerMonthlyBest(
                user_id=user.id, month=month, best_score=res.score, best_game_id=game.id, achieved_at=now
            )
            session.add(best_row)
            new_best = True
        elif res.score > best_row.best_score:
            best_row.best_score = res.score
            best_row.best_game_id = game.id
            best_row.achieved_at = now
            new_best = True
    await session.flush()
    best, rank = await month_standing(session, user.id, month)
    return FinishResult(game=game, result=res, new_best=new_best, best_month=best or 0, rank=rank)


# ───────── топ ─────────


async def leaderboard(
    session: AsyncSession,
    *,
    user_id: int,
    month: date | None = None,
    limit: int = 10,
    now: datetime | None = None,
) -> dict:
    """Топ месяца: лучший счёт игрока (не сумма); при равенстве выше тот, кто набрал раньше."""
    month = month or month_of(now)
    limit = max(1, min(int(limit), LEADERBOARD_MAX))
    q = (
        select(TowerMonthlyBest, User)
        .join(User, User.id == TowerMonthlyBest.user_id)
        .where(TowerMonthlyBest.month == month, TowerMonthlyBest.best_score > 0, User.is_banned.is_(False))
        .order_by(TowerMonthlyBest.best_score.desc(), TowerMonthlyBest.achieved_at.asc(), TowerMonthlyBest.user_id.asc())
        .limit(limit)
    )
    rows = (await session.execute(q)).all()
    entries = [
        {"rank": i, "name": _display_name(u), "score": int(b.best_score), "is_me": b.user_id == user_id}
        for i, (b, u) in enumerate(rows, start=1)
    ]
    total = await session.scalar(
        select(func.count())
        .select_from(TowerMonthlyBest)
        .join(User, User.id == TowerMonthlyBest.user_id)
        .where(TowerMonthlyBest.month == month, TowerMonthlyBest.best_score > 0, User.is_banned.is_(False))
    )
    best, rank = await month_standing(session, user_id, month)
    cfg = tower_prizes.safe(await get_setting(session, tower_prizes.KEY))
    # участники для призов — у кого лучший счёт не меньше min_score
    participants = int(total or 0)
    if cfg["min_score"] > 1:
        participants = int(
            await session.scalar(
                select(func.count())
                .select_from(TowerMonthlyBest)
                .join(User, User.id == TowerMonthlyBest.user_id)
                .where(
                    TowerMonthlyBest.month == month,
                    TowerMonthlyBest.best_score >= cfg["min_score"],
                    User.is_banned.is_(False),
                )
            )
            or 0
        )
    # призы — только текущего месяца и только если владелец их включил; истории бюджета нет —
    # прошлый месяц без призов. Денег здесь не двигаем: это расчёт по текущему числу участников.
    current = month == month_of(now)
    plan = tower_prizes.plan(cfg, participants) if cfg["enabled"] and current else None
    # счёт последнего призового места — для строки «+X до N-го места» у тех, кто ниже
    cutoff = None
    if plan and plan["places"]:
        cutoff = await session.scalar(
            select(TowerMonthlyBest.best_score)
            .join(User, User.id == TowerMonthlyBest.user_id)
            .where(TowerMonthlyBest.month == month, TowerMonthlyBest.best_score > 0, User.is_banned.is_(False))
            .order_by(TowerMonthlyBest.best_score.desc(), TowerMonthlyBest.achieved_at.asc(), TowerMonthlyBest.user_id.asc())
            .offset(plan["places"] - 1)
            .limit(1)
        )
    return {
        "month": month.strftime("%Y-%m"),
        "entries": entries,
        "total_players": int(total or 0),
        "me": {"rank": rank, "score": best} if rank is not None else None,
        "month_ends_at": month_end(month).isoformat(),
        "min_participants": cfg["min_participants"],
        "min_score": cfg["min_score"],
        "participants": participants,
        "prize_budget_ton": plan["budget_ton"] if plan else None,
        "prize_places": plan["places"] if plan else 0,
        "next_place_at": plan["next_place_at"] if plan else None,
        "max_places": cfg["max_places"],
        "prize_limited_by": plan["limited_by"] if plan else None,
        "min_prize_ton": cfg["min_prize_ton"] if plan else None,
        "prize_total_ton": plan["total_ton"] if plan else None,
        "prize_cutoff_score": int(cutoff) if cutoff is not None else None,
        "prizes": plan["prizes"] if plan else None,
    }
