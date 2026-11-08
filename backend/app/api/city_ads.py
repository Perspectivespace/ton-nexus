"""Реклама в городе — HTTP API (PR 1: витрина и расчёт цены; бронирование — следующим PR)."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services import city_ads as ads_svc

router = APIRouter(prefix="/city-ads", tags=["city-ads"])


class QuoteBody(BaseModel):
    spot: str = Field(min_length=1, max_length=32)
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
async def city_ads_board(response: Response, db: AsyncSession = Depends(get_db)):
    """Места и одобренные объявления на сегодня (МСК) — для города. Публично, без данных о пользователях."""
    data = await ads_svc.board(db)
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
        q = await ads_svc.quote(db, user=user, spot_key=body.spot, start=body.start, days=body.days, content=content)
    except ads_svc.CityAdPermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except ads_svc.CityAdError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    await db.commit()
    c = q.content
    return QuoteOut(
        spot=q.spot_key, format=q.format, start=q.start, end=q.end, days=q.days,
        price_day=q.price_day, total=q.total, price_day_nano=q.price_day_nano, total_nano=q.total_nano,
        available=q.available, occupied=q.occupied, busy=q.busy, next_free=q.next_free,
        earliest=q.earliest, latest=q.latest,
        content=None if c is None else QuoteContentOut(
            title=c.title, subtitle=c.subtitle, body=c.body, link_url=c.link_url, link_kind=q.link_kind, color=c.color
        ),
    )
