"""Daily, promo, prize wheel API."""

from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services import daily as daily_svc
from app.services import prize_wheel as wheel_svc
from app.services import promo as promo_svc
from app.services.daily import DailyError
from app.services.prize_wheel import WheelError
from app.services.promo import PromoError, PromoPermissionError

router = APIRouter(tags=["engagement"])


class DailyOut(BaseModel):
    already_claimed: bool
    streak: int
    reward_ton: Decimal
    reward_xp: int
    reward_focus: int
    check_date: str


class DailyStatusOut(BaseModel):
    claimed_today: bool
    streak: int
    check_date: str


class PromoBody(BaseModel):
    code: str = Field(min_length=3, max_length=64)


class PromoOut(BaseModel):
    code: str
    reward_ton: Decimal
    reward_xp: int
    reward_focus: int


class PromoCreateBody(BaseModel):
    code: str = Field(min_length=3, max_length=64)
    reward_ton: Decimal = Decimal("0")
    reward_xp: int = 0
    reward_focus: int = 0
    max_uses: int | None = None
    expires_at: datetime | None = None


class PromoCreateOut(BaseModel):
    id: int
    code: str
    is_active: bool


class SpinOut(BaseModel):
    item_id: str
    label: str
    reward_ton: Decimal
    reward_xp: int
    reward_focus: int
    reward_block: int
    success_boost_bp: int
    free_spins_left_today: int


class WheelStatusOut(BaseModel):
    free_spins_per_day: int
    used_today: int
    left_today: int


@router.get("/daily/status", response_model=DailyStatusOut)
async def daily_status(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    s = await daily_svc.daily_status(db, user_id=user.id)
    await db.commit()
    return DailyStatusOut(**s)


@router.post("/daily/claim", response_model=DailyOut)
async def daily_claim(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        r = await daily_svc.claim_daily(db, user=user)
        await db.commit()
        return DailyOut(
            already_claimed=r.already_claimed,
            streak=r.streak,
            reward_ton=r.reward_ton,
            reward_xp=r.reward_xp,
            reward_focus=r.reward_focus,
            check_date=r.check_date.isoformat(),
        )
    except DailyError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/promo/redeem", response_model=PromoOut)
async def promo_redeem(
    body: PromoBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        r = await promo_svc.redeem(db, user=user, code=body.code)
        await db.commit()
        return PromoOut(
            code=r.code, reward_ton=r.reward_ton, reward_xp=r.reward_xp, reward_focus=r.reward_focus
        )
    except PromoError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/promo/create", response_model=PromoCreateOut)
async def promo_create(
    body: PromoCreateBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        row = await promo_svc.create_promo(
            db,
            actor=user,
            code=body.code,
            reward_ton=body.reward_ton,
            reward_xp=body.reward_xp,
            reward_focus=body.reward_focus,
            max_uses=body.max_uses,
            expires_at=body.expires_at,
        )
        await db.commit()
        return PromoCreateOut(id=row.id, code=row.code, is_active=row.is_active)
    except PromoPermissionError as e:
        raise HTTPException(status_code=403, detail=str(e)) from e
    except PromoError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/wheel/status", response_model=WheelStatusOut)
async def wheel_status(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    s = await wheel_svc.wheel_status(db, user_id=user.id)
    await db.commit()
    return WheelStatusOut(**s)


@router.post("/wheel/spin", response_model=SpinOut)
async def wheel_spin(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        r = await wheel_svc.spin(db, user=user)
        await db.commit()
        return SpinOut(
            item_id=r.item_id,
            label=r.label,
            reward_ton=r.reward_ton,
            reward_xp=r.reward_xp,
            reward_focus=r.reward_focus,
            reward_block=r.reward_block,
            success_boost_bp=r.success_boost_bp,
            free_spins_left_today=r.free_spins_left_today,
        )
    except WheelError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


from sqlalchemy import select
from app.models.promo import PromoCode
from app.services.roles import is_platform_owner


class PromoListItem(BaseModel):
    id: int
    code: str
    reward_ton: Decimal
    reward_xp: int
    reward_focus: int
    max_uses: int | None
    used_count: int
    is_active: bool
    created_at: datetime


@router.get("/promo/list", response_model=list[PromoListItem])
async def promo_list(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not is_platform_owner(user):
        raise HTTPException(status_code=403, detail="owner only")

    rows = (await db.scalars(select(PromoCode).order_by(PromoCode.created_at.desc()))).all()
    return [
        PromoListItem(
            id=p.id,
            code=p.code,
            reward_ton=p.reward_ton,
            reward_xp=p.reward_xp,
            reward_focus=p.reward_focus,
            max_uses=p.max_uses,
            used_count=p.used_count,
            is_active=p.is_active,
            created_at=p.created_at,
        )
        for p in rows
    ]
