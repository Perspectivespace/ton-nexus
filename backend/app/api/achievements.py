"""Достижения: экран игрока (прогресс, значки, закреплённый значок, праздничное окно) и решения владельца."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services import achievement_rules as rules_mod
from app.services import achievements as svc
from app.services.roles import is_platform_owner

router = APIRouter(prefix="/achievements", tags=["achievements"])


def _owner(user: User) -> None:
    if not is_platform_owner(user):
        raise HTTPException(status_code=403, detail="owner only")


@router.get("")
async def my_achievements(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Профиль → «Достижения»: ветки, ступени, прогресс до следующей, закреплённый значок."""
    await svc.check(db, user)
    out = await svc.player_view(db, user)
    await db.commit()
    return out


@router.get("/fresh")
async def fresh(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """При входе: досчитать ступени и отдать ещё не показанные — для праздничного окна."""
    await svc.check(db, user)
    items = await svc.fresh(db, user)
    await db.commit()
    return {"items": items}


class SeenIn(BaseModel):
    ids: list[int] = Field(default_factory=list, max_length=50)


@router.post("/seen")
async def seen(body: SeenIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict[str, int]:
    n = await svc.mark_seen(db, user, body.ids)
    await db.commit()
    return {"seen": n}


class PinIn(BaseModel):
    branch: str | None = None
    tier: int | None = None


@router.put("/pin")
async def pin(body: PinIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Закрепить значок в профиле (или снять: branch = null)."""
    if body.branch is not None and (body.branch not in rules_mod.BRANCHES or body.tier is None):
        raise HTTPException(status_code=400, detail={"code": "bad_badge"})
    try:
        out = await svc.set_pin(db, user, body.branch, body.tier)
    except svc.AchievementNotFound as e:
        raise HTTPException(status_code=404, detail={"code": "not_earned"}) from e
    await db.commit()
    return {"pin": out}


@router.get("/wall")
async def wall(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """«Стена славы»: игроки с самыми редкими достижениями (топ 50) и место игрока."""
    return await svc.wall(db, user.id)


# ── владелец ──────────────────────────────────────────────────────────────────


@router.get("/owner")
async def owner_summary(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Админка: всего выплачено, ждут подтверждения, сколько игроков получили каждую ступень."""
    _owner(user)
    return await svc.owner_summary(db)


async def _decide(award_id: int, approve: bool, user: User, db: AsyncSession) -> dict[str, Any]:
    _owner(user)
    try:
        a = await (svc.approve if approve else svc.reject)(db, award_id=award_id, actor=user)
    except svc.AchievementNotFound as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except svc.AchievementError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    await db.commit()
    return svc.award_out(a)


@router.post("/owner/{award_id}/approve")
async def approve(award_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await _decide(award_id, True, user, db)


@router.post("/owner/{award_id}/reject")
async def reject(award_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await _decide(award_id, False, user, db)
