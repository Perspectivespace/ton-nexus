"""«Арена»: эскроу ставок — вход в комнату (холд), выход до старта, возврат по таймауту набора, расчёт призов.

Правила денег:
- все суммы в нанотонах (int); в balance.credit/debit уходят Decimal TON, ровно 8 знаков (кратно 10 нано);
- каждая операция — только через services/balance (строка в balance_history):
  arena_hold (списание ставки), arena_refund (возврат), arena_prize (приз);
  reference_type = "arena_entry", reference_id = id места;
- комиссия — не проводка, а доход платформы: arena_rooms.commission_nano = банк − выплаченные призы;
- идемпотентность: строка комнаты блокируется (FOR UPDATE) в начале каждой операции, все изменения мест —
  только под этой блокировкой, переходы статусов однонаправленные; повтор расчёта/возврата ничего не платит.
Порядок блокировок везде один: комната → пользователи по возрастанию id (без взаимных блокировок).

Планировщика нет (HANDOFF §4.9): refund_if_expired / refund_expired вызываются лениво (из API комнат)
или позже из опросчика; они безопасны при повторном и параллельном вызове.
"""

from __future__ import annotations

import hashlib
import secrets
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.arena import ArenaEntry, ArenaRoom
from app.services import balance
from app.services.arena_config import FILL_TIMEOUT_S, LEDGER_QUANTUM_NANO, NANO_PER_TON, room_type

REF = "arena_entry"


class ArenaError(Exception):
    """Базовая ошибка «Арены» (код — для API следующих PR)."""

    code = "arena_error"


class ArenaRoomNotFound(ArenaError):
    code = "room_not_found"


class ArenaStateError(ArenaError):
    """Комната не в том статусе для операции (уже идёт, закрыта, не набрана…)."""

    code = "room_state"


class ArenaRoomExpired(ArenaError):
    code = "room_expired"


class ArenaRoomFull(ArenaError):
    code = "room_full"


class ArenaAlreadyJoined(ArenaError):
    code = "already_joined"

    def __init__(self, entry_id: int):
        super().__init__(f"already joined (entry {entry_id})")
        self.entry_id = entry_id


class ArenaNotJoined(ArenaError):
    code = "not_joined"


class ArenaInsufficientBalance(ArenaError):
    code = "insufficient_balance"


class ArenaPlacementError(ArenaError):
    code = "bad_placements"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def nano_to_ton(nano: int) -> Decimal:
    """Нанотоны → Decimal TON с 8 знаками. Сумма обязана быть кратна 10 нано (точность баланса)."""
    if nano % LEDGER_QUANTUM_NANO:
        raise ValueError(f"amount {nano} nano is not a multiple of {LEDGER_QUANTUM_NANO}")
    return (Decimal(nano) / Decimal(NANO_PER_TON)).quantize(Decimal("0.00000001"))


def seed_commit(seed: int, salt: str) -> str:
    return hashlib.sha256(f"{salt}:{seed}".encode()).hexdigest()


async def _lock_room(session: AsyncSession, room_id: int) -> ArenaRoom:
    await session.flush()
    room = (
        await session.execute(
            select(ArenaRoom)
            .where(ArenaRoom.id == room_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if room is None:
        raise ArenaRoomNotFound(f"room {room_id}")
    return room


async def _entries(session: AsyncSession, room_id: int, status: str | None = None) -> list[ArenaEntry]:
    q = select(ArenaEntry).where(ArenaEntry.room_id == room_id).execution_options(populate_existing=True)
    if status is not None:
        q = q.where(ArenaEntry.status == status)
    return list((await session.scalars(q.order_by(ArenaEntry.user_id))).all())


def _expired(room: ArenaRoom, now: datetime) -> bool:
    return now >= _aware(room.fill_deadline)


async def create_room(
    session: AsyncSession, code: str, *, now: datetime | None = None, seed: int | None = None
) -> ArenaRoom:
    """Новая комната в наборе. Условия (места, ставка, комиссия) копируются из таблицы комнат."""
    rt = room_type(code)
    now = now or utcnow()
    seed = secrets.randbits(32) if seed is None else seed
    salt = secrets.token_hex(16)
    room = ArenaRoom(
        room_type=rt.code,
        status="waiting",
        seats=rt.seats,
        stake_nano=rt.stake_nano,
        commission_bps=rt.commission_bps,
        seed=seed,
        seed_salt=salt,
        seed_hash=seed_commit(seed, salt),
        created_at=now,
        fill_deadline=now + timedelta(seconds=FILL_TIMEOUT_S),
    )
    session.add(room)
    await session.flush()
    return room


async def join(session: AsyncSession, *, room_id: int, user_id: int, now: datetime | None = None) -> ArenaEntry:
    """Войти в комнату: занять свободное место и списать ставку в холд (arena_hold).

    Повторный вход — ArenaAlreadyJoined (денег не трогает). После выхода можно войти снова — та же строка.
    Просроченную комнату не трогает (только ошибка): возврат делает refund_if_expired.
    """
    now = now or utcnow()
    room = await _lock_room(session, room_id)
    if room.status != "waiting":
        raise ArenaStateError(f"room {room_id} is {room.status}")
    if _expired(room, now):
        raise ArenaRoomExpired(f"room {room_id} fill deadline passed")
    entries = await _entries(session, room_id)
    mine = next((e for e in entries if e.user_id == user_id), None)
    if mine is not None and mine.status == "held":
        raise ArenaAlreadyJoined(mine.id)
    taken = {e.seat for e in entries if e.status == "held"}
    if len(taken) >= room.seats:
        raise ArenaRoomFull(f"room {room_id} is full")
    stake = nano_to_ton(room.stake_nano)
    user = await balance.get_user_for_update(session, user_id)
    if Decimal(user.balance) < stake:
        raise ArenaInsufficientBalance(f"need {stake}, have {user.balance}")
    seat = min(s for s in range(room.seats) if s not in taken)
    if mine is None:
        mine = ArenaEntry(room_id=room.id, user_id=user_id, created_at=now)
        session.add(mine)
    mine.seat = seat
    mine.held_nano = room.stake_nano
    mine.status = "held"
    mine.place = None
    mine.prize_nano = 0
    mine.updated_at = now
    await session.flush()
    await balance.debit(
        session,
        user_id=user_id,
        amount=stake,
        balance_type="arena_hold",
        description=f"Комната #{room.id}",
        reference_type=REF,
        reference_id=mine.id,
    )
    return mine


async def _refund(session: AsyncSession, room: ArenaRoom, entry: ArenaEntry, now: datetime) -> None:
    if entry.status != "held":
        return
    amount = entry.held_nano
    entry.status = "refunded"
    entry.seat = None
    entry.updated_at = now
    await session.flush()
    if amount > 0:
        await balance.credit(
            session,
            user_id=entry.user_id,
            amount=nano_to_ton(amount),
            balance_type="arena_refund",
            description=f"Комната #{room.id}",
            reference_type=REF,
            reference_id=entry.id,
        )


async def leave(session: AsyncSession, *, room_id: int, user_id: int, now: datetime | None = None) -> ArenaEntry:
    """Выйти до старта: место освобождается, ставка возвращается целиком (arena_refund)."""
    now = now or utcnow()
    room = await _lock_room(session, room_id)
    if room.status != "waiting":
        raise ArenaStateError(f"room {room_id} is {room.status}")
    entry = next((e for e in await _entries(session, room_id) if e.user_id == user_id), None)
    if entry is None or entry.status != "held":
        raise ArenaNotJoined(f"user {user_id} is not in room {room_id}")
    await _refund(session, room, entry, now)
    return entry


async def _refund_all(session: AsyncSession, room: ArenaRoom, status: str, now: datetime) -> int:
    held = await _entries(session, room.id, "held")
    for e in held:  # по возрастанию user_id
        await _refund(session, room, e, now)
    room.status = status
    room.commission_nano = 0
    room.finished_at = now
    await session.flush()
    return len(held)


async def refund_if_expired(session: AsyncSession, room_id: int, *, now: datetime | None = None) -> int:
    """Комната не набралась к fill_deadline → вернуть все ставки, статус refunded. Возвращает число возвратов.

    Идемпотентно: повтор (или комната уже не в наборе / ещё не истекла / набрана полностью) — 0.
    Набранную комнату не трогаем — её запускает start (а зависшую — cancel).
    """
    now = now or utcnow()
    room = await _lock_room(session, room_id)
    if room.status != "waiting" or not _expired(room, now):
        return 0
    if len(await _entries(session, room_id, "held")) >= room.seats:
        return 0
    return await _refund_all(session, room, "refunded", now)


async def refund_expired(session: AsyncSession, *, now: datetime | None = None) -> int:
    """Обойти все просроченные комнаты в наборе (для ленивого вызова или будущего опросчика)."""
    now = now or utcnow()
    ids = (
        await session.scalars(
            select(ArenaRoom.id)
            .where(ArenaRoom.status == "waiting", ArenaRoom.fill_deadline <= now)
            .order_by(ArenaRoom.id)
        )
    ).all()
    total = 0
    for rid in ids:
        total += await refund_if_expired(session, rid, now=now)
    return total


async def cancel(session: AsyncSession, room_id: int, *, now: datetime | None = None) -> int:
    """Отменить комнату в наборе или в бою (сбой, ручное решение): все ставки назад, статус cancelled.

    Повтор и уже закрытая комната — 0. Расчитанную (finished) комнату отменить нельзя.
    """
    now = now or utcnow()
    room = await _lock_room(session, room_id)
    if room.status in ("refunded", "cancelled"):
        return 0
    if room.status == "finished":
        raise ArenaStateError(f"room {room_id} is finished")
    return await _refund_all(session, room, "cancelled", now)


async def start(session: AsyncSession, room_id: int, *, now: datetime | None = None) -> ArenaRoom:
    """Набранная комната → running: с этого момента выйти с возвратом нельзя. Повтор — без изменений."""
    now = now or utcnow()
    room = await _lock_room(session, room_id)
    if room.status == "running":
        return room
    if room.status != "waiting":
        raise ArenaStateError(f"room {room_id} is {room.status}")
    if len(await _entries(session, room_id, "held")) < room.seats:
        raise ArenaStateError(f"room {room_id} is not full")
    room.status = "running"
    room.started_at = now
    await session.flush()
    return room


@dataclass
class Settlement:
    room_id: int
    pot_nano: int
    commission_nano: int
    prizes_nano: dict[int, int] = field(default_factory=dict)  # user_id → приз (только ненулевые)
    places: dict[int, int] = field(default_factory=dict)  # user_id → место
    already: bool = False  # True — комната была рассчитана раньше, ничего не выплачено


def split_prizes(prizes_nano: tuple[int, ...], placements: Mapping[int, int]) -> dict[int, int]:
    """Призы по местам с учётом общих мест (чистая функция).

    placements: user_id → место в «спортивной» нумерации (1, 1, 3, 4…): k игроков на месте p занимают
    места p…p+k−1, их призы складываются и делятся поровну, вниз до 10 нано. Остаток — в комиссию.
    """
    if not placements:
        raise ArenaPlacementError("no placements")
    by_place: dict[int, list[int]] = {}
    for uid, p in placements.items():
        if not isinstance(p, int) or isinstance(p, bool) or p < 1:
            raise ArenaPlacementError(f"bad place {p!r}")
        by_place.setdefault(p, []).append(uid)
    out: dict[int, int] = {}
    pos = 1
    for p in sorted(by_place):
        users = by_place[p]
        if p != pos:
            raise ArenaPlacementError(f"place {p} expected {pos} (places must be 1,1,3… style)")
        pool = sum(prizes_nano[i - 1] for i in range(p, p + len(users)) if i <= len(prizes_nano))
        share = pool // len(users) // LEDGER_QUANTUM_NANO * LEDGER_QUANTUM_NANO
        for uid in users:
            out[uid] = share
        pos += len(users)
    return out


async def settle(
    session: AsyncSession, room_id: int, placements: Mapping[int, int], *, now: datetime | None = None
) -> Settlement:
    """Итог боя: выплатить призы (arena_prize) по таблице комнаты, остальное — комиссия платформы.

    placements — место каждого игрока комнаты (user_id → 1…). Идемпотентно: рассчитанная комната
    возвращает прежний итог с already=True и ничего не платит.
    """
    now = now or utcnow()
    room = await _lock_room(session, room_id)
    entries = await _entries(session, room_id)
    if room.status == "finished":
        paid = [e for e in entries if e.status in ("paid", "lost")]
        return Settlement(
            room_id=room.id,
            pot_nano=sum(e.held_nano for e in paid),
            commission_nano=room.commission_nano or 0,
            prizes_nano={e.user_id: e.prize_nano for e in paid if e.prize_nano},
            places={e.user_id: e.place for e in paid if e.place is not None},
            already=True,
        )
    if room.status != "running":
        raise ArenaStateError(f"room {room_id} is {room.status}")
    held = [e for e in entries if e.status == "held"]
    if set(placements) != {e.user_id for e in held}:
        raise ArenaPlacementError("placements must list exactly the room's players")
    rt = room_type(room.room_type)
    shares = split_prizes(rt.prizes_nano, placements)
    pot = sum(e.held_nano for e in held)
    paid_total = sum(shares.values())
    if paid_total > pot:  # не может случиться при валидной таблице — защита от неверной настройки
        raise ArenaError(f"prizes {paid_total} exceed pot {pot}")
    for e in held:
        e.place = placements[e.user_id]
        e.prize_nano = shares[e.user_id]
        e.status = "paid" if e.prize_nano > 0 else "lost"
        e.updated_at = now
    room.status = "finished"
    room.finished_at = now
    room.commission_nano = pot - paid_total
    await session.flush()
    for e in held:  # по возрастанию user_id
        if e.prize_nano > 0:
            await balance.credit(
                session,
                user_id=e.user_id,
                amount=nano_to_ton(e.prize_nano),
                balance_type="arena_prize",
                description=f"Комната #{room.id}, {e.place} место",
                reference_type=REF,
                reference_id=e.id,
            )
    return Settlement(
        room_id=room.id,
        pot_nano=pot,
        commission_nano=room.commission_nano,
        prizes_nano={uid: v for uid, v in shares.items() if v},
        places=dict(placements),
    )


async def house_revenue_nano(session: AsyncSession, *, since: datetime | None = None) -> int:
    """Доход платформы с «Арены» (сумма commission_nano рассчитанных комнат) — для «Кассы» в следующих PR."""
    q = select(func.coalesce(func.sum(ArenaRoom.commission_nano), 0)).where(ArenaRoom.status == "finished")
    if since is not None:
        q = q.where(ArenaRoom.finished_at >= since)
    return int((await session.execute(q)).scalar_one())
