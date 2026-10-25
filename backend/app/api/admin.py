"""Owner/admin controls."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services.roles import (
    can_assign_admin,
    can_deploy,
    deployer_change_error,
    deployer_count,
    is_deployer,
    is_admin,
    is_platform_owner,
)

router = APIRouter(prefix="/admin", tags=["admin"])


class RoleBody(BaseModel):
    telegram_id: int
    is_admin: bool | None = None
    is_ambassador: bool | None = None
    is_deployer: bool | None = None


class UserRoleOut(BaseModel):
    id: int
    telegram_id: int
    username: str | None
    is_admin: bool
    is_ambassador: bool
    is_deployer: bool = False
    can_deploy: bool = False
    is_owner: bool


@router.post("/roles", response_model=UserRoleOut)
async def set_roles(
    body: RoleBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    target = await db.scalar(select(User).where(User.telegram_id == body.telegram_id))
    if not target:
        raise HTTPException(status_code=404, detail="user not found")

    if body.is_admin is not None:
        if not can_assign_admin(user):
            raise HTTPException(status_code=403, detail="only owner can assign admins")
        target.is_admin = body.is_admin

    if body.is_ambassador is not None:
        if not is_admin(user):
            raise HTTPException(status_code=403, detail="admin or owner required")
        target.is_ambassador = body.is_ambassador

    if body.is_deployer is not None:
        count = await deployer_count(db, lock=True)
        err = deployer_change_error(user, target, body.is_deployer, count)
        if err:
            raise HTTPException(status_code=403, detail=err)
        target.is_deployer = body.is_deployer

    await db.commit()
    await db.refresh(target)
    return UserRoleOut(
        id=target.id,
        telegram_id=target.telegram_id,
        username=target.username,
        is_admin=bool(target.is_admin),
        is_ambassador=bool(target.is_ambassador),
        is_deployer=is_deployer(target),
        can_deploy=can_deploy(target),
        is_owner=is_platform_owner(target),
    )


@router.get("/me/roles", response_model=UserRoleOut)
async def my_roles(user: User = Depends(get_current_user)):
    return UserRoleOut(
        id=user.id,
        telegram_id=user.telegram_id,
        username=user.username,
        is_admin=bool(user.is_admin),
        is_ambassador=bool(user.is_ambassador),
        is_deployer=is_deployer(user),
        can_deploy=can_deploy(user),
        is_owner=is_platform_owner(user),
    )


from app.services import gameday
from sqlalchemy import func, select


@router.get("/stats")
async def owner_stats(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not is_platform_owner(user):
        raise HTTPException(status_code=403, detail="owner only")

    total = await db.scalar(select(func.count()).select_from(User))
    today_start = gameday.day_start_of()  # «сегодня» — игровой день, с 00:00 МСК
    today = await db.scalar(
        select(func.count()).select_from(User).where(User.created_at >= today_start)
    )
    return {
        "total_users": total or 0,
        "registrations_today": today or 0,
    }
