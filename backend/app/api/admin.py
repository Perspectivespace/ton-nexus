"""Owner/admin controls."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services.roles import can_assign_admin, is_admin, is_platform_owner

router = APIRouter(prefix="/admin", tags=["admin"])


class RoleBody(BaseModel):
    telegram_id: int
    is_admin: bool | None = None
    is_ambassador: bool | None = None


class UserRoleOut(BaseModel):
    id: int
    telegram_id: int
    username: str | None
    is_admin: bool
    is_ambassador: bool
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

    await db.commit()
    await db.refresh(target)
    return UserRoleOut(
        id=target.id,
        telegram_id=target.telegram_id,
        username=target.username,
        is_admin=bool(target.is_admin),
        is_ambassador=bool(target.is_ambassador),
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
        is_owner=is_platform_owner(user),
    )
