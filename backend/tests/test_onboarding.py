"""Знакомство игрока: состояние на сервере (/me, PUT /me/onboarding), сброс, миграция 028.

Запуск из backend: python -m unittest tests.test_onboarding
"""

import itertools
import unittest
import warnings
from unittest import mock

import httpx
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.db.base import Base
from app.models import User
from app.services import onboarding as onb

warnings.filterwarnings("ignore", message=".*Decimal objects natively.*")
_TG = itertools.count(93000)


class ServiceTest(unittest.TestCase):
    def test_apply_and_reset(self):
        u = User(telegram_id=1)
        self.assertEqual(onb.state(u), {"intro_done": False, "hints": []})
        onb.apply(u, intro_done=True)
        onb.apply(u, hint="miner")
        onb.apply(u, hint="home")
        onb.apply(u, hint="miner")
        self.assertEqual(onb.state(u), {"intro_done": True, "hints": ["home", "miner"]})
        with self.assertRaises(ValueError):
            onb.apply(u, hint="nope")
        self.assertEqual(onb.apply(u, reset=True), {"intro_done": False, "hints": []})
        u.onboarding = {"intro": True, "hints": ["junk", "earn"]}  # мусор из базы не наружу
        self.assertEqual(onb.state(u)["hints"], ["earn"])


class ApiTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from app.db.session import get_db
        from app.main import app

        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool)
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        self.addAsyncCleanup(self.engine.dispose)
        self.S = async_sessionmaker(self.engine, expire_on_commit=False, autoflush=False)

        async def _db():
            async with self.S() as s:
                yield s

        app.dependency_overrides[get_db] = _db
        self.addCleanup(app.dependency_overrides.clear)
        p = mock.patch.object(settings, "debug", True)
        p.start()
        self.addCleanup(p.stop)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")
        self.addAsyncCleanup(self.client.aclose)

    async def test_state_persists_across_devices(self):
        tg = next(_TG)
        h = {"X-Telegram-Init-Data": f"dev:{tg}"}
        c = self.client
        r = await c.get("/api/v1/me", headers=h)
        self.assertEqual(r.json()["onboarding"], {"intro_done": False, "hints": []})
        r = await c.put("/api/v1/me/onboarding", json={"intro_done": True}, headers=h)
        self.assertEqual(r.json(), {"intro_done": True, "hints": []})
        r = await c.put("/api/v1/me/onboarding", json={"hint": "earn"}, headers=h)
        self.assertEqual(r.json()["hints"], ["earn"])
        r = await c.put("/api/v1/me/onboarding", json={"hint": "casino"}, headers=h)
        self.assertEqual(r.status_code, 400)
        # «другое устройство» — тот же игрок, новый запрос
        r = await c.get("/api/v1/me", headers=h)
        self.assertEqual(r.json()["onboarding"], {"intro_done": True, "hints": ["earn"]})
        r = await c.put("/api/v1/me/onboarding", json={"reset": True}, headers=h)
        self.assertEqual(r.json(), {"intro_done": False, "hints": []})


class MigrationTest(unittest.TestCase):
    def test_028_backfills_existing_players(self):
        import importlib.util
        import pathlib

        import sqlalchemy as sa
        from alembic.migration import MigrationContext
        from alembic.operations import Operations

        path = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "028_user_onboarding.py"
        spec = importlib.util.spec_from_file_location("m028", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        self.assertEqual((mod.revision, mod.down_revision), ("028", "027"))
        eng = sa.create_engine("sqlite://")
        with eng.begin() as conn:
            Base.metadata.create_all(conn)
            conn.execute(sa.text("ALTER TABLE users DROP COLUMN onboarding"))
            conn.execute(sa.text("INSERT INTO users (telegram_id, balance, xp, level, focus_tokens, block_tokens, success_boost_bp, "
                                 "is_banned, is_ambassador, is_admin, is_deployer, is_owner) VALUES (5, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0)"))

        def apply(fn):
            with eng.begin() as conn:
                with mock.patch.object(mod, "op", Operations(MigrationContext.configure(conn))):
                    fn()

        apply(mod.upgrade)
        apply(mod.upgrade)
        with eng.connect() as conn:
            v = conn.execute(sa.text("SELECT onboarding FROM users")).scalar_one()
        u = User(telegram_id=5, onboarding=__import__("json").loads(v))
        self.assertEqual(onb.state(u), {"intro_done": True, "hints": list(onb.HINTS)})
        apply(mod.downgrade)
        self.assertNotIn("onboarding", [c["name"] for c in sa.inspect(eng).get_columns("users")])
