"""Выдача и снятие ролей в приложении + журнал (role_changes).

Кто что может:
- админа — владелец (из настроек сервера или назначенный в приложении);
- амбассадора — админ или владелец;
- деплойера и владельца — только деплойер.
Нельзя снять деплойера/владельца из настроек сервера и последнего деплойера/владельца.

Гонки: перед снятием списки деплойеров/владельцев блокируются (SELECT … FOR UPDATE) в одном порядке —
деплойеры, владельцы, потом строка пользователя, — так два запроса не снимут друг друга одновременно.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.telegram_auth import env_owner_ids
from app.models.role_change import RoleChange
from app.models.user import User
from app.services.roles import (
    can_assign_admin,
    can_assign_owner,
    deployer_change_error,
    deployer_count,
    is_admin,
    is_deployer,
    is_env_owner,
    is_platform_owner,
    owner_change_error,
    owner_count,
)


class RoleChangeError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


async def change_roles(
    db: AsyncSession,
    actor: User,
    telegram_id: int,
    *,
    is_admin_: bool | None = None,
    is_ambassador: bool | None = None,
    is_deployer_: bool | None = None,
    is_owner: bool | None = None,
) -> User:
    """Проверить права, поменять флаги, записать в журнал и закоммитить. Ошибка — RoleChangeError, ничего не меняется."""
    # права, не зависящие от данных, — до блокировок
    if is_admin_ is not None and not can_assign_admin(actor):
        raise RoleChangeError(403, "only owner can assign admins")
    if is_ambassador is not None and not is_admin(actor):
        raise RoleChangeError(403, "admin or owner required")
    if is_owner is not None and not can_assign_owner(actor):
        raise RoleChangeError(403, "only a deployer can manage owners")

    n_deployers = await deployer_count(db, lock=True) if is_deployer_ is not None else 0
    n_owners = await owner_count(db, lock=True) if is_owner is not None else 0

    target = await db.scalar(select(User).where(User.telegram_id == telegram_id).with_for_update())
    if not target:
        raise RoleChangeError(404, "user not found")

    if is_deployer_ is not None:
        err = deployer_change_error(actor, target, is_deployer_, n_deployers)
        if err:
            raise RoleChangeError(403, err)
    if is_owner is not None:
        err = owner_change_error(actor, target, is_owner, n_owners)
        if err:
            raise RoleChangeError(403, err)

    for role, value in (
        ("owner", is_owner),
        ("admin", is_admin_),
        ("ambassador", is_ambassador),
        ("deployer", is_deployer_),
    ):
        if value is None:
            continue
        attr = f"is_{role}"
        if bool(getattr(target, attr, False)) == value:
            continue  # уже так — в журнал не пишем
        setattr(target, attr, value)
        db.add(RoleChange(user_id=target.id, actor_id=actor.id, role=role, granted=value))

    await db.commit()
    await db.refresh(target)
    return target


@dataclass
class Grant:
    by: str | None
    at: datetime | None


def display_name(u: User | None) -> str | None:
    if u is None:
        return None
    return f"@{u.username}" if u.username else (u.first_name or str(u.telegram_id))


async def last_grants(db: AsyncSession, user_ids: list[int], role: str) -> dict[int, Grant]:
    """Последняя выдача роли каждому: кто и когда (по журналу)."""
    if not user_ids:
        return {}
    rows = (
        await db.execute(
            select(RoleChange, User)
            .outerjoin(User, User.id == RoleChange.actor_id)
            .where(RoleChange.user_id.in_(user_ids), RoleChange.role == role, RoleChange.granted.is_(True))
            .order_by(RoleChange.created_at.desc(), RoleChange.id.desc())
        )
    ).all()
    out: dict[int, Grant] = {}
    for change, actor in rows:
        out.setdefault(change.user_id, Grant(by=display_name(actor), at=change.created_at))
    return out


async def staff(db: AsyncSession) -> dict[str, list[dict]]:
    """Владельцы (сначала из настроек сервера) и админы с тем, кто и когда выдал роль."""
    env_ids = env_owner_ids()
    q = select(User).where(User.is_owner.is_(True) | User.is_admin.is_(True) | User.telegram_id.in_(env_ids)).order_by(User.id)
    users = list((await db.scalars(q)).all())
    by_tg = {u.telegram_id: u for u in users}
    db_owners = [u for u in users if u.is_owner and u.telegram_id not in env_ids]
    admins = [u for u in users if u.is_admin and not is_platform_owner(u)]
    owner_grants = await last_grants(db, [u.id for u in db_owners], "owner")
    admin_grants = await last_grants(db, [u.id for u in admins], "admin")

    def row(tg: int, u: User | None, *, from_env: bool = False, grant: Grant | None = None) -> dict:
        return {
            "telegram_id": tg,
            "username": u.username if u else None,
            "first_name": u.first_name if u else None,
            "from_env": from_env,
            "granted_by": grant.by if grant else None,
            "granted_at": grant.at if grant else None,
        }

    owners = [row(tg, by_tg.get(tg), from_env=True) for tg in sorted(env_ids)]
    owners += [row(u.telegram_id, u, grant=owner_grants.get(u.id)) for u in db_owners]
    return {
        "owners": owners,
        "admins": [row(u.telegram_id, u, grant=admin_grants.get(u.id)) for u in admins],
    }


def _escape_like(s: str) -> str:
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def search_users(db: AsyncSession, query: str, limit: int = 10) -> list[User]:
    """Поиск для выдачи ролей: по @username (начало, без регистра) или точному Telegram ID."""
    q = query.strip().lstrip("@").strip()
    if not q:
        return []
    cond = User.username.ilike(_escape_like(q) + "%", escape="\\")
    if q.isdigit():
        cond = cond | (User.telegram_id == int(q))
    rows = await db.scalars(select(User).where(cond).order_by(User.username.is_(None), User.username, User.id).limit(limit))
    return list(rows.all())


def user_roles(u: User) -> dict:
    return {
        "telegram_id": u.telegram_id,
        "username": u.username,
        "first_name": u.first_name,
        "is_owner": is_platform_owner(u),
        "owner_from_env": is_env_owner(u),
        "is_admin": bool(u.is_admin),
        "is_deployer": is_deployer(u),
    }
