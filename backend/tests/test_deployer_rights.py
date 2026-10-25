"""Права деплойера: деплоят и назначают только деплойеры (флаг в базе или TELEGRAM_DEPLOYER_IDS).
Владелец без флага прав не имеет. Деплойеров из настроек сервера и последнего деплойера снять нельзя.

Запуск из папки backend: python -m unittest discover -s tests
"""

import asyncio
import unittest
from types import SimpleNamespace
from unittest import mock

from fastapi import HTTPException

from app.api import admin, deploy
from app.services import roles

OWNER_ID = 1000


def _u(tg, deployer=False):
    return SimpleNamespace(
        id=tg, telegram_id=tg, username=f"u{tg}", first_name=None, is_admin=False, is_ambassador=False, is_deployer=deployer
    )


def _patches(test, env=""):
    for p in (
        mock.patch.object(roles, "is_owner", side_effect=lambda tg: tg == OWNER_ID),
        mock.patch.object(roles.settings, "telegram_deployer_ids", env),
    ):
        p.start()
        test.addCleanup(p.stop)


class RulesTest(unittest.TestCase):
    def setUp(self):
        _patches(self, env="900, 901,x")

    def test_env_ids_parsed(self):
        self.assertEqual(roles.env_deployer_ids(), {900, 901})

    def test_owner_has_no_deploy_rights(self):
        owner = _u(OWNER_ID)
        self.assertFalse(roles.can_deploy(owner))
        self.assertFalse(roles.can_assign_deployer(owner))
        self.assertEqual(
            roles.deployer_change_error(owner, _u(5), True, deployer_count=0), "only a deployer can manage deployers"
        )

    def test_owner_cannot_revoke(self):
        self.assertIsNotNone(roles.deployer_change_error(_u(OWNER_ID), _u(5, True), False, deployer_count=3))

    def test_owner_who_is_deployer_can(self):
        self.assertTrue(roles.can_deploy(_u(OWNER_ID, True)))

    def test_env_deployer_can_deploy_and_manage(self):
        self.assertTrue(roles.can_deploy(_u(900)))
        self.assertIsNone(roles.deployer_change_error(_u(900), _u(6), True, deployer_count=2))

    def test_env_deployer_cannot_be_revoked(self):
        err = roles.deployer_change_error(_u(5, True), _u(900), False, deployer_count=4)
        self.assertEqual(err, "deployer is set in server settings")

    def test_regular_user_never_deploys(self):
        self.assertFalse(roles.can_deploy(_u(7)))
        self.assertFalse(roles.can_assign_deployer(_u(7)))

    def test_deployer_grants_and_revokes(self):
        d = _u(5, True)
        self.assertIsNone(roles.deployer_change_error(d, _u(6), True, deployer_count=3))
        self.assertIsNone(roles.deployer_change_error(d, _u(6, True), False, deployer_count=4))

    def test_last_deployer_cannot_revoke_self(self):
        d = _u(5, True)
        self.assertEqual(roles.deployer_change_error(d, d, False, deployer_count=1), "cannot revoke the last deployer")

    def test_deployer_can_revoke_self_when_not_last(self):
        d = _u(5, True)
        self.assertIsNone(roles.deployer_change_error(d, d, False, deployer_count=2))


class _Rows:
    def __init__(self, ids):
        self._ids = ids

    def all(self):
        return list(self._ids)


class FakeDb:
    """Минимальная сессия для set_roles: target по scalar, список деплойеров по scalars."""

    def __init__(self, users):
        self.users = users
        self.committed = False

    async def scalar(self, q):
        tg = q.whereclause.right.value
        return self.users.get(tg)

    async def scalars(self, q):
        return _Rows([u.id for u in self.users.values() if u.is_deployer])

    async def commit(self):
        self.committed = True

    async def refresh(self, obj):
        pass


def _call(actor, db, telegram_id, is_deployer):
    body = admin.RoleBody(telegram_id=telegram_id, is_deployer=is_deployer)
    return asyncio.run(admin.set_roles(body, user=actor, db=db))


class EndpointTest(unittest.TestCase):
    def setUp(self):
        _patches(self, env="")
        p2 = mock.patch.object(admin, "is_platform_owner", side_effect=lambda u: u.telegram_id == OWNER_ID)
        p2.start()
        self.addCleanup(p2.stop)

    def _env(self, value):
        p = mock.patch.object(roles.settings, "telegram_deployer_ids", value)
        p.start()
        self.addCleanup(p.stop)

    def test_owner_grant_forbidden_even_when_empty(self):
        owner, new = _u(OWNER_ID), _u(6)
        db = FakeDb({OWNER_ID: owner, 6: new})
        with self.assertRaises(HTTPException) as cm:
            _call(owner, db, 6, True)
        self.assertEqual(cm.exception.status_code, 403)
        self.assertFalse(new.is_deployer)
        self.assertFalse(db.committed)

    def test_owner_revoke_forbidden(self):
        owner, a, b = _u(OWNER_ID), _u(5, True), _u(6, True)
        db = FakeDb({OWNER_ID: owner, 5: a, 6: b})
        with self.assertRaises(HTTPException):
            _call(owner, db, 5, False)
        self.assertTrue(a.is_deployer)

    def test_deployer_grants(self):
        dep, new = _u(5, True), _u(6)
        db = FakeDb({5: dep, 6: new})
        out = _call(dep, db, 6, True)
        self.assertTrue(out.is_deployer)
        self.assertTrue(db.committed)

    def test_last_deployer_self_revoke_blocked(self):
        dep = _u(5, True)
        db = FakeDb({5: dep})
        with self.assertRaises(HTTPException) as cm:
            _call(dep, db, 5, False)
        self.assertEqual(cm.exception.detail, "cannot revoke the last deployer")
        self.assertTrue(dep.is_deployer)

    def test_env_deployer_counts_so_last_db_deployer_can_go(self):
        self._env("900")
        env_dep, dep = _u(900), _u(5, True)
        db = FakeDb({900: env_dep, 5: dep})
        out = _call(dep, db, 5, False)
        self.assertFalse(dep.is_deployer)
        self.assertFalse(out.is_deployer)

    def test_env_deployer_manages_and_is_not_revocable(self):
        self._env("900")
        env_dep, dep = _u(900), _u(5, True)
        db = FakeDb({900: env_dep, 5: dep})
        _call(env_dep, db, 5, False)
        self.assertFalse(dep.is_deployer)
        with self.assertRaises(HTTPException) as cm:
            _call(_u(6, True), FakeDb({900: env_dep, 6: _u(6, True)}), 900, False)
        self.assertEqual(cm.exception.detail, "deployer is set in server settings")

    def test_deployer_revokes_other(self):
        a, b = _u(5, True), _u(6, True)
        db = FakeDb({5: a, 6: b})
        out = _call(a, db, 6, False)
        self.assertFalse(out.is_deployer)


class _UsersDb:
    def __init__(self, users):
        self.users = users

    async def scalars(self, q):
        return _Rows(self.users)


class DeployEndpointsTest(unittest.TestCase):
    def setUp(self):
        _patches(self, env="900,950")

    def test_owner_gets_403_on_deploy_endpoints(self):
        with self.assertRaises(HTTPException) as cm:
            deploy.require_deployer(_u(OWNER_ID))
        self.assertEqual(cm.exception.status_code, 403)

    def test_env_and_db_deployers_pass(self):
        self.assertIs(deploy.require_deployer(_u(950)).telegram_id, 950)
        self.assertEqual(deploy.require_deployer(_u(5, True)).telegram_id, 5)

    def test_list_marks_env_deployers_first(self):
        known = [_u(5, True), _u(900)]
        out = asyncio.run(deploy.deployers(user=_u(5, True), db=_UsersDb(known)))
        self.assertEqual([(d.telegram_id, d.from_env) for d in out], [(900, True), (950, True), (5, False)])
        self.assertEqual(out[0].username, "u900")
        self.assertIsNone(out[1].username)


if __name__ == "__main__":
    unittest.main()
