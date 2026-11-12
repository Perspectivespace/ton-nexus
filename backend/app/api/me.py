"""Current user profile."""

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.api.deps import get_current_user
from app.core.i18n import SUPPORTED, normalize, user_lang
from app.db.session import get_db
from app.models.miner import Miner
from app.models.user import User
from app.services.roles import can_deploy, is_deployer, is_platform_owner

router = APIRouter(prefix="/me", tags=["me"])


class MinerOut(BaseModel):
    power: int
    capacity: int
    acceleration: int
    luck: int
    stability: int
    status: str
    pending_reward: Decimal

    model_config = {"from_attributes": True}


class MeOut(BaseModel):
    id: int
    telegram_id: int
    username: str | None
    first_name: str | None
    balance: Decimal
    xp: int
    level: int
    focus_tokens: int
    block_tokens: int
    success_boost_bp: int
    is_ambassador: bool
    is_admin: bool
    is_owner: bool
    is_deployer: bool = False
    can_deploy: bool = False
    # язык приложения: выбор в Профиле или язык Telegram; lang_chosen — выбран ли вручную
    lang: str = "en"
    lang_chosen: bool = False
    miner: MinerOut | None

    model_config = {"from_attributes": True}


@router.get("", response_model=MeOut)
async def me(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    miner = await db.scalar(select(Miner).where(Miner.user_id == user.id))
    return MeOut(
        id=user.id,
        telegram_id=user.telegram_id,
        username=user.username,
        first_name=user.first_name,
        balance=user.balance,
        xp=user.xp,
        level=user.level,
        focus_tokens=user.focus_tokens,
        block_tokens=user.block_tokens,
        success_boost_bp=user.success_boost_bp,
        is_ambassador=user.is_ambassador,
        is_admin=bool(getattr(user, "is_admin", False)),
        is_owner=is_platform_owner(user),
        is_deployer=is_deployer(user),
        can_deploy=can_deploy(user),
        lang=user_lang(user),
        lang_chosen=normalize(user.lang) is not None,
        miner=MinerOut.model_validate(miner) if miner else None,
    )


class LangIn(BaseModel):
    lang: str


class LangOut(BaseModel):
    lang: str
    lang_chosen: bool


@router.put("/lang", response_model=LangOut)
async def set_lang(
    body: LangIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Переключатель «Язык / Language» в Профиле: выбор хранится у игрока и действует на всех устройствах."""
    lang = normalize(body.lang)
    if lang is None:
        raise HTTPException(status_code=400, detail={"code": "bad_lang", "supported": list(SUPPORTED)})
    user.lang = lang
    await db.commit()
    return LangOut(lang=lang, lang_chosen=True)
