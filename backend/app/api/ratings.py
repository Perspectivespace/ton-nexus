"""Рейтинги: сводка «Мои места» и топы по уровню, заданиям и друзьям («скоро»)."""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services import ratings as svc

router = APIRouter(prefix="/ratings", tags=["ratings"])


class FriendRuleOut(BaseModel):
    # 0 — условие выключено; need_both — нужны оба включённых условия, иначе любое
    min_level: int
    min_tasks: int
    need_both: bool


class CellOut(BaseModel):
    rank: int | None = None
    value: int | None = None
    total: int = 0
    soon: bool = False


class SummaryOut(BaseModel):
    month: str
    level: CellOut
    tasks: CellOut
    tower: CellOut
    friends: CellOut
    friend_rule: FriendRuleOut
    # включены ли призы у топа (level · tasks · friends · tower)
    prizes: dict[str, bool]


class EntryOut(BaseModel):
    rank: int
    name: str
    value: int
    # топ по уровню за всё время: опыт внутри уровня (решает при равном уровне)
    xp: int | None = None
    is_me: bool


class MeOut(BaseModel):
    rank: int
    value: int
    xp: int | None = None
    # уровень за всё время: сколько опыта до следующего уровня
    xp_to_next: int | None = None
    # остальные топы: сколько добрать, чтобы подняться на next_rank
    next_rank: int | None = None
    need: int | None = None


class PrizeGroupOut(BaseModel):
    from_place: int
    to_place: int
    ton: str


class PrizeOut(BaseModel):
    budget_ton: str
    places: int
    prizes: list[PrizeGroupOut]
    total_ton: str
    next_place_at: int | None = None
    limited_by: str | None = None
    min_participants: int
    min_score: int
    min_prize_ton: str
    participants: int
    # значение последнего призового места — сколько нужно, чтобы попасть в призы
    cutoff_value: int | None = None


class BoardOut(BaseModel):
    kind: str
    period: str
    periods: list[str]
    month: str
    month_ends_at: str
    server_time: str
    total_players: int
    entries: list[EntryOut]
    me: MeOut | None = None
    # топ друзей не открыт: приглашения ещё не записываются
    soon: bool = False
    rule: FriendRuleOut | None = None
    # призы текущего месяца (только период month и только если владелец их включил)
    prize: PrizeOut | None = None


def _http(e: svc.RatingError) -> HTTPException:
    return HTTPException(status_code=e.status, detail={"code": e.code, "message": e.message})


@router.get("/summary", response_model=SummaryOut)
async def ratings_summary(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return SummaryOut(**await svc.summary(db, user_id=user.id))


@router.get("/{kind}", response_model=BoardOut)
async def ratings_board(
    kind: str,
    period: str | None = Query(None, description="month | all"),
    limit: int = Query(50, ge=1, le=svc.BOARD_MAX),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        return BoardOut(**await svc.board(db, kind=kind, period=period, user_id=user.id, limit=limit))
    except svc.RatingError as e:
        raise _http(e) from e
