"""Role helpers: owner > admin > ambassador > user.

`deployer` is a separate technical permission (users.is_deployer), not a rung
of the hierarchy: admins do not get server access automatically, and a deployer
does not get access to money / moderation. The owner can always deploy.
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


def can_assign_deployer(user: User) -> bool:
    return is_platform_owner(user)
