"""«Башня»: попытки, старт, финиш с проверкой забега, топ месяца."""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, StrictInt
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services import tower as tower_svc
from app.services.tower import NoAttemptsError, RejectedError, TowerError

router = APIRouter(prefix="/tower", tags=["tower"])


class TowerStatusOut(BaseModel):
    free_per_day: int
    used_today: int
    left_today: int
    # ближайшие 00:00 МСК (UTC, ISO) — когда вернутся попытки
    next_reset_at: str
    month: str
    best_month: int | None = None
    rank: int | None = None


class StartBody(BaseModel):
    # бустеры появятся позже; пока любое значение, кроме null, отклоняется
    booster: str | None = None


class StartOut(BaseModel):
    game_id: int
    seed: int
    booster: str | None = None
    status: TowerStatusOut


class FinishBody(BaseModel):
    game_id: int
    # журнал тапов: целые мс от начала забега по игровым часам
    taps: list[StrictInt] = Field(max_length=20000)
    # счёт, который насчитал клиент: сервер сверяет его со своим проигрыванием
    score: int = Field(ge=0)


class FinishOut(BaseModel):
    game_id: int
    score: int
    height: int
    perfects: int
    best_combo: int
    over: bool
    new_best: bool
    best_month: int
    rank: int | None = None
    status: TowerStatusOut


class LeaderEntryOut(BaseModel):
    rank: int
    name: str
    score: int
    is_me: bool


class LeaderMeOut(BaseModel):
    rank: int | None = None
    score: int | None = None


class LeaderPrizeOut(BaseModel):
    place: int
    ton: str


class LeaderboardOut(BaseModel):
    month: str
    entries: list[LeaderEntryOut]
    total_players: int
    me: LeaderMeOut | None = None
    # 00:00 МСК 1-го числа следующего месяца (UTC) — отсчёт до конца топа
    month_ends_at: str
    # призы платятся, только если в месяце не меньше стольких участников
    min_participants: int
    # места → TON; null — призы выключены или не назначены (и всегда для прошлых месяцев)
    prizes: list[LeaderPrizeOut] | None = None


def _http(e: TowerError) -> HTTPException:
    detail: dict = {"code": e.code, "message": e.message}
    if isinstance(e, NoAttemptsError):
        detail["next_reset_at"] = e.next_reset.isoformat()
    return HTTPException(status_code=e.status, detail=detail)


@router.get("/me", response_model=TowerStatusOut)
async def tower_me(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return TowerStatusOut(**await tower_svc.my_status(db, user_id=user.id))


@router.post("/start", response_model=StartOut)
async def tower_start(
    body: StartBody | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        game = await tower_svc.start_game(db, user=user, booster=body.booster if body else None)
        await db.commit()
    except TowerError as e:
        await db.rollback()
        raise _http(e) from e
    st = await tower_svc.my_status(db, user_id=user.id)
    return StartOut(game_id=game.id, seed=game.seed, booster=game.booster, status=TowerStatusOut(**st))


@router.post("/finish", response_model=FinishOut)
async def tower_finish(
    body: FinishBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        r = await tower_svc.finish_game(
            db, user=user, game_id=body.game_id, taps=list(body.taps), claimed_score=body.score
        )
        await db.commit()
    except RejectedError as e:
        # забег закрыт без счёта — это нужно сохранить, иначе его можно было бы слать повторно с другим журналом
        await db.commit()
        raise _http(e) from e
    except TowerError as e:
        await db.rollback()
        raise _http(e) from e
    st = await tower_svc.my_status(db, user_id=user.id)
    res = r.result
    return FinishOut(
        game_id=r.game.id,
        score=res.score,
        height=res.height,
        perfects=res.perfects,
        best_combo=res.best_combo,
        over=res.over,
        new_best=r.new_best,
        best_month=r.best_month,
        rank=r.rank,
        status=TowerStatusOut(**st),
    )


@router.get("/leaderboard", response_model=LeaderboardOut)
async def tower_leaderboard(
    limit: int = Query(10, ge=1, le=tower_svc.LEADERBOARD_MAX),
    month: str | None = Query(None, description="ГГГГ-ММ, по умолчанию текущий (МСК)"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        m = tower_svc.parse_month(month) if month else None
    except TowerError as e:
        raise _http(e) from e
    return LeaderboardOut(**await tower_svc.leaderboard(db, user_id=user.id, month=m, limit=limit))
