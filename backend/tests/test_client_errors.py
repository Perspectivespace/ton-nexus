"""Ошибки клиента (P6): очистка, отпечаток, группировка, лимит, крючок оповещений, API, миграция 027.

SQLite в памяти. Запуск из backend: python -m unittest tests.test_client_errors
"""

import asyncio
import itertools
import unittest
import warnings
from unittest import mock

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.db.base import Base
from app.models import ClientError, User
from app.services import client_errors as svc

warnings.filterwarnings("ignore", message=".*Decimal objects natively.*")
_TG = itertools.count(91000)
ADDR = "UQ" + "A" * 46
RAW = "0:" + "ab" * 32
FAKE_BOT = "bot123456:" + "x" * 30  # не настоящий токен


class ScrubTest(unittest.TestCase):
    def test_removes_private_data(self):
        s = svc.scrub(
            f"pay {ADDR} raw {RAW} balance 499.4500 TON user 123456789 "
            "https://app.example/x?tgWebAppData=query_id%3DAAA&hash=abc#tgWebAppData=zzz "
            "initData=user%3D%7B%7D&hash=ff token=abc " + FAKE_BOT + " a@b.co",
            500,
        )
        for bad in (ADDR, RAW, "499.4500", "123456789", "tgWebAppData=query", FAKE_BOT, "a@b.co", "hash=abc", "token=abc"):
            self.assertNotIn(bad, s)
        self.assertIn("<адрес>", s)
        self.assertIn("https://app.example/x", s)
        self.assertLessEqual(len(svc.scrub("x" * 5000, 100)), 100)

    def test_keeps_useful_text(self):
        self.assertEqual(svc.scrub("TypeError: Cannot read properties of undefined (reading 'map')", 500),
                         "TypeError: Cannot read properties of undefined (reading 'map')")

    def test_fingerprint_ignores_build_hash_and_position(self):
        a = svc.fingerprint("error", "boom", "Error: boom\n    at f (https://x/assets/index-AbC123x.js:10:20)")
        b = svc.fingerprint("error", "boom", "Error: boom\n    at f (https://x/assets/index-ZZz999q.js:11:5)")
        c = svc.fingerprint("rejection", "boom", "Error: boom\n    at f (https://x/assets/index-AbC123x.js:10:20)")
        self.assertEqual(a, b)
        self.assertNotEqual(a, c)


class LimitTest(unittest.TestCase):
    def setUp(self):
        svc.reset_limits()
        self.addCleanup(svc.reset_limits)

    def test_per_user_window(self):
        ok = [svc.allow("1", now=100.0 + i) for i in range(svc.PER_USER + 3)]
        self.assertEqual(ok.count(True), svc.PER_USER)
        self.assertTrue(svc.allow("2", now=130.0))  # другой игрок — свой лимит
        self.assertTrue(svc.allow("1", now=100.0 + svc.PER_USER_WINDOW + 30))  # окно прошло


def run(fn):
    async def main():
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as s:
                await fn(s)
        finally:
            await engine.dispose()

    asyncio.run(main())


class RecordTest(unittest.TestCase):
    def test_group_count_users_and_hook(self):
        seen = []

        async def hook(row):
            seen.append(row.fingerprint)

        async def bad(row):
            raise RuntimeError("hook down")

        async def body(s):
            with mock.patch.object(svc, "_hooks", [bad, hook]):
                r1, n1 = await svc.record(s, kind="error", message=f"boom {ADDR}", stack="at f (a.js:1:1)", user_id=1)
                r2, n2 = await svc.record(s, kind="error", message=f"boom {ADDR}", stack="at f (a.js:2:9)", user_id=2)
                r3, n3 = await svc.record(s, kind="error", message=f"boom {ADDR}", stack="at f (a.js:2:9)", user_id=2)
                r4, _ = await svc.record(s, kind="weird", message="other", user_id=None, platform="android 8.0", build="b7f<3e>")
            self.assertEqual((r4.users, r4.platform, r4.build), (0, "android 8.0", "b7f3e"))
            self.assertEqual((n1, n2, n3), (True, False, False))
            self.assertEqual(r1.id, r3.id)
            self.assertEqual((r3.count, r3.users), (3, 2))  # игроки 1 и 2, повтор второго не считается
            self.assertNotIn(ADDR, r3.message)
            self.assertEqual(len(seen), 2)  # по разу на новый отпечаток, сломанный крючок не мешает
            kinds = (await s.execute(select(ClientError.kind))).scalars().all()
            self.assertEqual(sorted(kinds), ["error", "error"])  # неизвестный вид → error
            out = await svc.summary(s)
            self.assertEqual((out["groups"], out["events"], out["groups_24h"]), (2, 4, 2))
            self.assertNotIn("stack", out["items"][0])

        with self.assertLogs("app.services.client_errors", "ERROR"):
            run(body)


class ApiTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        from app.db.session import get_db
        from app.main import app

        svc.reset_limits()
        self.addCleanup(svc.reset_limits)
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
        p = mock.patch.object(settings, "debug", False)  # прод: без initData — аноним
        p.start()
        self.addCleanup(p.stop)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")
        self.addAsyncCleanup(self.client.aclose)

    async def _u(self, **kw):
        async with self.S() as s:
            u = User(telegram_id=next(_TG), **kw)
            s.add(u)
            await s.commit()
            return u.telegram_id

    async def test_report_anonymous_and_owner_views(self):
        c = self.client
        r = await c.post("/api/v1/client-errors", json={"kind": "rejection", "message": "Failed 12.5 TON", "stack": "at x", "route": "/miner"})
        self.assertEqual(r.status_code, 204, r.text)
        r = await c.post("/api/v1/client-errors", json={"message": "x" * 3000})
        self.assertEqual(r.status_code, 422)
        with mock.patch.object(settings, "debug", True):
            ptg = await self._u()
            otg = await self._u(is_owner=True)
            for m in ("get", "delete"):
                r = await c.request(m, "/api/v1/client-errors", headers={"X-Telegram-Init-Data": f"dev:{ptg}"})
                self.assertEqual(r.status_code, 403)
            r = await c.get("/api/v1/client-errors", headers={"X-Telegram-Init-Data": f"dev:{otg}"})
            self.assertEqual(r.status_code, 200)
            data = r.json()
            self.assertEqual((data["groups"], data["events"]), (1, 1))
            it = data["items"][0]
            self.assertEqual((it["kind"], it["message"], it["route"]), ("rejection", "Failed <n> TON", "/miner"))
            r = await c.get(f"/api/v1/client-errors/{it['id']}", headers={"X-Telegram-Init-Data": f"dev:{otg}"})
            self.assertEqual(r.json()["stack"], "at x")
            r = await c.delete("/api/v1/client-errors", headers={"X-Telegram-Init-Data": f"dev:{otg}"})
            self.assertEqual(r.json()["deleted"], 1)

    async def test_rate_limited_silently(self):
        for _ in range(svc.PER_USER + 5):
            r = await self.client.post("/api/v1/client-errors", json={"message": "same"})
            self.assertEqual(r.status_code, 204)
        async with self.S() as s:
            row = (await s.execute(select(ClientError))).scalar_one()
            self.assertEqual(row.count, svc.PER_USER)


class MigrationTest(unittest.TestCase):
    def test_027_idempotent_up_down(self):
        import importlib.util
        import pathlib

        import sqlalchemy as sa
        from alembic.migration import MigrationContext
        from alembic.operations import Operations

        path = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "027_client_errors.py"
        spec = importlib.util.spec_from_file_location("m027", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        self.assertEqual((mod.revision, mod.down_revision), ("027", "026"))
        eng = sa.create_engine("sqlite://")
        with eng.begin() as conn:
            Base.metadata.create_all(conn)
            conn.execute(sa.text("DROP TABLE client_errors"))

        def apply(fn):
            with eng.begin() as conn:
                with mock.patch.object(mod, "op", Operations(MigrationContext.configure(conn))):
                    fn()

        apply(mod.upgrade)
        apply(mod.upgrade)
        self.assertIn("client_errors", sa.inspect(eng).get_table_names())
        apply(mod.downgrade)
        self.assertNotIn("client_errors", sa.inspect(eng).get_table_names())
