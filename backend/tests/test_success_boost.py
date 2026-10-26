"""Бонус «+N% к успеху» с колеса: копится до потолка (настройка), тратится целиком на следующей
попытке усиления — и при успехе, и при неудаче.

Запуск из папки backend: python -m pytest -q tests/test_success_boost.py
"""

import asyncio
import json
import unittest
import warnings
from decimal import Decimal
from unittest import mock

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models import User  # noqa: F401 — регистрирует таблицы
from app.models.economy import EconomySetting
from app.models.miner import Miner
from app.services import prize_wheel, upgrade

warnings.filterwarnings("ignore", message=".*Decimal objects natively.*")

BOOST_WHEEL = {"free_spins_per_day": 99, "items": [{"id": "success_plus_5", "label": "+5%", "weight": 1, "success_boost_bp": 500}]}


def run(fn, settings=None):
    async def main():
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        try:
            async with async_sessionmaker(engine, expire_on_commit=False, autoflush=False)() as s:
                for k, v in {"prize_wheel": BOOST_WHEEL, **(settings or {})}.items():
                    s.add(EconomySetting(key=k, value_json=json.dumps(v)))
                u = User(telegram_id=7, balance=Decimal("10"))
                s.add(u)
                await s.flush()
                s.add(Miner(user_id=u.id))
                await s.flush()
                await fn(s, u)
        finally:
            await engine.dispose()

    asyncio.run(main())


async def _spins(s, u, n):
    for _ in range(n):
        await prize_wheel.spin(s, user=u)


class WheelStackTest(unittest.TestCase):
    def test_stacks_up_to_default_cap(self):
        async def body(s, u):
            await _spins(s, u, 2)
            self.assertEqual(u.success_boost_bp, 1000)
            await _spins(s, u, 3)
            self.assertEqual(u.success_boost_bp, 1500)  # потолок по умолчанию +15%
        run(body)

    def test_cap_is_a_setting(self):
        async def body(s, u):
            await _spins(s, u, 3)
            self.assertEqual(u.success_boost_bp, 800)
        run(body, {"success_boost_cap_bp": {"bp": 800}})


class UpgradeSpendsBoostTest(unittest.TestCase):
    def _attempt(self, roll):
        out = {}

        async def body(s, u):
            await _spins(s, u, 2)
            with mock.patch.object(upgrade.random, "randint", return_value=roll):
                r1 = await upgrade.attempt_upgrade(s, user_id=u.id)
            out["first"] = r1
            out["after"] = u.success_boost_bp
            with mock.patch.object(upgrade.random, "randint", return_value=roll):
                out["second"] = await upgrade.attempt_upgrade(s, user_id=u.id)
        run(body)
        return out

    def test_spent_on_success(self):
        out = self._attempt(1)
        self.assertTrue(out["first"].success)
        self.assertEqual(out["after"], 0)
        self.assertGreaterEqual(out["first"].success_chance_bp - out["second"].success_chance_bp, 1000)

    def test_spent_on_fail(self):
        out = self._attempt(10000)
        self.assertFalse(out["first"].success)
        self.assertEqual(out["after"], 0)
        # без бонуса и без роста уровня шанс второй попытки ровно на 10% ниже
        self.assertEqual(out["first"].success_chance_bp - out["second"].success_chance_bp, 1000)


if __name__ == "__main__":
    unittest.main()
