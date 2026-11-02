"""«Арена»: комнаты для API — список типов, вход «в любую комнату типа», выход, вид комнаты, старт боя.

Поверх services/arena_escrow (деньги) и services/arena_engine (состояние боя):
- вход: найти комнату типа в наборе или создать новую, затем escrow.join; набралась — escrow.start и
  состояние боя (arena_matches) в той же транзакции;
- «найти или создать» сериализуется транзакционной advisory-блокировкой Postgres на тип комнаты
  (иначе два параллельных входа создали бы две комнаты); на SQLite (тесты, локально) — без неё.
  Порядок блокировок: advisory(тип) → комната → игрок (как в эскроу: комната → игрок);
- возврат просроченных комнат: лениво (перед входом и на чтениях) и из фонового опросчика (main.deposit_loop);
- seed карты выдаётся из secrets при создании комнаты (escrow.create_room) и до боя виден только хэш
  (commit–reveal); при старте он не меняется.
Флаг «Арены» (настройка arena.enabled) проверяет API, а не этот модуль.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.arena import ArenaEntry, ArenaMatch, ArenaRoom
from app.models.user import User
from app.services import arena_engine
from app.services import arena_escrow as escrow
from app.services.arena_config import ARENA_ROOMS, room_type
from app.services.economy import get_setting

SETTING_KEY = "arena"
# ключ advisory-блокировки «найти или создать»: (класс, номер типа комнаты)
_LOCK_CLASS = 0x4152  # "AR"
_TYPE_LOCK = {code: i + 1 for i, code in enumerate(ARENA_ROOMS)}


class ArenaUnknownType(escrow.ArenaError):
    code = "unknown_room_type"


async def is_enabled(session: AsyncSession) -> bool:
    cfg = await get_setting(session, SETTING_KEY) or {}
    return bool(isinstance(cfg, dict) and cfg.get("enabled"))


def _rt(code: str):
    try:
        return room_type(code)
    except ValueError as e:
        raise ArenaUnknownType(str(e)) from None


async def _type_lock(session: AsyncSession, code: str) -> None:
    if session.get_bind().dialect.name == "postgresql":
        await session.execute(
            text("SELECT pg_advisory_xact_lock(:a, :b)"), {"a": _LOCK_CLASS, "b": _TYPE_LOCK[code]}
        )


async def _held_count(session: AsyncSession, room_id: int) -> int:
    return int(
        await session.scalar(
            select(func.count()).select_from(ArenaEntry).where(ArenaEntry.room_id == room_id, ArenaEntry.status == "held")
        )
        or 0
    )


async def _open_room(session: AsyncSession, code: str, now: datetime) -> ArenaRoom | None:
    """Самая старая комната типа в наборе: не просрочена и есть свободное место."""
    held = (
        select(func.count())
        .select_from(ArenaEntry)
        .where(ArenaEntry.room_id == ArenaRoom.id, ArenaEntry.status == "held")
        .scalar_subquery()
    )
    return await session.scalar(
        select(ArenaRoom)
        .where(
            ArenaRoom.room_type == code,
            ArenaRoom.status == "waiting",
            ArenaRoom.fill_deadline > now,
            held < ArenaRoom.seats,
        )
        .order_by(ArenaRoom.id)
        .limit(1)
    )


async def refund_expired(session: AsyncSession, *, now: datetime | None = None) -> int:
    """Вернуть ставки просроченных комнат (идемпотентно). Коммитит вызывающий."""
    return await escrow.refund_expired(session, now=now)


async def poll_once(session_factory: async_sessionmaker) -> int:
    """Шаг фонового опросчика: возвраты по просроченным комнатам, своя сессия и транзакция."""
    async with session_factory() as s:
        n = await escrow.refund_expired(s)
        await s.commit()
        return n


@dataclass
class JoinResult:
    room: ArenaRoom
    entry: ArenaEntry
    match: ArenaMatch | None  # не None — комната набралась этим входом и бой создан


async def join_type(session: AsyncSession, *, code: str, user_id: int, now: datetime | None = None) -> JoinResult:
    """Войти в комнату типа code: первая в наборе с местом, иначе новая. Набралась — старт и бой.

    Перед вызовом API уже вернул ставки просроченных комнат (refund_expired + commit) — отдельной транзакцией,
    чтобы не держать блокировки чужих комнат под advisory-блокировкой.
    """
    _rt(code)
    now = now or escrow.utcnow()
    await _type_lock(session, code)
    other = await escrow.active_room_id(session, user_id)
    if other is not None:
        raise escrow.ArenaAlreadyInRoom(other)
    room = await _open_room(session, code, now)
    if room is None:
        room = await escrow.create_room(session, code, now=now)
    entry = await escrow.join(session, room_id=room.id, user_id=user_id, now=now)
    match = None
    if await _held_count(session, room.id) >= room.seats:
        match = await start_match(session, room.id, now=now)
    return JoinResult(room=room, entry=entry, match=match)


async def start_match(session: AsyncSession, room_id: int, *, now: datetime | None = None) -> ArenaMatch:
    """Набранная комната → running (escrow.start) и состояние боя перед 1-м ходом. Повтор — тот же бой."""
    now = now or escrow.utcnow()
    room = await escrow.start(session, room_id, now=now)
    existing = await session.scalar(select(ArenaMatch).where(ArenaMatch.room_id == room.id))
    if existing is not None:
        return existing
    entries = (
        await session.scalars(
            select(ArenaEntry)
            .where(ArenaEntry.room_id == room.id, ArenaEntry.status == "held")
            .order_by(ArenaEntry.seat)
        )
    ).all()
    state = arena_engine.create_match(room.room_type, int(room.seed), [e.user_id for e in entries])
    match = ArenaMatch(
        room_id=room.id, turn=state.turn, state_json=arena_engine.state_to_json(state), created_at=now, updated_at=now
    )
    session.add(match)
    await session.flush()
    return match


async def leave_active(session: AsyncSession, *, user_id: int, now: datetime | None = None) -> ArenaEntry:
    """Выйти из своей комнаты до старта (ставка назад). Нет комнаты — not_joined, бой уже идёт — room_state."""
    room_id = await escrow.active_room_id(session, user_id)
    if room_id is None:
        raise escrow.ArenaNotJoined(f"user {user_id} has no active room")
    return await escrow.leave(session, room_id=room_id, user_id=user_id, now=now)


# ───────── чтение ─────────


def display_name(u: User | None) -> str:
    """Имя на месте в комнате: @username, иначе имя из Telegram; без id. Не длиннее 24 символов."""
    if u is None:
        return "Игрок"
    if u.username:
        return ("@" + u.username.strip())[:24]
    name = (u.first_name or "").strip()
    return name[:24] or "Игрок"


def _iso(dt: datetime | None) -> str | None:
    dt = escrow._aware(dt)
    return dt.isoformat() if dt else None


async def list_types(session: AsyncSession, *, user_id: int) -> dict:
    now = escrow.utcnow()
    rows = (
        await session.execute(
            select(ArenaRoom.room_type, func.count(ArenaEntry.id))
            .join(ArenaEntry, ArenaEntry.room_id == ArenaRoom.id)
            .where(ArenaRoom.status == "waiting", ArenaRoom.fill_deadline > now, ArenaEntry.status == "held")
            .group_by(ArenaRoom.room_type)
        )
    ).all()
    waiting = {code: int(n) for code, n in rows}
    types = [
        {
            "type": rt.code,
            "seats": rt.seats,
            "board": rt.board,
            "stake_nano": str(rt.stake_nano),
            "prizes_nano": [str(p) for p in rt.prizes_nano],
            "pot_nano": str(rt.pot_nano),
            "commission_bps": rt.commission_bps,
            "waiting": waiting.get(rt.code, 0),
        }
        for rt in ARENA_ROOMS.values()
    ]
    return {"types": types, "active_room_id": await escrow.active_room_id(session, user_id), "server_time": now.isoformat()}


async def room_view(session: AsyncSession, room_id: int, *, user_id: int) -> dict:
    room = await session.scalar(
        select(ArenaRoom).where(ArenaRoom.id == room_id).execution_options(populate_existing=True)
    )
    if room is None:
        raise escrow.ArenaRoomNotFound(f"room {room_id}")
    rows = (
        await session.execute(
            select(ArenaEntry, User)
            .join(User, User.id == ArenaEntry.user_id)
            .where(ArenaEntry.room_id == room.id, ArenaEntry.status.in_(("held", "paid", "lost")))
            .order_by(ArenaEntry.seat)
            .execution_options(populate_existing=True)
        )
    ).all()
    seats: list[dict | None] = [None] * room.seats
    me = None
    for e, u in rows:
        if e.seat is None or not 0 <= e.seat < room.seats:
            continue
        seats[e.seat] = {"seat": e.seat, "name": display_name(u), "is_me": e.user_id == user_id}
        if e.user_id == user_id:
            me = e.seat
    match = None
    if room.status in ("running", "finished"):
        m = await session.scalar(select(ArenaMatch).where(ArenaMatch.room_id == room.id))
        if m is not None:
            # состояние боя и ходы — в PR 4; пока только id и номер хода
            match = {"id": m.id, "turn": m.turn}
    return {
        "id": room.id,
        "type": room.room_type,
        "status": room.status,
        "seats_total": room.seats,
        "seats": seats,
        "taken": sum(1 for s in seats if s is not None),
        "my_seat": me,
        "stake_nano": str(room.stake_nano),
        "fill_deadline": _iso(room.fill_deadline),
        "started_at": _iso(room.started_at),
        "seed_hash": room.seed_hash,
        "match": match,
        "server_time": escrow.utcnow().isoformat(),
    }
