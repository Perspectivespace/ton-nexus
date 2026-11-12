"""«Арена»: комнаты для API — список типов, вход «в любую комнату типа», выход, вид комнаты, старт боя.

Поверх services/arena_escrow (деньги) и services/arena_engine (состояние боя):
- вход: найти комнату типа в наборе или создать новую, затем escrow.join; набралась — escrow.start и
  состояние боя (arena_matches) в той же транзакции;
- «найти или создать» сериализуется транзакционной advisory-блокировкой Postgres на тип комнаты
  (иначе два параллельных входа создали бы две комнаты); на SQLite (тесты, локально) — без неё.
  Порядок блокировок: advisory(тип) → комната → игрок (как в эскроу: комната → игрок);
- возврат просроченных комнат: лениво (перед входом и на чтениях) и из фонового опросчика (main.arena_loop);
- seed карты выдаётся из secrets при создании комнаты (escrow.create_room) и до конца боя виден только хэш
  (commit–reveal); при старте он не меняется, после конца seed и соль раскрываются в виде комнаты;
- ходы боя, журнал и расчёт — services/arena_match.
Флаг «Арены» (настройка arena.enabled) и доступ к комнате проверяет API, а не этот модуль.
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
from app.services import arena_match
from app.services.arena_config import ARENA_ROOMS, DEFAULT_COMMISSION_BPS, clamp_commission_bps, prizes_for, room_type
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


async def commission_bps(session: AsyncSession) -> int:
    """Текущая комиссия «Арены» из настройки (commission_bp); нет ключа — по умолчанию (10 %)."""
    cfg = await get_setting(session, SETTING_KEY) or {}
    raw = cfg.get("commission_bp", DEFAULT_COMMISSION_BPS) if isinstance(cfg, dict) else DEFAULT_COMMISSION_BPS
    return clamp_commission_bps(raw)


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
    """Шаг фонового опросчика: возвраты по просроченным комнатам и ходы с прошедшим дедлайном.

    Возвраты — своя транзакция, каждый ход — своя (arena_match.advance_due). Возвращает число возвратов + ходов.
    """
    async with session_factory() as s:
        n = await escrow.refund_expired(s)
        await s.commit()
    return n + await arena_match.advance_due(session_factory)


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
        room = await escrow.create_room(session, code, now=now, commission_bps=await commission_bps(session))
    entry = await escrow.join(session, room_id=room.id, user_id=user_id, now=now)
    match = None
    if await _held_count(session, room.id) >= room.seats:
        match = await start_match(session, room.id, now=now)
    return JoinResult(room=room, entry=entry, match=match)


async def start_match(session: AsyncSession, room_id: int, *, now: datetime | None = None) -> ArenaMatch:
    """Набранная комната → running (escrow.start), состояние боя перед 1-м ходом и окно 1-го хода
    (после отсчёта). Места перемешиваются seed'ом; игроки в движке — номера мест. Повтор — тот же бой."""
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
    slots = [int(e.seat) for e in entries]
    if slots != list(range(room.seats)):
        raise escrow.ArenaStateError(f"room {room.id}: seats {slots}")
    # До старта место = слот входа. На старте места перемешиваются seed'ом (RULES §3): вошедший i-м получает
    # seat_order(seed, n)[i]. Два шага — из-за unique (комната, место).
    order = arena_engine.seat_order(int(room.seed), room.seats)
    for e in entries:
        e.seat = None
    await session.flush()
    for slot, e in enumerate(entries):
        e.seat = order[slot]
    await session.flush()
    # игроки в движке — места, в порядке входа (slot в состоянии = слот входа)
    state = arena_engine.create_match(room.room_type, int(room.seed), order)
    match = ArenaMatch(
        room_id=room.id, turn=state.turn, state_json=arena_engine.state_to_json(state), created_at=now, updated_at=now
    )
    session.add(match)
    await session.flush()
    await arena_match.open_first_turn(session, room)
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
    bps = await commission_bps(session)
    types = [
        {
            "type": rt.code,
            "seats": rt.seats,
            "board": rt.board,
            "stake_nano": str(rt.stake_nano),
            "prizes_nano": [str(p) for p in prizes_for(rt, bps)],
            "pot_nano": str(rt.pot_nano),
            "commission_bps": bps,
            "waiting": waiting.get(rt.code, 0),
        }
        for rt in ARENA_ROOMS.values()
    ]
    return {"types": types, "active_room_id": await escrow.active_room_id(session, user_id), "server_time": now.isoformat()}


async def is_participant(session: AsyncSession, room_id: int, user_id: int) -> bool:
    """Был ли пользователь в комнате (любое место, в т. ч. вышедший или получивший возврат)."""
    return (
        await session.scalar(
            select(ArenaEntry.id).where(ArenaEntry.room_id == room_id, ArenaEntry.user_id == user_id).limit(1)
        )
    ) is not None


async def get_room(session: AsyncSession, room_id: int) -> ArenaRoom:
    room = await session.scalar(
        select(ArenaRoom).where(ArenaRoom.id == room_id).execution_options(populate_existing=True)
    )
    if room is None:
        raise escrow.ArenaRoomNotFound(f"room {room_id}")
    return room


_REVEALED = ("finished", "cancelled", "refunded")


async def room_view(session: AsyncSession, room_id: int, *, user_id: int, with_match: bool = False) -> dict:
    """Вид комнаты для участника (или владельца). with_match — полное состояние боя (поле, игроки, ход)."""
    room = await get_room(session, room_id)
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
    names: dict[int, str] = {}
    results = []
    me = None
    for e, u in rows:
        if e.seat is None or not 0 <= e.seat < room.seats:
            continue
        names[e.seat] = display_name(u)
        seats[e.seat] = {"seat": e.seat, "name": names[e.seat], "is_me": e.user_id == user_id}
        if e.user_id == user_id:
            me = e.seat
        if e.place is not None:
            results.append({"seat": e.seat, "name": names[e.seat], "place": e.place, "prize_nano": str(e.prize_nano)})
    match = None
    if room.status in ("running", "finished", "cancelled"):
        if with_match:
            match = await arena_match.match_view(session, room, names=names, my_seat=me)
        else:
            m = await session.scalar(
                select(ArenaMatch).where(ArenaMatch.room_id == room.id).execution_options(populate_existing=True)
            )
            if m is not None:
                match = {"id": m.id, "turn": m.turn}
    out = {
        "id": room.id,
        "type": room.room_type,
        "status": room.status,
        "seats_total": room.seats,
        "seats": seats,
        "taken": sum(1 for s in seats if s is not None),
        "my_seat": me,
        "stake_nano": str(room.stake_nano),
        # условия этой комнаты (комиссия зафиксирована при создании) — не текущая настройка
        "commission_bps": room.commission_bps,
        "prizes_nano": [str(p) for p in prizes_for(room_type(room.room_type), room.commission_bps)],
        "fill_deadline": _iso(room.fill_deadline),
        "started_at": _iso(room.started_at),
        "finished_at": _iso(room.finished_at),
        "seed_hash": room.seed_hash,
        "results": sorted(results, key=lambda r: (r["place"], r["seat"])) if room.status == "finished" else None,
        "match": match,
        "server_time": escrow.utcnow().isoformat(),
    }
    if room.status in _REVEALED:
        # commit–reveal: seed и соль — только когда комната закрыта; sha256("<соль>:<seed>") == seed_hash
        out["seed"] = int(room.seed)
        out["seed_salt"] = room.seed_salt
    return out
