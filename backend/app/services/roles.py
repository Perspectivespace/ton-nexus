"""Role helpers: owner > admin > ambassador > user.

`deployer` is a separate technical permission (users.is_deployer), not a rung
of the hierarchy: admins do not get server access automatically, and a deployer
does not get access to money / moderation. The owner can always deploy.

Who manages deployers: only an active deployer (users.is_deployer). The owner
does not grant/revoke deployer rights — except a one-time bootstrap when there
are no deployers at all (otherwise nobody could ever add the first one).
The last deployer cannot be revoked, so the list never becomes empty again.
"""

from __future__ import annotations

from app.core.telegram_auth import is_owner
from app.models.user import User


def is_platform_owner(user: User) -> bool:
    return is_owner(user.telegram_id)


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


def can_deploy(user: User) -> bool:
    return is_platform_owner(user) or bool(getattr(user, "is_deployer", False))


def can_assign_deployer(user: User, deployer_count: int) -> bool:
    if bool(getattr(user, "is_deployer", False)):
        return True
    # bootstrap: деплойеров нет совсем — первого назначает владелец
    return deployer_count == 0 and is_platform_owner(user)


def deployer_change_error(user: User, target: User, make_deployer: bool, deployer_count: int) -> str | None:
    """Почему нельзя поменять флаг деплойера у target; None — можно."""
    if not can_assign_deployer(user, deployer_count):
        return "only an active deployer can manage deployers"
    if not make_deployer and bool(getattr(target, "is_deployer", False)) and deployer_count <= 1:
        return "cannot revoke the last deployer"
    return None


async def deployer_count(db, *, lock: bool = False) -> int:
    """Сколько активных деплойеров. lock=True — блокирует их строки до конца транзакции,
    чтобы два деплойера не сняли друг друга одновременно и список не опустел."""
    from sqlalchemy import select

    q = select(User.id).where(User.is_deployer.is_(True))
    if lock:
        q = q.with_for_update()
    return len((await db.scalars(q)).all())
