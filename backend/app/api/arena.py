"""«Арена»: API комнат — типы комнат, вход, выход до старта, вид комнаты.

Пока настройка arena.enabled выключена (по умолчанию), игрокам закрыто всё, кроме выхода с возвратом ставки:
список, вход и вид комнаты отвечают 403 {"code": "arena_disabled"}. Бой (ходы) — PR 4, экраны — следующие PR.
Ошибки — {"code", "message", ...} как у «Башни».
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services import arena_escrow as escrow
from app.services import arena_rooms as rooms

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
}


def _http(e: escrow.ArenaError) -> HTTPException:
    status, message = _STATUS.get(e.code, (400, "Ошибка «Арены»"))
    detail: dict = {"code": e.code, "message": message}
    if isinstance(e, escrow.ArenaAlreadyInRoom):
        detail["room_id"] = e.room_id
    return HTTPException(status_code=status, detail=detail)


async def _require_enabled(db: AsyncSession) -> None:
    if not await rooms.is_enabled(db):
        raise HTTPException(status_code=403, detail={"code": "arena_disabled", "message": "«Арена» пока закрыта"})


async def _lazy_refund(db: AsyncSession) -> None:
    """Вернуть ставки просроченных комнат отдельной транзакцией (коммит всегда — снять блокировки комнат)."""
    await rooms.refund_expired(db)
    await db.commit()


class JoinBody(BaseModel):
    type: str = Field(min_length=1, max_length=8)


@router.get("/rooms")
async def list_rooms(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Типы комнат: ставка, призы, сколько ждут в наборе; и моя активная комната (id или null)."""
    await _require_enabled(db)
    await _lazy_refund(db)
    return await rooms.list_types(db, user_id=user.id)


@router.post("/join")
async def join(body: JoinBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Войти в комнату типа: в наборе с местом или новую. Ставка уходит в холд. Набралась — бой создан."""
    await _require_enabled(db)
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
    """Комната: места (имена без id), срок набора, статус; после старта — id боя (ходы — PR 4)."""
    await _require_enabled(db)
    try:
        await escrow.refund_if_expired(db, room_id)
        await db.commit()  # возврат (если был) и снятие блокировки строки комнаты
        return await rooms.room_view(db, room_id, user_id=user.id)
    except escrow.ArenaError as e:
        await db.rollback()
        raise _http(e) from None
