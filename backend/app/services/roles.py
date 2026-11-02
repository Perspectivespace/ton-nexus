"""Role helpers: owner > admin > ambassador > user.

`deployer` is a separate technical permission, not a rung of the hierarchy:
admins and the owner do not get deploy access automatically, and a deployer
does not get access to money / moderation.

A user is a deployer if users.is_deployer is set (granted in the app) or their
Telegram ID is listed in TELEGRAM_DEPLOYER_IDS (server settings). Only deployers
deploy and manage deployers. Env deployers cannot be revoked from the app, and
the last deployer cannot be revoked, so the list never becomes empty. If it ever
does, add an ID to TELEGRAM_DEPLOYER_IDS on the server and restart the API.

Owners: Telegram IDs from TELEGRAM_OWNER_IDS (server settings) plus users.is_owner (granted in the
app). Every owner-only check goes through is_platform_owner, never telegram_auth.is_owner directly.
Only deployers grant and revoke owners; env owners cannot be revoked from the app, and the last
owner cannot be revoked.
"""

from __future__ import annotations

from app.core.config import settings
from app.core.telegram_auth import env_owner_ids, is_owner
from app.models.user import User


def is_env_owner(user: User) -> bool:
    return is_owner(user.telegram_id)


def is_platform_owner(user: User) -> bool:
    """Владелец: из настроек сервера или назначен в приложении (users.is_owner)."""
    return is_env_owner(user) or bool(getattr(user, "is_owner", False))


def is_admin(user: User) -> bool:
    return is_platform_owner(user) or bool(user.is_admin)


def is_ambassador(user: User) -> bool:
    return is_admin(user) or bool(user.is_ambassador)


def can_create_task(user: User) -> bool:
    return is_ambassador(user)


def can_publish_directly(user: User) -> bool:
    return is_admin(user)


def can_manage_any_task(user: User) -> bool:
    return is_admin(user)


def can_approve_ambassador_task(user: User) -> bool:
    return is_admin(user)


def can_assign_admin(user: User) -> bool:
    return is_platform_owner(user)


def env_deployer_ids() -> set[int]:
    raw = settings.telegram_deployer_ids or ""
    return {int(x.strip()) for x in raw.split(",") if x.strip().isdigit()}


def is_env_deployer(user: User) -> bool:
    return user.telegram_id in env_deployer_ids()


def is_deployer(user: User) -> bool:
    return bool(getattr(user, "is_deployer", False)) or is_env_deployer(user)


def can_deploy(user: User) -> bool:
    return is_deployer(user)


def can_assign_deployer(user: User) -> bool:
    return is_deployer(user)


def deployer_change_error(user: User, target: User, make_deployer: bool, deployer_count: int) -> str | None:
    """Почему нельзя поменять флаг деплойера у target; None — можно.
    deployer_count — все деплойеры: из базы и из настроек сервера."""
    if not can_assign_deployer(user):
        return "only a deployer can manage deployers"
    if make_deployer:
        return None
    if is_env_deployer(target):
        return "deployer is set in server settings"
    if bool(getattr(target, "is_deployer", False)) and deployer_count <= 1:
        return "cannot revoke the last deployer"
    return None


async def db_deployer_tg_ids(db, *, lock: bool = False) -> list[int]:
    """Telegram ID деплойеров из базы. lock=True блокирует их строки до конца транзакции,
    чтобы два деплойера не сняли друг друга одновременно и список не опустел."""
    from sqlalchemy import select

    q = select(User.telegram_id).where(User.is_deployer.is_(True)).order_by(User.id)
    if lock:
        q = q.with_for_update()
    return list((await db.scalars(q)).all())


async def deployer_count(db, *, lock: bool = False) -> int:
    return len(set(await db_deployer_tg_ids(db, lock=lock)) | env_deployer_ids())


def can_assign_owner(user: User) -> bool:
    """Владельцев назначают и снимают только деплойеры (не просто владельцы)."""
    return is_deployer(user)


def owner_change_error(user: User, target: User, make_owner: bool, owner_count: int) -> str | None:
    """Почему нельзя поменять флаг владельца у target; None — можно.
    owner_count — все владельцы: из базы и из настроек сервера."""
    if not can_assign_owner(user):
        return "only a deployer can manage owners"
    if make_owner:
        return None
    if is_env_owner(target):
        return "owner is set in server settings"
    if bool(getattr(target, "is_owner", False)) and owner_count <= 1:
        return "cannot revoke the last owner"
    return None


async def db_owner_tg_ids(db, *, lock: bool = False) -> list[int]:
    """Telegram ID владельцев из базы; lock=True — как db_deployer_tg_ids: строки заблокированы до конца
    транзакции, два деплойера не снимут последних владельцев одновременно."""
    from sqlalchemy import select

    q = select(User.telegram_id).where(User.is_owner.is_(True)).order_by(User.id)
    if lock:
        q = q.with_for_update()
    return list((await db.scalars(q)).all())


async def owner_count(db, *, lock: bool = False) -> int:
    return len(set(await db_owner_tg_ids(db, lock=lock)) | env_owner_ids())
