"""«Башня»: попытки, старт, финиш с проверкой забега, топ месяца."""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, StrictInt
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services import tower as tower_svc
from app.services import tower_close
from app.services.roles import is_platform_owner
from app.services.tower import NoAttemptsError, RejectedError, TowerError

router = APIRouter(prefix="/tower", tags=["tower"])


class TowerStatusOut(BaseModel):
    free_per_day: int
    used_today: int
    left_today: int
    # ближайшие 00:00 МСК (UTC, ISO) — когда вернутся попытки
    next_reset_at: str
    # часы сервера (UTC, ISO): отсчёты на клиенте идут по ним, а не по часам телефона
    server_time: str | None = None
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
    # только у закрытого месяца: приз места и его статус — "paid" | "awaiting" | "voided"
    prize_ton: str | None = None
    prize_status: str | None = None


class LeaderMeOut(BaseModel):
    rank: int | None = None
    score: int | None = None
    prize_ton: str | None = None
    prize_status: str | None = None


class LeaderPrizeOut(BaseModel):
    # места с … по … (одно место — from_place == to_place); каждому — ton
    from_place: int
    to_place: int
    ton: str


class LeaderboardOut(BaseModel):
    month: str
    entries: list[LeaderEntryOut]
    total_players: int
    me: LeaderMeOut | None = None
    # 00:00 МСК 1-го числа следующего месяца (UTC) — отсчёт до конца топа
    month_ends_at: str
    server_time: str | None = None
    # призы платятся, только если в месяце не меньше стольких участников
    min_participants: int
    # участник для призов — лучший счёт не меньше min_score
    min_score: int = 1
    participants: int = 0
    # месячный бюджет призов (TON); null — призы выключены (и всегда для прошлых месяцев)
    prize_budget_ton: str | None = None
    # призовых мест сейчас (0 — ниже минимума участников или призы выключены)
    prize_places: int = 0
    # при каком числе участников добавится призовое место; null — уже максимум или выключено
    next_place_at: int | None = None
    max_places: int = 200
    # почему мест не больше: "budget" — не хватает на min_prize, "max" — потолок max_places
    prize_limited_by: str | None = None
    min_prize_ton: str | None = None
    # сколько уйдёт при текущем числе участников (≤ бюджета; остаток не тратится)
    prize_total_ton: str | None = None
    # счёт последнего призового места — сколько нужно, чтобы попасть в призы
    prize_cutoff_score: int | None = None
    # группы мест → TON каждому по текущему числу участников (вниз до 0.0001, сумма ≤ бюджета);
    # [] — ниже минимума или бюджета не хватает; null — призы выключены (и всегда для прошлых месяцев)
    prizes: list[LeaderPrizeOut] | None = None
    # закрытый месяц: итоги из сохранённой таблицы (места и призы заморожены)
    closed: bool = False
    # почему без призов: disabled / few_participants / no_budget / no_players
    close_reason: str | None = None
    prize_paid_ton: str | None = None
    prize_awaiting_ton: str | None = None


def _http(e: TowerError) -> HTTPException:
    detail: dict = {"code": e.code, "message": e.message}
    if isinstance(e, NoAttemptsError):
        detail["next_reset_at"] = e.next_reset.isoformat()
    return HTTPException(status_code=e.status, detail=detail)


@router.get("/me", response_model=TowerStatusOut)
async def tower_me(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    uid = user.id  # до ensure_closed: при его откате объекты сессии сбрасываются
    await tower_close.ensure_closed(db)
    return TowerStatusOut(**await tower_svc.my_status(db, user_id=uid))


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
    # первый запрос после 00:00 МСК 1-го числа закрывает прошедший месяц (идемпотентно)
    uid = user.id  # до ensure_closed: при его откате объекты сессии сбрасываются
    await tower_close.ensure_closed(db)
    return LeaderboardOut(**await tower_svc.leaderboard(db, user_id=uid, month=m, limit=limit))


# ───────── владелец: «Призы Башни» (Управление → Касса) ─────────


class PrizeResultOut(BaseModel):
    id: int
    place: int
    user_id: int
    name: str
    username: str | None = None
    score: int
    game_id: int | None = None
    booster: str | None = None
    amount_ton: str
    # pending — ждёт выплаты; paid; flagged — забег не прошёл повторную проверку; voided — аннулирован
    status: str
    # причина flagged/voided: replay_mismatch, no_game, banned, owner…
    note: str | None = None
    paid_at: str | None = None
    banned: bool = False


class PrizeCountsOut(BaseModel):
    pending: int = 0
    paid: int = 0
    flagged: int = 0
    voided: int = 0


class PrizeMonthOut(BaseModel):
    id: int
    month: str
    # no_prizes · payout (есть невыплаченные) · settled (всё решено)
    status: str
    reason: str | None = None
    total_players: int
    participants: int
    min_participants: int | None = None
    places: int
    budget_ton: str
    planned_ton: str
    paid_ton: str
    pending_ton: str
    closed_at: str
    closed_auto: bool
    counts: PrizeCountsOut
    results: list[PrizeResultOut]


class PrizesAdminOut(BaseModel):
    months: list[PrizeMonthOut]
    # прошедшие месяцы с игроками, которые ещё не закрыты — для кнопки «Закрыть месяц»
    unclosed: list[str]
    server_time: str
    # итог последнего действия (pay-all): сколько выплачено/аннулировано
    done: dict | None = None


class CloseBody(BaseModel):
    month: str | None = None


def _owner(user: User) -> None:
    if not is_platform_owner(user):
        raise HTTPException(status_code=403, detail={"code": "owner_only", "message": "Только для владельца"})


async def _overview(db: AsyncSession, done: dict | None = None) -> PrizesAdminOut:
    return PrizesAdminOut(**await tower_close.admin_overview(db), done=done)


@router.get("/admin/prizes", response_model=PrizesAdminOut)
async def prizes_admin(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    _owner(user)
    # бан до выплаты аннулирует приз — сверяем перед показом
    if await tower_close.void_banned(db):
        await db.commit()
    return await _overview(db)


@router.post("/admin/prizes/close", response_model=PrizesAdminOut)
async def prizes_close(
    body: CloseBody | None = None, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """«Закрыть месяц»: указанный (ГГГГ-ММ) или все прошедшие незакрытые. Повторное нажатие ничего не меняет."""
    _owner(user)
    try:
        months = [tower_svc.parse_month(body.month)] if body and body.month else await tower_close.unclosed_months(db)
        closed = 0
        for m in months:
            _, fresh = await tower_close.close_month(db, m, by=user.id)
            closed += int(fresh)
        await db.commit()
    except TowerError as e:
        await db.rollback()
        raise _http(e) from e
    return await _overview(db, {"closed": closed})


async def _act(db: AsyncSession, fn, **kw) -> dict | None:
    try:
        out = await fn(db, **kw)
        await db.commit()
        return out if isinstance(out, dict) else {"result": out} if out else None
    except TowerError as e:
        await db.rollback()
        raise _http(e) from e


@router.post("/admin/prizes/results/{result_id}/pay", response_model=PrizesAdminOut)
async def prizes_pay(result_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    _owner(user)
    done = await _act(db, tower_close.pay_result, result_id=result_id, by=user.id)
    return await _overview(db, done)


@router.post("/admin/prizes/months/{month_id}/pay-all", response_model=PrizesAdminOut)
async def prizes_pay_all(month_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    _owner(user)
    done = await _act(db, tower_close.pay_all, month_id=month_id, by=user.id)
    return await _overview(db, done)


@router.post("/admin/prizes/results/{result_id}/void", response_model=PrizesAdminOut)
async def prizes_void(result_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    _owner(user)
    await _act(db, tower_close.void_result, result_id=result_id, by=user.id)
    return await _overview(db)


@router.post("/admin/prizes/results/{result_id}/approve", response_model=PrizesAdminOut)
async def prizes_approve(result_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    _owner(user)
    await _act(db, tower_close.approve_result, result_id=result_id, by=user.id)
    return await _overview(db)
