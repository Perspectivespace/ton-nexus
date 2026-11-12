"""Секретный промокод в «Прогулке»: что видно в локации сейчас (игроку) и кампании (владельцу).

Расписание наружу не отдаётся никогда: игрок получает только код, пока появление идёт в его локации;
владелец — только счётчики. Ввод кода — обычный POST /promo/redeem.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services import secret_promo as svc

router = APIRouter(tags=["secret-promo"])


class SignalOut(BaseModel):
    code: str | None = None


@router.get("/city/signal", response_model=SignalOut)
async def city_signal(
    district: str = Query("centre", max_length=16),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return SignalOut(code=await svc.visible_code(db, user=user, district=district))


class CampaignBody(BaseModel):
    code: str = Field(min_length=4, max_length=16)
    reward_ton: str = Field(min_length=1, max_length=20)
    max_uses: int
    days: int
    per_day: int


class CampaignOut(BaseModel):
    id: int
    code: str
    reward_ton: str
    max_uses: int
    used_count: int
    days: int
    per_day: int
    appearances_total: int
    appearances_done: int
    status: str
    created_at: datetime
    ends_at: datetime


def _out(c: svc.CampaignStats) -> CampaignOut:
    return CampaignOut(**c.__dict__)


@router.get("/owner/secret-promos", response_model=list[CampaignOut])
async def secret_list(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        return [_out(c) for c in await svc.list_campaigns(db, actor=user)]
    except svc.SecretPromoPermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e


@router.post("/owner/secret-promos", response_model=CampaignOut, status_code=201)
async def secret_create(body: CampaignBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        camp = await svc.create_campaign(
            db, actor=user, code=body.code, reward_ton=body.reward_ton, max_uses=body.max_uses, days=body.days, per_day=body.per_day
        )
        await db.commit()
        item = next(c for c in await svc.list_campaigns(db, actor=user) if c.id == camp.id)
        return _out(item)
    except svc.SecretPromoPermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except svc.SecretPromoError as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/owner/secret-promos/{campaign_id}/disable", response_model=CampaignOut)
async def secret_disable(campaign_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        await svc.disable(db, actor=user, campaign_id=campaign_id)
        await db.commit()
        item = next(c for c in await svc.list_campaigns(db, actor=user) if c.id == campaign_id)
        return _out(item)
    except svc.SecretPromoPermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except svc.SecretPromoError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
