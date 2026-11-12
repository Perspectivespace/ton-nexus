"""Язык игрока: определение по Telegram, выбор в Профиле (хранится на сервере), миграция 025."""

from __future__ import annotations

import itertools
import unittest
from decimal import Decimal as D
from unittest import mock

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core import i18n
from app.core.config import settings
from app.db.base import Base
from app.models import User

_TG = itertools.count(61000)


class Detect(unittest.TestCase):
    def test_ru_family_goes_ru(self):
        for code in ("ru", "RU", "ru-RU", "uk", "be", "kk", "kk_KZ"):
            self.assertEqual(i18n.detect(code), "ru", code)

    def test_everything_else_goes_en(self):
        for code in ("en", "en-US", "de", "pl", "uz", "ka", "", None, "xx-yy"):
            self.assertEqual(i18n.detect(code), "en", code)

    def test_choice_wins_over_telegram(self):
        self.assertEqual(i18n.user_lang(User(language_code="ru", lang="en")), "en")
        self.assertEqual(i18n.user_lang(User(language_code="de", lang="ru")), "ru")
        self.assertEqual(i18n.user_lang(User(language_code="uk", lang=None)), "ru")
        self.assertEqual(i18n.user_lang(User(language_code="fr", lang="zz")), "en")  # мусор в поле — как пусто

    def test_normalize(self):
        self.assertEqual(i18n.normalize("EN-gb"), "en")
        self.assertIsNone(i18n.normalize("uk"))  # украинского интерфейса пока нет
        self.assertIsNone(i18n.normalize(None))


class Api(unittest.IsolatedAsyncioTestCase):
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

    async def user(self, **kw) -> int:
        tg = next(_TG)
        async with self.S() as s:
            s.add(User(telegram_id=tg, balance=D("0"), level=1, **kw))
            await s.commit()
        return tg

    @staticmethod
    def h(tg: int) -> dict:
        return {"X-Telegram-Init-Data": f"dev:{tg}"}

    async def test_me_reports_lang_and_switch_persists(self):
        tg = await self.user()  # dev-вход приходит с language_code=ru
        me = (await self.client.get("/api/v1/me", headers=self.h(tg))).json()
        self.assertEqual((me["lang"], me["lang_chosen"]), ("ru", False))

        r = await self.client.put("/api/v1/me/lang", headers=self.h(tg), json={"lang": "en"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"lang": "en", "lang_chosen": True})
        # «другое устройство» — тот же игрок, новый запрос: выбор сохранился, язык Telegram его не перебивает
        me = (await self.client.get("/api/v1/me", headers=self.h(tg))).json()
        self.assertEqual((me["lang"], me["lang_chosen"]), ("en", True))
        async with self.S() as s:
            self.assertEqual(await s.scalar(select(User.lang).where(User.telegram_id == tg)), "en")

    async def test_bad_lang_rejected(self):
        tg = await self.user()
        r = await self.client.put("/api/v1/me/lang", headers=self.h(tg), json={"lang": "de"})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["detail"]["code"], "bad_lang")


class Migration(unittest.TestCase):
    def test_025_adds_and_drops_lang(self):
        import importlib.util
        import pathlib

        import sqlalchemy as sa
        from alembic.migration import MigrationContext
        from alembic.operations import Operations

        path = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "025_user_lang.py"
        spec = importlib.util.spec_from_file_location("mig_025", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        self.assertEqual((mod.revision, mod.down_revision), ("025", "024"))
        engine = sa.create_engine("sqlite://")
        users = Base.metadata.tables["users"]
        meta = sa.MetaData()
        sa.Table("users", meta, *[c._copy() for c in users.columns if c.name != "lang"])
        meta.create_all(engine)

        def run(fn):
            with engine.begin() as conn, Operations.context(MigrationContext.configure(conn)):
                fn()

        run(mod.upgrade)
        self.assertIn("lang", {c["name"] for c in sa.inspect(engine).get_columns("users")})
        run(mod.downgrade)
        self.assertNotIn("lang", {c["name"] for c in sa.inspect(engine).get_columns("users")})
