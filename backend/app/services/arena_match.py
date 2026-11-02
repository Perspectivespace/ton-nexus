"""«Арена»: цикл ходов боя — приём планов, разрешение хода по дедлайну или «Готово», журнал ходов, расчёт.

Поверх services/arena_engine (правила) и services/arena_escrow (деньги):
- игроки в движке — номера мест (0…seats-1): журнал ходов публичный, id пользователей в нём нет;
- 1-й ход открывается через COUNTDOWN_S после старта комнаты (отсчёт), на план — TURN_S; следующий ход
  открывается в момент разрешения предыдущего и тоже длится TURN_S;
- ход разрешается, когда наступил дедлайн или все живые игроки нажали «Готово». Нет плана — «стоять» (RULES §1);
- журнал: arena_turns — по строке на ход (окно, планы, итог движка). Вместе с раскрытым seed этого достаточно,
  чтобы любой пересчитал бой (arena_engine.run_match) и проверил места;
- конец боя: места из движка (placements) → escrow.settle — призы (arena_prize) и комиссия в той же транзакции.
Все изменения боя — под блокировкой строки комнаты (escrow._lock_room): порядок «комната → игроки» как в эскроу.
Продвижение ленивое (чтение комнаты/состояния и отправка плана) плюс фоновый опросчик (advance_due).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.arena import ArenaEntry, ArenaMatch, ArenaRoom, ArenaTurn
from app.services import arena_engine as eng
from app.services import arena_escrow as escrow

COUNTDOWN_S = 3
TURN_S = eng.TURN_MS // 1000

log = logging.getLogger(__name__)


class ArenaPlanRejected(escrow.ArenaError):
    """План не прошёл строгую проверку движка (arena_engine.validate_plan); reason — код движка."""

    code = "bad_plan"

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


class ArenaTurnMismatch(escrow.ArenaError):
    """План прислан не на текущий ход (ход уже разрешён или ещё не открыт)."""

    code = "turn_mismatch"

    def __init__(self, current: int | None):
        super().__init__(f"current turn is {current}")
        self.current = current


class ArenaTurnNotOpen(escrow.ArenaError):
    """Отсчёт перед 1-м ходом: планы ещё не принимаются."""

    code = "turn_not_open"


class ArenaNotPlaying(escrow.ArenaError):
    """Пользователь не играет в этой комнате (нет места в бою)."""

    code = "not_playing"


def _dumps(v: Any) -> str:
    return json.dumps(v, separators=(",", ":"), sort_keys=True)


async def open_first_turn(session: AsyncSession, room: ArenaRoom) -> ArenaTurn:
    """1-й ход: отсчёт COUNTDOWN_S после старта комнаты, затем TURN_S на план. Повтор — тот же ход."""
    existing = await session.scalar(select(ArenaTurn).where(ArenaTurn.room_id == room.id, ArenaTurn.turn == 1))
    if existing is not None:
        return existing
    started = escrow._aware(room.started_at)
    opens = started + timedelta(seconds=COUNTDOWN_S)
    t = ArenaTurn(room_id=room.id, turn=1, opens_at=opens, deadline=opens + timedelta(seconds=TURN_S), plans_json="{}")
    session.add(t)
    await session.flush()
    return t


async def _match(session: AsyncSession, room_id: int) -> ArenaMatch | None:
    return await session.scalar(
        select(ArenaMatch).where(ArenaMatch.room_id == room_id).execution_options(populate_existing=True)
    )


async def _open_turn(session: AsyncSession, room_id: int) -> ArenaTurn | None:
    """Текущий (не разрешённый) ход комнаты или None (бой окончен)."""
    return await session.scalar(
        select(ArenaTurn)
        .where(ArenaTurn.room_id == room_id, ArenaTurn.resolved_at.is_(None))
        .order_by(ArenaTurn.turn.desc())
        .limit(1)
        .execution_options(populate_existing=True)
    )


def _due(turn: ArenaTurn, state: eng.MatchState, now: datetime) -> str | None:
    """Пора ли разрешать ход: "deadline" | "ready" | None."""
    if now >= escrow._aware(turn.deadline):
        return "deadline"
    if now < escrow._aware(turn.opens_at):
        return None
    plans = json.loads(turn.plans_json or "{}")
    alive = [p.id for p in state.players if p.alive]
    if alive and all(plans.get(str(seat), {}).get("ready") for seat in alive):
        return "ready"
    return None


async def _seat_users(session: AsyncSession, room_id: int) -> dict[int, int]:
    """Место → user_id игроков боя (ставка в холде или уже рассчитана)."""
    rows = (
        await session.execute(
            select(ArenaEntry.seat, ArenaEntry.user_id).where(
                ArenaEntry.room_id == room_id, ArenaEntry.status.in_(("held", "paid", "lost"))
            )
        )
    ).all()
    return {int(seat): int(uid) for seat, uid in rows if seat is not None}


async def _settle(session: AsyncSession, room: ArenaRoom, state: eng.MatchState, now: datetime) -> None:
    seat_user = await _seat_users(session, room.id)
    places = {seat_user[pl.id]: pl.place for pl in (state.places or eng.placements(state))}
    await escrow.settle(session, room.id, places, now=now)


async def _resolve(
    session: AsyncSession,
    room: ArenaRoom,
    match: ArenaMatch,
    turn: ArenaTurn,
    state: eng.MatchState,
    reason: str,
    now: datetime,
) -> eng.MatchState:
    """Разрешить ход: планы (невалидный или нет — «стоять») → движок → журнал → следующий ход или расчёт."""
    submitted = json.loads(turn.plans_json or "{}")
    eff: dict[int, eng.Plan] = {}
    for p in state.players:
        raw = submitted.get(str(p.id))
        if not p.alive or raw is None:
            continue
        try:
            eff[p.id] = eng.validate_plan(state, p.id, eng.parse_plan(raw.get("plan")))
        except eng.InvalidPlan:
            continue  # не должно случаться: план проверен при приёме, состояние с тех пор не менялось
    new = eng.resolve_turn(state, eff)
    turn.plans_json = _dumps({str(p.id): eng.plan_to_dict(eff[p.id]) if p.id in eff else None for p in state.players if p.alive})
    turn.result_json = _dumps(new.last_turn)
    turn.reason = reason
    turn.resolved_at = now
    match.state_json = eng.state_to_json(new)
    match.turn = new.turn
    match.updated_at = now
    await session.flush()
    if new.finished:
        await _settle(session, room, new, now)
    else:
        session.add(
            ArenaTurn(
                room_id=room.id,
                turn=new.turn,
                opens_at=now,
                deadline=now + timedelta(seconds=TURN_S),
                plans_json="{}",
            )
        )
        await session.flush()
    return new


async def _advance_locked(session: AsyncSession, room: ArenaRoom, now: datetime) -> bool:
    """Под блокировкой комнаты: разрешить текущий ход, если пора. True — что-то изменилось."""
    if room.status != "running":
        return False
    match = await _match(session, room.id)
    if match is None:
        return False
    state = eng.state_from_json(match.state_json)
    turn = await _open_turn(session, room.id)
    if turn is None:
        if state.finished:  # бой окончен, но комната не рассчитана (не должно быть: расчёт в той же транзакции)
            await _settle(session, room, state, now)
            return True
        turn = await open_first_turn(session, room) if state.turn == 1 else None
        if turn is None:
            raise escrow.ArenaStateError(f"room {room.id}: no open turn")
    reason = _due(turn, state, now)
    if reason is None:
        return False
    await _resolve(session, room, match, turn, state, reason, now)
    return True


async def is_due(session: AsyncSession, room_id: int, *, now: datetime | None = None) -> bool:
    """Без блокировок: есть ли что продвигать (для ленивого продвижения на чтениях)."""
    now = now or escrow.utcnow()
    status = await session.scalar(select(ArenaRoom.status).where(ArenaRoom.id == room_id))
    if status != "running":
        return False
    match = await _match(session, room_id)
    turn = await _open_turn(session, room_id)
    if match is None or turn is None:
        return match is not None
    return _due(turn, eng.state_from_json(match.state_json), now) is not None


async def advance(session: AsyncSession, room_id: int, *, now: datetime | None = None) -> bool:
    """Разрешить текущий ход комнаты, если наступил дедлайн или все «Готово». Коммитит вызывающий.

    Ход разрешается не больше одного за вызов: следующий открывается в момент разрешения и длится TURN_S.
    Идемпотентно и безопасно при параллельных вызовах (блокировка строки комнаты).
    """
    now = now or escrow.utcnow()
    room = await escrow._lock_room(session, room_id)
    return await _advance_locked(session, room, now)


async def advance_due(session_factory: async_sessionmaker, *, now: datetime | None = None) -> int:
    """Шаг опросчика: разрешить все ходы с прошедшим дедлайном. Каждая комната — своя транзакция."""
    now = now or escrow.utcnow()
    async with session_factory() as s:
        ids = (
            await s.scalars(
                select(ArenaTurn.room_id)
                .join(ArenaRoom, ArenaRoom.id == ArenaTurn.room_id)
                .where(ArenaRoom.status == "running", ArenaTurn.resolved_at.is_(None), ArenaTurn.deadline <= now)
                .order_by(ArenaTurn.room_id)
            )
        ).all()
    done = 0
    for rid in ids:
        async with session_factory() as s:
            try:
                done += int(await advance(s, rid, now=now))
                await s.commit()
            except Exception:
                await s.rollback()
                log.exception("[arena] advance room %s failed", rid)
    return done


async def submit_plan(
    session: AsyncSession,
    room_id: int,
    *,
    user_id: int,
    turn: int,
    plan: Any,
    ready: bool = True,
    now: datetime | None = None,
) -> dict:
    """Принять план игрока на ход `turn` (перезапись до дедлайна). Все живые «Готово» — ход разрешается сразу.

    Ошибки: not_playing, room_state (бой не идёт), turn_mismatch (ход уже другой), turn_not_open (отсчёт),
    bad_plan (+ reason — код движка). Коммитит вызывающий.
    """
    now = now or escrow.utcnow()
    room = await escrow._lock_room(session, room_id)
    seat = await session.scalar(
        select(ArenaEntry.seat).where(
            ArenaEntry.room_id == room_id, ArenaEntry.user_id == user_id, ArenaEntry.status.in_(("held", "paid", "lost"))
        )
    )
    if seat is None:
        raise ArenaNotPlaying(f"user {user_id} is not playing in room {room_id}")
    if room.status != "running":
        raise escrow.ArenaStateError(f"room {room_id} is {room.status}")
    # опоздавший план не должен попасть в следующий ход: сначала разрешаем просроченный
    await _advance_locked(session, room, now)
    if room.status != "running":
        raise escrow.ArenaStateError(f"room {room_id} is {room.status}")
    cur = await _open_turn(session, room_id)
    if cur is None or cur.turn != turn:
        raise ArenaTurnMismatch(cur.turn if cur else None)
    if now < escrow._aware(cur.opens_at):
        raise ArenaTurnNotOpen(f"turn {turn} opens at {cur.opens_at}")
    match = await _match(session, room_id)
    state = eng.state_from_json(match.state_json)
    try:
        parsed = eng.validate_plan(state, seat, eng.parse_plan(plan))
    except eng.InvalidPlan as e:
        raise ArenaPlanRejected(e.code) from None
    plans = json.loads(cur.plans_json or "{}")
    plans[str(seat)] = {"plan": eng.plan_to_dict(parsed), "ready": bool(ready)}
    cur.plans_json = _dumps(plans)
    await session.flush()
    resolved = False
    if _due(cur, state, now) == "ready":
        await _resolve(session, room, match, cur, state, "ready", now)
        resolved = True
    return {"turn": turn, "seat": seat, "ready": bool(ready), "resolved": resolved}


# ───────── чтение ─────────


def _iso(dt: datetime | None) -> str | None:
    dt = escrow._aware(dt)
    return dt.isoformat() if dt else None


def _players(state: eng.MatchState, names: dict[int, str], my_seat: int | None) -> list[dict]:
    out = []
    for p in state.players:
        out.append(
            {
                "seat": p.id,
                "name": names.get(p.id, "Игрок"),
                "is_me": p.id == my_seat,
                "x": p.x,
                "y": p.y,
                "hp": p.hp,
                "ap": p.ap,
                "armor": p.armor,
                "weapon": p.weapon,
                "medkits": p.medkits,
                "alive": p.alive,
                "death_turn": p.death_turn,
                "kills": p.kills,
                "dealt": p.dealt,
            }
        )
    return out


def turn_entry(t: ArenaTurn) -> dict:
    """Разрешённый ход для журнала: окно, планы по местам (null — стоял), итог движка."""
    return {
        "turn": t.turn,
        "opens_at": _iso(t.opens_at),
        "deadline": _iso(t.deadline),
        "resolved_at": _iso(t.resolved_at),
        "reason": t.reason,
        "plans": json.loads(t.plans_json or "{}"),
        "result": json.loads(t.result_json) if t.result_json else None,
    }


async def turn_log(session: AsyncSession, room_id: int, *, since: int = 0) -> list[dict]:
    rows = (
        await session.scalars(
            select(ArenaTurn)
            .where(ArenaTurn.room_id == room_id, ArenaTurn.resolved_at.is_not(None), ArenaTurn.turn > since)
            .order_by(ArenaTurn.turn)
            .execution_options(populate_existing=True)
        )
    ).all()
    return [turn_entry(t) for t in rows]


async def match_view(
    session: AsyncSession, room: ArenaRoom, *, names: dict[int, str], my_seat: int | None, now: datetime | None = None
) -> dict | None:
    """Состояние боя для участника: поле, лут, игроки, зона, текущий ход (окно, кто «Готов», мой план).

    Чужие планы текущего хода не отдаются; seed — только после конца (в виде комнаты, вместе с солью).
    """
    now = now or escrow.utcnow()
    match = await _match(session, room.id)
    if match is None:
        return None
    s = eng.state_from_json(match.state_json)
    cur = await _open_turn(session, room.id) if not s.finished and room.status == "running" else None
    turn_info = None
    if cur is not None:
        plans = json.loads(cur.plans_json or "{}")
        mine = plans.get(str(my_seat)) if my_seat is not None else None
        turn_info = {
            "turn": cur.turn,
            "opens_at": _iso(cur.opens_at),
            "deadline": _iso(cur.deadline),
            "ready_seats": sorted(int(k) for k, v in plans.items() if v.get("ready")),
            "my_plan": mine,
        }
    if s.finished or room.status == "finished":
        phase = "finished"
    elif room.status != "running":
        phase = room.status  # cancelled — бой прерван владельцем
    elif cur is not None and now < escrow._aware(cur.opens_at):
        phase = "countdown"
    else:
        phase = "planning"
    box = eng.zone_box(s.n, s.stage)
    return {
        "id": match.id,
        "turn": match.turn,
        "phase": phase,
        "finished": s.finished,
        "current": turn_info,
        "n": s.n,
        "tiles": [list(r) for r in s.tiles],
        "loot": [{"id": x.id, "x": x.x, "y": x.y, "kind": x.kind, "type": x.type} for x in s.loot],
        "zone": {"stage": s.stage, "box": list(box), "closed": s.stage > eng.max_stage(s.n)},
        "players": _players(s, names, my_seat),
        "last_turn": s.last_turn,
        "places": [{"seat": p.id, "place": p.place, "shared": p.shared} for p in s.places] if s.places else None,
    }
