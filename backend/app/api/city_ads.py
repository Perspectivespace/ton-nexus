"""Реклама в городе — HTTP API: витрина и расчёт цены (PR 1); бронь, мои объявления, отмена, смена ссылки,
модерация владельцем (PR 2). Районы: витрина, расчёт и бронь принимают district (centre / rows / port)."""

from collections.abc import Awaitable, Callable
from datetime import date, datetime
from typing import TypeVar

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.city_ad import CityAdSpot
from app.models.user import User
from app.services import city_ads as ads_svc
from app.services.roles import is_platform_owner

router = APIRouter(prefix="/city-ads", tags=["city-ads"])


DISTRICT_PATTERN = "^(centre|rows|port)$"


class QuoteBody(BaseModel):
    spot: str = Field(min_length=1, max_length=32)
    district: str | None = Field(default=None, pattern=DISTRICT_PATTERN)  # если указан — место должно быть в нём
    start: date  # первый день показа, сутки МСК
    days: int = Field(ge=1, le=ads_svc.HARD_MAX_DAYS)
    # необязательно: проверить текст, ссылку и цвет заранее (живой расчёт в форме)
    title: str | None = Field(default=None, max_length=512)
    subtitle: str | None = Field(default=None, max_length=512)
    body: str | None = Field(default=None, max_length=10_000)
    link_url: str | None = Field(default=None, max_length=2048)
    color: str | None = Field(default=None, max_length=32)


class QuoteContentOut(BaseModel):
    title: str | None
    subtitle: str | None
    body: str | None
    link_url: str | None
    link_kind: str | None
    color: str | None


class QuoteOut(BaseModel):
    spot: str
    format: str
    district: str
    start: date
    end: date
    days: int
    price_day: str
    total: str
    price_day_nano: int
    total_nano: int
    available: bool
    occupied: list[date]
    busy: list[date]
    next_free: date | None
    earliest: date
    latest: date
    content: QuoteContentOut | None = None


@router.get("")
async def city_ads_board(
    response: Response,
    db: AsyncSession = Depends(get_db),
    district: str = "centre",
):
    """Места и одобренные объявления на сегодня (МСК) — для города. Публично, без данных о пользователях.

    ?district=centre (по умолчанию — как до районов) | rows | port | all."""
    if district != "all" and district not in ads_svc.DISTRICT_RU:
        raise HTTPException(status_code=400, detail="неизвестный район")
    data = await ads_svc.board(db, district=district)
    await db.commit()
    response.headers["Cache-Control"] = "public, max-age=60, stale-while-revalidate=300"
    return data


@router.post("/quote", response_model=QuoteOut)
async def city_ads_quote(body: QuoteBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Цена, занятые сутки и ближайшая свободная дата. Сервер считает всё сам из тарифа city_ads."""
    has_content = any(v not in (None, "") for v in (body.title, body.subtitle, body.body, body.link_url, body.color))
    content = (
        ads_svc.AdContent(title=body.title, subtitle=body.subtitle, body=body.body, link_url=body.link_url, color=body.color)
        if has_content
        else None
    )
    try:
        q = await ads_svc.quote(
            db, user=user, spot_key=body.spot, start=body.start, days=body.days, content=content, district=body.district
        )
    except ads_svc.CityAdPermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except ads_svc.CityAdError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    await db.commit()
    c = q.content
    return QuoteOut(
        spot=q.spot_key, format=q.format, district=q.district, start=q.start, end=q.end, days=q.days,
        price_day=q.price_day, total=q.total, price_day_nano=q.price_day_nano, total_nano=q.total_nano,
        available=q.available, occupied=q.occupied, busy=q.busy, next_free=q.next_free,
        earliest=q.earliest, latest=q.latest,
        content=None if c is None else QuoteContentOut(
            title=c.title, subtitle=c.subtitle, body=c.body, link_url=c.link_url, link_kind=q.link_kind, color=c.color
        ),
    )


# ── PR 2: бронь, мои объявления, модерация ───────────────────────────────────

T = TypeVar("T")


class BookBody(BaseModel):
    spot: str = Field(min_length=1, max_length=32)
    district: str | None = Field(default=None, pattern=DISTRICT_PATTERN)
    start: date
    days: int = Field(ge=1, le=ads_svc.HARD_MAX_DAYS)
    title: str = Field(min_length=1, max_length=512)
    subtitle: str | None = Field(default=None, max_length=512)
    body: str | None = Field(default=None, max_length=10_000)
    link_url: str | None = Field(default=None, max_length=2048)
    color: str = Field(min_length=1, max_length=32)


class LinkBody(BaseModel):
    link_url: str | None = Field(default=None, max_length=2048)


class RejectBody(BaseModel):
    note: str | None = Field(default=None, max_length=2_000)


class AdOut(BaseModel):
    id: int
    spot: str
    district: str = "centre"
    # название места по-русски («Экран на фасаде рынка»), не ключ
    spot_title: str = ""
    format: str
    status: str
    title: str
    subtitle: str | None
    body: str | None
    link_url: str | None
    link_kind: str | None
    color: str
    start: date
    end: date
    days: int
    price_day: str
    total: str
    paid: str
    refunded: str
    total_nano: int
    paid_nano: int
    refunded_nano: int
    moderation_note: str | None
    moderated: bool  # уже проверялось владельцем — отменить самому нельзя
    created_at: datetime | None
    # счётчики «Прогулки»: impression / open / click (уникальные человеко-сутки)
    stats: dict[str, int] | None = None


class OwnerAdOut(AdOut):
    advertiser_id: int
    revenue_nano: int
    held_nano: int
    link_changed_at: datetime | None


class ModerationOut(BaseModel):
    items: list[OwnerAdOut]
    revenue_total: str
    revenue_total_nano: int


def _ad(ad, spot: CityAdSpot | None) -> dict:
    t = ads_svc.nano_to_ton
    return dict(
        id=ad.id, spot=spot.key if spot else "", district=spot.district if spot else ads_svc.DEFAULT_DISTRICT,
        spot_title=spot.title if spot else "",
        format=ad.format, status=ad.status, title=ad.title, subtitle=ad.subtitle, body=ad.body,
        link_url=ad.link_url, link_kind=ads_svc.link_kind(ad.link_url), color=ad.color,
        start=ad.start_day, end=ad.end_day, days=ad.days,
        price_day=t(ad.price_day_nano), total=t(ad.total_nano), paid=t(ad.paid_nano), refunded=t(ad.refunded_nano),
        total_nano=ad.total_nano, paid_nano=ad.paid_nano, refunded_nano=ad.refunded_nano,
        moderation_note=ad.moderation_note, moderated=ad.moderated_at is not None, created_at=ad.created_at,
    )


def _owner_ad(ad, spot: CityAdSpot | None) -> OwnerAdOut:
    return OwnerAdOut(
        **_ad(ad, spot), advertiser_id=ad.advertiser_id, revenue_nano=ad.revenue_nano,
        held_nano=ads_svc.held_nano(ad), link_changed_at=ad.link_changed_at,
    )


async def _spot(db: AsyncSession, spot_id: int) -> CityAdSpot | None:
    return await db.get(CityAdSpot, spot_id)


async def _tx(db: AsyncSession, fn: Callable[[], Awaitable[T]]) -> T:
    """Вызов сервиса одной транзакцией: ошибки → HTTP, при ошибке — rollback (ничего не списано)."""
    try:
        out = await fn()
    except ads_svc.CityAdPermissionError as e:
        await db.rollback()
        raise HTTPException(status_code=403, detail=str(e)) from e
    except ads_svc.CityAdNotFoundError as e:
        await db.rollback()
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ads_svc.CityAdBusyError as e:
        await db.rollback()
        raise HTTPException(status_code=409, detail=str(e)) from e
    except ads_svc.CityAdFundsError as e:
        await db.rollback()
        raise HTTPException(status_code=402, detail=str(e)) from e
    except ads_svc.CityAdError as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(e)) from e
    except BaseException:
        await db.rollback()
        raise
    await db.commit()
    return out


def _require_owner(user: User) -> None:
    if not is_platform_owner(user):
        raise HTTPException(status_code=403, detail="owner only")


@router.post("", response_model=AdOut, status_code=201)
async def city_ads_book(body: BookBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Купить показ: сервер пересчитывает цену, резервирует сутки и списывает TON. Объявление ждёт проверки."""
    content = ads_svc.AdContent(
        title=body.title, subtitle=body.subtitle, body=body.body, link_url=body.link_url, color=body.color
    )
    ad = await _tx(
        db,
        lambda: ads_svc.book(
            db, user=user, spot_key=body.spot, start=body.start, days=body.days, content=content, district=body.district
        ),
    )
    return AdOut(**_ad(ad, await _spot(db, ad.spot_id)))


@router.get("/mine", response_model=list[AdOut])
async def city_ads_mine(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    items = await ads_svc.my_ads(db, user=user)
    spots = {s.id: s for s in (await db.execute(select(CityAdSpot))).scalars().all()}
    stats = await ads_svc.event_counts(db, [a.id for a in items])
    return [AdOut(**_ad(a, spots.get(a.spot_id)), stats=stats[a.id]) for a in items]


@router.post("/{ad_id}/cancel", response_model=AdOut)
async def city_ads_cancel(ad_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Отменить своё объявление до проверки — полный возврат."""
    ad = await _tx(db, lambda: ads_svc.cancel(db, user=user, ad_id=ad_id))
    return AdOut(**_ad(ad, await _spot(db, ad.spot_id)))


@router.patch("/{ad_id}/link", response_model=AdOut)
async def city_ads_link(
    ad_id: int, body: LinkBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """Сменить ссылку: одобренное объявление снова уходит на проверку."""
    ad = await _tx(db, lambda: ads_svc.edit_link(db, user=user, ad_id=ad_id, link_url=body.link_url))
    return AdOut(**_ad(ad, await _spot(db, ad.spot_id)))


@router.get("/moderation", response_model=ModerationOut)
async def city_ads_moderation(
    status: str = Query(default="pending", max_length=16),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Очередь проверки для владельца (и списки по статусам) + доход платформы с рекламы."""
    _require_owner(user)
    try:
        rows = await ads_svc.moderation_queue(db, status=status)
    except ads_svc.CityAdError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    total = await ads_svc.revenue_total_nano(db)
    stats = await ads_svc.event_counts(db, [a.id for a, _ in rows])
    return ModerationOut(
        items=[_owner_ad(a, sp).model_copy(update={"stats": stats[a.id]}) for a, sp in rows], revenue_total=ads_svc.nano_to_ton(total), revenue_total_nano=total
    )


@router.post("/{ad_id}/approve", response_model=OwnerAdOut)
async def city_ads_approve(ad_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    _require_owner(user)
    ad = await _tx(db, lambda: ads_svc.approve(db, owner=user, ad_id=ad_id))
    return _owner_ad(ad, await _spot(db, ad.spot_id))


@router.post("/{ad_id}/reject", response_model=OwnerAdOut)
async def city_ads_reject(
    ad_id: int, body: RejectBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """Отклонить (или снять одобренное): возврат на баланс, сутки освобождаются."""
    _require_owner(user)
    ad = await _tx(db, lambda: ads_svc.reject(db, owner=user, ad_id=ad_id, note=body.note))
    return _owner_ad(ad, await _spot(db, ad.spot_id))


# ── PR 3: статистика «Прогулки» ──────────────────────────────────────────────


class EventBody(BaseModel):
    kind: str = Field(pattern="^(impression|open|click)$")


class EventOut(BaseModel):
    counted: bool


@router.post("/{ad_id}/events", response_model=EventOut)
async def city_ads_event(
    ad_id: int, body: EventBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """Показ / открытие карточки / переход по ссылке — только из «Прогулки». Раз в сутки на человека и вид."""
    counted = await _tx(db, lambda: ads_svc.record_event(db, user=user, ad_id=ad_id, kind=body.kind))
    return EventOut(counted=counted)
