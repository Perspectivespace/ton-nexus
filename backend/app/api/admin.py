"""Owner/admin controls."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services import role_admin
from app.services.roles import (
    can_assign_admin,
    can_assign_owner,
    can_deploy,
    is_deployer,
    is_platform_owner,
)

router = APIRouter(prefix="/admin", tags=["admin"])


class RoleBody(BaseModel):
    telegram_id: int
    is_admin: bool | None = None
    is_ambassador: bool | None = None
    is_deployer: bool | None = None
    is_owner: bool | None = None


class UserRoleOut(BaseModel):
    id: int
    telegram_id: int
    username: str | None
    is_admin: bool
    is_ambassador: bool
    is_deployer: bool = False
    can_deploy: bool = False
    is_owner: bool


def _role_out(u: User) -> UserRoleOut:
    return UserRoleOut(
        id=u.id,
        telegram_id=u.telegram_id,
        username=u.username,
        is_admin=bool(u.is_admin),
        is_ambassador=bool(u.is_ambassador),
        is_deployer=is_deployer(u),
        can_deploy=can_deploy(u),
        is_owner=is_platform_owner(u),
    )


@router.post("/roles", response_model=UserRoleOut)
async def set_roles(
    body: RoleBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        target = await role_admin.change_roles(
            db,
            user,
            body.telegram_id,
            is_admin_=body.is_admin,
            is_ambassador=body.is_ambassador,
            is_deployer_=body.is_deployer,
            is_owner=body.is_owner,
        )
    except role_admin.RoleChangeError as e:
        raise HTTPException(status_code=e.status, detail=e.detail) from e
    return _role_out(target)


class StaffRow(BaseModel):
    telegram_id: int
    username: str | None
    first_name: str | None
    from_env: bool = False
    granted_by: str | None = None
    granted_at: datetime | None = None


class StaffOut(BaseModel):
    owners: list[StaffRow]
    admins: list[StaffRow]
    can_manage_admins: bool
    can_manage_owners: bool


class UserSearchRow(BaseModel):
    telegram_id: int
    username: str | None
    first_name: str | None
    is_owner: bool
    owner_from_env: bool
    is_admin: bool
    is_deployer: bool


def require_role_manager(user: User = Depends(get_current_user)) -> User:
    """«Роли»: владельцы (админы) и деплойеры (владельцы)."""
    if not (can_assign_admin(user) or can_assign_owner(user)):
        raise HTTPException(status_code=403, detail="owner or deployer required")
    return user


@router.get("/roles/staff", response_model=StaffOut)
async def roles_staff(user: User = Depends(require_role_manager), db: AsyncSession = Depends(get_db)):
    data = await role_admin.staff(db)
    return StaffOut(
        owners=[StaffRow(**r) for r in data["owners"]],
        admins=[StaffRow(**r) for r in data["admins"]],
        can_manage_admins=can_assign_admin(user),
        can_manage_owners=can_assign_owner(user),
    )


@router.get("/users/search", response_model=list[UserSearchRow])
async def users_search(
    q: str = Query(min_length=1, max_length=64),
    user: User = Depends(require_role_manager),
    db: AsyncSession = Depends(get_db),
):
    return [UserSearchRow(**role_admin.user_roles(u)) for u in await role_admin.search_users(db, q)]


@router.get("/me/roles", response_model=UserRoleOut)
async def my_roles(user: User = Depends(get_current_user)):
    return _role_out(user)


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
