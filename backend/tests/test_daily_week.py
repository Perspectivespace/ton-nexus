"""Ежедневка — 7 дней по кругу: после 7-го дня снова день 1, а серия растёт дальше.

Запуск из папки backend: python -m pytest -q tests/test_daily_week.py
"""

import asyncio
import json
import unittest
import warnings
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models import User  # noqa: F401 — регистрирует таблицы
from app.models.economy import EconomySetting
from app.services import daily
from app.services.economy_seed import DEFAULTS

warnings.filterwarnings("ignore", message=".*Decimal objects natively.*")

MSK = timezone(timedelta(hours=3))
D = Decimal
WEEK = DEFAULTS["daily_rewards"][0]


class CycleTest(unittest.TestCase):
    def test_cycle_day(self):
        self.assertEqual([daily.cycle_day(s) for s in (1, 6, 7, 8, 14, 15, 22)], [1, 6, 7, 1, 7, 1, 1])

    def test_defaults_have_7_days(self):
        self.assertEqual(sorted(WEEK), [f"day_{d}" for d in range(1, 8)])
        self.assertEqual(WEEK["day_4"], {"ton": "0.0025", "xp": 12})
        self.assertEqual(WEEK["day_5"], {"ton": "0.003", "xp": 15})
        self.assertEqual(WEEK["day_6"], {"ton": "0.0035", "xp": 18})
        self.assertEqual(WEEK["day_7"], {"ton": "0.005", "xp": 25, "focus": 1})

    def test_old_settings_without_days_4_6_use_defaults(self):
        old = {"day_1": {"ton": "0.001", "xp": 5}, "day_2": {"ton": "0.0015", "xp": 8},
               "day_3": {"ton": "0.002", "xp": 10}, "day_7": {"ton": "0.005", "xp": 25, "focus": 1}}
        self.assertEqual(daily._reward_for_streak(old, 5), WEEK["day_5"])
        week = daily.week_rewards(old)
        self.assertEqual([w["day"] for w in week], list(range(1, 8)))
        self.assertEqual(week[3], {"day": 4, "ton": "0.0025", "xp": 12, "focus": 0})

    def test_owner_value_wins(self):
        cfg = {**WEEK, "day_4": {"ton": "0.1", "xp": 1}}
        self.assertEqual(daily._reward_for_streak(cfg, 11), {"ton": "0.1", "xp": 1})


class LoopTest(unittest.TestCase):
    def test_nine_days_in_a_row(self):
        async def main():
            engine = create_async_engine("sqlite+aiosqlite:///:memory:")
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            try:
                async with async_sessionmaker(engine, expire_on_commit=False, autoflush=False)() as s:
                    s.add(EconomySetting(key="daily_rewards", value_json=json.dumps(WEEK)))
                    u = User(telegram_id=5, balance=D("0"))
                    s.add(u)
                    await s.flush()
                    out = []
                    start = datetime(2026, 11, 2, 12, 0, tzinfo=MSK)
                    for i in range(9):
                        now = start + timedelta(days=i)
                        before = await daily.daily_status(s, user_id=u.id, now=now)
                        r = await daily.claim_daily(s, user=u, now=now)
                        after = await daily.daily_status(s, user_id=u.id, now=now)
                        out.append((before["cycle_day"], r.streak, r.reward_ton, r.reward_focus, after["cycle_day"]))
                    return out, u
            finally:
                await engine.dispose()

        out, u = asyncio.run(main())
        self.assertEqual([o[1] for o in out], list(range(1, 10)))            # серия растёт дальше 7
        self.assertEqual([o[0] for o in out], [1, 2, 3, 4, 5, 6, 7, 1, 2])   # до отметки — день круга
        self.assertEqual([o[4] for o in out], [1, 2, 3, 4, 5, 6, 7, 1, 2])   # после — тот же день
        self.assertEqual([o[2] for o in out][6:], [D("0.005"), D("0.001"), D("0.0015")])
        self.assertEqual([o[3] for o in out], [0, 0, 0, 0, 0, 0, 1, 0, 0])
        self.assertEqual(D(u.balance), sum((D(WEEK[f"day_{d}"]["ton"]) for d in range(1, 8)), D("0")) + D("0.0025"))


class AdminFormTest(unittest.TestCase):
    def test_old_row_shows_all_7_days(self):
        from app.services import economy_admin

        old = {"day_1": {"ton": "0.001", "xp": 5}, "day_2": {"ton": "0.0015", "xp": 8},
               "day_3": {"ton": "0.002", "xp": 10}, "day_7": {"ton": "0.009", "xp": 30, "focus": 2}}

        async def main():
            engine = create_async_engine("sqlite+aiosqlite:///:memory:")
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            try:
                async with async_sessionmaker(engine, expire_on_commit=False, autoflush=False)() as s:
                    s.add(EconomySetting(key="daily_rewards", value_json=json.dumps(old)))
                    await s.flush()
                    one = await economy_admin.get_setting_admin(s, "daily_rewards")
                    all_ = {v.key: v for v in await economy_admin.list_settings(s)}
                    return one.value, all_["daily_rewards"].value
            finally:
                await engine.dispose()

        one, listed = asyncio.run(main())
        for v in (one, listed):
            self.assertEqual(list(v), [f"day_{d}" for d in range(1, 8)])
            self.assertEqual(v["day_7"], old["day_7"])        # значение владельца не трогаем
            self.assertEqual(v["day_5"], WEEK["day_5"])       # недостающий день — по умолчанию


if __name__ == "__main__":
    unittest.main()
