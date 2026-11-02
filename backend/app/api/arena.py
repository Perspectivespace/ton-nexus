"""«Арена»: API комнат и боя — типы комнат, вход, выход до старта, вид комнаты, состояние боя, план хода,
отмена комнаты владельцем.

Доступ:
- список и вход — только при включённой настройке arena.enabled (по умолчанию выключена) или владельцам
  платформы (проверка до открытия); иначе 403 {"code": "arena_disabled"};
- комната, состояние боя и план — только участникам этой комнаты (и владельцам на чтение), независимо от флага:
  начатый бой доигрывается, даже если «Арену» выключили; чужим — 403 not_participant;
- выход с возвратом ставки — всегда; отмена комнаты с возвратом всем — только владельцы.
Чтения лениво возвращают ставки просроченной комнаты и разрешают просроченный ход (плюс фоновый main.arena_loop).
Ошибки — {"code", "message", ...} как у «Башни».
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services import arena_escrow as escrow
from app.services import arena_match
from app.services import arena_rooms as rooms
from app.services.roles import is_platform_owner

router = APIRouter(prefix="/arena", tags=["arena"])

_STATUS = {
    "unknown_room_type": (400, "Нет такой комнаты"),
    "insufficient_balance": (402, "Недостаточно TON для ставки"),
    "already_in_room": (409, "Вы уже в комнате"),
    "already_joined": (409, "Вы уже в этой комнате"),
    "room_full": (409, "Комната уже набрана"),
    "room_expired": (409, "Набор в комнату закончился"),
    "room_state": (409, "Комната уже не в наборе"),
    "not_joined": (409, "Вы не в комнате"),
    "room_not_found": (404, "Комната не найдена"),
    "not_playing": (403, "Вы не играете в этой комнате"),
    "turn_mismatch": (409, "Ход уже сменился"),
    "turn_not_open": (409, "Ход ещё не начался"),
    "bad_plan": (400, "Недопустимый план хода"),
}


def _http(e: escrow.ArenaError) -> HTTPException:
    status, message = _STATUS.get(e.code, (400, "Ошибка «Арены»"))
    detail: dict = {"code": e.code, "message": message}
    if isinstance(e, escrow.ArenaAlreadyInRoom):
        detail["room_id"] = e.room_id
    if isinstance(e, arena_match.ArenaTurnMismatch):
        detail["current_turn"] = e.current
    if isinstance(e, arena_match.ArenaPlanRejected):
        detail["reason"] = e.reason
    return HTTPException(status_code=status, detail=detail)


def _forbidden(code: str, message: str) -> HTTPException:
    return HTTPException(status_code=403, detail={"code": code, "message": message})


async def _require_enabled(db: AsyncSession, user: User) -> None:
    """Флаг «Арены»: выключен — закрыто для всех, кроме владельцев (проверка до открытия)."""
    if is_platform_owner(user):
        return
    if not await rooms.is_enabled(db):
        raise _forbidden("arena_disabled", "«Арена» пока закрыта")


async def _require_access(db: AsyncSession, room_id: int, user: User) -> None:
    """Комната видна только своим участникам и владельцам. Нет комнаты — 404."""
    try:
        await rooms.get_room(db, room_id)
    except escrow.ArenaError as e:
        raise _http(e) from None
    if is_platform_owner(user) or await rooms.is_participant(db, room_id, user.id):
        return
    raise _forbidden("not_participant", "Это не ваша комната")


async def _lazy_refund(db: AsyncSession) -> None:
    """Вернуть ставки просроченных комнат отдельной транзакцией (коммит всегда — снять блокировки комнат)."""
    await rooms.refund_expired(db)
    await db.commit()


async def _lazy_room(db: AsyncSession, room_id: int) -> None:
    """Ленивое продвижение одной комнаты: возврат по таймауту набора и просроченный ход. Коммит всегда."""
    try:
        await escrow.refund_if_expired(db, room_id)
        await db.commit()
        if await arena_match.is_due(db, room_id):
            await arena_match.advance(db, room_id)
        await db.commit()
    except escrow.ArenaError as e:
        await db.rollback()
        raise _http(e) from None


class JoinBody(BaseModel):
    type: str = Field(min_length=1, max_length=8)


class PlanBody(BaseModel):
    turn: int = Field(ge=1, le=1000)
    # {"path": [[x, y], …], "attack": место|null} или {"medkit": true}; null / {} — стоять
    plan: dict | None = None
    ready: bool = True


@router.get("/rooms")
async def list_rooms(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Типы комнат: ставка, призы, сколько ждут в наборе; и моя активная комната (id или null)."""
    await _require_enabled(db, user)
    await _lazy_refund(db)
    return await rooms.list_types(db, user_id=user.id)


@router.post("/join")
async def join(body: JoinBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Войти в комнату типа: в наборе с местом или новую. Ставка уходит в холд. Набралась — бой создан."""
    await _require_enabled(db, user)
    await _lazy_refund(db)
    try:
        res = await rooms.join_type(db, code=body.type, user_id=user.id)
        await db.commit()
    except escrow.ArenaError as e:
        await db.rollback()
        raise _http(e) from None
    return await rooms.room_view(db, res.room.id, user_id=user.id)


@router.post("/leave")
async def leave(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Выйти до старта: место освобождается, ставка возвращается. Работает и при выключенной «Арене»."""
    try:
        entry = await rooms.leave_active(db, user_id=user.id)
        await db.commit()
    except escrow.ArenaError as e:
        await db.rollback()
        raise _http(e) from None
    return {"ok": True, "room_id": entry.room_id, "refunded_nano": str(entry.held_nano)}


@router.get("/rooms/{room_id}")
async def get_room(room_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Комната: места (имена без id), срок набора, статус, id боя и ход; после конца — seed, соль и итоги."""
    await _require_access(db, room_id, user)
    await _lazy_room(db, room_id)
    return await rooms.room_view(db, room_id, user_id=user.id)


@router.get("/rooms/{room_id}/state")
async def get_state(
    room_id: int,
    since: int = Query(0, ge=0, le=1000),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Комната + состояние боя (поле, игроки, зона, текущий ход и окно планов) + журнал ходов после `since`.

    Клиент опрашивает раз в ~1 с с since = последний полученный ход. Чужие планы текущего хода не отдаются.
    """
    await _require_access(db, room_id, user)
    await _lazy_room(db, room_id)
    view = await rooms.room_view(db, room_id, user_id=user.id, with_match=True)
    view["turns"] = await arena_match.turn_log(db, room_id, since=since)
    return view


@router.post("/rooms/{room_id}/plan")
async def submit_plan(
    room_id: int, body: PlanBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """План на текущий ход (перезапись до дедлайна). ready=true — «Готово»: все живые готовы → ход сразу.

    Просроченный ход разрешается до проверки номера хода; он сохраняется и при отказе в плане
    (turn_mismatch, turn_not_open, bad_plan): план не записан, а продвижение боя — верное.
    """
    try:
        res = await arena_match.submit_plan(
            db, room_id, user_id=user.id, turn=body.turn, plan=body.plan or None, ready=body.ready
        )
        await db.commit()
    except (arena_match.ArenaTurnMismatch, arena_match.ArenaTurnNotOpen, arena_match.ArenaPlanRejected) as e:
        await db.commit()
        raise _http(e) from None
    except escrow.ArenaError as e:
        await db.rollback()
        raise _http(e) from None
    return {"ok": True, **res}


@router.post("/rooms/{room_id}/cancel")
async def cancel_room(room_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Владелец: отменить комнату в наборе или в бою — все ставки возвращаются целиком (escrow.cancel)."""
    if not is_platform_owner(user):
        raise _forbidden("owner_only", "Только для владельцев")
    try:
        n = await escrow.cancel(db, room_id)
        await db.commit()
    except escrow.ArenaError as e:
        await db.rollback()
        raise _http(e) from None
    room = await rooms.get_room(db, room_id)
    return {"ok": True, "room_id": room_id, "status": room.status, "refunded": n}
