"""Роли из приложения: несколько владельцев (TELEGRAM_OWNER_IDS + users.is_owner), выдача админов владельцем,
выдача владельцев только деплойером, журнал role_changes.

Запуск из папки backend: python -m unittest discover -s tests
"""

import asyncio
import pathlib
import re
import unittest
from types import SimpleNamespace
from unittest import mock

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import economy, tower
from app.db.base import Base
from app.models import RoleChange, User
from app.services import role_admin, roles
from app.services.role_admin import RoleChangeError

ENV_OWNER = 1000
ENV_DEPLOYER = 900


def _ns(tg, **kw):
    flags = {"is_admin": False, "is_ambassador": False, "is_deployer": False, "is_owner": False, **kw}
    return SimpleNamespace(id=tg, telegram_id=tg, username=None, first_name=None, **flags)


def _settings(test, owners=str(ENV_OWNER), deployers=""):
    for p in (
        mock.patch.object(roles.settings, "telegram_owner_ids", owners),
        mock.patch.object(roles.settings, "telegram_deployer_ids", deployers),
    ):
        p.start()
        test.addCleanup(p.stop)


class OwnerRulesTest(unittest.TestCase):
    def setUp(self):
        _settings(self)

    def test_env_or_db_owner(self):
        self.assertTrue(roles.is_platform_owner(_ns(ENV_OWNER)))
        self.assertTrue(roles.is_platform_owner(_ns(5, is_owner=True)))
        self.assertFalse(roles.is_platform_owner(_ns(6)))
        # владелец из базы — тоже админ (Касса, модерация)
        self.assertTrue(roles.is_admin(_ns(5, is_owner=True)))

    def test_db_owner_passes_owner_only_checks(self):
        db_owner = _ns(5, is_owner=True)
        economy._require_owner(db_owner)  # экономика
        tower._owner(db_owner)  # призы башни
        with self.assertRaises(HTTPException):
            economy._require_owner(_ns(6, is_admin=True))

    def test_only_deployer_manages_owners(self):
        owner = _ns(ENV_OWNER)
        self.assertEqual(roles.owner_change_error(owner, _ns(5), True, 1), "only a deployer can manage owners")
        self.assertEqual(roles.owner_change_error(_ns(7, is_owner=True), _ns(5), True, 2), "only a deployer can manage owners")
        self.assertIsNone(roles.owner_change_error(_ns(8, is_deployer=True), _ns(5), True, 1))

    def test_env_owner_and_last_owner_not_revocable(self):
        dep = _ns(8, is_deployer=True)
        self.assertEqual(roles.owner_change_error(dep, _ns(ENV_OWNER), False, 3), "owner is set in server settings")
        self.assertEqual(roles.owner_change_error(dep, _ns(5, is_owner=True), False, 1), "cannot revoke the last owner")
        self.assertIsNone(roles.owner_change_error(dep, _ns(5, is_owner=True), False, 2))

    def test_owner_checks_go_through_roles(self):
        """Никто, кроме roles.py, не проверяет владельца по TELEGRAM_OWNER_IDS напрямую."""
        app = pathlib.Path(__file__).resolve().parents[1] / "app"
        offenders = [
            str(p.relative_to(app))
            for p in app.rglob("*.py")
            if p.name not in ("roles.py", "telegram_auth.py", "config.py")
            and re.search(r"\bis_owner\(|telegram_owner_ids|import[^\n]*\bis_owner\b", p.read_text())
        ]
        self.assertEqual(offenders, [])


def run(fn):
    async def main():
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        try:
            async with async_sessionmaker(engine, expire_on_commit=False, autoflush=False)() as s:
                people = {
                    "env_owner": User(telegram_id=ENV_OWNER, username="sergey", is_deployer=True),
                    "owner": User(telegram_id=2001, username="olga", is_owner=True),
                    "deployer": User(telegram_id=2002, username="dima", is_deployer=True),
                    "user": User(telegram_id=2003, username="vasya"),
                    "user2": User(telegram_id=2004, username="vasilisa"),
                }
                s.add_all(people.values())
                await s.commit()
                await fn(s, SimpleNamespace(**people))
        finally:
            await engine.dispose()

    asyncio.run(main())


async def _log(s):
    return [(c.user_id, c.actor_id, c.role, c.granted) for c in (await s.scalars(select(RoleChange).order_by(RoleChange.id))).all()]


class ChangeRolesTest(unittest.TestCase):
    def setUp(self):
        _settings(self)

    def test_owner_grants_and_revokes_admin_with_log(self):
        async def body(s, p):
            t = await role_admin.change_roles(s, p.owner, 2003, is_admin_=True)
            self.assertTrue(t.is_admin)
            await role_admin.change_roles(s, p.owner, 2003, is_admin_=True)  # уже админ — в журнал не пишем
            await role_admin.change_roles(s, p.env_owner, 2003, is_admin_=False)
            self.assertFalse(p.user.is_admin)
            self.assertEqual(await _log(s), [(p.user.id, p.owner.id, "admin", True), (p.user.id, p.env_owner.id, "admin", False)])

        run(body)

    def test_non_owner_cannot_grant_admin(self):
        async def body(s, p):
            for actor in (p.deployer, p.user):
                with self.assertRaises(RoleChangeError) as cm:
                    await role_admin.change_roles(s, actor, 2004, is_admin_=True)
                self.assertEqual(cm.exception.status, 403)
            self.assertFalse(p.user2.is_admin)
            self.assertEqual(await _log(s), [])

        run(body)

    def test_deployer_grants_owner_and_new_owner_has_rights(self):
        async def body(s, p):
            await role_admin.change_roles(s, p.deployer, 2003, is_owner=True)
            self.assertTrue(roles.is_platform_owner(p.user))
            self.assertTrue(roles.can_assign_admin(p.user))
            # новый владелец (не деплойер) сам владельцев не назначает
            with self.assertRaises(RoleChangeError) as cm:
                await role_admin.change_roles(s, p.user, 2004, is_owner=True)
            self.assertEqual(cm.exception.detail, "only a deployer can manage owners")
            self.assertEqual(await _log(s), [(p.user.id, p.deployer.id, "owner", True)])

        run(body)

    def test_owner_without_deploy_cannot_make_owners(self):
        async def body(s, p):
            with self.assertRaises(RoleChangeError):
                await role_admin.change_roles(s, p.owner, 2003, is_owner=True)
            self.assertFalse(p.user.is_owner)

        run(body)

    def test_env_owner_not_revocable(self):
        async def body(s, p):
            with self.assertRaises(RoleChangeError) as cm:
                await role_admin.change_roles(s, p.deployer, ENV_OWNER, is_owner=False)
            self.assertEqual(cm.exception.detail, "owner is set in server settings")

        run(body)

    def test_last_owner_not_revocable(self):
        _settings(self, owners="")  # владельцев в настройках нет — остаётся один из базы

        async def body(s, p):
            with self.assertRaises(RoleChangeError) as cm:
                await role_admin.change_roles(s, p.deployer, 2001, is_owner=False)
            self.assertEqual(cm.exception.detail, "cannot revoke the last owner")
            self.assertTrue(p.owner.is_owner)
            await role_admin.change_roles(s, p.deployer, 2003, is_owner=True)
            await role_admin.change_roles(s, p.deployer, 2001, is_owner=False)
            self.assertFalse(p.owner.is_owner)
            self.assertFalse(roles.is_platform_owner(p.owner))

        run(body)

    def test_failed_check_changes_nothing(self):
        async def body(s, p):
            # админ можно, владельца — нет: запрос целиком отклонён
            with self.assertRaises(RoleChangeError):
                await role_admin.change_roles(s, p.owner, 2003, is_admin_=True, is_owner=True)
            self.assertFalse(p.user.is_admin)

        run(body)

    def test_unknown_user(self):
        async def body(s, p):
            with self.assertRaises(RoleChangeError) as cm:
                await role_admin.change_roles(s, p.owner, 999999, is_admin_=True)
            self.assertEqual(cm.exception.status, 404)

        run(body)

    def test_staff_lists_with_who_granted(self):
        async def body(s, p):
            await role_admin.change_roles(s, p.owner, 2003, is_admin_=True)
            await role_admin.change_roles(s, p.deployer, 2004, is_owner=True)
            out = await role_admin.staff(s)
            self.assertEqual([(o["telegram_id"], o["from_env"]) for o in out["owners"]], [(ENV_OWNER, True), (2001, False), (2004, False)])
            self.assertEqual(out["owners"][2]["granted_by"], "@dima")
            self.assertIsNotNone(out["owners"][2]["granted_at"])
            self.assertIsNone(out["owners"][1]["granted_by"])  # назначен до журнала
            self.assertEqual([(a["telegram_id"], a["granted_by"]) for a in out["admins"]], [(2003, "@olga")])

        run(body)

    def test_search_by_username_and_id(self):
        async def body(s, p):
            names = lambda us: [u.username for u in us]  # noqa: E731
            self.assertEqual(names(await role_admin.search_users(s, "@vas")), ["vasilisa", "vasya"])
            self.assertEqual(names(await role_admin.search_users(s, "VASYA")), ["vasya"])
            self.assertEqual(names(await role_admin.search_users(s, "2002")), ["dima"])
            self.assertEqual(await role_admin.search_users(s, "%"), [])
            self.assertEqual(await role_admin.search_users(s, "  @ "), [])
            row = role_admin.user_roles(p.env_owner)
            self.assertTrue(row["is_owner"] and row["owner_from_env"] and row["is_deployer"])

        run(body)


if __name__ == "__main__":
    unittest.main()
