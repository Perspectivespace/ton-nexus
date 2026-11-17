"""«Честность» — только владелец (R1, теневой режим). Игрокам счёт не показывается."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services import integrity as svc
from app.services.roles import is_platform_owner

router = APIRouter(prefix="/integrity", tags=["integrity"])


def _require_owner(user: User) -> None:
    if not is_platform_owner(user):
        raise HTTPException(status_code=403, detail="owner only")


def _err(e: svc.IntegrityActionError) -> HTTPException:
    return HTTPException(status_code=404 if isinstance(e, svc.IntegrityNotFound) else 400, detail=str(e))


class AdjustBody(BaseModel):
    delta: int = 0
    reason: str = Field(min_length=3, max_length=500)
    half_life_days: int | None = None
    fraud: bool = False


class VoidBody(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


@router.get("/summary")
async def summary(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    _require_owner(user)
    return await svc.summary(db)


@router.get("/users/{user_id}")
async def user_view(user_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    _require_owner(user)
    try:
        out = await svc.user_view(db, user_id)
    except svc.IntegrityActionError as e:
        raise _err(e) from e
    await db.commit()
    return out


@router.post("/users/{user_id}/recompute")
async def recompute(user_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    _require_owner(user)
    if await db.get(User, user_id) is None:
        raise HTTPException(status_code=404, detail="user not found")
    score, tier = await svc.recompute(db, user_id)
    await db.commit()
    return {"user_id": user_id, "integrity": score, "tier": tier}


@router.post("/users/{user_id}/adjust")
async def adjust(user_id: int, body: AdjustBody, user: User = Depends(get_current_user),
                 db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    _require_owner(user)
    try:
        ev = await svc.adjust(db, user_id=user_id, actor=user, reason=body.reason.strip(), delta=body.delta,
                              half_life_days=body.half_life_days, fraud=body.fraud)
    except svc.IntegrityActionError as e:
        raise _err(e) from e
    target = await db.get(User, user_id)
    out = {"event": svc.event_out(ev), "integrity": target.integrity, "tier": target.integrity_tier}
    await db.commit()
    return out


@router.get("/review")
async def review(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> list[dict[str, Any]]:
    _require_owner(user)
    return await svc.review_queue(db)


@router.post("/events/{event_id}/confirm")
async def confirm(event_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    _require_owner(user)
    try:
        ev = await svc.confirm_event(db, event_id=event_id, actor=user)
    except svc.IntegrityActionError as e:
        raise _err(e) from e
    out = svc.event_out(ev)
    await db.commit()
    return out


@router.post("/events/{event_id}/void")
async def void(event_id: int, body: VoidBody, user: User = Depends(get_current_user),
               db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    _require_owner(user)
    try:
        ev = await svc.void_event(db, event_id=event_id, actor=user, reason=body.reason.strip())
    except svc.IntegrityActionError as e:
        raise _err(e) from e
    out = svc.event_out(ev)
    await db.commit()
    return out
