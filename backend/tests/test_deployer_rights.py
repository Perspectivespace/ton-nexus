"""Права деплойера: назначает и снимает только активный деплойер, последнего снять нельзя.

Запуск из папки backend: python -m unittest discover -s tests
"""

import asyncio
import unittest
from types import SimpleNamespace
from unittest import mock

from fastapi import HTTPException

from app.api import admin
from app.services import roles

OWNER_ID = 1000


def _u(tg, deployer=False):
    return SimpleNamespace(
        id=tg, telegram_id=tg, username=f"u{tg}", is_admin=False, is_ambassador=False, is_deployer=deployer
    )


def _owner_patch():
    return mock.patch.object(roles, "is_owner", side_effect=lambda tg: tg == OWNER_ID)


class RulesTest(unittest.TestCase):
    def setUp(self):
        p = _owner_patch()
        p.start()
        self.addCleanup(p.stop)

    def test_owner_not_deployer_cannot_manage(self):
        self.assertFalse(roles.can_assign_deployer(_u(OWNER_ID), deployer_count=1))
        err = roles.deployer_change_error(_u(OWNER_ID), _u(5), True, deployer_count=1)
        self.assertEqual(err, "only an active deployer can manage deployers")

    def test_owner_cannot_revoke_deployer(self):
        err = roles.deployer_change_error(_u(OWNER_ID), _u(5, True), False, deployer_count=2)
        self.assertIsNotNone(err)

    def test_owner_bootstraps_first_deployer_only_when_none(self):
        self.assertTrue(roles.can_assign_deployer(_u(OWNER_ID), deployer_count=0))
        self.assertIsNone(roles.deployer_change_error(_u(OWNER_ID), _u(5), True, deployer_count=0))

    def test_regular_user_never_manages(self):
        self.assertFalse(roles.can_assign_deployer(_u(7), deployer_count=0))
        self.assertFalse(roles.can_assign_deployer(_u(7), deployer_count=3))

    def test_deployer_grants_and_revokes(self):
        d = _u(5, True)
        self.assertIsNone(roles.deployer_change_error(d, _u(6), True, deployer_count=1))
        self.assertIsNone(roles.deployer_change_error(d, _u(6, True), False, deployer_count=2))

    def test_last_deployer_cannot_revoke_self(self):
        d = _u(5, True)
        self.assertEqual(roles.deployer_change_error(d, d, False, deployer_count=1), "cannot revoke the last deployer")

    def test_deployer_can_revoke_self_when_not_last(self):
        d = _u(5, True)
        self.assertIsNone(roles.deployer_change_error(d, d, False, deployer_count=2))

    def test_owner_still_deploys(self):
        self.assertTrue(roles.can_deploy(_u(OWNER_ID)))
        self.assertTrue(roles.can_deploy(_u(5, True)))
        self.assertFalse(roles.can_deploy(_u(7)))


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
        p = _owner_patch()
        p.start()
        self.addCleanup(p.stop)
        p2 = mock.patch.object(admin, "is_platform_owner", side_effect=lambda u: u.telegram_id == OWNER_ID)
        p2.start()
        self.addCleanup(p2.stop)

    def test_owner_grant_forbidden_when_deployer_exists(self):
        owner, dep, new = _u(OWNER_ID), _u(5, True), _u(6)
        db = FakeDb({OWNER_ID: owner, 5: dep, 6: new})
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

    def test_deployer_revokes_other(self):
        a, b = _u(5, True), _u(6, True)
        db = FakeDb({5: a, 6: b})
        out = _call(a, db, 6, False)
        self.assertFalse(out.is_deployer)

    def test_owner_bootstrap_when_no_deployers(self):
        owner, new = _u(OWNER_ID), _u(6)
        db = FakeDb({OWNER_ID: owner, 6: new})
        out = _call(owner, db, 6, True)
        self.assertTrue(out.is_deployer)


if __name__ == "__main__":
    unittest.main()
