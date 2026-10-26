"""Ёмкость и Удача майнера.

Ёмкость: +6% добычи за цикл за уровень выше 1 — хранилище растёт и наполняется в той же доле,
к концу цикла заполнено ровно на 100%. Удача: бросок при сборе в границах настройки (−1%..+5%),
доля диапазона растёт с уровнем удачи (полный — с 26-го).

Запуск из папки backend: python -m pytest -q tests/test_capacity_luck.py
"""

import asyncio
import json
import unittest
import warnings
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest import mock

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base
from app.models import User  # noqa: F401 — регистрирует таблицы
from app.models.economy import EconomySetting
from app.models.miner import Miner
from app.services import miner as miner_svc
from app.services.economy_seed import DEFAULTS

warnings.filterwarnings("ignore", message=".*Decimal objects natively.*")

D = Decimal
UTC = timezone.utc
RATE = D(DEFAULTS["miner_base_rate"][0]["ton_per_hour"])
C_MULT = D(DEFAULTS["miner_capacity_mult"][0]["per_level"])
HOURS = float(DEFAULTS["miner_session_hours"][0]["hours"])


def _m(capacity=1, status="running", started=None, ends=None, pending="0", luck=1):
    return SimpleNamespace(power=1, capacity=capacity, acceleration=1, luck=luck, status=status,
                           session_started_at=started, session_ends_at=ends, pending_reward=D(pending))


def _acc(m, now):
    return miner_svc._accrued(m, now=now, base_rate=RATE, power_mult=D("0.08"), capacity_mult=C_MULT, base_hours=HOURS)


class CapacityTest(unittest.TestCase):
    t0 = datetime(2026, 10, 26, 0, 0, tzinfo=UTC)

    def test_cap_factor_6pct_per_level(self):
        self.assertEqual(miner_svc._cap_factor(_m(capacity=1), C_MULT), D("1"))
        self.assertEqual(miner_svc._cap_factor(_m(capacity=6), C_MULT), D("1.30"))

    def test_full_cycle_fills_storage_100pct(self):
        for cap_lvl in (1, 2, 6, 11):
            m = _m(capacity=cap_lvl, started=self.t0, ends=self.t0 + timedelta(hours=HOURS))
            cap = miner_svc._storage_cap(m, RATE, D("0.08"), C_MULT, HOURS)
            self.assertEqual(_acc(m, self.t0 + timedelta(hours=HOURS)), cap, cap_lvl)
            self.assertEqual(_acc(m, self.t0 + timedelta(hours=HOURS * 3)), cap)   # дальше не растёт
            half = _acc(m, self.t0 + timedelta(hours=HOURS / 2))
            self.assertAlmostEqual(float(half / cap), 0.5, places=6)

    def test_capacity_increases_earnings(self):
        end = self.t0 + timedelta(hours=HOURS)
        base = _acc(_m(capacity=1, started=self.t0, ends=end), end)
        more = _acc(_m(capacity=6, started=self.t0, ends=end), end)
        self.assertEqual(more, (base * D("1.30")).quantize(D("0.00000001")))

    def test_ready_without_frozen_value_is_full(self):
        m = _m(capacity=3, status="ready", started=self.t0, ends=self.t0 + timedelta(hours=HOURS))
        self.assertEqual(_acc(m, self.t0), miner_svc._storage_cap(m, RATE, D("0.08"), C_MULT, HOURS))


class LuckRangeTest(unittest.TestCase):
    CFG = DEFAULTS["miner_luck_roll_bp"][0]

    def test_default_bounds(self):
        self.assertEqual(self.CFG, {"min_bp": -100, "max_bp": 500})

    def test_scaled_by_level(self):
        r = miner_svc.luck_range_bp
        self.assertEqual(r(1, self.CFG), (0, 0))
        self.assertEqual(r(2, self.CFG), (-4, 20))
        self.assertEqual(r(11, self.CFG), (-40, 200))
        self.assertEqual(r(26, self.CFG), (-100, 500))
        self.assertEqual(r(60, self.CFG), (-100, 500))

    def test_bounds_from_setting(self):
        self.assertEqual(miner_svc.luck_range_bp(26, {"min_bp": 0, "max_bp": 1000}), (0, 1000))
        self.assertEqual(miner_svc.luck_range_bp(26, None), (-100, 500))


class ClaimFlowTest(unittest.TestCase):
    """SQLite: цикл закончился → хранилище полное → сбор с броском Удачи."""

    def _run(self, *, capacity, luck, roll, luck_cfg=None):
        async def main():
            engine = create_async_engine("sqlite+aiosqlite:///:memory:")
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            try:
                async with async_sessionmaker(engine, expire_on_commit=False, autoflush=False)() as s:
                    if luck_cfg:
                        s.add(EconomySetting(key="miner_luck_roll_bp", value_json=json.dumps(luck_cfg)))
                    u = User(telegram_id=7, balance=D("0"))
                    s.add(u)
                    await s.flush()
                    now = datetime.now(UTC)
                    m = Miner(user_id=u.id, capacity=capacity, luck=luck, status="running",
                              session_started_at=now - timedelta(hours=HOURS + 1),
                              session_ends_at=now - timedelta(hours=1), pending_reward=D("0"))
                    s.add(m)
                    await s.flush()
                    view = await miner_svc.get_miner_view(s, u.id)
                    calls = []

                    def fake(lo, hi):
                        calls.append((lo, hi))
                        return hi if roll == "max" else lo

                    with mock.patch.object(miner_svc.random, "randint", side_effect=fake):
                        _, amount = await miner_svc.claim(s, u.id)
                    return view, amount, calls, D(u.balance)
            finally:
                await engine.dispose()

        return asyncio.run(main())

    def test_storage_full_and_luck_max(self):
        view, amount, calls, bal = self._run(capacity=6, luck=26, roll="max")
        self.assertEqual(view.status, "ready")
        self.assertEqual(view.accrued_now, view.storage_cap)                     # хранилище заполнено
        self.assertAlmostEqual(view.capacity_bonus_pct, 30.0)
        self.assertEqual((view.luck_min_pct, view.luck_max_pct), (-1.0, 5.0))
        self.assertEqual(calls, [(-100, 500)])
        self.assertEqual(amount, (view.storage_cap * D("1.05")).quantize(D("0.00000001")))
        self.assertEqual(bal, amount)

    def test_luck_min_and_custom_bounds(self):
        _, amount, calls, _ = self._run(capacity=1, luck=26, roll="min", luck_cfg={"min_bp": -200, "max_bp": 300})
        self.assertEqual(calls, [(-200, 300)])
        full = (RATE * D(str(HOURS))).quantize(D("0.00000001"))
        self.assertEqual(amount, (full * D("0.98")).quantize(D("0.00000001")))

    def test_luck_level_1_no_roll(self):
        view, amount, calls, _ = self._run(capacity=1, luck=1, roll="max")
        self.assertEqual(calls, [])
        self.assertEqual(amount, view.storage_cap)


if __name__ == "__main__":
    unittest.main()
