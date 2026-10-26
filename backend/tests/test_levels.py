"""Начисление XP с повышением уровня (общая функция для ежедневки, заданий, промо и колеса).

Запуск из папки backend: python -m unittest discover -s tests
"""

import asyncio
import unittest
from decimal import Decimal
from types import SimpleNamespace
from unittest import mock

from app.services import levels
from app.services import prize_wheel as wheel

CURVE = {"base": 100, "growth": 1.35}


async def _curve(_s, key):
    assert key == "xp_per_level"
    return CURVE


def _add(user, xp):
    with mock.patch.object(levels, "get_setting", _curve):
        return asyncio.run(levels.add_xp(None, user, xp))


class AddXpTest(unittest.TestCase):
    def test_below_threshold_no_level(self):
        u = SimpleNamespace(xp=0, level=1)
        self.assertEqual(_add(u, 60), 0)
        self.assertEqual((u.level, u.xp), (1, 60))

    def test_exact_threshold_levels_up(self):
        u = SimpleNamespace(xp=40, level=1)
        self.assertEqual(_add(u, 60), 1)
        self.assertEqual((u.level, u.xp), (2, 0))

    def test_several_levels_at_once(self):
        # 100 (1→2) + 135 (2→3) = 235, остаток 15
        u = SimpleNamespace(xp=0, level=1)
        self.assertEqual(_add(u, 250), 2)
        self.assertEqual((u.level, u.xp), (3, 15))

    def test_zero_xp_noop(self):
        u = SimpleNamespace(xp=99, level=1)
        self.assertEqual(_add(u, 0), 0)
        self.assertEqual((u.level, u.xp), (1, 99))


class WheelXpLevelsUpTest(unittest.TestCase):
    """XP с колеса удачи сразу повышает уровень (раньше копился без роста уровня)."""

    def test_wheel_xp_levels_up(self):
        cfg = {"free_spins_per_day": 1, "items": [{"id": "xp_150", "label": "150 XP", "weight": 1, "xp": 150}]}

        async def fake_get_setting(_s, key):
            return CURVE if key == "xp_per_level" else cfg

        async def zero(*_a, **_k):
            return 0

        session = SimpleNamespace(add=lambda *_: None, flush=mock.AsyncMock())
        user = SimpleNamespace(
            id=1, xp=0, level=1, focus_tokens=0, block_tokens=0, success_boost_bp=0, balance=Decimal("0")
        )
        with mock.patch.object(wheel, "get_setting", fake_get_setting), mock.patch.object(
            levels, "get_setting", fake_get_setting
        ), mock.patch.object(wheel, "_spins_today", zero), mock.patch.object(
            wheel.balance_svc, "get_user_for_update", mock.AsyncMock(return_value=user)
        ):
            res = asyncio.run(wheel.spin(session, user=user))
        self.assertEqual(res.reward_xp, 150)
        self.assertEqual((user.level, user.xp), (2, 50))


if __name__ == "__main__":
    unittest.main()
